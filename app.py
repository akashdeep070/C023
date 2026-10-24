"""Lex AI: a small cloud vault for legal files, with Groq-powered reading."""

import collections
import datetime as dt
import json
import os
import socket
import time

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template, request,
                   send_from_directory, url_for)


def _load_env(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")):
    """Read KEY=value lines from .env so `python app.py` picks up GROQ_API_KEY."""
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env()

import ai  # noqa: E402  (after .env so the key is visible)
import db  # noqa: E402
import extract  # noqa: E402
import seed  # noqa: E402
import vault  # noqa: E402

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "lex-ai-demo")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB per file, as on the slides
app.teardown_appcontext(db.close)

INSTANCE = os.environ.get("INSTANCE_NAME") or socket.gethostname()
STARTED = time.time()
METRICS = {"latency": collections.deque(maxlen=2000), "requests": 0, "errors": 0}


def _setup():
    conn = db.init()
    empty = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0
    if empty and os.environ.get("SEED_DEMO", "1") == "1":
        seed.run(conn)
    conn.close()


_setup()


# ---------------------------------------------------------------- metrics

@app.before_request
def _start_timer():
    g.t0 = time.perf_counter()


@app.after_request
def _record(resp):
    if request.endpoint not in ("static", "health"):
        METRICS["requests"] += 1
        METRICS["latency"].append((time.perf_counter() - g.t0) * 1000)
        if resp.status_code >= 500:
            METRICS["errors"] += 1
    resp.headers["X-Served-By"] = INSTANCE
    return resp


# ---------------------------------------------------------------- formatting

def inr(value):
    """Indian digit grouping: 340000 -> ₹3,40,000."""
    n = int(round(value or 0))
    sign, s = ("-" if n < 0 else ""), str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return f"{sign}₹{s}"


def _date(value):
    if not value:
        return None
    if isinstance(value, dt.date):
        return value
    return dt.date.fromisoformat(str(value)[:10])


def _fmt(d, fmt):
    # "%-d" (day without zero padding) is not portable to Windows, so fill it in by hand
    return d.strftime(fmt.replace("%-d", str(d.day)))


def nice_date(value, fmt="%-d %b %Y"):
    d = _date(value)
    return _fmt(d, fmt) if d else "—"


def nice_time(value):
    if not value:
        return "—"
    t = dt.datetime.fromisoformat(value)
    today = dt.date.today()
    if t.date() == today:
        return "Today, " + t.strftime("%H:%M")
    if t.date() == today - dt.timedelta(days=1):
        return "Yesterday, " + t.strftime("%H:%M")
    return _fmt(t, "%-d %b, %H:%M")


def days_until(value):
    d = _date(value)
    if not d:
        return ""
    n = (d - dt.date.today()).days
    if n == 0:
        return "Today"
    if n == 1:
        return "Tomorrow"
    if n == -1:
        return "Yesterday"
    return f"In {n} days" if n > 0 else f"{-n} days ago"


def filesize(n):
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


app.jinja_env.filters.update(inr=inr, date=nice_date, time=nice_time, until=days_until, filesize=filesize,
                             fromjson=json.loads)


def _section(endpoint):
    for prefix, section in (("document", "documents"), ("upload", "documents"), ("hearing", "hearings"),
                            ("client", "clients"), ("invoice", "invoices")):
        if endpoint.startswith(prefix):
            return section
    return endpoint


@app.context_processor
def _globals():
    return {"instance": INSTANCE, "ai_on": ai.enabled(), "ai_model": ai.text_model(),
            "today": dt.date.today(), "section": _section(request.endpoint or "")}


# ---------------------------------------------------------------- queries

def invoice_totals(conn, invoice_id):
    inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    items = conn.execute("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", (invoice_id,)).fetchall()
    payments = conn.execute("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on", (invoice_id,)).fetchall()
    total = sum(i["qty"] * i["rate"] for i in items)
    paid = sum(p["amount"] for p in payments)
    balance = total - inv["retainer"] - paid
    if balance <= 0:
        status = "Paid"
    elif _date(inv["due"]) < dt.date.today():
        status = "Overdue"
    elif inv["retainer"] or paid:
        status = "Part paid"
    else:
        status = "Unpaid"
    return {"inv": inv, "lines": items, "payments": payments, "total": total, "paid": paid,
            "balance": max(balance, 0), "status": status}


def client_rows(conn, q=""):
    sql = """
        SELECT c.*,
          (SELECT COUNT(DISTINCT case_number) FROM documents d WHERE d.client_id = c.id AND d.case_number != '') AS matters,
          (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id) AS docs,
          (SELECT MIN(hearing_date) FROM documents d WHERE d.client_id = c.id
             AND hearing_confirmed = 1 AND hearing_date >= date('now', 'localtime')) AS next_hearing
        FROM clients c
    """
    args = []
    if q:
        sql += """ WHERE c.name LIKE ? OR c.code LIKE ? OR c.lawyer LIKE ? OR c.matter LIKE ?
                   OR c.id IN (SELECT client_id FROM documents WHERE case_number LIKE ?)"""
        args = [f"%{q}%"] * 5
    rows = []
    for c in conn.execute(sql + " ORDER BY c.code", args):
        ids = [r["id"] for r in conn.execute("SELECT id FROM invoices WHERE client_id = ?", (c["id"],))]
        balance = sum(invoice_totals(conn, i)["balance"] for i in ids)
        rows.append({**dict(c), "balance": balance, "invoices": len(ids)})
    return rows


def get_doc(conn, doc_id):
    doc = conn.execute("""SELECT d.*, c.name AS client_name, c.code AS client_code
                          FROM documents d LEFT JOIN clients c ON c.id = d.client_id WHERE d.id = ?""",
                       (doc_id,)).fetchone()
    if not doc:
        abort(404)
    return doc


def recent_activity(conn, limit=8, where="", args=()):
    return conn.execute(f"""SELECT a.*, d.title AS doc_title, c.name AS client_name FROM audit a
                            LEFT JOIN documents d ON d.id = a.document_id
                            LEFT JOIN clients c ON c.id = a.client_id
                            {where} ORDER BY a.ts DESC, a.id DESC LIMIT ?""", (*args, limit)).fetchall()


# ---------------------------------------------------------------- pages

@app.route("/")
def dashboard():
    conn = db.get()
    today = dt.date.today().isoformat()
    stats = {
        "documents": conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0],
        "clients": conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0],
        "hearings": conn.execute("SELECT COUNT(*) FROM documents WHERE hearing_confirmed = 1 AND hearing_date >= ?",
                                 (today,)).fetchone()[0],
        "review": conn.execute("SELECT COUNT(*) FROM documents WHERE status = 'Awaiting review'").fetchone()[0],
        "to_confirm": conn.execute("SELECT COUNT(*) FROM documents WHERE hearing_date >= ? AND hearing_confirmed = 0",
                                   (today,)).fetchone()[0],
    }
    hearings = conn.execute("""SELECT d.*, c.name AS client_name FROM documents d
                               LEFT JOIN clients c ON c.id = d.client_id
                               WHERE d.hearing_date >= ? ORDER BY d.hearing_date LIMIT 5""", (today,)).fetchall()
    recent = conn.execute("""SELECT d.*, c.name AS client_name FROM documents d
                             LEFT JOIN clients c ON c.id = d.client_id ORDER BY d.created_at DESC LIMIT 4""").fetchall()
    return render_template("dashboard.html", stats=stats, hearings=hearings, recent=recent,
                           activity=recent_activity(conn, 7))


@app.route("/upload", methods=["GET", "POST"])
def upload():
    conn = db.get()
    clients = conn.execute("SELECT * FROM clients ORDER BY name").fetchall()
    if request.method == "POST":
        file = request.files.get("file")
        if not file or not file.filename:
            flash("Choose a file to upload.", "error")
            return redirect(url_for("upload"))
        if not extract.allowed(file.filename):
            flash("Lex AI accepts PDF, text and image files (PNG, JPG, WEBP).", "error")
            return redirect(url_for("upload"))
        client_id = request.form.get("client_id") or None
        new_client = request.form.get("new_client", "").strip()
        if client_id == "new" and new_client:
            client_id = _create_client(conn, new_client)
        elif client_id == "new":
            client_id = None
        data = file.read()
        title = request.form.get("title", "").strip() or os.path.splitext(file.filename)[0].replace("-", " ").replace("_", " ").capitalize()
        try:
            doc_id = vault.ingest(conn, data, file.filename, title=title, client_id=client_id,
                                  case_number=request.form.get("case_number", "").strip(),
                                  doc_type=request.form.get("doc_type", ""))
        except Exception as exc:
            conn.rollback()
            flash(f"That file could not be read: {exc}", "error")
            return redirect(url_for("upload"))
        conn.commit()
        flash("Uploaded, fingerprinted and summarized.", "ok")
        return redirect(url_for("document", doc_id=doc_id))
    return render_template("upload.html", clients=clients, doc_types=ai.DOC_TYPES,
                           preselect=request.args.get("client", type=int))


@app.route("/documents")
def documents():
    conn = db.get()
    q = request.args.get("q", "").strip()
    doc_type = request.args.get("type", "")
    sql = """SELECT d.*, c.name AS client_name, v.size, v.filename, v.version FROM documents d
             LEFT JOIN clients c ON c.id = d.client_id
             JOIN versions v ON v.document_id = d.id
               AND v.version = (SELECT MAX(version) FROM versions WHERE document_id = d.id)
             WHERE 1 = 1"""
    args = []
    if q:
        sql += """ AND (d.title LIKE ? OR d.case_number LIKE ? OR c.name LIKE ? OR d.parties LIKE ?
                   OR d.summary LIKE ? OR v.pages LIKE ? OR d.hearing_date LIKE ? OR d.created_at LIKE ?)"""
        args += [f"%{q}%"] * 8
    if doc_type:
        sql += " AND d.doc_type = ?"
        args.append(doc_type)
    t0 = time.perf_counter()
    rows = conn.execute(sql + " ORDER BY d.created_at DESC", args).fetchall()
    took = (time.perf_counter() - t0) * 1000
    types = [r[0] for r in conn.execute("SELECT DISTINCT doc_type FROM documents ORDER BY doc_type")]
    return render_template("documents.html", rows=rows, q=q, doc_type=doc_type, types=types, took=took)


@app.route("/documents/<int:doc_id>")
def document(doc_id):
    conn = db.get()
    doc = get_doc(conn, doc_id)
    versions = conn.execute("SELECT * FROM versions WHERE document_id = ? ORDER BY version DESC", (doc_id,)).fetchall()
    pages = vault.pages_of(versions[0]) if versions else []
    return render_template("document.html", doc=doc, versions=versions, pages=pages,
                           key_points=json.loads(doc["key_points"] or "[]"),
                           activity=recent_activity(conn, 12, "WHERE a.document_id = ?", (doc_id,)),
                           integrity=request.args.get("checked") and vault.verify(conn, doc_id))


@app.route("/documents/<int:doc_id>/file/<int:version>")
def document_file(doc_id, version):
    conn = db.get()
    v = conn.execute("SELECT * FROM versions WHERE document_id = ? AND version = ?", (doc_id, version)).fetchone()
    if not v:
        abort(404)
    vault.log(conn, "Opened", f"{v['filename']} · v{version}", doc_id)
    conn.commit()
    return send_from_directory(db.UPLOAD_DIR, v["stored_name"], mimetype=v["mime"],
                               download_name=v["filename"], as_attachment=request.args.get("dl") == "1")


@app.post("/documents/<int:doc_id>/version")
def document_version(doc_id):
    conn = db.get()
    doc = get_doc(conn, doc_id)
    file = request.files.get("file")
    if not file or not file.filename or not extract.allowed(file.filename):
        flash("Choose a PDF, text or image file.", "error")
        return redirect(url_for("document", doc_id=doc_id))
    vault.ingest(conn, file.read(), file.filename, title=doc["title"], document_id=doc_id)
    conn.commit()
    flash("New version saved. Earlier versions are kept.", "ok")
    return redirect(url_for("document", doc_id=doc_id))


@app.post("/documents/<int:doc_id>/reanalyze")
def document_reanalyze(doc_id):
    conn = db.get()
    get_doc(conn, doc_id)
    v = vault.latest_version(conn, doc_id)
    result = ai.analyze(vault.pages_of(v))
    conn.execute("""UPDATE documents SET summary = ?, key_points = ?, ai_source = ?, parties = COALESCE(NULLIF(?, ''), parties),
                    hearing_date = ?, hearing_page = ?, hearing_confirmed = 0, updated_at = ? WHERE id = ?""",
                 (result["summary"], json.dumps(result["key_points"]), result["source"], result.get("parties", ""),
                  result["hearing_date"], result["hearing_page"], vault.now(), doc_id))
    vault.log(conn, "AI summary", "Re-read by " + ("Groq" if result["source"] == "groq" else "local reader"),
              doc_id, actor="Automation")
    conn.commit()
    if result.get("error"):
        flash("Groq was unreachable, so the local reader was used.", "error")
    else:
        flash("Summary refreshed.", "ok")
    return redirect(url_for("document", doc_id=doc_id))


@app.post("/documents/<int:doc_id>/review")
def document_review(doc_id):
    conn = db.get()
    get_doc(conn, doc_id)
    conn.execute("UPDATE documents SET status = 'Reviewed', updated_at = ? WHERE id = ?", (vault.now(), doc_id))
    vault.log(conn, "Reviewed", "Summary checked by lawyer", doc_id)
    conn.commit()
    flash("Marked as reviewed.", "ok")
    return redirect(url_for("document", doc_id=doc_id))


@app.post("/documents/<int:doc_id>/hearing")
def document_hearing(doc_id):
    conn = db.get()
    get_doc(conn, doc_id)
    action = request.form.get("action")
    if action == "clear":
        conn.execute("UPDATE documents SET hearing_date = '', hearing_page = NULL, hearing_confirmed = 0 WHERE id = ?",
                     (doc_id,))
        vault.log(conn, "Hearing removed", "", doc_id)
        flash("Hearing date removed.", "ok")
    else:
        date = request.form.get("date", "")
        try:
            dt.date.fromisoformat(date)
        except ValueError:
            flash("Enter a valid date.", "error")
            return redirect(url_for("document", doc_id=doc_id))
        conn.execute("UPDATE documents SET hearing_date = ?, hearing_confirmed = 1, reminder_sent = 0 WHERE id = ?",
                     (date, doc_id))
        send_on = (dt.date.fromisoformat(date) - dt.timedelta(days=1))
        vault.log(conn, "Hearing confirmed", f"{nice_date(date)} · reminder on {nice_date(send_on)}", doc_id)
        flash(f"Hearing confirmed. A reminder goes out on {nice_date(send_on)}.", "ok")
    conn.commit()
    return redirect(url_for("document", doc_id=doc_id))


@app.post("/documents/<int:doc_id>/verify")
def document_verify(doc_id):
    conn = db.get()
    get_doc(conn, doc_id)
    results = vault.verify(conn, doc_id)
    bad = [r for r in results if not r["ok"]]
    if bad:
        vault.log(conn, "Integrity alert", f"{len(bad)} version(s) do not match their SHA-256 fingerprint",
                  doc_id, actor="Automation")
        flash("Fingerprint mismatch. The file was changed after upload.", "error")
    else:
        vault.log(conn, "Integrity verified", f"{len(results)} version(s) match SHA-256", doc_id, actor="Automation")
        flash("Every version matches its SHA-256 fingerprint.", "ok")
    conn.commit()
    return redirect(url_for("document", doc_id=doc_id, checked=1) + "#integrity")


@app.post("/documents/<int:doc_id>/tamper")
def document_tamper(doc_id):
    conn = db.get()
    get_doc(conn, doc_id)
    v = vault.latest_version(conn, doc_id)
    vault.tamper(v["stored_name"])
    vault.log(conn, "File overwritten", f"v{v['version']} changed outside Lex AI (demo)", doc_id, actor="Unknown script")
    conn.commit()
    flash("Demo: the working copy was overwritten. Now run Verify.", "error")
    return redirect(url_for("document", doc_id=doc_id) + "#integrity")


@app.post("/documents/<int:doc_id>/restore")
def document_restore(doc_id):
    conn = db.get()
    get_doc(conn, doc_id)
    restored = [r["version"] for r in vault.verify(conn, doc_id) if not r["ok"] and vault.restore(r["stored_name"])]
    vault.log(conn, "Restored", f"Locked copy restored for v{', v'.join(map(str, restored))}" if restored
              else "Nothing to restore", doc_id)
    conn.commit()
    flash("Restored from the locked copy." if restored else "Nothing needed restoring.", "ok")
    return redirect(url_for("document", doc_id=doc_id, checked=1) + "#integrity")


@app.post("/api/documents/<int:doc_id>/ask")
def document_ask(doc_id):
    conn = db.get()
    get_doc(conn, doc_id)
    question = (request.get_json(silent=True) or {}).get("question", "").strip()[:300]
    if not question:
        return jsonify(error="Type a question."), 400
    t0 = time.perf_counter()
    result = ai.ask(question, vault.pages_of(vault.latest_version(conn, doc_id)))
    result["ms"] = round((time.perf_counter() - t0) * 1000)
    vault.log(conn, "Asked the file", question, doc_id)
    conn.commit()
    return jsonify(result)


@app.route("/hearings")
def hearings():
    conn = db.get()
    today = dt.date.today()
    rows = conn.execute("""SELECT d.*, c.name AS client_name FROM documents d
                           LEFT JOIN clients c ON c.id = d.client_id
                           WHERE d.hearing_date != '' ORDER BY d.hearing_date""").fetchall()
    upcoming = [r for r in rows if r["hearing_confirmed"] and _date(r["hearing_date"]) >= today]
    pending = [r for r in rows if not r["hearing_confirmed"] and _date(r["hearing_date"]) >= today]
    past = [r for r in rows if _date(r["hearing_date"]) < today][::-1][:8]
    due = [r for r in upcoming if not r["reminder_sent"] and _date(r["hearing_date"]) - dt.timedelta(days=1) <= today]
    # A small month calendar; ?m=YYYY-MM moves between months
    try:
        first = dt.date.fromisoformat(request.args.get("m", "") + "-01")
    except ValueError:
        first = today.replace(day=1)
    prev_m = (first - dt.timedelta(days=1)).strftime("%Y-%m")
    next_m = (first + dt.timedelta(days=32)).strftime("%Y-%m")
    start = first - dt.timedelta(days=first.weekday())
    marks = collections.defaultdict(list)
    for r in rows:
        marks[r["hearing_date"]].append(r)
    weeks = [[start + dt.timedelta(days=w * 7 + i) for i in range(7)] for w in range(6)]
    if weeks[-1][0].month != first.month:
        weeks = weeks[:-1]
    return render_template("hearings.html", upcoming=upcoming, pending=pending, past=past, due=due,
                           weeks=weeks, marks=marks, month=first, prev_m=prev_m, next_m=next_m)


@app.post("/hearings/remind")
def hearings_remind():
    conn = db.get()
    today = dt.date.today().isoformat()
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    due = conn.execute("""SELECT d.*, c.lawyer, c.name AS client_name FROM documents d
                          LEFT JOIN clients c ON c.id = d.client_id
                          WHERE hearing_confirmed = 1 AND reminder_sent = 0 AND hearing_date BETWEEN ? AND ?""",
                       (today, tomorrow)).fetchall()
    for d in due:
        conn.execute("UPDATE documents SET reminder_sent = 1 WHERE id = ?", (d["id"],))
        vault.log(conn, "Reminder email sent",
                  f"To {d['lawyer'] or 'the lawyer'}: {d['case_number'] or d['title']} on {nice_date(d['hearing_date'])}",
                  d["id"], actor="Scheduler")
    conn.commit()
    flash(f"{len(due)} reminder email(s) sent." if due else "No reminders are due yet.", "ok")
    return redirect(url_for("hearings"))


def _create_client(conn, name, **extra):
    n = conn.execute("SELECT COALESCE(MAX(CAST(SUBSTR(code, 4) AS INTEGER)), 13) + 1 FROM clients").fetchone()[0]
    code = f"CL-{n:03d}"
    cur = conn.execute(
        "INSERT INTO clients (code, name, matter, email, phone, lawyer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (code, name, extra.get("matter", ""), extra.get("email", ""), extra.get("phone", ""),
         extra.get("lawyer", ""), vault.now()))
    vault.log(conn, "Client added", f"{name} · {code}", client_id=cur.lastrowid)
    return cur.lastrowid


@app.route("/clients", methods=["GET", "POST"])
def clients():
    conn = db.get()
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("A client needs a name.", "error")
            return redirect(url_for("clients"))
        cid = _create_client(conn, name, **{k: request.form.get(k, "").strip()
                                            for k in ("matter", "email", "phone", "lawyer")})
        conn.commit()
        flash("Client added.", "ok")
        return redirect(url_for("client", client_id=cid))
    q = request.args.get("q", "").strip()
    rows = client_rows(conn, q)
    all_rows = rows if not q else client_rows(conn)
    stats = {
        "clients": len(all_rows),
        "matters": sum(r["matters"] for r in all_rows),
        "invoices_due": sum(1 for i in conn.execute("SELECT id FROM invoices")
                            if invoice_totals(conn, i["id"])["balance"] > 0),
        "outstanding": sum(r["balance"] for r in all_rows),
    }
    return render_template("clients.html", rows=rows, q=q, stats=stats)


@app.route("/clients/<int:client_id>")
def client(client_id):
    conn = db.get()
    c = conn.execute("SELECT * FROM clients WHERE id = ?", (client_id,)).fetchone()
    if not c:
        abort(404)
    docs = conn.execute("SELECT * FROM documents WHERE client_id = ? ORDER BY created_at DESC", (client_id,)).fetchall()
    matters = collections.OrderedDict()
    for d in docs:
        key = d["case_number"] or "General"
        matters.setdefault(key, {"docs": 0, "next": None})
        matters[key]["docs"] += 1
        if d["hearing_confirmed"] and d["hearing_date"] >= dt.date.today().isoformat():
            cur = matters[key]["next"]
            matters[key]["next"] = min(cur, d["hearing_date"]) if cur else d["hearing_date"]
    invoices = [invoice_totals(conn, r["id"]) for r in
                conn.execute("SELECT id FROM invoices WHERE client_id = ? ORDER BY issued DESC", (client_id,))]
    return render_template("client.html", c=c, docs=docs, matters=matters, invoices=invoices,
                           balance=sum(i["balance"] for i in invoices),
                           activity=recent_activity(conn, 15, "WHERE a.client_id = ?", (client_id,)))


@app.route("/billing")
def invoices():
    conn = db.get()
    rows = []
    for r in conn.execute("""SELECT i.id, c.name AS client_name FROM invoices i
                             JOIN clients c ON c.id = i.client_id ORDER BY i.issued DESC, i.id DESC"""):
        rows.append({**invoice_totals(conn, r["id"]), "client_name": r["client_name"]})
    totals = {
        "billed": sum(r["total"] for r in rows),
        "received": sum(r["total"] - r["balance"] for r in rows),
        "outstanding": sum(r["balance"] for r in rows),
    }
    return render_template("invoices.html", rows=rows, totals=totals)


@app.route("/billing/new", methods=["GET", "POST"])
def invoice_new():
    conn = db.get()
    if request.method == "POST":
        f = request.form
        items = [(s.strip(), int(q or 0), int(r or 0)) for s, q, r in
                 zip(f.getlist("service"), f.getlist("qty"), f.getlist("rate")) if s.strip()]
        if not f.get("client_id") or not items:
            flash("Pick a client and add at least one line.", "error")
            return redirect(url_for("invoice_new"))
        year = dt.date.today().year
        n = conn.execute("SELECT COUNT(*) FROM invoices").fetchone()[0] + 14
        number = f"INV-{year}-{n:03d}"
        while conn.execute("SELECT 1 FROM invoices WHERE number = ?", (number,)).fetchone():
            n += 1
            number = f"INV-{year}-{n:03d}"
        cur = conn.execute(
            "INSERT INTO invoices (number, client_id, case_number, issued, due, retainer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (number, int(f["client_id"]), f.get("case_number", "").strip(), f.get("issued") or dt.date.today().isoformat(),
             f.get("due") or (dt.date.today() + dt.timedelta(days=14)).isoformat(), int(f.get("retainer") or 0), vault.now()))
        conn.executemany("INSERT INTO invoice_items (invoice_id, service, qty, rate) VALUES (?, ?, ?, ?)",
                         [(cur.lastrowid, *i) for i in items])
        vault.log(conn, "Invoice issued", number, client_id=int(f["client_id"]))
        conn.commit()
        flash(f"{number} created.", "ok")
        return redirect(url_for("invoice", invoice_id=cur.lastrowid))
    return render_template("invoice_new.html", clients=conn.execute("SELECT * FROM clients ORDER BY name").fetchall(),
                           preselect=request.args.get("client", type=int),
                           due=(dt.date.today() + dt.timedelta(days=14)).isoformat())


@app.route("/billing/<int:invoice_id>")
def invoice(invoice_id):
    conn = db.get()
    if not conn.execute("SELECT 1 FROM invoices WHERE id = ?", (invoice_id,)).fetchone():
        abort(404)
    t = invoice_totals(conn, invoice_id)
    c = conn.execute("SELECT * FROM clients WHERE id = ?", (t["inv"]["client_id"],)).fetchone()
    return render_template("invoice.html", t=t, c=c)


@app.post("/billing/<int:invoice_id>/payment")
def invoice_payment(invoice_id):
    conn = db.get()
    t = invoice_totals(conn, invoice_id)
    amount = request.form.get("amount", type=int) or 0
    if amount <= 0:
        flash("Enter an amount.", "error")
    else:
        conn.execute("INSERT INTO payments (invoice_id, amount, method, paid_on) VALUES (?, ?, ?, ?)",
                     (invoice_id, amount, request.form.get("method", ""), dt.date.today().isoformat()))
        vault.log(conn, "Payment recorded", f"{inr(amount)} on {t['inv']['number']}", client_id=t["inv"]["client_id"])
        conn.commit()
        flash(f"{inr(amount)} recorded.", "ok")
    return redirect(url_for("invoice", invoice_id=invoice_id))


@app.route("/activity")
def activity():
    return render_template("activity.html", rows=recent_activity(db.get(), 200))


def _percentile(values, p):
    if not values:
        return 0
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


def _status():
    lat = list(METRICS["latency"])
    checks = {}
    try:
        db.get().execute("SELECT 1").fetchone()
        checks["database"] = True
    except Exception:
        checks["database"] = False
    checks["storage"] = os.access(db.UPLOAD_DIR, os.W_OK)
    return {
        "status": "ok" if all(checks.values()) else "degraded",
        "instance": INSTANCE,
        "uptime_s": round(time.time() - STARTED),
        "requests": METRICS["requests"],
        "errors": METRICS["errors"],
        "error_rate": (METRICS["errors"] / METRICS["requests"] * 100) if METRICS["requests"] else 0,
        "avg_ms": sum(lat) / len(lat) if lat else 0,
        "p95_ms": _percentile(lat, 95),
        "p99_ms": _percentile(lat, 99),
        "checks": checks,
        "ai": {"enabled": ai.enabled(), "model": ai.text_model(), "vision_model": ai.vision_model()},
    }


@app.route("/health")
def health():
    s = _status()
    return jsonify(s), (200 if s["status"] == "ok" else 503)


@app.route("/status")
def status():
    return render_template("status.html", s=_status())


@app.errorhandler(404)
def not_found(_e):
    return render_template("error.html", code=404, message="That page or file doesn't exist."), 404


@app.errorhandler(413)
def too_large(_e):
    flash("Files must be 20 MB or smaller.", "error")
    return redirect(request.referrer or url_for("upload"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=os.environ.get("FLASK_DEBUG") == "1")

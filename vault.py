"""File storage, SHA-256 fingerprints, versions and the audit log."""

import datetime as dt
import hashlib
import json
import os
import shutil

import ai
import db
import extract


def now():
    return dt.datetime.now().isoformat(timespec="seconds")


def log(conn, action, detail="", document_id=None, client_id=None, actor="Lawyer"):
    if document_id and not client_id:
        row = conn.execute("SELECT client_id FROM documents WHERE id = ?", (document_id,)).fetchone()
        client_id = row["client_id"] if row else None
    conn.execute(
        "INSERT INTO audit (ts, action, detail, document_id, client_id, actor) VALUES (?, ?, ?, ?, ?, ?)",
        (now(), action, detail, document_id, client_id, actor),
    )


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def save_blob(data, filename):
    """Write the working copy and a read-only locked copy. Returns (sha, stored_name)."""
    digest = sha256(data)
    stored = digest + os.path.splitext(filename.lower())[1]
    with open(os.path.join(db.UPLOAD_DIR, stored), "wb") as fh:
        fh.write(data)
    locked = os.path.join(db.VAULT_DIR, stored)
    if not os.path.exists(locked):
        with open(locked, "wb") as fh:
            fh.write(data)
        os.chmod(locked, 0o444)
    return digest, stored


def ingest(conn, data, filename, *, title, client_id=None, case_number="", doc_type="",
           document_id=None, analysis=None, actor="Lawyer"):
    """Store a file, read it, summarize it and record everything.

    With `document_id` the file becomes a new version of that document.
    Returns the document id.
    """
    digest, stored = save_blob(data, filename)
    pages, note = extract.extract_pages(data, filename)
    if analysis is None:
        analysis = ai.analyze(pages)
    ts = now()
    fields = {
        "summary": analysis.get("summary", ""),
        "key_points": json.dumps(analysis.get("key_points", [])),
        "ai_source": analysis.get("source", "local"),
        "parties": analysis.get("parties", ""),
        "note": note,
        "hearing_date": analysis.get("hearing_date", ""),
        "hearing_page": analysis.get("hearing_page"),
        "hearing_confirmed": 0,
        "reminder_sent": 0,
        "status": "Awaiting review",
        "updated_at": ts,
    }
    if document_id is None:
        fields.update(
            title=title,
            client_id=client_id,
            case_number=case_number or analysis.get("case_number", ""),
            doc_type=doc_type or analysis.get("doc_type") or "Other",
            created_at=ts,
        )
        cols = ", ".join(fields)
        cur = conn.execute(f"INSERT INTO documents ({cols}) VALUES ({', '.join('?' * len(fields))})",
                           list(fields.values()))
        document_id = cur.lastrowid
        version = 1
    else:
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE documents SET {sets} WHERE id = ?", [*fields.values(), document_id])
        version = conn.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM versions WHERE document_id = ?",
                               (document_id,)).fetchone()[0]
    conn.execute(
        "INSERT INTO versions (document_id, version, filename, stored_name, mime, size, sha256, pages, uploaded_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (document_id, version, filename, stored, extract.mime_for(filename), len(data), digest,
         json.dumps(pages), ts),
    )
    log(conn, "Uploaded" if version == 1 else "New version",
        f"{filename} · v{version} · SHA-256 {digest[:12]}…", document_id, client_id, actor)
    source = "Groq" if fields["ai_source"] == "groq" else "local reader"
    log(conn, "AI summary", f"Summarized by {source}", document_id, actor="Automation")
    if fields["hearing_date"]:
        log(conn, "Hearing date found", f"{fields['hearing_date']} on page {fields['hearing_page'] or '?'}"
            " · waiting for lawyer to confirm", document_id, actor="Automation")
    return document_id


def latest_version(conn, document_id):
    return conn.execute("SELECT * FROM versions WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                        (document_id,)).fetchone()


def pages_of(version_row):
    return [tuple(p) for p in json.loads(version_row["pages"])] if version_row else []


def file_hash(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as fh:
        return sha256(fh.read())


def verify(conn, document_id):
    """Re-hash every stored version. Returns a list of dicts."""
    results = []
    for v in conn.execute("SELECT * FROM versions WHERE document_id = ? ORDER BY version", (document_id,)):
        actual = file_hash(os.path.join(db.UPLOAD_DIR, v["stored_name"]))
        results.append({"version": v["version"], "expected": v["sha256"], "actual": actual,
                        "ok": actual == v["sha256"], "stored_name": v["stored_name"]})
    return results


def tamper(stored_name):
    """Demo only: overwrite the working copy, the way an attacker or bad script would."""
    with open(os.path.join(db.UPLOAD_DIR, stored_name), "ab") as fh:
        fh.write(b"\n[altered by an unauthorised script]\n")


def restore(stored_name):
    """Copy the locked version back over the working copy."""
    src = os.path.join(db.VAULT_DIR, stored_name)
    if not os.path.exists(src):
        return False
    dst = os.path.join(db.UPLOAD_DIR, stored_name)
    if os.path.exists(dst):
        os.remove(dst)
    shutil.copyfile(src, dst)
    os.chmod(dst, 0o644)
    return True

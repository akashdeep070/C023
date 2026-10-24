"""Groq-backed AI helpers with a tiny local fallback.

Everything here is deliberately cheap: a small, fast Groq model, short
prompts built from only the most relevant pages, and capped output tokens.
When no GROQ_API_KEY is set (or Groq is unreachable) the local fallback
keeps the demo working with simple keyword and date matching.
"""

import base64
import datetime as dt
import json
import os
import re

import requests

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
TIMEOUT = 30

DOC_TYPES = ["Order", "Judgment", "Petition", "Evidence", "Contract",
             "Notice", "Identity", "Affidavit", "Other"]


def enabled():
    return bool(os.environ.get("GROQ_API_KEY", "").strip())


def text_model():
    return os.environ.get("GROQ_MODEL") or "llama-3.1-8b-instant"


def vision_model():
    return os.environ.get("GROQ_VISION_MODEL") or "meta-llama/llama-4-scout-17b-16e-instruct"


def _chat(messages, *, model=None, json_mode=False, max_tokens=400):
    body = {
        "model": model or text_model(),
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": max_tokens,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    r = requests.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY'].strip()}"},
        json=body,
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _paged(pages, limit):
    """Join pages with [Page n] markers, stopping at `limit` characters."""
    out, used = [], 0
    for num, text in pages:
        chunk = f"[Page {num}]\n{text.strip()}\n"
        if used + len(chunk) > limit:
            chunk = chunk[: max(0, limit - used)]
        out.append(chunk)
        used += len(chunk)
        if used >= limit:
            break
    return "\n".join(out)


# ---------------------------------------------------------------- dates

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_MON = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_DATE_PATTERNS = [
    (re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MON + r",?\s+(\d{4})\b", re.I), "dmy"),
    (re.compile(r"\b" + _MON + r"\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", re.I), "mdy"),
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), "iso"),
    (re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b"), "num"),
]
_HEARING_CUE = re.compile(r"(next\s+(?:date|hearing)|hearing|listed|list(?:ed)?\s+(?:on|for)|adjourned|posted\s+(?:to|for)|returnable)", re.I)


def _find_dates(text):
    found = []
    for rx, kind in _DATE_PATTERNS:
        for m in rx.finditer(text):
            try:
                if kind == "dmy":
                    d = dt.date(int(m[3]), MONTHS[m[2][:3].lower()], int(m[1]))
                elif kind == "mdy":
                    d = dt.date(int(m[3]), MONTHS[m[1][:3].lower()], int(m[2]))
                elif kind == "iso":
                    d = dt.date(int(m[1]), int(m[2]), int(m[3]))
                else:  # dd/mm/yyyy, the usual Indian court format
                    d = dt.date(int(m[3]), int(m[2]), int(m[1]))
            except (ValueError, KeyError):
                continue
            found.append((m.start(), d))
    return sorted(found)


def find_hearing(pages):
    """Return (iso_date, page) for the first date that follows a hearing cue."""
    best = None
    for num, text in pages:
        for cue in _HEARING_CUE.finditer(text):
            for pos, d in _find_dates(text[cue.end(): cue.end() + 160]):
                cand = (d, num)
                if best is None or d > best[0]:
                    best = cand
                break
    if best:
        return best[0].isoformat(), best[1]
    return "", None


def _valid_iso(value):
    try:
        return dt.date.fromisoformat(str(value)).isoformat()
    except ValueError:
        return ""


# ---------------------------------------------------------------- local fallback

_STOP = set("""a an and are as at be by for from has have in is it its of on or that the this to was were will with
what when where which who why how did does do any all can i we you they he she his her their our there been into
about not no yes""".split())


def _words(text):
    return [w for w in re.findall(r"[a-z0-9₹]+", text.lower()) if w not in _STOP and len(w) > 1]


_SPLIT = re.compile(r"(?<!\bRs\.)(?<!\bNo\.)(?<!\bMr\.)(?<!\bMs\.)(?<!\bDr\.)(?<!\bAdv\.)(?<!\bvs\.)(?<!\bPvt\.)"
                    r"(?<!\b[A-Z]\.)(?<=[.!?])\s+(?!No\.|Ltd\b)(?=[A-Z0-9\"“(])")


def _is_heading(line):
    letters = [c for c in line if c.isalpha()]
    shouty = letters and sum(c.isupper() for c in letters) / len(letters) > 0.6
    return shouty or (len(line.split()) < 8 and not line.endswith((".", ":", ";", ",")))


def _sentences(text, body_only=False):
    if body_only:  # drop court headers and cause-title lines before splitting
        text = "\n".join(l for l in text.splitlines() if not _is_heading(l.strip()))
    text = re.sub(r"\s+", " ", text).strip()
    return [s.strip() for s in _SPLIT.split(text) if len(s.strip()) > 20]


_KEY = re.compile(r"\b(order(?:ed)?|grant(?:ed)?|direct(?:ed|s)?|bail|dismiss(?:ed)?|allow(?:ed)?|adjourn(?:ed)?|"
                  r"hearing|bond|₹|rs\.?|compensation|injunction|deadline|due)\b", re.I)
_CASE_NO = re.compile(r"\b((?:[A-Z][A-Za-z.()]*[ ]){0,3}(?:No\.[ ]*)?\d{1,6}[ ]*(?:/|[ ]+of[ ]+)[ ]*\d{4})\b")
_TYPE_HINTS = [("Judgment", r"\bjudgment\b"), ("Order", r"\border\b|\bbail is granted\b"), ("Notice", r"\bnotice\b"),
               ("Petition", r"\bplaint\b|\bpetition\b"), ("Contract", r"\bagreement\b|\bcontract\b"),
               ("Affidavit", r"\baffidavit\b"), ("Identity", r"\baadhaar\b|\bpassport no\b|\bidentity\b")]
_ROLE = re.compile(r"\s*(?:\.{2,}|…)?\s*(?:applicant|plaintiff|petitioner|appellant|respondent|defendant|accused)s?\s*$", re.I)


def _parties(text):
    lines = [l.strip() for l in text.splitlines() if l.strip()][:40]
    for i, line in enumerate(lines):
        if re.fullmatch(r"(?:versus|vs\.?|v\.)", line, re.I) and 0 < i < len(lines) - 1:
            return f"{_ROLE.sub('', lines[i - 1])} vs {_ROLE.sub('', lines[i + 1])}"
        m = re.fullmatch(r"(.{3,60}?)\s+(?:versus|vs\.?|v\.)\s+(.{3,60})", line, re.I)
        if m:
            return f"{_ROLE.sub('', m[1])} vs {_ROLE.sub('', m[2])}"
    return ""


def _local_analyze(pages):
    full = "\n".join(t for _, t in pages)
    sents = _sentences(full, body_only=True) or _sentences(full)
    keyed = [x for x in sents[1:] if _KEY.search(x)]
    picked = sents[:1] + keyed[:2] if keyed else sents[:3]
    summary = " ".join(picked)[:520] or "No readable text was found in this file."
    key_points = [x[:180] for x in keyed if x not in picked][:3]
    date, page = find_hearing(pages)
    case = _CASE_NO.search(full)
    doc_type = next((t for t, rx in _TYPE_HINTS if re.search(rx, full[:3000], re.I)), "")
    return {
        "summary": summary,
        "key_points": key_points,
        "doc_type": doc_type,
        "parties": _parties(full),
        "case_number": case.group(1).strip() if case else "",
        "hearing_date": date,
        "hearing_page": page,
    }


def _local_answer(question, pages):
    q = set(_words(question))
    best = (0, None, None)
    for num, text in pages:
        for s in _sentences(text):
            score = len(q & set(_words(s)))
            if score > best[0]:
                best = (score, s, num)
    if not best[1]:
        return {"answer": "I could not find that in this file.", "page": None}
    return {"answer": best[1], "page": best[2]}


def _top_pages(question, pages, k=3):
    q = set(_words(question))
    scored = sorted(pages, key=lambda p: -len(q & set(_words(p[1]))))
    keep = {num for num, _ in scored[:k]}
    return [p for p in pages if p[0] in keep]


# ---------------------------------------------------------------- public API

ANALYZE_PROMPT = """You read legal documents for a small Indian law practice.
Reply with JSON only, using exactly these keys:
{"summary": "3 short sentences in plain English: the facts, what was ordered or asked, and the next step",
 "key_points": ["up to 4 short points, each under 20 words"],
 "doc_type": "one of: %s",
 "parties": "who is involved, e.g. 'State vs R. Sharma'",
 "case_number": "the case number exactly as written, or empty string",
 "hearing_date": "the NEXT hearing or listing date as YYYY-MM-DD, or empty string",
 "hearing_page": page number where that date appears, or null}
Only use facts in the document. Never invent dates.""" % ", ".join(DOC_TYPES)


def analyze(pages):
    """Summarize a document and pull out its next hearing date.

    `pages` is a list of (page_number, text). Returns a dict plus a
    "source" key of "groq" or "local".
    """
    if not any(t.strip() for _, t in pages):
        return {**_local_analyze(pages), "source": "local"}
    if enabled():
        try:
            raw = _chat(
                [{"role": "system", "content": ANALYZE_PROMPT},
                 {"role": "user", "content": _paged(pages, 9000)}],
                json_mode=True, max_tokens=450,
            )
            data = json.loads(raw)
            local = _local_analyze(pages)
            out = {
                "summary": str(data.get("summary") or local["summary"]).strip(),
                "key_points": [str(k).strip() for k in (data.get("key_points") or [])][:4],
                "doc_type": data.get("doc_type") if data.get("doc_type") in DOC_TYPES else "",
                "parties": str(data.get("parties") or "").strip(),
                "case_number": str(data.get("case_number") or "").strip(),
                "hearing_date": _valid_iso(data.get("hearing_date")),
                "hearing_page": data.get("hearing_page") if isinstance(data.get("hearing_page"), int) else None,
                "source": "groq",
            }
            if not out["hearing_date"] and local["hearing_date"]:
                out["hearing_date"], out["hearing_page"] = local["hearing_date"], local["hearing_page"]
            return out
        except Exception as exc:  # network, quota, bad JSON: fall back quietly
            return {**_local_analyze(pages), "source": "local", "error": str(exc)[:200]}
    return {**_local_analyze(pages), "source": "local"}


ASK_PROMPT = """Answer the lawyer's question using ONLY the pages below.
Reply with JSON only: {"answer": "one or two sentences", "page": page number the answer came from, or null}.
If the pages do not contain the answer, say "Not found in this file." and use null for page."""


def ask(question, pages):
    context = _top_pages(question, pages)
    if enabled() and any(t.strip() for _, t in context):
        try:
            raw = _chat(
                [{"role": "system", "content": ASK_PROMPT},
                 {"role": "user", "content": f"{_paged(context, 6000)}\n\nQuestion: {question}"}],
                json_mode=True, max_tokens=200,
            )
            data = json.loads(raw)
            page = data.get("page")
            return {
                "answer": str(data.get("answer") or "Not found in this file.").strip(),
                "page": page if isinstance(page, int) else None,
                "source": "groq",
            }
        except Exception as exc:
            return {**_local_answer(question, pages), "source": "local", "error": str(exc)[:200]}
    return {**_local_answer(question, pages), "source": "local"}


def read_image(data, mime):
    """Transcribe text from a photo or scan with Groq's vision model."""
    if not enabled():
        return "", "Add a GROQ_API_KEY to read text from photos and scans."
    if len(data) > 4 * 1024 * 1024:
        return "", "Images over 4 MB can't be read by the AI. Try a smaller photo."
    try:
        text = _chat(
            [{"role": "user", "content": [
                {"type": "text", "text": "Transcribe all text in this document image exactly. Output only the text."},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}},
            ]}],
            model=vision_model(), max_tokens=1500,
        )
        return text.strip(), ""
    except Exception as exc:
        return "", f"The AI could not read this image ({str(exc)[:120]})."

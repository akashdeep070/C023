"""SQLite storage. One small file stands in for DynamoDB in the demo."""

import os
import sqlite3

from flask import g

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
DB_PATH = os.path.join(DATA_DIR, "lex.db")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")  # the working copy
VAULT_DIR = os.path.join(DATA_DIR, "vault")      # read-only copy, like S3 Object Lock

SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    matter TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    lawyer TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    case_number TEXT DEFAULT '',
    doc_type TEXT DEFAULT 'Other',
    parties TEXT DEFAULT '',
    status TEXT DEFAULT 'Awaiting review',
    summary TEXT DEFAULT '',
    key_points TEXT DEFAULT '[]',
    ai_source TEXT DEFAULT 'local',
    note TEXT DEFAULT '',
    hearing_date TEXT DEFAULT '',
    hearing_page INTEGER,
    hearing_confirmed INTEGER DEFAULT 0,
    reminder_sent INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    version INTEGER NOT NULL,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    pages TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    document_id INTEGER,
    client_id INTEGER,
    actor TEXT DEFAULT 'Lawyer'
);
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    number TEXT UNIQUE NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    case_number TEXT DEFAULT '',
    issued TEXT NOT NULL,
    due TEXT NOT NULL,
    retainer INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    service TEXT NOT NULL,
    qty INTEGER NOT NULL,
    rate INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    amount INTEGER NOT NULL,
    method TEXT DEFAULT '',
    paid_on TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_doc ON audit(document_id);
"""


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get():
    if "db" not in g:
        g.db = connect()
    return g.db


def close(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init():
    for d in (DATA_DIR, UPLOAD_DIR, VAULT_DIR):
        os.makedirs(d, exist_ok=True)
    conn = connect()
    conn.execute("PRAGMA journal_mode = WAL")  # lets app1 and app2 share the file
    conn.executescript(SCHEMA)
    conn.commit()
    return conn

// SQLite storage through Node's built-in node:sqlite. One small file stands in for DynamoDB.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// Vercel functions can only write to /tmp, so data there lasts only while an instance stays warm
export const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/lex-data" : path.resolve("data"));
export const DB_PATH = path.join(DATA_DIR, "lex.db");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads"); // the working copy
export const VAULT_DIR = path.join(DATA_DIR, "vault"); // read-only copy, like S3 Object Lock

const SCHEMA = `
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
-- The case diary: one matter per case, with its dated hearings and deadlines
CREATE TABLE IF NOT EXISTS matters (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  case_number TEXT DEFAULT '',
  title TEXT NOT NULL,
  court TEXT DEFAULT '',
  our_side TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  opposite_party TEXT DEFAULT '',
  opposite_counsel TEXT DEFAULT '',
  status TEXT DEFAULT 'Open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hearings (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER NOT NULL REFERENCES matters(id),
  date TEXT NOT NULL,
  purpose TEXT DEFAULT '',
  outcome TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  document_id INTEGER,
  reminder_sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deadlines (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER REFERENCES matters(id),
  title TEXT NOT NULL,
  due TEXT NOT NULL,
  rule TEXT DEFAULT '',
  done INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_doc ON audit(document_id);
CREATE INDEX IF NOT EXISTS idx_hearings_date ON hearings(date);
CREATE INDEX IF NOT EXISTS idx_hearings_matter ON hearings(matter_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_due ON deadlines(due);
`;

for (const dir of [DATA_DIR, UPLOAD_DIR, VAULT_DIR]) mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL"); // lets app1 and app2 share the file
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");
db.exec(SCHEMA);

// Databases created before the case diary existed get the new link columns
function addColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn("documents", "matter_id", "INTEGER REFERENCES matters(id)");
addColumn("audit", "matter_id", "INTEGER");

type Params = SQLInputValue[];

export function all<T>(sql: string, ...params: Params): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Params): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function scalar(sql: string, ...params: Params): number {
  const row = db.prepare(sql).get(...params) as Record<string, number> | undefined;
  return row ? Number(Object.values(row)[0] ?? 0) : 0;
}

export function run(sql: string, ...params: Params): number {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

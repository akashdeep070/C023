// Shapes the API returns. The React app imports these so both sides agree.

export type DocStatus = "Awaiting review" | "Reviewed";

export interface Client {
  id: number;
  code: string;
  name: string;
  matter: string;
  email: string;
  phone: string;
  lawyer: string;
  created_at: string;
}

export interface Doc {
  id: number;
  title: string;
  client_id: number | null;
  matter_id: number | null;
  case_number: string;
  doc_type: string;
  parties: string;
  status: DocStatus;
  summary: string;
  key_points: string; // JSON array
  ai_source: "groq" | "local";
  note: string;
  hearing_date: string;
  hearing_page: number | null;
  hearing_confirmed: number;
  reminder_sent: number;
  created_at: string;
  updated_at: string;
  client_name?: string | null;
  client_code?: string | null;
  matter_title?: string | null;
}

export interface DocRow extends Doc {
  size: number;
  filename: string;
  version: number;
}

export interface Version {
  id: number;
  document_id: number;
  version: number;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  sha256: string;
  uploaded_at: string;
}

export type Page = [number, string];

export interface AuditRow {
  id: number;
  ts: string;
  action: string;
  detail: string;
  document_id: number | null;
  client_id: number | null;
  matter_id: number | null;
  actor: string;
  doc_title?: string | null;
  client_name?: string | null;
}

export interface IntegrityResult {
  version: number;
  expected: string;
  actual: string | null;
  ok: boolean;
  stored_name: string;
}

export interface InvoiceLine { id: number; invoice_id: number; service: string; qty: number; rate: number }
export interface Payment { id: number; invoice_id: number; amount: number; method: string; paid_on: string }
export interface Invoice {
  id: number;
  number: string;
  client_id: number;
  case_number: string;
  issued: string;
  due: string;
  retainer: number;
  created_at: string;
}
export type InvoiceStatus = "Paid" | "Overdue" | "Part paid" | "Unpaid";
export interface InvoiceTotals {
  inv: Invoice;
  lines: InvoiceLine[];
  payments: Payment[];
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  client_name?: string;
}

export interface Counts {
  documents: number;
  clients: number;
  matters: number;
  today: number;        // hearings listed today
  to_confirm: number;   // AI-found dates not yet in the diary
  unrecorded: number;   // past hearings with no outcome written down
  overdue: number;      // open deadlines past their date
  due_week: number;     // open deadlines in the next 7 days
  reminders: number;
  alerts: number;
  invoices_due: number;
}

export interface Meta {
  instance: string;
  ai: AiStatus;
  counts: Counts;
  max_upload_mb: number;
}

export interface Status {
  status: "ok" | "degraded";
  instance: string;
  uptime_s: number;
  requests: number;
  errors: number;
  error_rate: number;
  avg_ms: number;
  p95_ms: number;
  p99_ms: number;
  checks: { database: boolean; storage: boolean };
  ai: AiStatus;
}

/** The latest Groq call on the instance that answered. */
export interface AiHealth { ok: boolean; at: string; ms: number; model: string; error: string }

export interface AiStatus { enabled: boolean; model: string; vision_model: string; health: AiHealth | null }

export interface Task {
  icon: string;
  tone: "amber" | "red" | "blue" | "purple" | "";
  title: string;
  sub: string;
  to?: string;
  action?: "remind";
  cta: string;
}

// ---------------------------------------------------------------- case diary

export interface Matter {
  id: number;
  client_id: number | null;
  case_number: string;
  title: string;            // e.g. "Ananya Sharma vs Deepak Sharma"
  court: string;
  our_side: string;         // Plaintiff, Applicant, Complainant, Defendant...
  stage: string;            // Written statement, Evidence, Arguments...
  opposite_party: string;
  opposite_counsel: string;
  status: "Open" | "Disposed";
  created_at: string;
  client_name?: string | null;
}

export interface MatterRow extends Matter {
  next_hearing: string | null;
  next_purpose: string | null;
  last_date: string | null;
  last_outcome: string | null;
  open_deadlines: number;
  docs: number;
}

export interface Hearing {
  id: number;
  matter_id: number;
  date: string;
  purpose: string;
  outcome: string;          // written after the hearing
  notes: string;
  document_id: number | null;
  reminder_sent: number;
  created_at: string;
  // joined from the matter and the previous hearing
  case_number: string;
  matter_title: string;
  court: string;
  stage: string;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  prev_date: string | null;
  prev_outcome: string | null;
}

export interface Deadline {
  id: number;
  matter_id: number | null;
  title: string;
  due: string;
  rule: string;
  done: number;
  created_at: string;
  case_number?: string | null;
  matter_title?: string | null;
  client_name?: string | null;
}

export interface MatterDetail {
  matter: Matter;
  client: Client | null;
  hearings: Hearing[];      // newest first
  docs: Doc[];
  deadlines: Deadline[];
  invoices: InvoiceTotals[];
  activity: AuditRow[];
}

export interface DiaryData {
  date: string;
  hearings: Hearing[];      // the cause list for the day
  deadlines: Deadline[];    // open deadlines due that day
  pending: Doc[];           // AI-found dates waiting to be confirmed
  unrecorded: Hearing[];    // past hearings with no outcome
  month: { date: string; hearings: number; deadlines: number }[];
  due_reminders: number;
}

export interface ConflictHit { kind: string; name: string; detail: string; to: string }

export interface Dashboard {
  kpi: { today: number; week: number; overdue: number; due_week: number; unrecorded: number;
         outstanding: number; invoices_due: number };
  today: Hearing[];
  upcoming: Hearing[];      // after today, next 7 days
  deadlines: Deadline[];    // overdue and due within 7 days
  load: { date: string; count: number }[]; // hearings per day, next 14 days
  tasks: Task[];
  recent: DocRow[];
  activity: AuditRow[];
}

export interface DocumentDetail {
  doc: Doc;
  versions: Version[];
  pages: Page[];
  key_points: string[];
  activity: AuditRow[];
}

export interface AskResult { answer: string; page: number | null; source: "groq" | "local"; ms?: number; error?: string }

export interface ClientRow extends Client { matters: number; docs: number; next_hearing: string | null; balance: number; invoices: number }

export interface ClientDetail {
  client: Client;
  docs: Doc[];
  matters: MatterRow[];
  invoices: InvoiceTotals[];
  balance: number;
  activity: AuditRow[];
}

// ------------------------------------------------------------ document editor

export interface Draft {
  id: number;
  title: string;
  html: string;
  template_id: string;
  matter_id: number | null;
  words: number;
  blanks: number;               // fill-in blanks still left
  created_at: string;
  updated_at: string;
}

export interface DraftRow extends Omit<Draft, "html"> {
  case_number: string | null;
  matter_title: string | null;
  client_name: string | null;
}

export interface DraftDetail {
  draft: Draft;
  // the linked matter, for filling blanks
  matter: Matter | null;
  client: Client | null;
  last: Hearing | null;
  next: Hearing | null;
  matters: { id: number; label: string }[];
}

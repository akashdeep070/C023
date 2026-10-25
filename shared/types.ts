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
  to_confirm: number;
  reminders: number;
  alerts: number;
  invoices_due: number;
}

export interface Meta {
  instance: string;
  ai: { enabled: boolean; model: string; vision_model: string };
  counts: Counts;
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
  ai: { enabled: boolean; model: string; vision_model: string };
}

export interface Task {
  icon: string;
  title: string;
  sub: string;
  to?: string;
  action?: "remind";
  cta: string;
}

export interface Dashboard {
  kpi: { documents: number; new_week: number; hearings_14: number; next_hearing: string | null;
         review: number; outstanding: number; invoices_due: number };
  hearings: Doc[];
  recent: DocRow[];
  chart: { date: string; count: number }[];
  tasks: Task[];
  health: Status;
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
  matters: { case: string; docs: number; next: string | null }[];
  invoices: InvoiceTotals[];
  balance: number;
  activity: AuditRow[];
}

export interface HearingsData { upcoming: Doc[]; pending: Doc[]; past: Doc[]; due: number; all: Doc[] }

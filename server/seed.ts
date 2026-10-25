// Sample practice data so the app never starts empty: five clients, seven matters
// with their hearing history, deadlines, documents, drafts and invoices.
// All names, case numbers and amounts are made up. Dates are relative to today,
// so there is always something listed today and tomorrow.

import { addDays, isoDate, isoDateTime, strftime, today } from "../shared/format.js";
import type { Analysis } from "./ai.js";
import { run } from "./db.js";
import { createDraft } from "./drafts.js";
import { ingest, log } from "./vault.js";

const d = (days: number) => addDays(today(), days);
const iso = (days: number) => isoDate(d(days));
const long = (days: number) => strftime(d(days), "%-d %B %Y");

/** A timestamp `daysAgo` days back, at a working hour. */
function ts(daysAgo: number, hour = 10): string {
  const t = d(-daysAgo);
  t.setHours(hour, 12, 0);
  return isoDateTime(t);
}

/** Write an audit entry, then move it back to when it happened. */
function logAt(when: string, ...args: Parameters<typeof log>) {
  run("UPDATE audit SET ts = ? WHERE id = ?", when, log(...args));
}

const CLIENTS = [
  ["CL-014", "Ananya Sharma", "Property dispute", "ananya.sharma@example.com", "+91 98200 11014", "Adv. R. Mehta"],
  ["CL-015", "Kapoor Textiles Pvt. Ltd.", "Commercial", "legal@kapoortextiles.example", "+91 22 4000 1015", "Adv. S. Rao"],
  ["CL-016", "Vikram Sharma", "Criminal", "vikram.s@example.com", "+91 98330 21016", "Adv. R. Mehta"],
  ["CL-017", "Meera Iyer", "Recovery suit", "meera.iyer@example.com", "+91 99870 31017", "Adv. S. Rao"],
  ["CL-018", "Farhan Qureshi", "Consumer complaint", "farhan.q@example.com", "+91 98190 41018", "Adv. S. Rao"],
];

interface SeedHearing { day: number; purpose: string; outcome?: string }
interface SeedMatter {
  key: string; client: string; case: string; title: string; court: string; side: string; stage: string;
  opposite: string; counsel: string; age: number; hearings: SeedHearing[];
  deadlines: { title: string; due: number; rule?: string; done?: boolean }[];
}

const MATTERS: SeedMatter[] = [
  {
    key: "A", client: "CL-014", case: "CS 214/2026", title: "Ananya Sharma vs Deepak Sharma",
    court: "Civil Judge (Senior Division), Pune · Court Room 4", side: "Plaintiff", stage: "Written statement",
    opposite: "Deepak Sharma", counsel: "Adv. P. Kulkarni", age: 30,
    hearings: [
      { day: -23, purpose: "First hearing", outcome: "Suit admitted. Summons issued to the defendant; notice on the injunction application (Exh. 5)." },
      { day: -9, purpose: "Injunction application (Exh. 5)", outcome: "Temporary injunction granted. Defendant to file written statement within 30 days." },
    ],
    deadlines: [{ title: "Send copy of the injunction order to the defendant", due: -8, rule: "CPC Order XXXIX Rule 3", done: true }],
  },
  {
    key: "G", client: "CL-014", case: "Misc. Appl. 77/2026", title: "Ananya Sharma, succession certificate",
    court: "Civil Judge (Senior Division), Pune · Court Room 2", side: "Applicant", stage: "Publication of notice",
    opposite: "", counsel: "", age: 40,
    hearings: [
      { day: -30, purpose: "Admission", outcome: "Notice to be published in a local newspaper. Objections, if any, within 30 days." },
      { day: 0, purpose: "Proof of publication" },
    ],
    deadlines: [],
  },
  {
    key: "B", client: "CL-016", case: "Bail Appl. 1123/2026", title: "State vs Vikram Sharma",
    court: "Sessions Court, Mumbai · Court Room 12", side: "Applicant", stage: "Bail granted, compliance",
    opposite: "State of Maharashtra", counsel: "Ld. APP", age: 10,
    hearings: [
      { day: -6, purpose: "Bail arguments", outcome: "Bail granted on a personal bond of ₹50,000 with one surety." },
      { day: 12, purpose: "Compliance and filing of charge sheet" },
    ],
    deadlines: [{ title: "Furnish surety and bail bond", due: -4, done: true }],
  },
  {
    key: "C", client: "CL-017", case: "CS (COMM) 88/2026", title: "Meera Iyer vs Northwind Logistics Pvt. Ltd.",
    court: "Commercial Court, Bengaluru · Court Hall 3", side: "Plaintiff", stage: "Case management",
    opposite: "Northwind Logistics Pvt. Ltd.", counsel: "Adv. K. Rao", age: 45,
    hearings: [
      { day: -20, purpose: "First hearing", outcome: "Defendant appeared. Written statement taken on record." },
      { day: 1, purpose: "Case management hearing" },
    ],
    deadlines: [{ title: "File affidavit of admission and denial of documents", due: 0, rule: "CPC Order XI Rule 4 (commercial suits)" }],
  },
  {
    key: "F", client: "CL-018", case: "CC/412/2025", title: "Farhan Qureshi vs Sunrise Builders Pvt. Ltd.",
    court: "District Consumer Commission, Mumbai Suburban", side: "Complainant", stage: "Evidence",
    opposite: "Sunrise Builders Pvt. Ltd.", counsel: "Adv. N. Desai", age: 120,
    hearings: [
      { day: -42, purpose: "Reply of opposite party", outcome: "Reply filed. Complainant to file evidence affidavit." },
      { day: -7, purpose: "Evidence affidavit" }, // the outcome was never written down
      { day: 0, purpose: "Cross-examination of complainant" },
    ],
    deadlines: [],
  },
  {
    key: "D", client: "CL-015", case: "", title: "Kapoor Textiles, supply agreement review",
    court: "", side: "Advisory", stage: "Advice", opposite: "Northwind Mills LLP", counsel: "", age: 4,
    hearings: [],
    deadlines: [{ title: "Send revised liability and termination clauses to the client", due: 3 }],
  },
  {
    key: "E", client: "CL-015", case: "", title: "Kapoor Textiles vs Northwind Mills LLP, cheque dishonour",
    court: "", side: "Complainant", stage: "Demand notice", opposite: "Northwind Mills LLP", counsel: "", age: 3,
    hearings: [],
    deadlines: [{ title: "Send demand notice for the dishonoured cheque", due: 18,
      rule: "NI Act s.138(b): within 30 days of the bank's return memo" }],
  },
];

interface SeedDoc {
  matter: string; title: string; filename: string; type: string; status: string;
  confirmed: boolean; age: number; text: string; analysis: Analysis;
}

const groq = (a: Omit<Analysis, "source" | "doc_type" | "case_number">): Analysis =>
  ({ ...a, doc_type: "", case_number: "", source: "groq" });

function docs(): SeedDoc[] {
  return [
    {
      matter: "B", title: "Bail order, State vs Vikram Sharma", filename: "bail-order-1123-2026.txt",
      type: "Order", status: "Reviewed", confirmed: true, age: 6,
      text: `IN THE COURT OF THE SESSIONS JUDGE, MUMBAI

Bail Application No. 1123/2026
State vs Vikram Sharma

ORDER

The applicant Vikram Sharma has been in custody since the date of arrest in connection with FIR No. 412/2026 registered at Andheri Police Station. Learned counsel for the applicant submits that the applicant has deep roots in society, a permanent address in Mumbai and no prior criminal record.
\fThe learned APP opposes the application, stating that the investigation is at an advanced stage and the applicant may influence witnesses.

Having heard both sides and perused the record, this Court is of the view that further custody is not required. Bail is granted on a personal bond of ₹50,000 with one surety of the like amount.
\fConditions: the applicant shall not leave the jurisdiction of this Court without permission, shall appear before the Investigating Officer every Monday, and shall not contact any prosecution witness.

The matter is listed for next hearing on ${long(12)} for compliance and filing of the charge sheet.

Sd/- Sessions Judge`,
      analysis: groq({
        summary: "Vikram Sharma was granted bail in Bail Application 1123/2026 after the court found further custody unnecessary. " +
          "Bail is on a personal bond of ₹50,000 with one surety, with conditions on travel, weekly reporting and witness contact. " +
          `The next hearing is on ${long(12)} for compliance and the charge sheet.`,
        key_points: ["Bail granted on a ₹50,000 personal bond with one surety",
          "Must report to the Investigating Officer every Monday",
          "Cannot leave the court's jurisdiction without permission",
          "No contact with prosecution witnesses"],
        parties: "State vs Vikram Sharma", hearing_date: iso(12), hearing_page: 3,
      }),
    },
    {
      matter: "A", title: "Plaint, Ananya Sharma vs Deepak Sharma", filename: "plaint-cs-214-2026.txt",
      type: "Petition", status: "Reviewed", confirmed: true, age: 25,
      text: `IN THE COURT OF THE CIVIL JUDGE (SENIOR DIVISION), PUNE

Civil Suit No. CS 214/2026
Ananya Sharma ... Plaintiff
versus
Deepak Sharma ... Defendant

PLAINT UNDER ORDER VII RULE 1 OF THE CODE OF CIVIL PROCEDURE

1. The plaintiff is the daughter of the late Suresh Sharma, who owned a residential flat at Kothrud, Pune, bearing Survey No. 88/2.
2. The defendant, the plaintiff's cousin, has occupied the flat since March 2025 and refuses to vacate despite a legal notice dated 4 January 2026.
\f3. The plaintiff relies on the registered will of the late Suresh Sharma and the mutation entry in her favour.
4. The plaintiff prays for a decree of possession, mesne profits of ₹25,000 per month, and a permanent injunction restraining the defendant from creating third-party rights.

Valuation and court fee have been paid as per the schedule annexed.

The suit is listed for first hearing on ${long(-23)} before the Civil Judge, Court Room 4.

Advocate for the Plaintiff`,
      analysis: groq({
        summary: "Ananya Sharma has sued her cousin Deepak Sharma for possession of her late father's flat in Kothrud, Pune. " +
          "She relies on a registered will and mutation entry, and asks for possession, ₹25,000 a month in mesne profits and an injunction. " +
          `The first hearing was listed for ${long(-23)} in Court Room 4.`,
        key_points: ["Possession of flat at Kothrud, Survey No. 88/2",
          "Defendant in occupation since March 2025",
          "Mesne profits claimed at ₹25,000 per month",
          "Relies on registered will and mutation entry"],
        parties: "Ananya Sharma vs Deepak Sharma", hearing_date: iso(-23), hearing_page: 2,
      }),
    },
    {
      matter: "A", title: "Order on injunction application (Exh. 5)", filename: "interim-order-cs-214.txt",
      type: "Order", status: "Awaiting review", confirmed: false, age: 8,
      text: `CIVIL JUDGE (SENIOR DIVISION), PUNE
CS 214/2026, Ananya Sharma vs Deepak Sharma

ORDER BELOW EXHIBIT 5

Heard counsel for the plaintiff on the application for temporary injunction on ${long(-9)}. Notice was served on the defendant, who remained absent.

Prima facie, the plaintiff has shown title through the registered will. The balance of convenience lies in her favour. The defendant is restrained from selling, leasing or creating any third-party rights in the suit flat until further orders.

The defendant shall file his written statement within 30 days. List on ${long(19)} for written statement.`,
      analysis: groq({
        summary: "The court granted Ananya Sharma a temporary injunction in CS 214/2026. " +
          "Deepak Sharma cannot sell, lease or create third-party rights in the flat until further orders. " +
          `He must file his written statement within 30 days; the matter is next listed on ${long(19)}.`,
        key_points: ["Temporary injunction granted; defendant was absent",
          "Title shown prima facie through the registered will",
          "Written statement due within 30 days",
          `Next date ${long(19)} for written statement`],
        parties: "Ananya Sharma vs Deepak Sharma", hearing_date: iso(19), hearing_page: 1,
      }),
    },
    {
      matter: "A", title: "Identity proof, Ananya Sharma", filename: "identity-proof.txt",
      type: "Identity", status: "Reviewed", confirmed: false, age: 26,
      text: `IDENTITY DECLARATION (SAMPLE DOCUMENT)

Name: Ananya Sharma
Address: Flat 12, Kothrud, Pune 411038
ID type: Aadhaar (masked) XXXX XXXX 4821

This sample document is used only to demonstrate Lex AI.`,
      analysis: groq({
        summary: "A masked identity declaration for Ananya Sharma with her Pune address. " +
          "It supports her standing as plaintiff in CS 214/2026.",
        key_points: [], parties: "Ananya Sharma", hearing_date: "", hearing_page: null,
      }),
    },
    {
      matter: "D", title: "Supply agreement review memo", filename: "supply-agreement-memo.txt",
      type: "Contract", status: "Awaiting review", confirmed: false, age: 2,
      text: `MEMO: REVIEW OF FABRIC SUPPLY AGREEMENT
Client: Kapoor Textiles Pvt. Ltd.
Counterparty: Northwind Mills LLP

1. Term: three years, auto-renewing unless either party gives 90 days' notice.
2. Price: fixed for year one; thereafter linked to the cotton index with a 7% cap.
3. Liability: the counterparty's liability is capped at one month of fees. We recommend raising the cap to twelve months.
4. Termination: no right to terminate for repeated late delivery. We recommend adding termination after three late deliveries in any quarter.
5. Dispute resolution: arbitration seated in Mumbai, which suits the client.

Recommendation: sign after the liability cap and termination clauses are revised.`,
      analysis: groq({
        summary: "A review of Kapoor Textiles' three-year fabric supply agreement with Northwind Mills. " +
          "The liability cap of one month's fees is too low and there is no right to terminate for repeated late delivery. " +
          "Recommendation: sign once both clauses are revised.",
        key_points: ["Auto-renews unless 90 days' notice is given",
          "Price linked to cotton index, capped at 7%",
          "Raise liability cap from one to twelve months",
          "Add termination after three late deliveries a quarter"],
        parties: "Kapoor Textiles vs Northwind Mills", hearing_date: "", hearing_page: null,
      }),
    },
    {
      matter: "C", title: "Hearing notice, Meera Iyer vs Northwind Logistics", filename: "hearing-notice-88-2026.txt",
      type: "Notice", status: "Reviewed", confirmed: true, age: 5,
      text: `COMMERCIAL COURT, BENGALURU
CS (COMM) 88/2026
Meera Iyer vs Northwind Logistics Pvt. Ltd.

NOTICE OF HEARING

Take notice that the above suit for recovery of ₹3,40,000 with interest at 12% per annum, being unpaid freight charges, is listed for case management hearing on ${long(1)} at 11:00 AM.

Parties shall file their affidavits of admission and denial of documents before the hearing.`,
      analysis: groq({
        summary: "Meera Iyer's commercial suit against Northwind Logistics seeks ₹3,40,000 in unpaid freight with 12% interest. " +
          `A case management hearing is listed on ${long(1)} at 11:00 AM. ` +
          "Both sides must file affidavits of admission and denial before then.",
        key_points: ["Recovery of ₹3,40,000 with 12% interest",
          "Case management hearing at 11:00 AM",
          "File affidavit of admission/denial beforehand"],
        parties: "Meera Iyer vs Northwind Logistics", hearing_date: iso(1), hearing_page: 1,
      }),
    },
  ];
}

// number, client, case, issued (days from today), due, retainer, lines, payments
const INVOICES: [string, string, string, number, number, number, [string, number, number][], [number, string, number][]][] = [
  ["INV-2026-014", "CL-014", "CS 214/2026", 0, 14, 5000,
    [["Consultation", 1, 2000], ["Document review", 1, 5000], ["Court appearance", 2, 3500]], []],
  ["INV-2026-015", "CL-015", "", -2, 12, 0, [["Contract review", 1, 4000]], []],
  ["INV-2026-016", "CL-017", "CS (COMM) 88/2026", -20, -6, 0,
    [["Drafting plaint", 1, 6000], ["Court appearance", 1, 3500]], [[9500, "UPI", -8]]],
];

export async function seed() {
  const clients: Record<string, number> = {};
  for (const [code, name, matter, email, phone, lawyer] of CLIENTS) {
    clients[code] = run("INSERT INTO clients (code, name, matter, email, phone, lawyer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      code, name, matter, email, phone, lawyer, ts(130));
    logAt(ts(130, 9), "Client added", `${name} · ${code}`, null, clients[code]);
  }

  const matters: Record<string, number> = {};
  for (const m of MATTERS) {
    const mid = run(`INSERT INTO matters (client_id, case_number, title, court, our_side, stage, opposite_party, opposite_counsel, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clients[m.client], m.case, m.title, m.court, m.side, m.stage, m.opposite, m.counsel, ts(m.age));
    matters[m.key] = mid;
    logAt(ts(m.age, 9), "Matter opened", m.case || m.title, null, null, "Lawyer", mid);
    for (const h of m.hearings) {
      run("INSERT INTO hearings (matter_id, date, purpose, outcome, created_at) VALUES (?, ?, ?, ?, ?)",
        mid, iso(h.day), h.purpose, h.outcome ?? "", ts(Math.max(-h.day, 0) + 1));
      if (h.outcome) logAt(ts(Math.max(-h.day, 0), 17), "Outcome recorded", `${strftime(d(h.day), "%-d %b %Y")}: ${h.outcome}`, null, null, "Lawyer", mid);
    }
    for (const dl of m.deadlines) {
      run("INSERT INTO deadlines (matter_id, title, due, rule, done, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        mid, dl.title, iso(dl.due), dl.rule ?? "", dl.done ? 1 : 0, ts(m.age));
    }
  }

  for (const doc of docs().sort((a, b) => b.age - a.age)) {
    const m = MATTERS.find((x) => x.key === doc.matter)!;
    const id = await ingest(Buffer.from(doc.text), doc.filename, {
      title: doc.title, clientId: clients[m.client], matterId: matters[doc.matter], caseNumber: m.case,
      docType: doc.type, analysis: doc.analysis,
    });
    run("UPDATE documents SET status = ?, hearing_confirmed = ?, created_at = ?, updated_at = ? WHERE id = ?",
      doc.status, doc.confirmed ? 1 : 0, ts(doc.age), ts(doc.age), id);
    run("UPDATE versions SET uploaded_at = ? WHERE document_id = ?", ts(doc.age), id);
    run("UPDATE audit SET ts = ? WHERE document_id = ?", ts(doc.age), id);
    if (doc.confirmed) {
      run("UPDATE hearings SET document_id = ? WHERE matter_id = ? AND date = ?", id, matters[doc.matter], doc.analysis.hearing_date);
    }
  }

  for (const [number, code, caseNo, issued, due, retainer, lines, payments] of INVOICES) {
    const id = run("INSERT INTO invoices (number, client_id, case_number, issued, due, retainer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      number, clients[code], caseNo, iso(issued), iso(due), retainer, ts(Math.max(-issued, 0)));
    for (const [service, qty, rate] of lines) {
      run("INSERT INTO invoice_items (invoice_id, service, qty, rate) VALUES (?, ?, ?, ?)", id, service, qty, rate);
    }
    for (const [amount, method, day] of payments) {
      run("INSERT INTO payments (invoice_id, amount, method, paid_on) VALUES (?, ?, ?, ?)", id, amount, method, iso(day));
    }
    logAt(ts(Math.max(-issued, 0), 16), "Invoice issued", number, null, clients[code]);
  }

  // Two drafts in progress: tomorrow's adjournment application and the Kapoor demand notice
  for (const [template, key, hoursAgo] of [["adjournment", "C", 3], ["s138-notice", "E", 26]] as const) {
    const draftId = createDraft(template, matters[key]);
    const when = isoDateTime(new Date(Date.now() - hoursAgo * 3_600_000));
    run("UPDATE drafts SET created_at = ?, updated_at = ? WHERE id = ?", when, when, draftId);
    run("UPDATE audit SET ts = ? WHERE id = (SELECT MAX(id) FROM audit)", when);
  }
}

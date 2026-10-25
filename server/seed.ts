// Dummy clients, documents and invoices so the demo never starts empty.
// All names, case numbers and amounts are made up. Dates are relative to
// today so the hearings and reminders always look current.

import { addDays, isoDate, isoDateTime, strftime, today } from "../shared/format.js";
import type { Analysis } from "./ai.js";
import { run } from "./db.js";
import { ingest, log } from "./vault.js";

const d = (days: number) => addDays(today(), days);
const long = (x: Date) => strftime(x, "%-d %B %Y");

function ts(daysAgo: number, hour = 10): string {
  const t = d(-daysAgo);
  t.setHours(hour, 12, 0);
  return isoDateTime(t);
}

const CLIENTS = [
  ["CL-014", "Ananya Sharma", "Property dispute", "ananya.sharma@example.com", "+91 98200 11014", "Adv. R. Mehta"],
  ["CL-015", "Kapoor Textiles Pvt. Ltd.", "Contract review", "legal@kapoortextiles.example", "+91 22 4000 1015", "Adv. S. Rao"],
  ["CL-016", "Vikram Sharma", "Bail matter", "vikram.s@example.com", "+91 98330 21016", "Adv. R. Mehta"],
  ["CL-017", "Meera Iyer", "Recovery suit", "meera.iyer@example.com", "+91 99870 31017", "Adv. S. Rao"],
];

interface SeedDoc {
  client: string; title: string; filename: string; case: string; type: string;
  status: string; confirmed: boolean; age: number; text: string; analysis: Analysis;
}

const groq = (a: Omit<Analysis, "source" | "doc_type" | "case_number">): Analysis =>
  ({ ...a, doc_type: "", case_number: "", source: "groq" });

function docs(): SeedDoc[] {
  const bailNext = d(12), plaintNext = d(19), recoveryNext = d(1), interimPast = d(-9);
  return [
    {
      client: "CL-016", title: "Bail order, State vs Vikram Sharma", filename: "bail-order-1123-2026.txt",
      case: "Bail Appl. 1123/2026", type: "Order", status: "Reviewed", confirmed: true, age: 6,
      text: `IN THE COURT OF THE SESSIONS JUDGE, MUMBAI

Bail Application No. 1123/2026
State vs Vikram Sharma

ORDER

The applicant Vikram Sharma has been in custody since the date of arrest in connection with FIR No. 412/2026 registered at Andheri Police Station. Learned counsel for the applicant submits that the applicant has deep roots in society, a permanent address in Mumbai and no prior criminal record.
\fThe learned APP opposes the application, stating that the investigation is at an advanced stage and the applicant may influence witnesses.

Having heard both sides and perused the record, this Court is of the view that further custody is not required. Bail is granted on a personal bond of ₹50,000 with one surety of the like amount.
\fConditions: the applicant shall not leave the jurisdiction of this Court without permission, shall appear before the Investigating Officer every Monday, and shall not contact any prosecution witness.

The matter is listed for next hearing on ${long(bailNext)} for compliance and filing of the charge sheet.

Sd/- Sessions Judge`,
      analysis: groq({
        summary: "Vikram Sharma was granted bail in Bail Application 1123/2026 after the court found further custody unnecessary. " +
          "Bail is on a personal bond of ₹50,000 with one surety, with conditions on travel, weekly reporting and witness contact. " +
          `The next hearing is on ${long(bailNext)} for compliance and the charge sheet.`,
        key_points: ["Bail granted on a ₹50,000 personal bond with one surety",
          "Must report to the Investigating Officer every Monday",
          "Cannot leave the court's jurisdiction without permission",
          "No contact with prosecution witnesses"],
        parties: "State vs Vikram Sharma", hearing_date: isoDate(bailNext), hearing_page: 3,
      }),
    },
    {
      client: "CL-014", title: "Plaint, Ananya Sharma vs Deepak Sharma", filename: "plaint-cs-214-2026.txt",
      case: "CS 214/2026", type: "Petition", status: "Awaiting review", confirmed: false, age: 3,
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

The suit is listed for first hearing on ${long(plaintNext)} before the Civil Judge, Court Room 4.

Advocate for the Plaintiff`,
      analysis: groq({
        summary: "Ananya Sharma has sued her cousin Deepak Sharma for possession of her late father's flat in Kothrud, Pune. " +
          "She relies on a registered will and mutation entry, and asks for possession, ₹25,000 a month in mesne profits and an injunction. " +
          `The first hearing is on ${long(plaintNext)} in Court Room 4.`,
        key_points: ["Possession of flat at Kothrud, Survey No. 88/2", "Defendant in occupation since March 2025",
          "Mesne profits claimed at ₹25,000 per month", "Relies on registered will and mutation entry"],
        parties: "Ananya Sharma vs Deepak Sharma", hearing_date: isoDate(plaintNext), hearing_page: 2,
      }),
    },
    {
      client: "CL-014", title: "Interim order on injunction", filename: "interim-order-cs-214.txt",
      case: "CS 214/2026", type: "Order", status: "Reviewed", confirmed: true, age: 14,
      text: `CIVIL JUDGE (SENIOR DIVISION), PUNE
CS 214/2026, Ananya Sharma vs Deepak Sharma

ORDER BELOW EXHIBIT 5

Heard counsel for the plaintiff on the application for temporary injunction. Notice was served on the defendant, who remained absent.

Prima facie, the plaintiff has shown title through the registered will. The balance of convenience lies in her favour. The defendant is restrained from selling, leasing or creating any third-party rights in the suit flat until further orders.

Hearing held on ${long(interimPast)}. Written statement to be filed within 30 days.`,
      analysis: groq({
        summary: "The court granted Ananya Sharma a temporary injunction in CS 214/2026. " +
          "Deepak Sharma cannot sell, lease or create third-party rights in the flat until further orders. " +
          "He must file his written statement within 30 days.",
        key_points: ["Temporary injunction granted ex parte", "Title shown prima facie through the registered will",
          "Written statement due within 30 days"],
        parties: "Ananya Sharma vs Deepak Sharma", hearing_date: isoDate(interimPast), hearing_page: 1,
      }),
    },
    {
      client: "CL-014", title: "Identity proof, Ananya Sharma", filename: "identity-proof.txt",
      case: "CS 214/2026", type: "Identity", status: "Reviewed", confirmed: false, age: 15,
      text: `IDENTITY DECLARATION (DUMMY DOCUMENT)

Name: Ananya Sharma
Address: Flat 12, Kothrud, Pune 411038
ID type: Aadhaar (masked) XXXX XXXX 4821

This dummy document is used only to demonstrate Lex AI.`,
      analysis: groq({
        summary: "A masked identity declaration for Ananya Sharma with her Pune address. " +
          "It supports her standing as plaintiff in CS 214/2026. Dummy document for the demo.",
        key_points: [], parties: "Ananya Sharma", hearing_date: "", hearing_page: null,
      }),
    },
    {
      client: "CL-015", title: "Supply agreement review memo", filename: "supply-agreement-memo.txt",
      case: "", type: "Contract", status: "Awaiting review", confirmed: false, age: 2,
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
        key_points: ["Auto-renews unless 90 days' notice is given", "Price linked to cotton index, capped at 7%",
          "Raise liability cap from one to twelve months", "Add termination after three late deliveries a quarter"],
        parties: "Kapoor Textiles vs Northwind Mills", hearing_date: "", hearing_page: null,
      }),
    },
    {
      client: "CL-017", title: "Hearing notice, Meera Iyer vs Northwind Logistics", filename: "hearing-notice-88-2026.txt",
      case: "CS (COMM) 88/2026", type: "Notice", status: "Reviewed", confirmed: true, age: 5,
      text: `COMMERCIAL COURT, BENGALURU
CS (COMM) 88/2026
Meera Iyer vs Northwind Logistics Pvt. Ltd.

NOTICE OF HEARING

Take notice that the above suit for recovery of ₹3,40,000 with interest at 12% per annum, being unpaid freight charges, is listed for case management hearing on ${long(recoveryNext)} at 11:00 AM.

Parties shall file their affidavits of admission and denial of documents before the hearing.`,
      analysis: groq({
        summary: "Meera Iyer's commercial suit against Northwind Logistics seeks ₹3,40,000 in unpaid freight with 12% interest. " +
          `A case management hearing is listed on ${long(recoveryNext)} at 11:00 AM. ` +
          "Both sides must file affidavits of admission and denial before then.",
        key_points: ["Recovery of ₹3,40,000 with 12% interest", "Case management hearing at 11:00 AM",
          "File affidavit of admission/denial beforehand"],
        parties: "Meera Iyer vs Northwind Logistics", hearing_date: isoDate(recoveryNext), hearing_page: 1,
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
  const ids: Record<string, number> = {};
  for (const [code, name, matter, email, phone, lawyer] of CLIENTS) {
    ids[code] = run("INSERT INTO clients (code, name, matter, email, phone, lawyer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      code, name, matter, email, phone, lawyer, ts(30));
    const auditId = log("Client added", `${name} · ${code}`, null, ids[code]);
    run("UPDATE audit SET ts = ? WHERE id = ?", ts(30, 9), auditId);
  }

  for (const doc of docs().sort((a, b) => b.age - a.age)) {
    const id = await ingest(Buffer.from(doc.text), doc.filename, {
      title: doc.title, clientId: ids[doc.client], caseNumber: doc.case, docType: doc.type, analysis: doc.analysis,
    });
    run("UPDATE documents SET status = ?, hearing_confirmed = ?, created_at = ?, updated_at = ? WHERE id = ?",
      doc.status, doc.confirmed ? 1 : 0, ts(doc.age), ts(doc.age), id);
    run("UPDATE versions SET uploaded_at = ? WHERE document_id = ?", ts(doc.age), id);
    run("UPDATE audit SET ts = ? WHERE document_id = ?", ts(doc.age), id);
    if (doc.confirmed) {
      const auditId = log("Hearing confirmed", doc.analysis.hearing_date, id);
      run("UPDATE audit SET ts = ? WHERE id = ?", ts(doc.age, 11), auditId);
    }
  }

  for (const [number, code, caseNo, issued, due, retainer, lines, payments] of INVOICES) {
    const id = run("INSERT INTO invoices (number, client_id, case_number, issued, due, retainer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      number, ids[code], caseNo, isoDate(d(issued)), isoDate(d(due)), retainer, ts(Math.max(-issued, 0)));
    for (const [service, qty, rate] of lines) {
      run("INSERT INTO invoice_items (invoice_id, service, qty, rate) VALUES (?, ?, ?, ?)", id, service, qty, rate);
    }
    for (const [amount, method, day] of payments) {
      run("INSERT INTO payments (invoice_id, amount, method, paid_on) VALUES (?, ?, ?, ?)", id, amount, method, isoDate(d(day)));
    }
    const auditId = log("Invoice issued", number, null, ids[code]);
    run("UPDATE audit SET ts = ? WHERE id = ?", ts(Math.max(-issued, 0), 16), auditId);
  }
}

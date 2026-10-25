// Fill-in drafts for routine work. They use what the app already knows about the
// matter and leave [square brackets] where the lawyer must add details.

import { niceDate } from "./format.js";
import type { Client, Hearing, Matter } from "./types.js";

export const FIRM = "Mehta & Rao Associates";

export interface DraftContext {
  matter: Matter;
  client: Client | null;
  last: Hearing | null;     // latest hearing with an outcome
  next: Hearing | null;     // next listed hearing
  today: string;
}

export interface DraftTemplate {
  id: string;
  name: string;
  kind: "message" | "document";
  build: (c: DraftContext) => string;
}

const firstName = (c: DraftContext) => c.client?.name.split(" ")[0] ?? "[client name]";
const lawyer = (c: DraftContext) => c.client?.lawyer || "Adv. R. Mehta";
const caseRef = (m: Matter) => [m.case_number, m.title].filter(Boolean).join(", ");
const court = (m: Matter) => m.court.split(" · ")[0] || "[court]";
const side = (m: Matter) => m.our_side || "[Plaintiff / Applicant]";

export const DRAFTS: DraftTemplate[] = [
  {
    id: "client-update",
    name: "Client update (WhatsApp or SMS)",
    kind: "message",
    build: (c) => [
      `Dear ${firstName(c)},`,
      "",
      c.matter.case_number ? `Update on ${c.matter.case_number} (${c.matter.title})` : `Update on ${c.matter.title}`,
      c.matter.court ? `Court: ${court(c.matter)}` : "",
      "",
      c.last ? `On ${niceDate(c.last.date, "%-d %b")}: ${c.last.outcome}` : "",
      c.next
        ? `Next date: ${niceDate(c.next.date, "%A, %-d %B %Y")}${c.next.purpose ? `, for ${c.next.purpose.toLowerCase()}` : ""}.`
        : "The next date is not fixed yet. We will let you know.",
      c.next ? "You do not need to attend unless we tell you." : "",
      "",
      `Please call us if you have any questions.`,
      `${lawyer(c)}, ${FIRM}`,
    ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n"),
  },
  {
    id: "adjournment",
    name: "Application for adjournment",
    kind: "document",
    build: (c) => `IN THE COURT OF THE ${court(c.matter).toUpperCase()}

${c.matter.case_number || "[Case number]"}
${c.matter.title}

APPLICATION FOR ADJOURNMENT ON BEHALF OF THE ${side(c.matter).toUpperCase()}

The ${side(c.matter)} above named most respectfully submits as under:

1. The above matter is listed on ${c.next ? niceDate(c.next.date, "%-d %B %Y") : "[date]"}${c.next?.purpose ? ` for ${c.next.purpose.toLowerCase()}` : ""}.

2. [State the reason, for example: the counsel for the ${side(c.matter)} is engaged in a part-heard matter before another court, or the ${side(c.matter)} is unwell and a medical certificate is annexed.]

3. This application is made bona fide and not to delay the proceedings. The other side will not be prejudiced, and may be compensated by costs if this Hon'ble Court so directs.

PRAYER

It is therefore most respectfully prayed that this Hon'ble Court may be pleased to adjourn the above matter to a convenient date, in the interest of justice.

Place: [place]
Date: ${niceDate(c.today, "%-d %B %Y")}

${lawyer(c)}
Advocate for the ${side(c.matter)}`,
  },
  {
    id: "s138-notice",
    name: "Demand notice for a dishonoured cheque (NI Act s.138)",
    kind: "document",
    build: (c) => `BY REGISTERED POST A.D. / SPEED POST

Date: ${niceDate(c.today, "%-d %B %Y")}

To,
${c.matter.opposite_party || "[Name of the drawer]"}
[Address]

Subject: Legal notice under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881

Under instructions from and on behalf of my client, ${c.client?.name ?? "[client name]"}, [address], I serve you with the following notice:

1. You issued cheque No. [number] dated [date] for ₹[amount], drawn on [bank and branch], in favour of my client towards [the liability, e.g. goods supplied under invoice No. ___].

2. When presented for payment, the cheque was returned unpaid with the remark "[reason, e.g. funds insufficient]" by the bank's return memo dated [date].

3. You are called upon to pay the said sum of ₹[amount] to my client within 15 days of receiving this notice.

4. If you fail to pay within that time, my client will be constrained to file a complaint against you under Section 138 of the Negotiable Instruments Act, 1881, and to take civil proceedings for recovery, entirely at your risk as to costs and consequences.

A copy of this notice is kept in my office for further action.

${lawyer(c)}
Advocate for ${c.client?.name ?? "[client name]"}

Note for the file: send within 30 days of receiving the return memo (s.138(b)).`,
  },
  {
    id: "file-note",
    name: "Hearing note for the file",
    kind: "document",
    build: (c) => `FILE NOTE

Matter: ${caseRef(c.matter)}
Court: ${c.matter.court || "[court]"}
Client: ${c.client?.name ?? "[client]"}
Stage: ${c.matter.stage || "[stage]"}

Last date: ${c.last ? `${niceDate(c.last.date, "%-d %b %Y")}${c.last.purpose ? ` (${c.last.purpose})` : ""}` : "[none]"}
What happened: ${c.last?.outcome || "[outcome]"}
${c.last?.notes ? `Notes: ${c.last.notes}\n` : ""}
Next date: ${c.next ? `${niceDate(c.next.date, "%-d %b %Y")}${c.next.purpose ? ` (${c.next.purpose})` : ""}` : "[not fixed]"}
To do before then: [steps, documents, witnesses]

${lawyer(c)}, ${niceDate(c.today, "%-d %b %Y")}`,
  },
];

/** A WhatsApp link that opens a chat with the client and the message filled in. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

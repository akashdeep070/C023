// The update a lawyer sends the client after a hearing, and the WhatsApp link for it.
// Court papers are drafted in the document editor from the templates in templates.ts.

import { niceDate } from "./format.js";
import type { Client, Hearing, Matter } from "./types.js";

export interface DraftContext {
  matter: Matter;
  client: Client | null;
  last: Hearing | null;     // latest hearing with an outcome
  next: Hearing | null;     // next listed hearing
  today: string;
}

const firstName = (c: DraftContext) => c.client?.name.split(" ")[0] ?? "[client name]";
const lawyer = (c: DraftContext) => c.client?.lawyer || "Adv. R. Mehta";
const court = (m: Matter) => m.court.split(" · ")[0] || "[court]";

/** A short update for WhatsApp or SMS: what happened, and the next date. */
export function clientUpdate(c: DraftContext): string {
  return [
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
    lawyer(c),
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

/** A WhatsApp link that opens a chat with the client and the message filled in. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

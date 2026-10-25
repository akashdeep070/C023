// Common Indian limitation periods and filing timelines, for planning.
// The app shows the statute next to every result and asks the lawyer to verify it.

import { addDays, isoDate, parseDate } from "./format.js";

export interface LimitationRule {
  id: string;
  group: string;
  label: string;
  period: { days?: number; months?: number; years?: number };
  from: string;             // what the start date means
  ref: string;              // where the period comes from
  outer?: { period: { days?: number; months?: number }; note: string }; // absolute limit, also from the start date
  note?: string;
}

export const RULES: LimitationRule[] = [
  { id: "appeal-hc", group: "Appeals and reviews", label: "First appeal to the High Court (CPC)", period: { days: 90 },
    from: "Date of the decree or order", ref: "Limitation Act 1963, Art. 116(a)",
    note: "Time spent getting a certified copy is excluded (s.12(2))." },
  { id: "appeal-other", group: "Appeals and reviews", label: "Appeal to the District Court (CPC)", period: { days: 30 },
    from: "Date of the decree or order", ref: "Limitation Act 1963, Art. 116(b)",
    note: "Time spent getting a certified copy is excluded (s.12(2))." },
  { id: "review", group: "Appeals and reviews", label: "Review of a judgment (not Supreme Court)", period: { days: 30 },
    from: "Date of the decree or order", ref: "Limitation Act 1963, Art. 124" },
  { id: "revision", group: "Appeals and reviews", label: "Revision", period: { days: 90 },
    from: "Date of the decree, order or sentence", ref: "Limitation Act 1963, Art. 131" },
  { id: "restore", group: "Appeals and reviews", label: "Restore a suit dismissed for default", period: { days: 30 },
    from: "Date of dismissal", ref: "Limitation Act 1963, Art. 122" },
  { id: "ex-parte", group: "Appeals and reviews", label: "Set aside an ex parte decree", period: { days: 30 },
    from: "Date of the decree (or of knowledge, if summons was not served)", ref: "Limitation Act 1963, Art. 123" },
  { id: "ws-civil", group: "Pleadings", label: "Written statement, civil suit", period: { days: 30 },
    from: "Date the summons was served", ref: "CPC Order VIII Rule 1",
    outer: { period: { days: 90 }, note: "The court may allow up to 90 days for recorded reasons." } },
  { id: "ws-commercial", group: "Pleadings", label: "Written statement, commercial suit", period: { days: 30 },
    from: "Date the summons was served", ref: "CPC Order VIII Rule 1, as amended by the Commercial Courts Act 2015",
    outer: { period: { days: 120 }, note: "Never later than 120 days from service." } },
  { id: "s138-notice", group: "Cheque dishonour (NI Act)", label: "Send the demand notice", period: { days: 30 },
    from: "Date the bank's return memo was received", ref: "Negotiable Instruments Act 1881, s.138(b)" },
  { id: "s138-complaint", group: "Cheque dishonour (NI Act)", label: "File the complaint", period: { days: 15, months: 1 },
    from: "Date the drawer received the demand notice", ref: "NI Act s.138(c) and s.142(1)(b)",
    note: "15 days to pay, then one month to file. This shows the earlier, safer date." },
  { id: "arb-34", group: "Arbitration and consumer", label: "Challenge an arbitral award", period: { months: 3 },
    from: "Date the award was received", ref: "Arbitration and Conciliation Act 1996, s.34(3)",
    outer: { period: { months: 3, days: 30 }, note: "A further 30 days only with sufficient cause, and not after that." } },
  { id: "consumer", group: "Arbitration and consumer", label: "File a consumer complaint", period: { years: 2 },
    from: "Date the cause of action arose", ref: "Consumer Protection Act 2019, s.69" },
  { id: "consumer-appeal", group: "Arbitration and consumer", label: "Appeal to the State Commission", period: { days: 45 },
    from: "Date of the District Commission's order", ref: "Consumer Protection Act 2019, s.41" },
  { id: "money", group: "Suits", label: "Suit for breach of contract or money due", period: { years: 3 },
    from: "Date of the breach", ref: "Limitation Act 1963, Art. 55" },
  { id: "possession", group: "Suits", label: "Suit for possession based on title", period: { years: 12 },
    from: "Date the defendant's possession became adverse", ref: "Limitation Act 1963, Art. 65" },
  { id: "execution", group: "Suits", label: "Execute a decree", period: { years: 12 },
    from: "Date the decree became enforceable", ref: "Limitation Act 1963, Art. 136" },
];

function addPeriod(start: Date, p: { days?: number; months?: number; years?: number }): Date {
  // Calendar months and years; a date that doesn't exist (31 Feb) becomes the month's last day
  const months = (p.years ?? 0) * 12 + (p.months ?? 0);
  const y = start.getFullYear() + Math.floor((start.getMonth() + months) / 12);
  const m = (start.getMonth() + months) % 12;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return addDays(new Date(y, m, Math.min(start.getDate(), lastDay)), p.days ?? 0);
}

export interface LimitationResult {
  last: string;             // last date to act
  outer: string | null;     // absolute limit, if the rule has one
  closedDay: boolean;       // the last date falls on a Sunday
}

/**
 * The start day itself is not counted (s.12(1)), so "30 days from 1 Jan" ends on 31 Jan.
 * `excludeDays` adds time the law lets you leave out, such as waiting for a certified copy.
 */
export function compute(rule: LimitationRule, start: string, excludeDays = 0): LimitationResult {
  const last = addDays(addPeriod(parseDate(start), rule.period), Math.max(0, excludeDays));
  const outer = rule.outer ? addDays(addPeriod(parseDate(start), rule.outer.period), Math.max(0, excludeDays)) : null;
  return { last: isoDate(last), outer: outer ? isoDate(outer) : null, closedDay: last.getDay() === 0 };
}

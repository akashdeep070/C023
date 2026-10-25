// Starting points for the document editor. Four come from the firm's own files
// (the suit for accounts, Forms 15D and 26D, and the eligibility criteria and terms);
// the rest are everyday court papers.
//
// Each template is HTML. Anything the lawyer must supply is a blank:
// <mark class="blank">[label]</mark>. Blanks that the app can answer from a matter
// carry data-key, so they fill in when the document is tied to a matter.

import { niceDate } from "./format.js";
import type { Client, Hearing, Matter } from "./types.js";

export type FieldKey = "client" | "opposite" | "case_number" | "court" | "matter_title" | "our_side" | "stage"
  | "advocate" | "next_date" | "next_purpose" | "last_date" | "last_outcome" | "date";

export interface TemplateContext {
  matter: Matter | null;
  client: Client | null;
  last: Hearing | null;     // latest hearing with an outcome
  next: Hearing | null;     // next listed hearing
  today: string;
}

/** Turns a blank's label (and the matter field it stands for, if any) into HTML. */
export type Blank = (label: string, key?: FieldKey) => string;

export interface DocTemplate {
  id: string;
  name: string;
  group: string;
  blurb: string;
  fromFile?: string;        // the firm's file this template was made from
  build: (b: Blank) => string;
}

const lower = (s: string | undefined) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** What the app already knows for each blank key. Empty values stay blank. */
export function fieldValues(c: TemplateContext): Partial<Record<FieldKey, string>> {
  const values: Partial<Record<FieldKey, string | undefined>> = { date: niceDate(c.today, "%-d %B %Y") };
  const m = c.matter;
  if (m) {
    Object.assign(values, {
      client: c.client?.name,
      opposite: m.opposite_party,
      case_number: m.case_number,
      court: m.court.split(" · ")[0],
      matter_title: m.title,
      our_side: m.our_side,
      stage: m.stage,
      advocate: c.client?.lawyer || "Adv. R. Mehta",
      next_date: c.next ? niceDate(c.next.date, "%-d %B %Y") : undefined,
      next_purpose: lower(c.next?.purpose),
      last_date: c.last ? niceDate(c.last.date, "%-d %B %Y") : undefined,
      last_outcome: c.last?.outcome,
    });
  }
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v)) as Partial<Record<FieldKey, string>>;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export const blankHtml = (label: string, key?: string) =>
  `<mark class="blank"${key ? ` data-key="${key}"` : ""}>[${escapeHtml(label)}]</mark>`;

/** A template's HTML, with every blank the context can answer already filled. */
export function render(t: DocTemplate, ctx: TemplateContext): string {
  const values = fieldValues(ctx);
  return t.build((label, key) => (key && values[key] ? escapeHtml(values[key]) : blankHtml(label, key)));
}

/** A neutral preview for the template gallery: every blank shown as a blank. */
export const preview = (t: DocTemplate) => t.build(blankHtml);

const p = (html: string) => `<p>${html}</p>`;
const center = (html: string) => `<p style="text-align: center;">${html}</p>`;
const right = (html: string) => `<p style="text-align: right;">${html}</p>`;
const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const cite = (text: string, ref: string) => `${text} <em>(${ref})</em>`;
const empty = (n: number) => "<td><br></td>".repeat(n);

/** A form table: headings, the column numbers in brackets, one row per label, then a total row. */
function formTable(cols: string[], rows: string[], total = true): string {
  return [
    "<table><tbody>",
    `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`,
    `<tr>${cols.map((_, i) => `<td style="text-align: center;">(${i + 1})</td>`).join("")}</tr>`,
    ...rows.map((r) => `<tr><td>${r}</td>${empty(cols.length - 1)}</tr>`),
    total ? `<tr><td><strong>Total</strong></td>${empty(cols.length - 1)}</tr>` : "",
    "</tbody></table>",
  ].join("");
}

const TDS_COLS = (payee: "company" | "person / payee", lowerRate: boolean) => [
  "Sl. No.", "Permanent Account Number (PAN)", payee === "company" ? "Name of company" : "Name of person / payee",
  payee === "company" ? "Address of the company" : "Address of the person / payee",
  "Amount of commission credited / paid (Rs.)", "Date on which commission credited or paid, whichever is earlier",
  ...(lowerRate ? ["Rate of deduction of tax (%)"] : []),
  "Amount of tax deducted (Rs.)", "Date on which tax deducted", "Date on which tax paid to the credit of the Central Government",
  ...(lowerRate ? ["Assessing Officer's certificate reference number"] : []),
  "Tax deduction certificate number", `Date of furnishing the tax deduction certificate to the ${payee}`,
];

export const TEMPLATES: DocTemplate[] = [
  {
    id: "blank",
    name: "Blank document",
    group: "Blank",
    blurb: "Start from an empty page.",
    build: () => "<p><br></p>",
  },
  {
    id: "suit-for-accounts",
    name: "Suit for accounts by an insurance agent",
    group: "Court papers",
    blurb: "Plaint against an insurance company for accounts of premia and commission, with verification and case-law notes.",
    fromFile: "Suit_for_Accounts_by_Insurance_Agent_against_Company.docx",
    build: (b) => [
      center(`<strong>IN THE COURT OF THE ${b("name of the court", "court")}</strong>`),
      center(b("Suit No. ___ of 20__", "case_number")),
      p(b("name and address of the agent", "client")),
      right("… Plaintiff"),
      center("versus"),
      p(b("name and registered office of the company", "opposite")),
      right("… Defendant"),
      center("<strong>SUIT FOR ACCOUNTS BY AN INSURANCE AGENT AGAINST A COMPANY</strong>"),
      p("The above-named plaintiff most respectfully submits as under:"),
      p(`1. That the plaintiff was appointed by the defendant Company as its insurance agent for the District of ${b("district")}. ` +
        `The defendant Company agreed to pay the plaintiff a commission at ${b("rate")} per cent on all the premia to be paid on the policies effected through the plaintiff.`),
      p(`2. That the plaintiff acted in pursuance of the agreement dated ${b("date of agreement")} from that date to ${b("end date")} ` +
        "and introduced the policies described in the Schedule annexed to the plaint."),
      p(`3. That the defendant Company paid to the plaintiff during the aforesaid period only a sum of ₹${b("amount received")} on account of commission, ` +
        "but has not rendered any account of premia on the policies detailed in the Schedule annexed hereto, even on the demand made by the plaintiff " +
        `through a registered notice dated ${b("date of notice")} received by the defendant on ${b("date of receipt")}.`),
      p("4. That the plaintiff is not aware of the policies lapsed, matured or forfeited, and as such does not know how much money is due " +
        "to the plaintiff as commission under the agreement referred to above."),
      p(`5. That the cause of action arose on ${b("date of receipt")} within the jurisdiction of this Court, when the defendant Company received ` +
        "the plaintiff's notice of demand but did not render account."),
      p(`6. That the suit is valued at ₹${b("value of the suit")}, being the approximate insurance commission due after deduction of ₹${b("amount received")} ` +
        "already received by the plaintiff from the defendant Company, and the court fee is paid according to the reliefs claimed."),
      p("<strong>RELIEFS CLAIMED</strong>"),
      p("The reliefs claimed by way of this suit are:"),
      p("(1) A full and true account of the moneys realised by the defendant Company as premia on the policies detailed in the Schedule, " +
        "and of the commission due to the plaintiff;"),
      p(`(2) Payment of the sum found to be due to the plaintiff after deduction of ₹${b("amount received")} already received by the plaintiff from the defendant Company;`),
      p("(3) Costs of the suit to the plaintiff."),
      p(`Place: ${b("place")}<br>Date: ${b("date", "date")}`),
      right(`Plaintiff<br><br>Through<br><br>${b("name of the advocate", "advocate")}<br>Advocate`),
      center("<strong>VERIFICATION</strong>"),
      p(`I, the above-named plaintiff, do hereby verify that the contents of paras ${b("paras on personal knowledge")} of the plaint are true to my ` +
        `personal knowledge and those of paras ${b("paras on legal advice")} are based on legal advice, which I believe to be true.`),
      p(`Verified on this ${b("day")} day of ${b("month and year")} at ${b("place")}.`),
      right("Plaintiff"),
      '<hr class="page-break">',
      "<h2>Case-law notes</h2>",
      p("<em>For the drafter. Delete this part before filing.</em>"),
      "<h3>Section 216: principal's right to benefit gained by an agent dealing on his own account</h3>",
      ul([
        cite("The commission agent need not disclose the name of the firm from which he purchased the goods, but he cannot supply goods at a particular rate.", "A.I.R. 1922 All. 400"),
        cite("No agent in the course of agency can make a profit without the knowledge of his principal.", "All. 1942 Mad. 634; (1939) 3 All E.R. 235"),
        cite("Where an agent makes a profit by using his principal's money, he cannot treat that transaction as an independent transaction.", "A.I.R. 1927 Mad. 478; A.I.R. 1937 Mad. 810"),
        cite("The Court has no inherent power to issue a commission for determining the liability of an agent for secret profits.", "A.I.R. 1975 Cal. 303"),
      ]),
      "<h3>Section 230: agent contracting in the name of his principal</h3>",
      p(cite("Personal liability of the agent is concluded by Section 230 of the Contract Act. In the absence of any contract to the effect, an agent cannot " +
        "personally enforce contracts entered into by him on behalf of his principal, and conversely he is not personally liable except to the extent of " +
        "his liability as agent. But a contract in favour of or against the agent will be presumed (1) where the contract is made by an agent for the sale " +
        "or purchase of goods for a merchant resident abroad, (2) where the agent does not disclose the name of the principal, or (3) where the principal, " +
        "though disclosed, cannot be sued. The test is on whom the opposite party gave credit, or is presumed to have given credit. When no credit is " +
        "given to the agent, but credit is given exclusively to the principal, the agent is not personally liable.", "1991 (2) C.C.C. 205")),
      "<h3>Right of an agent to sue the principal: equitable, not statutory</h3>",
      p(cite("The principal's right to sue an agent for rendition of accounts is recognised by statute; there is no corresponding provision in favour of " +
        "the agent. But the Contract Act is not exhaustive. Where the principal has kept the accounts between him and his agent, and the transactions in " +
        "the course of the agency are within the principal's peculiar knowledge, or the agent has no records with which to quantify the amounts, the agent " +
        "may ask for accounts. The same applies where the accounts are so complicated that a suit for a definite sum is not possible. The right depends " +
        "on the facts and circumstances of each case.", "1991 (2) C.C.C. 220; A.I.R. 1967 S.C. 333")),
      p(cite("If the agent purports to act as such and enters into a transaction on behalf of the principal, he must render an account to the principal " +
        "if the principal requires it.", "A.I.R. 1961 A.P. 143")),
      "<h3>Section 214: agent's duty to communicate with the principal</h3>",
      ul([
        cite("Where the principal effected insurance because the agent failed to communicate, the insurance was held to be void.", "(1867) 2 Q.B. 511"),
        cite("It is the duty of the agent to communicate with his principal in case of difficulty.", "A.I.R. 1927 M.W.N. 578"),
      ]),
      "<h3>Section 215: agent dealing on his own account without the principal's consent</h3>",
      ul([
        cite("Information an agent obtains in the course of his agency should not be used against his principal.", "(1913) 2 Ch. 239; (1909) 1 Ch. 413"),
        cite("The agent must make full disclosure of the nature and extent of his interest.", "(1873) 10 H.L. 180; (1874) 18 Eq. 524"),
        cite("A person acting as agent for both the principal and the contracting party cannot take remuneration from both without the principal's knowledge.", "A.I.R. 1933 Rang. 184"),
        cite("A broker employed to sell cannot himself become the buyer, nor the seller when employed to buy, without notice to the principal.", "(1924) A.C. 566; (1844) 8 E.R. 1273; (1940) Ch. D. 359"),
        cite("The principal could repudiate the transaction where the agent employed to procure a loan lent his own money.", "A.I.R. 1928 Cal. 727"),
        cite("When an agent pays the price to the principal he can become a purchaser; an agent employed as a broker cannot convert himself into the principal.", "A.I.R. 1967 S.C. 181; 1933 Bom. L.R. 703"),
      ]),
      "<h3>Section 231: contract made by an agent for an undisclosed principal</h3>",
      ul([
        cite("An agent for an undisclosed principal can enforce the contract personally.", "I.L.R. 1953 Bom. 110; I.L.R. 1924 Mad. 130"),
        cite("Where the buyer was told before the contract was completed that the goods belonged to a third person, he could not set off a debt due to him from the agent.", "I.L.R. 1932 Bom. 356; I.L.R. 1924 Cal. 504"),
        cite("Business done by a commission agent in his own name, though for the benefit of an undisclosed principal who must indemnify him, is business done by the agent.", "A.I.R. 1929 Sind. 24; 18 Bom. 294 (P.C.)"),
        cite("The second paragraph of Section 231 is read with the first: it applies where the agent contracted with a person who did not know, or have reason to suspect, that he was an agent.", "A.I.R. 1960 Cal. 752"),
      ]),
      "<h3>Sections 232 and 233: contract with an agent supposed to be the principal</h3>",
      ul([
        cite("Where one of the contracting parties has a principal, that principal may intervene and may even sue on the contract.", "L.R. 5 Q.B. 656"),
        cite("The principal's right to require performance is subject to the rights and obligations between the agent and the other party.", "(1879-80) 4 Bom. 447"),
        cite("Where a contract is made with an agent in his own name for an undisclosed principal, either may sue on it; the defendant is placed in the same position as if the agent had been the contracting party.", "A.I.R. 1931 Sind. 4"),
        cite("A plaintiff entitled to sue both agent and principal under Section 233 cannot, after suing one of them to judgment, sue the other in a second suit.", "A.I.R. 1917 Bom. 268"),
        cite("Section 233 is substantive law on who is liable, not procedure; it creates a joint liability so that judgment may be obtained against both principal and agent.", "A.I.R. 1917 Bom. 268"),
      ]),
    ].join(""),
  },
  {
    id: "form-15d",
    name: "Form No. 15D: certificate for receipt without TDS",
    group: "Tax forms",
    blurb: "Application under section 195(3) of the Income-tax Act by a non-resident (not a bank) to receive sums other than interest and dividends without deduction of tax.",
    fromFile: "FORM_NO_15_D.docx",
    build: (b) => {
      const firm = () => b("name of the firm, company, etc.", "client");
      return [
        center("<strong>FORM NO. 15D</strong>"),
        center("[See rule 29B]"),
        center("<strong>Application by a person other than a banking company for a certificate under section 195(3) of the Income-tax Act, 1961, " +
          "for receipt of sums other than interest and dividends without deduction of tax</strong>"),
        p(`To<br>The Assessing Officer,<br>${b("ward or circle")}<br>${b("Assessing Officer's address")}`),
        p("Sir,"),
        p(`I, ${b("name of the principal officer")}, being the principal officer of ${firm()}, do hereby declare:`),
        p(`(a) that I / ${firm()} am / is a non-resident assessee (not being a banking company) carrying on business / profession in India ` +
          `through a branch(es) by name(s) ${b("name(s) of the branch(es)")} having office(s) at ${b("address(es) of the branch office(s)")};`),
        p(`(b) that my head office / the head office of ${firm()} is situated at ${b("name of the place and country")};`),
        p(`(c) that I / ${firm()} am / is entitled to receive income (other than dividends and interest) chargeable under the provisions of ` +
          `the Income-tax Act, 1961, during the financial year ${b("20__-__")};`),
        p(`(d) that I / ${firm()} fulfil(s) all the conditions laid down in rule 29B of the Income-tax Rules, 1962.`),
        p(`I, therefore, request that a certificate may be issued authorising me / ${firm()} to receive income other than interest or dividends ` +
          `without deduction of tax under sub-section (1) of section 195 of the Income-tax Act, 1961, during the financial year ${b("20__-__")}.`),
        p("I hereby declare that what is stated in this application is correct."),
        p(`Date: ${b("date", "date")}`),
        right(`${b("signature")}<br>Signature<br><br>${b("applicant's address")}<br>Address`),
      ].join("");
    },
  },
  {
    id: "form-26d",
    name: "Form No. 26D: annual TDS return on insurance commission",
    group: "Tax forms",
    blurb: "Annual return under section 206 of tax deducted from insurance commission (section 194D), with the payee and challan tables.",
    fromFile: "FORM_NO_26_D.docx",
    build: (b) => [
      center("<strong>FORM NO. 26D</strong>"),
      center("[See section 194D and rule 37]"),
      center(`<strong>Annual return of deduction of tax from insurance commission under section 206 of the Income-tax Act, 1961, ` +
        `for the year ending 31st March, ${b("year")}</strong>`),
      p(`1. (a) Tax Deduction Account Number: ${b("TAN")}<br>&nbsp;&nbsp;&nbsp;&nbsp;(b) Permanent Account Number: ${b("PAN")}`),
      p("2. Details of the person responsible for paying any income by way of remuneration or reward or commission for soliciting or " +
        "procuring insurance business under section 194D:"),
      p(`(a) Name / Designation: ${b("name and designation")}`),
      p("(b) Address:"),
      "<table><tbody>",
      ...["Flat / Door / Block No.", "Name of premises / Building", "Road / Street / Lane", "Area / Locality", "Town / City / District", "State", "Pin Code"]
        .map((label) => `<tr><td>${label}</td><td><br></td></tr>`),
      "</tbody></table>",
      p("(c) Has the address of the person responsible for paying any income by way of remuneration or reward or commission for soliciting or " +
        "procuring insurance business referred to in section 194D changed since submitting the last return? (Tick as applicable) ☐ Yes ☐ No"),
      p("3. Payments of income under section 194D made and tax deducted thereon:"),
      formTable(["Payee", "Gross payment made during the year (Rs.)", "Total payment on which no tax deducted (Rs.)",
        "Total payment on which tax deducted (Rs.)", "Income-tax deducted (Rs.)", "Surcharge deducted (Rs.)", "Total tax deducted (Rs.)"],
      ["1. Companies", "2. Persons other than companies"]),
      p("4. Details of tax paid to the credit of the Central Government:"),
      formTable(["Sl. No.", "Challan number", "Date of payment", "Amount of tax paid (Rs.)", "Name and address of the bank"], ["1", "2"]),
      p("5. Details of income referred to in section 194D credited / paid during the financial year and of tax deducted at source at the " +
        "prescribed rates in force:"),
      p("(a) In the case of income credited / paid to companies:"),
      formTable(TDS_COLS("company", false), ["1", "2"]),
      p("(b) In the case of income credited / paid to persons / payees other than companies:"),
      formTable(TDS_COLS("person / payee", false), ["1", "2"]),
      p("6. Details of income referred to in section 194D which has been credited / paid during the year and of tax deducted at source at a " +
        "lower rate or no tax deducted in accordance with section 197:"),
      p("(a) In the case of companies:"),
      formTable(TDS_COLS("company", true), ["1", "2"]),
      p("(b) In the case of persons / payees other than companies:"),
      formTable(TDS_COLS("person / payee", true), ["1", "2"]),
      center("<strong>VERIFICATION</strong>"),
      p(`I, ${b("name of the person responsible for deducting tax")}, certify that all the particulars furnished above are correct and complete.`),
      p(`Place: ${b("place")}<br>Date: ${b("date", "date")}`),
      right(`Name and signature of the person responsible for deducting tax at source: ${b("name and signature")}<br>Designation: ${b("designation")}`),
    ].join(""),
  },
  {
    id: "eligibility-tc",
    name: "Eligibility criteria and terms and conditions",
    group: "Terms",
    blurb: "Rules for a start-up challenge or grant: who can apply, stages, IP, open-source use, disputes and jurisdiction.",
    fromFile: "Eligibility-Criteria-TC.pdf",
    build: (b) => {
      const org = () => b("organiser");
      return [
        "<h1>Eligibility criteria and terms and conditions</h1>",
        p(`${b("name of the challenge")} · organised by ${org()}`),
        "<h2>Eligibility criteria</h2>",
        ul([
          "Start-ups registered in India can apply. The start-up should not be a subsidiary of any foreign corporation (as per DPIIT guidelines).",
          "To encourage maximum participation, start-ups need not be registered as a start-up when applying. However, start-ups shortlisted for the " +
            "proof-of-concept stage must have applied for registration as an Indian start-up and submit proof of it. Registration should be complete " +
            "by the time of selection at the final stage.",
          "All members of the registering start-up should be at least 18 years of age and Indian citizens.",
          "Only one member per start-up is allowed to register for the challenge.",
          "Members of the start-ups should be mutually exclusive, i.e. a member cannot be part of two or more participating start-ups.",
          "One start-up can apply for multiple use cases, but would be awarded only once.",
        ]),
        "<h2>Terms and conditions</h2>",
        ul([
          `During the challenge, the Single Point of Contact (SPoC) will be contacted for all communications by the implementing agency. The SPoC cannot ` +
            `be changed during the challenge without the prior consent of the implementing agency (${org()}).`,
          "The SPoC will use their e-mail ID and mobile number for registration and account creation on the challenge portal.",
          "All correspondence with participating start-ups will be through the SPoC's e-mail ID. The organisers are not liable for any e-mail delivery failures.",
          `The challenge has three stages. In the first stage (ideation), proposals submitted online are scrutinised and only qualifying start-ups move ` +
            `to the prototyping stage. In the second stage, qualifying start-ups move to the Minimum Viable Product (MVP) stage. In the third stage, ` +
            `qualifying start-ups move to the deployment stage and are considered finalists. One winner is declared from the finalists per domain; ` +
            `since use cases are shortlisted from ${b("number of domains")} domains, ${b("number of winners")} winners will be announced.`,
          "Start-ups may be called for multiple presentations and demonstrations of their work, and may be asked for clarifications by the implementing " +
            "agency or the jury during the challenge.",
          `Start-ups shall maintain detailed documentation of their solution at all stages for reference, evaluation and record. The documentation will ` +
            `carry such weightage as the jury deems fit. ${org()} may review these documents at any time during the challenge.`,
          "Start-ups may withdraw voluntarily only once during the challenge, before the prototype stage, and must disclose it to the organising team " +
            "for approval. No other modification will be entertained.",
          "Awards or funding under this challenge shall be spent only on further enhancement and commercialisation of the use case. Awarded start-ups " +
            "will submit a declaration to that effect.",
          `The intellectual property rights (IPR) in the product developed in the challenge shall be held jointly by ${org()} and the start-up. ` +
            `${org()} will exercise its IPR only if the winning team has no plan to bring the solution to larger public use or commercialisation within ` +
            `a stipulated time, or fails to start its plan within 12 months. ${org()} may then transfer those rights to an appropriate start-up, and ` +
            "reserves the right to hold the IPR for any strategic purpose of national interest.",
          "The solution should not violate, breach or copy already copyrighted, patented or existing products, tools or solutions. Participants are " +
            "solely responsible for any legal dispute arising from it, and shall indemnify the organisers against any losses, damages, rights, claims and " +
            "actions of any kind arising from:" + ul([
            "an exclusion or disqualification of the participant under these rules;",
            "late or unsuccessful efforts to notify winners of any prize;",
            "forfeiture of a prize and the selection of an alternate winner;",
            "late, lost, delayed, damaged, misdirected, incomplete, illegible or unintelligible entries;",
            "telephone, electronic, hardware or software, network, internet or computer malfunctions, failures or difficulties of any kind;",
            "failed, incomplete, garbled or delayed computer transmissions;",
            "any condition caused by events beyond control that may disrupt or corrupt the contest; and",
            "any injuries, losses or damages of any kind relating to participation in this challenge.",
          ]),
          "Participants must declare on a hundred-rupee non-judicial stamp paper that the product or solution submitted is their own and that there is " +
            "no copyright violation of any sort at any stage of the challenge.",
          `Participants may use free and open-source libraries and must follow the terms of their licences. They are expected to make significant and ` +
            `original contributions to the core ${b("technology")} solution.`,
          `Any dispute will be presented to the jury committee; the decision of ${b("final authority")} will be final.`,
          `Any legal dispute shall be subject to the exclusive jurisdiction of the courts at ${b("city")}.`,
          "Participants shall share: the complete source code (including all libraries); executable files with instructions; documentation of software " +
            "design, development and testing; and any other relevant artefacts or documents asked for.",
          "Funds will be transferred only to the bank accounts of start-ups, not to individuals.",
          "Anyone found not complying with these terms and conditions will be debarred from the challenge.",
        ]),
        p(`<em>${org()} reserves the right, at its sole discretion, to cancel, terminate or suspend this challenge, or to change, add to or modify ` +
          `the rules and prizes without prior notice. In no event shall ${org()} or the other organisers be liable for any claims, losses, expenses or ` +
          "damages arising out of or in connection with the challenge.</em>"),
        "<h2>Use of open-source components and the start-up's own work</h2>",
        "<h3>Use of open-source components</h3>",
        ul([
          "Start-ups may use open-source software, libraries, frameworks and tools, provided they comply with recognised open-source licences " +
            "(e.g. MIT, Apache 2.0) that allow commercial use.",
          "All open-source components used must be identified and documented in the submission, with version numbers and licences.",
          "Start-ups are responsible for licence compliance, including attribution, redistribution rights and other obligations under those licences.",
          "Use of non-compliant or proprietary software without the necessary permissions or licences is strictly prohibited.",
        ]),
        "<h3>Original development</h3>",
        ul([
          "A significant portion of the solution's core architecture, business logic and user experience must be developed by the start-up team itself.",
          "Start-ups must clearly separate their own work from third-party and open-source components.",
          "The solution must not be a repackaged or minimally modified version of an existing open-source project.",
          "Start-ups are expected to carry out all phases of development: design, coding, testing, deployment and documentation.",
          "The evaluation committees may audit, review and verify the originality and ownership of the codebase and architecture.",
          "Any evidence of plagiarism, unauthorised reuse or insufficient original development may result in disqualification.",
        ]),
        "<h3>Intellectual property rights</h3>",
        ul([
          `${org()} and the start-ups share ownership of the intellectual property developed, subject to the licences of any open-source components.`,
          `${org()} may use, showcase and promote the solutions developed in this challenge, with attribution to the start-ups.`,
          `Start-ups shall ensure their solutions do not infringe any third-party IP or break any law, and shall indemnify ${org()} against any claim arising from such infringement.`,
        ]),
        "<h3>Compliance and reporting</h3>",
        p("Start-ups shall keep transparent records of all open-source components used, including licences, sources and modifications. Regular " +
          "reports on development progress, open-source use and compliance must be submitted with each milestone. Non-compliance may lead to " +
          "withdrawal of funding or disqualification."),
        "<h2>Guidelines for submitting the idea</h2>",
        ul([
          `${b("technology")} should be used effectively to capture detailed workflows and transactions across stakeholders, with value-added features from other emerging technologies.`,
          `Solutions should be ${b("scope of solutions, e.g. non-crypto applications")}.`,
          "Use deep-tech features to bring innovation and uniqueness to the solution.",
          "Define a viable business model and a plan for wider adoption across states and union territories.",
          "Keep the architecture modular, with API integration, so it can be replicated and scaled.",
          "Define security and privacy, scalability and performance requirements, and comply with regulatory requirements.",
          "Under each use-case category, start-ups may also submit their own unique, innovative and impactful idea.",
          "Start-ups should work with the relevant State or Central Government departments to implement and deploy the use case.",
        ]),
      ].join("");
    },
  },
  {
    id: "adjournment",
    name: "Application for adjournment",
    group: "Court papers",
    blurb: "Short application to adjourn a listed hearing, with the reason and a prayer.",
    build: (b) => [
      center(`<strong>IN THE COURT OF THE ${b("name of the court", "court")}</strong>`),
      center(b("case number", "case_number")),
      center(b("cause title", "matter_title")),
      center(`<strong>APPLICATION FOR ADJOURNMENT ON BEHALF OF THE ${b("Plaintiff / Applicant", "our_side")}</strong>`),
      p(`The ${b("Plaintiff / Applicant", "our_side")} above named most respectfully submits as under:`),
      p(`1. The above matter is listed on ${b("date of hearing", "next_date")} for ${b("purpose of the hearing", "next_purpose")}.`),
      p(`2. ${b("reason, e.g. counsel is engaged in a part-heard matter before another court, or the party is unwell and a medical certificate is annexed")}.`),
      p("3. This application is made bona fide and not to delay the proceedings. The other side will not be prejudiced, and may be compensated " +
        "by costs if this Hon'ble Court so directs."),
      center("<strong>PRAYER</strong>"),
      p("It is therefore most respectfully prayed that this Hon'ble Court may be pleased to adjourn the above matter to a convenient date, " +
        "in the interest of justice."),
      p(`Place: ${b("place")}<br>Date: ${b("date", "date")}`),
      right(`${b("name of the advocate", "advocate")}<br>Advocate for the ${b("Plaintiff / Applicant", "our_side")}`),
    ].join(""),
  },
  {
    id: "s138-notice",
    name: "Demand notice for a dishonoured cheque",
    group: "Notices",
    blurb: "Legal notice under section 138 of the Negotiable Instruments Act, demanding payment within 15 days.",
    build: (b) => [
      p("<strong>BY REGISTERED POST A.D. / SPEED POST</strong>"),
      right(`Date: ${b("date", "date")}`),
      p(`To,<br>${b("name of the drawer", "opposite")}<br>${b("address of the drawer")}`),
      p("<strong>Subject: Legal notice under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881</strong>"),
      p("Sir / Madam,"),
      p(`Under instructions from and on behalf of my client, ${b("client name", "client")}, ${b("client's address")}, I serve you with the following notice:`),
      p(`1. You issued cheque No. ${b("cheque number")} dated ${b("cheque date")} for ₹${b("amount")}, drawn on ${b("bank and branch")}, ` +
        `in favour of my client towards ${b("the liability, e.g. goods supplied under invoice No. ___")}.`),
      p(`2. When presented for payment, the cheque was returned unpaid with the remark "${b("reason, e.g. funds insufficient")}" ` +
        `by the bank's return memo dated ${b("date of return memo")}.`),
      p(`3. You are called upon to pay the said sum of ₹${b("amount")} to my client within 15 days of receiving this notice.`),
      p("4. If you fail to pay within that time, my client will be constrained to file a complaint against you under Section 138 of the " +
        "Negotiable Instruments Act, 1881, and to take civil proceedings for recovery, entirely at your risk as to costs and consequences."),
      p("A copy of this notice is kept in my office for further action."),
      right(`${b("name of the advocate", "advocate")}<br>Advocate for ${b("client name", "client")}`),
      p("<em>Note for the file: send within 30 days of receiving the return memo (s.138(b)).</em>"),
    ].join(""),
  },
  {
    id: "file-note",
    name: "Hearing note for the file",
    group: "Office",
    blurb: "What happened at the last date, the next date, and what to do before it.",
    build: (b) => [
      "<h1>File note</h1>",
      "<table><tbody>",
      `<tr><td><strong>Case</strong></td><td>${b("case number", "case_number")}</td></tr>`,
      `<tr><td><strong>Title</strong></td><td>${b("cause title", "matter_title")}</td></tr>`,
      `<tr><td><strong>Court</strong></td><td>${b("court", "court")}</td></tr>`,
      `<tr><td><strong>Client</strong></td><td>${b("client", "client")}</td></tr>`,
      `<tr><td><strong>Stage</strong></td><td>${b("stage", "stage")}</td></tr>`,
      "</tbody></table>",
      "<h2>Last date</h2>",
      p(`${b("last date", "last_date")}: ${b("what happened", "last_outcome")}`),
      "<h2>Next date</h2>",
      p(`${b("next date", "next_date")}, for ${b("purpose", "next_purpose")}`),
      "<h2>To do before then</h2>",
      ul([b("steps, documents, witnesses")]),
      p(`${b("name of the advocate", "advocate")}, ${b("date", "date")}`),
    ].join(""),
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

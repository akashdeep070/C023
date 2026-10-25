# Lex AI

A small cloud vault for legal files, built for a cloud computing class project.
Lawyers upload scans, photos and PDFs. Lex AI fingerprints each file with SHA-256,
keeps a locked copy, writes a short AI summary, finds the next hearing date and
reminds the lawyer the day before.

**Stack:** Node.js 22 with Express 5 and TypeScript for the API. React 19 with TypeScript
and Vite for the frontend. Storage uses Node's built-in `node:sqlite`, so there are no native modules.
The AI runs on [Groq](https://console.groq.com) with small, fast models to keep compute low.
If no key is set, a local reader (keyword and date matching) takes over, so the demo still works offline.

All names, cases and amounts in the app are dummy data.

## Features

| Page | What it shows |
| --- | --- |
| Overview | Control panel: KPI tiles, a 14-day activity chart, live system health, a "needs attention" queue, upcoming hearings, recent documents and live activity |
| Upload | Drag-and-drop for PDF, TXT, PNG, JPG and WEBP files up to 20 MB, with auto-detected case number and document type |
| Documents | Search by case number, party, client, date or any word in the file |
| Document | AI summary and key points, "Ask the file" (answers cite a page), hearing confirmation, SHA-256 proof, versions, tamper demo and restore, audit trail |
| Hearings | Dates to confirm, upcoming hearings, a month calendar, and "Send due reminders" |
| Clients | Client directory, profiles, matters, documents, invoices and a case activity timeline |
| Billing | Itemized invoices, retainers, payments and a printable PDF invoice |
| Audit log | Every action, who did it and when |
| Status & SLA | Live P95/P99 latency and error rate (refreshes every 5 s), health checks, and which container answered |

The app uses a SaaS-style shell: a sidebar menu with counts, and a menu button that collapses it to an
icon rail (or opens it as a drawer on phones). The top bar has search (press `/`), the serving
instance, and hearing alerts.

## Run it locally

Needs Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env      # then paste your GROQ_API_KEY into .env
npm run dev
```

Open http://localhost:5173. Vite serves the React app with hot reload and forwards `/api` to the
Express server on port 3000. Demo data is created on first run in `data/`.
Delete the `data/` folder to start fresh.

To run the production build on one port:

```bash
npm run build
npm start                 # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | API (tsx watch) and web (Vite) together |
| `npm run build` | Compile the server to `dist/server`, type-check the client, build it to `dist/client` |
| `npm start` | Run the built server, which also serves the React app |
| `npm run typecheck` | Type-check server and client |

## Run it like the architecture slide (nginx + app1 + app2)

```bash
cp .env.example .env      # add GROQ_API_KEY
docker compose up --build
```

Open http://localhost. nginx balances between `app1` and `app2`. Both share one volume,
so files and the database are the same everywhere. Each container is a single Node process
using about 80 MB of memory, which fits on a t3.micro.

## Demo script (about 5 minutes)

1. **Overview.** Walk through the KPIs, the activity chart, system health and the "Needs attention" list.
2. **Upload** `samples/sample-bail-order.pdf` with client "+ New client…".
   Show the summary, the detected case number and parties, and the suggested hearing date with its page.
3. **Ask the file:** "When was bail granted?" or "What is the bond amount?". The answer cites page 3.
4. **Confirm** the hearing date. Then open **Hearings** and click **Send due reminders**.
5. **Search** "Sharma" from the top bar to find files across three clients.
6. **Proof:** on any document click **Verify now**, then **Demo: simulate a tampering script**,
   then **Verify now** again (mismatch) and **Restore locked copy** (verified again). It is all in the audit log.
7. **Billing:** open INV-2026-014 (balance ₹9,000), record a payment and click **Download PDF invoice**.
8. **Status & SLA:** with Docker, refresh to see app1 and app2 take turns. Run
   `docker compose exec app1 kill 1` and the app stays up while Docker restarts app1.

## Keeping compute low

- Text model `llama-3.1-8b-instant`. Vision model `llama-4-scout` is only used for photos.
- Prompts send at most about 9,000 characters. "Ask the file" sends only the 3 most relevant pages.
- Output is capped at 200 to 450 tokens.
- AI runs once per upload, never on page views.
- PDFs are limited to the first 60 pages.
- SQLite and the local disk stand in for DynamoDB and S3, so there is nothing else to run.
- The React bundle is about 100 KB gzipped, with no UI framework.

Change the models in `.env` (`GROQ_MODEL`, `GROQ_VISION_MODEL`) if Groq retires them.

## How it maps to AWS

| In this demo | On AWS (per the slides) |
| --- | --- |
| `data/uploads/` working copy | S3 bucket with versioning |
| `data/vault/` read-only copy | S3 Object Lock |
| `data/lex.db` (SQLite) | DynamoDB |
| Audit table | CloudTrail + app log |
| "Send due reminders" button | EventBridge Scheduler + SNS email |
| `/health` endpoint | Route 53 health check, CloudWatch |
| docker-compose (nginx, app1, app2) | EC2 t3.micro running Docker Compose |

## Files

```
server/
  index.ts      Express app and all /api routes
  ai.ts         Groq calls (summary, hearing date, Q&A, image reading) and the local fallback
  extract.ts    Text from PDFs (unpdf), text files and images
  vault.ts      Storage, SHA-256, versions, tamper and restore, audit log
  queries.ts    Shared read queries, metrics and health
  db.ts         SQLite schema and helpers (node:sqlite)
  seed.ts       Dummy clients, documents and invoices
shared/
  types.ts      API response types used by both server and client
  format.ts     Dates, rupees and file sizes
client/
  index.html
  src/main.tsx  Routes
  src/pages/    One component per page
  src/components/  Layout (sidebar + top bar), chart, flash messages, icons
  src/styles.css   One hand-written stylesheet (black and gray, no UI framework)
samples/        Files to upload during the demo
```

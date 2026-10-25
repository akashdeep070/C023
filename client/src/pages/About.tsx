import { Link } from "react-router-dom";
import { PageHead } from "../components/common";
import { Icon } from "../components/Icon";
import { Illustration } from "../components/Illustration";
import { useTitle } from "../hooks";

// The story from the class presentation: problem, solution, how it is built, result
const PROBLEMS: [string, string, string][] = [
  ["message", "Files on WhatsApp", "Client documents arrive on WhatsApp, email and pen drives."],
  ["alert", "Paper gets damaged", "Originals are lost, burnt or eaten by termites."],
  ["clock", "Slow to find", "One order means flipping through hundreds of pages."],
  ["file", "Too much reading", "Long judgments are read just for the key points."],
  ["calendar", "Missed hearings", "Hearing dates live in a paper diary."],
  ["server", "No backup", "A lost phone or crashed PC loses everything."],
  ["history", "No audit trail", "Nobody knows who opened or changed a file."],
  ["eye", "Privacy risk", "Confidential files sit on personal phones."],
];

const SOLUTIONS: [string, string, string, string][] = [
  ["upload", "One upload page", "Every client document goes to one secure place.", "blue"],
  ["lock", "Safe in the cloud", "Stored with every version kept and a locked copy.", "green"],
  ["search", "Find in seconds", "Search by case number, party or date.", "blue"],
  ["sparkles", "AI summary", "AI writes a short summary of every file.", "purple"],
  ["bell", "Hearing reminders", "AI finds the date; a reminder goes out a day before.", "amber"],
  ["refresh", "Automatic backup", "Two app containers; a failed one restarts itself.", "green"],
  ["fingerprint", "Proof and audit log", "SHA-256 fingerprint and a record of every action.", "green"],
  ["shield", "Private by default", "Files open only inside the app, and every view is logged.", "blue"],
];

const BUILT: [string, string, string][] = [
  ["server", "Docker", "nginx in front of two app containers"],
  ["database", "Cloud storage", "Files, locked copies and a database; S3 and DynamoDB on AWS"],
  ["sparkles", "AI", "Groq reads and summarizes files; Textract and Bedrock on AWS"],
  ["activity", "SLA & TTR", "Live latency, error rate and health checks"],
];

export function About() {
  useTitle("About the project");

  return (
    <>
      <PageHead eyebrow="About the project · Cloud computing 2026" title="Legal files, off paper" soft="and into the cloud."
        lede="Lex AI is a cloud app that keeps every client document in one safe place, reads it with AI, and reminds lawyers before each hearing.">
        <Link className="btn" to="/upload"><Icon name="upload" size={16} /> Try an upload</Link>
      </PageHead>

      <Illustration src="/images/hero-vault.jpg" alt="Legal files moving from paper into a secure glass cloud vault" className="about-banner" />

      <section className="section">
        <div className="eyebrow" style={{ marginBottom: 14 }}>The problem</div>
        <h2>Legal work is scattered <span className="text-red">across phones, paper and diaries.</span></h2>
        <div className="about-grid section" style={{ marginTop: 24 }}>
          <Illustration src="/images/problem-paperwork.jpg" alt="Scattered legal papers, case folders, a phone and a hearing diary" className="about-side" />
          <div className="grid g2">
            {PROBLEMS.map(([icon, title, text]) => (
              <div className="card about-point" key={title}>
                <span className="icon-tile red"><Icon name={icon} size={17} /></span>
                <h4>{title}</h4>
                <p className="small muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="check bad" style={{ marginTop: 20 }}>
          <Icon name="search" size={17} />
          <span><b>The gap:</b> client files have no single safe home, and nothing reminds anyone of a hearing.</span>
        </div>
      </section>

      <section className="section" style={{ marginTop: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Our solution</div>
        <h2>Lex AI gives every client file <span className="text-blue">one safe home.</span></h2>
        <div className="about-grid section" style={{ marginTop: 24 }}>
          <Illustration src="/images/solution-workspace.jpg" alt="Digital legal workspace with laptop, secure cloud and confirmed hearing reminder" className="about-side" />
          <div className="grid g2">
            {SOLUTIONS.map(([icon, title, text, tone]) => (
              <div className="card about-point" key={title}>
                <span className={`icon-tile ${tone}`}><Icon name={icon} size={17} /></span>
                <h4>{title}</h4>
                <p className="small muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="check" style={{ marginTop: 20 }}>
          <Icon name="check-circle" size={17} />
          <span><b>The result:</b> files are safe, searchable and summarized, and every hearing gets a reminder.</span>
        </div>
      </section>

      <section className="card section" style={{ marginTop: 56 }}>
        <div className="label" style={{ marginBottom: 20 }}>Built with</div>
        <div className="grid g4">
          {BUILT.map(([icon, title, text]) => (
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }} key={title}>
              <span className="icon-tile blue"><Icon name={icon} size={17} /></span>
              <div><h4>{title}</h4><p className="small muted" style={{ marginTop: 4 }}>{text}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="about-end card section" style={{ marginTop: 20 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Conclusion</div>
          <h2>Never lost. AI-assisted. Self-healing. <span className="text-green">Measured.</span></h2>
          <p className="muted" style={{ marginTop: 12, maxWidth: 520 }}>
            Lex AI takes client files off WhatsApp and paper and into one cloud vault that keeps them safe, reads them with AI,
            and reminds lawyers before every hearing.
          </p>
          <div className="row wrap-row" style={{ gap: 8, marginTop: 20 }}>
            <Link className="btn sm" to="/">Open the control panel</Link>
            <Link className="btn ghost sm" to="/status">See the live SLA</Link>
          </div>
        </div>
        <Illustration src="/images/vault-verified.jpg" alt="Legal files protected inside a cloud vault with a lock and verification check" />
      </section>
    </>
  );
}

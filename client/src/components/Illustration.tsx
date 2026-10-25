import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

/** An image from the class presentation, labelled as AI-generated like on the slides. */
export function Illustration({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={`illustration ${className}`}>
      <img src={src} alt={alt} loading="lazy" decoding="async" />
      <figcaption>AI-generated illustration</figcaption>
    </figure>
  );
}

const HIDE_KEY = "lex-hide-hero";

/** The welcome banner on the overview. It can be hidden; the choice is remembered in this browser. */
export function HeroBanner() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });
  if (hidden) return null;

  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* private mode */ }
  };

  return (
    <section className="hero card">
      <div className="hero-text">
        <div className="label text-blue">Cloud + AI for the legal industry</div>
        <h2>Legal files, off paper and <span className="text-blue">into the cloud.</span></h2>
        <p className="muted">
          Lex AI keeps every client document in one safe place, reads it with AI, and reminds lawyers before each hearing.
        </p>
        <div className="hero-steps">
          {[["scan", "Collect", "Scans, photos, PDFs"], ["lock", "Store", "Locked copy"], ["fingerprint", "Prove", "SHA-256"],
            ["sparkles", "Read", "AI summary"], ["bell", "Remind", "Before each hearing"]].map(([icon, title, sub]) => (
            <div className="hero-step" key={title}>
              <Icon name={icon} size={16} />
              <div><b>{title}</b><span>{sub}</span></div>
            </div>
          ))}
        </div>
        <div className="row wrap-row" style={{ gap: 8 }}>
          <Link className="btn sm" to="/upload"><Icon name="upload" size={14} /> Upload a file</Link>
          <Link className="btn ghost sm" to="/about">About the project</Link>
        </div>
      </div>
      <Illustration src="/images/hero-vault.jpg" alt="Legal files moving from paper into a secure glass cloud vault" className="hero-art" />
      <button className="icon-btn hero-x" onClick={hide} aria-label="Hide welcome banner" title="Hide"><Icon name="x" size={16} /></button>
    </section>
  );
}

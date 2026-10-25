import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { PageHead } from "./components/common";
import { FlashProvider } from "./components/Flash";
import { Icon } from "./components/Icon";
import { Layout } from "./components/Layout";
import { Activity } from "./pages/Activity";
import { Billing } from "./pages/Billing";
import { ClientPage } from "./pages/ClientPage";
import { Clients } from "./pages/Clients";
import { Dashboard } from "./pages/Dashboard";
import { Deadlines } from "./pages/Deadlines";
import { Diary } from "./pages/Diary";
import { DocumentPage } from "./pages/DocumentPage";
import { Documents } from "./pages/Documents";
import { DraftEditor } from "./pages/DraftEditor";
import { Drafts } from "./pages/Drafts";
import { InvoiceNew } from "./pages/InvoiceNew";
import { InvoicePage } from "./pages/InvoicePage";
import { MatterPage } from "./pages/MatterPage";
import { Matters } from "./pages/Matters";
import { StatusPage } from "./pages/StatusPage";
import { Upload } from "./pages/Upload";
// Self-hosted fonts: Inter Tight for everything, Geist Mono for case numbers, hashes and keys
import "@fontsource-variable/inter-tight";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./styles.css";

function NotFound() {
  return (
    <PageHead eyebrow="Error 404" title="That page doesn't exist.">
      <Link className="btn" to="/"><Icon name="arrow-left" size={16} /> Back to overview</Link>
    </PageHead>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <FlashProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="upload" element={<Upload />} />
            <Route path="documents" element={<Documents />} />
            <Route path="documents/:id" element={<DocumentPage />} />
            <Route path="drafts" element={<Drafts />} />
            <Route path="drafts/:id" element={<DraftEditor />} />
            <Route path="diary" element={<Diary />} />
            <Route path="hearings" element={<Navigate to="/diary" replace />} />
            <Route path="matters" element={<Matters />} />
            <Route path="matters/:id" element={<MatterPage />} />
            <Route path="deadlines" element={<Deadlines />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<ClientPage />} />
            <Route path="billing" element={<Billing />} />
            <Route path="billing/new" element={<InvoiceNew />} />
            <Route path="billing/:id" element={<InvoicePage />} />
            <Route path="activity" element={<Activity />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </FlashProvider>
    </BrowserRouter>
  </StrictMode>,
);

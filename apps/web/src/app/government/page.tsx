"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardLayout, { DashboardError, DashboardLoading } from "../../components/DashboardLayout";
import MapPlotDirectory from "../../components/MapPlotDirectory";
import PlotLocationNote from "../../components/PlotLocationNote";
import { dashboardFetch, loadMapPlots, type MapPlot } from "../../lib/dashboard";

type Land = { id: string; plotId: string; title: string; state?: string; district?: string; metadata?: unknown };
type VerificationRequest = { id: string; land: Land; requestedBy?: { name?: string; email?: string }; submittedAt: string };
type Transfer = { id: string; status: string; land: Land; escrow?: { status: string }; approvals: { officerId: string }[]; fromUser?: { name?: string }; toUser?: { name?: string } };
type Case = { id: string; reason?: string; severity?: string; caseReference?: string; authority?: string; description?: string; documentHash?: string; type?: string; land?: Land };
type Objection = { id: string; name: string; reason: string; land: { plotId: string; title: string; state: string; district?: string; metadata?: unknown } };
type AuditEntry = { id: string; action: string; targetType: string; targetId: string; createdAt: string };
type GovernmentData = {
  verificationQueue: VerificationRequest[];
  transfers: Transfer[];
  disputes: Case[];
  encumbrances: Case[];
  fraudFlags: Case[];
  objections: Objection[];
  auditLogs: AuditEntry[];
  stats: { _count?: { _all: number }; status: string }[];
};

export default function GovernmentDashboard() {
  const [data, setData] = useState<GovernmentData | null>(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [mapPlots, setMapPlots] = useState<MapPlot[]>([]);

  async function loadDashboard() {
    try {
      const [officerData, plots] = await Promise.all([
        dashboardFetch<GovernmentData>("/api/v1/dashboard/officer"),
        loadMapPlots(),
      ]);
      setData(officerData);
      setMapPlots(plots);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  useEffect(() => { void loadDashboard(); }, []);

  async function reviewRequest(path: string, body?: Record<string, unknown>) {
    setBusyAction(path);
    setActionMessage("");
    try {
      const result = await dashboardFetch<{ message?: string }>(path, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setActionMessage(result.message || "Review action completed.");
      await loadDashboard();
    } catch (reason) {
      setActionMessage((reason as Error).message);
    } finally {
      setBusyAction("");
    }
  }

  function rejectVerification(requestId: string) {
    const reason = window.prompt("Enter a reason for rejecting this verification request:");
    if (!reason?.trim()) return;
    void reviewRequest(`/api/v1/verification/${requestId}/reject`, { reason: reason.trim() });
  }

  function rejectTransfer(transferId: string) {
    const reason = window.prompt("Enter a reason for rejecting this transfer:");
    if (!reason?.trim()) return;
    void reviewRequest(`/api/v1/transfers/${transferId}/reject`, { reason: reason.trim() });
  }

  function resolveCase(path: string, status: "RESOLVED" | "DISMISSED" = "RESOLVED") {
    const resolution = window.prompt("Enter the official resolution and evidence reference:");
    if (!resolution?.trim()) return;
    const documentHash = path.includes("/encumbrances/") ? window.prompt("Enter the 64-character SHA-256 hash of the supporting clearance document:") : null;
    if (path.includes("/encumbrances/") && !/^[a-fA-F0-9]{64}$/.test(documentHash || "")) {
      setActionMessage("A valid 64-character hexadecimal SHA-256 hash is required.");
      return;
    }
    void reviewRequest(path, {
      ...(path.includes("/objections/") || path.includes("/disputes/") || path.includes("/encumbrances/") ? { resolution: resolution.trim() } : { reason: resolution.trim() }),
      status,
      ...(documentHash ? { documentHash } : {}),
    });
  }

  async function createRestriction(event: React.FormEvent<HTMLFormElement>, kind: "disputes" | "encumbrances") {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = kind === "disputes"
      ? { landId: form.get("landId"), caseReference: form.get("reference"), description: form.get("description") }
      : { landId: form.get("landId"), type: form.get("type"), authority: form.get("authority"), reference: form.get("reference"), documentHash: form.get("documentHash") };
    await reviewRequest(`/api/v1/dashboard/${kind}`, body);
    formElement.reset();
  }

  if (error) return <DashboardError message={error} requiredRole="GOVERNMENT" />;
  if (!data) return <DashboardLoading message="Loading the government review queue..." />;

  const totalRecords = data.stats.reduce((sum, item) => sum + (item._count?._all || 0), 0);
  const pendingLand = data.stats.find((item) => item.status === "PENDING")?._count?._all || 0;

  return (
    <DashboardLayout
      role="GOVERNMENT"
      eyebrow="Authorized officer portal"
      title="Government operations"
      description="Review land verification requests, transfer approvals, fraud flags, disputes, and active restrictions."
    >
      {actionMessage && <p className="dashboard-feedback" role="status">{actionMessage}</p>}
      <section className="dashboard-grid">
        <Metric label="Registry records" value={totalRecords} detail="All land records grouped by status" />
        <Metric label="Pending verification" value={data.verificationQueue.length || pendingLand} detail="Land records awaiting officer review" />
        <Metric label="Transfer review" value={data.transfers.length} detail="Locked or escrow-backed transfers" />
        <Metric label="Open risk cases" value={data.fraudFlags.length + data.disputes.length} detail={`${data.fraudFlags.length} fraud flags · ${data.disputes.length} disputes`} />
      </section>

      <section className="dashboard-status-strip">
        {data.stats.map((item) => <div key={item.status}><span>{item.status.replaceAll("_", " ")}</span><b>{item._count?._all || 0}</b></div>)}
      </section>

      <MapPlotDirectory plots={mapPlots} audience="officer" />

      <section className="dashboard-columns">
        <article className="dashboard-panel" id="verification-queue">
          <div className="dashboard-panel-heading"><h2>Land verification queue</h2><Link href="/admin">Admin overview</Link></div>
          {data.verificationQueue.length ? data.verificationQueue.slice(0, 8).map((request) => (
            <div className="dashboard-row" key={request.id}>
              <div><b>{request.land.plotId} · {request.land.title}</b><span>{[request.land.district, request.land.state].filter(Boolean).join(", ")}{request.land.district || request.land.state ? " · " : ""}{request.requestedBy?.name || request.requestedBy?.email || "Land owner"} · Submitted {new Date(request.submittedAt).toLocaleDateString()}</span><PlotLocationNote metadata={request.land.metadata} /></div>
              <div className="dashboard-actions">
                <button type="button" disabled={busyAction === `/api/v1/verification/${request.id}/approve`} onClick={() => void reviewRequest(`/api/v1/verification/${request.id}/approve`)}>
                  {busyAction === `/api/v1/verification/${request.id}/approve` ? "Approving..." : "Approve"}
                </button>
                <button className="danger-action" type="button" disabled={Boolean(busyAction)} onClick={() => rejectVerification(request.id)}>Reject</button>
              </div>
            </div>
          )) : <Empty text="No land verification requests are pending." />}
        </article>
        <article className="dashboard-panel" id="transfer-review">
          <div className="dashboard-panel-heading"><h2>Transfer approvals</h2><Link href="/admin#users">User directory</Link></div>
          {data.transfers.length ? data.transfers.slice(0, 8).map((transfer) => (
            <div className="dashboard-row" key={transfer.id}>
              <div><b>{transfer.land.plotId} · {transfer.land.title}</b><span>{[transfer.land.district, transfer.land.state].filter(Boolean).join(", ")}{transfer.land.district || transfer.land.state ? " · " : ""}{transfer.status.replaceAll("_", " ")} · Escrow {transfer.escrow?.status || "PENDING"} · {transfer.approvals.length} approval(s)</span><PlotLocationNote metadata={transfer.land.metadata} /></div>
              <div className="dashboard-actions">
                <Status value={transfer.status} />
                <button type="button" disabled={Boolean(busyAction)} onClick={() => {
                  if (window.confirm(transfer.approvals.length ? "Record your independent approval for this transfer?" : "Approve this transfer? High-value or flagged transfers require a second officer.")) {
                    void reviewRequest(`/api/v1/transfers/${transfer.id}/approve`);
                  }
                }}>{transfer.approvals.length ? "Second approval" : "Approve"}</button>
                <button className="danger-action" type="button" disabled={Boolean(busyAction)} onClick={() => rejectTransfer(transfer.id)}>Reject</button>
              </div>
            </div>
          )) : <Empty text="No transfers currently need officer review." />}
        </article>
      </section>

      <section className="dashboard-columns" id="risk-cases">
        <CaseList title="Fraud review" entries={data.fraudFlags} type="fraud" onResolve={(entry) => resolveCase(`/api/v1/dashboard/fraud-flags/${entry.id}/resolve`)} />
        <CaseList title="Disputes" entries={data.disputes} type="restriction" onResolve={(entry) => resolveCase(`/api/v1/dashboard/disputes/${entry.id}/resolve`)} />
      </section>
      <section className="dashboard-columns">
        <CaseList title="Encumbrances" entries={data.encumbrances} type="restriction" onResolve={(entry) => resolveCase(`/api/v1/dashboard/encumbrances/${entry.id}/clear`)} />
        <article className="dashboard-panel"><h2>Public objections</h2>
          {data.objections.length ? data.objections.map((objection) => <div className="dashboard-row" key={objection.id}>
            <div><b>{objection.land.plotId} · {objection.name}</b><span>{objection.reason}</span><PlotLocationNote metadata={objection.land.metadata} /></div>
            <div className="dashboard-actions">
              <button type="button" onClick={() => resolveCase(`/api/v1/dashboard/objections/${objection.id}/resolve`, "RESOLVED")}>Resolve</button>
              <button className="danger-action" type="button" onClick={() => resolveCase(`/api/v1/dashboard/objections/${objection.id}/resolve`, "DISMISSED")}>Dismiss</button>
            </div>
          </div>) : <Empty text="No public objections are awaiting resolution." />}
        </article>
      </section>
      <section className="dashboard-columns">
        <article className="dashboard-panel"><h2>Record encumbrance</h2>
          <form className="dashboard-login-form" onSubmit={(event) => void createRestriction(event, "encumbrances")}>
            <label>Land record ID<input name="landId" required /></label>
            <label>Type<select name="type">{["MORTGAGE", "LIEN", "ACQUISITION_NOTICE", "COURT_ORDER", "OTHER"].map((type) => <option key={type}>{type}</option>)}</select></label>
            <label>Authority<input name="authority" required /></label><label>Reference<input name="reference" /></label>
            <label>Supporting document SHA-256<input name="documentHash" required minLength={64} maxLength={64} pattern="[a-fA-F0-9]{64}" /></label>
            <button className="button dark" type="submit">Record restriction</button>
          </form>
        </article>
        <article className="dashboard-panel"><h2>Open a dispute</h2>
          <form className="dashboard-login-form" onSubmit={(event) => void createRestriction(event, "disputes")}>
            <label>Land record ID<input name="landId" required /></label>
            <label>Case reference<input name="reference" required /></label>
            <label>Case description<textarea name="description" required /></label>
            <button className="button dark" type="submit">Record dispute</button>
          </form>
        </article>
      </section>
      <section className="dashboard-panel"><h2>My immutable audit trail</h2>
        {data.auditLogs.length ? data.auditLogs.slice(0, 12).map((entry) => <div className="dashboard-row" key={entry.id}><div><b>{entry.action.replaceAll("_", " ")}</b><span>{entry.targetType} · {entry.targetId}</span></div><time>{new Date(entry.createdAt).toLocaleString()}</time></div>) : <Empty text="Your officer actions will be recorded here." />}
      </section>
    </DashboardLayout>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="dashboard-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function CaseList({ title, entries, type, onResolve }: { title: string; entries: Case[]; type: "fraud" | "restriction"; onResolve: (entry: Case) => void }) {
  return (
    <article className="dashboard-panel">
      <h2>{title}</h2>
      {entries.length ? entries.slice(0, 8).map((entry) => (
        <div className="dashboard-row" key={entry.id}>
          <div><b>{entry.land?.plotId || "Unlinked case"}</b><span>{entry.reason || entry.description || entry.caseReference || entry.authority || "Active restriction"}</span><PlotLocationNote metadata={entry.land?.metadata} /></div>
          <div className="dashboard-actions"><Status value={type === "fraud" ? entry.severity || "REVIEW" : "BLOCKED"} /><button type="button" onClick={() => onResolve(entry)}>{type === "fraud" ? "Resolve review" : title === "Encumbrances" ? "Clear" : "Resolve"}</button></div>
        </div>
      )) : <Empty text={type === "fraud" ? "No open fraud cases." : "No active disputes or encumbrances."} />}
    </article>
  );
}

function Status({ value }: { value: string }) {
  const tone = ["HIGH", "CRITICAL", "BLOCKED", "REJECTED"].includes(value) ? "danger" : "warning";
  return <mark className={tone}>{value.replaceAll("_", " ")}</mark>;
}

function Empty({ text }: { text: string }) {
  return <p className="dashboard-empty">{text}</p>;
}

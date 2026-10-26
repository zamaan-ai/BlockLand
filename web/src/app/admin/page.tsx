"use client";

import { FormEvent, useEffect, useState } from "react";
import DashboardLayout, { DashboardError, DashboardLoading } from "../../components/DashboardLayout";
import PlotLocationNote from "../../components/PlotLocationNote";
import { dashboardFetch } from "../../lib/dashboard";

type AdminStats = { stats: { totalLands: number; verifiedUsers: number; totalUsers: number; pendingLands: number; activeTransfers: number; openFraudFlags: number } };
type AdminUser = { id: string; name: string; email: string; role: string; isActive: boolean; isVerified: boolean; createdAt: string; roleAssignments: { id: string; role: string; jurisdiction?: string | null; active: boolean }[] };
type AuditLog = { id: string; action: string; actorId?: string; entityType?: string; entityId?: string; createdAt: string };
type RoleRequest = { id: string; role: string; jurisdiction?: string | null; user: { id: string; name: string; email: string; isVerified: boolean } };
type AdminData = {
  stats: AdminStats["stats"]; users: AdminUser[]; logs: AuditLog[]; requests: RoleRequest[];
  health: { health: { database: string; api: string; checkedAt: string }; monitoring: Record<string, number> };
  approvals: { transfers: { id: string; status: string; escrow?: { amount: string }; land: { plotId: string; title: string; metadata?: unknown; fraudFlags: { severity: string; reason: string }[] }; approvals: { officerId: string }[] }[] };
};

export default function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  async function loadData(search = "") {
    return Promise.all([
      dashboardFetch<AdminStats>("/api/v1/admin/stats"),
      dashboardFetch<{ users: AdminUser[] }>("/api/v1/admin/users"),
      dashboardFetch<{ logs: AuditLog[] }>(`/api/v1/admin/audit-logs${search ? `?q=${encodeURIComponent(search)}` : ""}`),
      dashboardFetch<{ requests: RoleRequest[] }>("/api/v1/admin/role-requests"),
      dashboardFetch<AdminData["health"]>("/api/v1/admin/system-health"),
      dashboardFetch<AdminData["approvals"]>("/api/v1/dashboard/second-approvals"),
    ]).then(([stats, users, audit, requests, health, approvals]) => {
      setData({
        stats: stats.stats, users: users.users, logs: audit.logs,
        requests: requests.requests, health, approvals,
      });
    }).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { void loadData(); }, []);

  async function adminAction(path: string, options: RequestInit, successMessage: string): Promise<boolean> {
    try {
      await dashboardFetch(path, options);
      setMessage(successMessage);
      await loadData(query);
      return true;
    } catch (reason) { setMessage((reason as Error).message); }
    return false;
  }

  function grantRole(userId: string, role: string) {
    const jurisdiction = role === "GOVERNMENT" ? window.prompt("Enter the officer's assigned state jurisdiction (do not use * unless formally authorized):") : null;
    if (role === "GOVERNMENT" && !jurisdiction?.trim()) return;
    void adminAction(`/api/v1/admin/users/${userId}/roles`, {
      method: "POST", body: JSON.stringify({ role, ...(jurisdiction ? { jurisdiction: jurisdiction.trim() } : {}) }),
    }, `${role} access granted.`);
  }

  function approveRequest(request: RoleRequest) {
    const jurisdiction = request.role === "GOVERNMENT" ? window.prompt("Enter the officer's assigned state jurisdiction:") : request.jurisdiction;
    if (request.role === "GOVERNMENT" && !jurisdiction?.trim()) return;
    void adminAction(`/api/v1/admin/users/${request.user.id}/roles`, {
      method: "POST", body: JSON.stringify({ role: request.role, ...(jurisdiction ? { jurisdiction } : {}) }),
    }, `${request.role} request approved.`);
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const saved = await adminAction("/api/v1/admin/legal-corrections", {
      method: "POST",
      body: JSON.stringify({
        landId: form.get("landId"), caseReference: form.get("caseReference"),
        description: form.get("description"), correctedOwnerId: form.get("correctedOwnerId") || undefined,
        documentHash: form.get("documentHash"),
      }),
    }, "Court-ordered correction recorded as a new ownership-history event.");
    if (saved) formElement.reset();
  }

  async function createOfficer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const saved = await adminAction("/api/v1/admin/officers", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"), email: form.get("email"),
        password: form.get("password"), jurisdiction: form.get("jurisdiction"),
      }),
    }, "Government officer account created with the assigned jurisdiction.");
    if (saved) formElement.reset();
  }

  if (error) return <DashboardError message={error} requiredRole="ADMIN" />;
  if (!data) return <DashboardLoading message="Loading administration console..." />;

  return (
    <DashboardLayout
      role="ADMIN"
      eyebrow="Platform administration"
      title="Admin console"
      description="Monitor platform activity, review account access, and inspect the audit trail. Government casework remains available in its dedicated portal."
    >
      {message && <p className="dashboard-feedback" role="status">{message}</p>}
      <section className="dashboard-panel" id="create-officer">
        <h2>Create a government officer account</h2>
        <p>Officer accounts are separate role assignments with an explicitly scoped jurisdiction.</p>
        <form className="dashboard-login-form" onSubmit={(event) => void createOfficer(event)}>
          <label>Officer name<input name="name" required maxLength={120} /></label>
          <label>Officer email<input name="email" type="email" required /></label>
          <label>Initial password<input name="password" type="password" minLength={12} maxLength={128} required /></label>
          <label>Assigned state jurisdiction<input name="jurisdiction" required placeholder="State name" /></label>
          <button className="button dark" type="submit">Create scoped officer account</button>
        </form>
      </section>
      <section className="dashboard-grid">
        <Metric label="Land records" value={data.stats.totalLands} detail="Total parcels in the registry" />
        <Metric label="Registered users" value={data.stats.totalUsers} detail={`${data.stats.verifiedUsers} verified identities`} />
        <Metric label="Pending land review" value={data.stats.pendingLands} detail="Records waiting for verification" />
        <Metric label="Active transfers" value={data.stats.activeTransfers} detail={`${data.stats.openFraudFlags} open fraud flags`} />
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><h2>System health</h2><span>Checked {new Date(data.health.health.checkedAt).toLocaleString()}</span></div>
        <div className="dashboard-status-strip">
          <div><span>Database</span><b>{data.health.health.database}</b></div><div><span>API</span><b>{data.health.health.api}</b></div>
          {Object.entries(data.health.monitoring).map(([key, value]) => <div key={key}><span>{key.replaceAll(/([A-Z])/g, " $1")}</span><b>{value}</b></div>)}
        </div>
      </section>
      <section className="dashboard-panel" id="second-approvals">
        <div className="dashboard-panel-heading"><h2>High-risk second approvals</h2><span>Cases flagged for senior review</span></div>
        {data.approvals.transfers.length ? data.approvals.transfers.map((transfer) => <div className="dashboard-row" key={transfer.id}>
          <div><b>{transfer.land.plotId} · {transfer.land.title}</b><span>{transfer.status} · {transfer.land.fraudFlags.map((flag) => `${flag.severity}: ${flag.reason}`).join(" · ") || "High-risk review"} · {transfer.approvals.length} approvals</span><PlotLocationNote metadata={transfer.land.metadata} /></div>
        </div>) : <p className="dashboard-empty">No flagged transfers are awaiting second approval.</p>}
      </section>
      <section className="dashboard-panel" id="role-requests">
        <div className="dashboard-panel-heading"><h2>Pending access requests</h2><span>{data.requests.length} requests</span></div>
        {data.requests.length ? data.requests.map((request) => <div className="dashboard-row" key={request.id}>
          <div><b>{request.user.name} · {request.role}</b><span>{request.user.email} · identity {request.user.isVerified ? "verified" : "not verified"}{request.jurisdiction ? ` · ${request.jurisdiction}` : ""}</span></div>
          <div className="dashboard-user-badges"><button className="button ghost" type="button" onClick={() => approveRequest(request)}>Approve</button><button className="button ghost" type="button" onClick={() => void adminAction(`/api/v1/admin/role-assignments/${request.id}`, { method: "DELETE" }, "Access request declined.")}>Decline</button></div>
        </div>) : <p className="dashboard-empty">No pending role requests.</p>}
      </section>
      <section className="dashboard-columns">
        <article className="dashboard-panel" id="users">
          <div className="dashboard-panel-heading"><h2>User &amp; role management</h2><span>Latest 50 accounts</span></div>
          {data.users.length ? data.users.slice(0, 12).map((user) => (
            <div className="dashboard-row" key={user.id}>
              <div><b>{user.name}</b><span>{user.email} · Joined {new Date(user.createdAt).toLocaleDateString()}</span></div>
              <div className="dashboard-user-badges">
                <mark>{user.roleAssignments.filter((assignment) => assignment.active).map((assignment) => `${assignment.role}${assignment.jurisdiction ? ` (${assignment.jurisdiction})` : ""}`).join(", ") || "NO ACTIVE ROLE"}</mark>
                <button className="button ghost" type="button" onClick={() => void adminAction(`/api/v1/admin/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !user.isActive }) }, user.isActive ? "Account suspended." : "Account activated.")}>{user.isActive ? "Suspend" : "Activate"}</button>
                <select aria-label={`Grant role to ${user.email}`} defaultValue="" onChange={(event) => { if (event.target.value) grantRole(user.id, event.target.value); event.target.value = ""; }}>
                  <option value="">Grant role…</option><option value="LANDOWNER">Landowner</option><option value="BUYER">Buyer</option><option value="DEVELOPER">Developer</option><option value="GOVERNMENT">Government officer</option><option value="ADMIN">Administrator</option>
                </select>
              </div>
            </div>
          )) : <p className="dashboard-empty">No user accounts found.</p>}
        </article>
        <article className="dashboard-panel" id="audit-log">
          <div className="dashboard-panel-heading"><h2>Searchable audit activity</h2>
            <form onSubmit={(event) => { event.preventDefault(); void loadData(query); }}><input aria-label="Search audit trail" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions or records" /><button className="button ghost" type="submit">Search</button></form>
          </div>
          {data.logs.length ? data.logs.slice(0, 12).map((log) => (
            <div className="dashboard-row" key={log.id}>
              <div><b>{log.action.replaceAll("_", " ")}</b><span>{log.entityType || "Platform"}{log.entityId ? ` · ${log.entityId}` : ""} · Actor {log.actorId || "system"}</span></div>
              <time>{new Date(log.createdAt).toLocaleString()}</time>
            </div>
          )) : <p className="dashboard-empty">No audit activity has been recorded.</p>}
        </article>
      </section>
      <section className="dashboard-panel" id="legal-corrections">
        <h2>Record court-ordered correction</h2>
        <p>Corrections are stored as immutable ownership-history events; prior records are not overwritten.</p>
        <form className="dashboard-login-form" onSubmit={(event) => void submitCorrection(event)}>
          <label>Land record ID<input name="landId" required /></label>
          <label>Court case reference<input name="caseReference" required /></label>
          <label>Correction description<textarea name="description" required /></label>
          <label>Supporting document SHA-256<input name="documentHash" required minLength={64} maxLength={64} pattern="[a-fA-F0-9]{64}" /></label>
          <label>Corrected owner account ID (optional)<input name="correctedOwnerId" /></label>
          <button className="button dark" type="submit">Record correction event</button>
        </form>
      </section>
    </DashboardLayout>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="dashboard-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

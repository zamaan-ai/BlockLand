"use client";

import { useEffect, useState } from "react";
import DashboardLayout, { DashboardError, DashboardLoading } from "../../../components/DashboardLayout";
import PlotLocationNote from "../../../components/PlotLocationNote";
import { dashboardFetch } from "../../../lib/dashboard";

type Project = { id: string; title: string; description?: string | null; status: string; _count: { lands: number }; lands: { id: string; plotId: string; title: string; status: string; district?: string; state?: string; metadata?: unknown; lockTransferId: string | null; encumbrances: { id: string }[]; disputes: { id: string }[] }[] };
type DeveloperData = {
  profile: { name: string; bio?: string | null; coverImageUrl?: string | null; interests: string[]; developerVerified: boolean; profileViews: number } | null;
  projects: Project[];
  lands: { id: string; plotId: string; title: string; status: string; district: string; state: string; metadata?: unknown; encumbrances: { id: string }[]; disputes: { id: string }[] }[];
  enquiries: { id: string; message: string; status: string; land?: { plotId: string; title: string } }[];
  followers: number; following: number; pendingRole: { id: string } | null;
};

export default function DeveloperDashboard() {
  const [data, setData] = useState<DeveloperData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    try { setData(await dashboardFetch<DeveloperData>("/api/v1/dashboard/developer")); }
    catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await dashboardFetch<{ message?: string }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"), description: form.get("description"),
          location: form.get("location"), state: form.get("state"), district: form.get("district"),
        }),
      });
      setMessage(response.message || "Project created.");
      formElement.reset();
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await dashboardFetch<{ message?: string }>("/api/v1/dashboard/developer/profile", {
        method: "PATCH",
        body: JSON.stringify({
          bio: form.get("bio"), coverImageUrl: form.get("coverImageUrl"),
          interests: String(form.get("interests") || "").split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      setMessage(response.message || "Developer profile updated.");
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  async function updateProjectStatus(project: Project, status: string) {
    try {
      await dashboardFetch(`/api/v1/projects/${project.id}`, { method: "PUT", body: JSON.stringify({ status }) });
      setMessage(`Project status updated to ${status.toLowerCase()}.`);
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  if (error) return <DashboardError message={error} requiredRole="DEVELOPER" />;
  if (!data) return <DashboardLoading message="Loading developer portfolio..." />;
  const verified = data.lands.filter((land) => land.status === "VERIFIED").length;

  return <DashboardLayout role="DEVELOPER" eyebrow="Builder & developer portal" title="Developer workspace" description="Manage your profile, verified land portfolio, projects, followers, enquiries, and government review requests.">
    {message && <p className="dashboard-feedback" role="status">{message}</p>}
    <section className="dashboard-grid">
      <Metric label="Verified properties" value={verified} detail={`${data.lands.length} properties in your portfolio`} />
      <Metric label="Projects" value={data.projects.length} detail="Planned, active, and completed" />
      <Metric label="Profile views" value={data.profile?.profileViews || 0} detail="Public profile engagement" />
      <Metric label="Followers" value={data.followers} detail={`${data.following} developers followed`} />
    </section>
    <section className="dashboard-columns">
      <article className="dashboard-panel" id="profile"><h2>Profile manager</h2>
        <h3>{data.profile?.name || "Developer profile"}</h3>
        <p>{data.profile?.bio || "Add your professional bio and interests to complete your public profile."}</p>
        <p>Verification: {data.profile?.developerVerified ? "Verified developer" : "Pending government verification"}</p>
        <p>Interests: {data.profile?.interests?.join(", ") || "None added"}</p>
        <form className="dashboard-login-form" onSubmit={(event) => void saveProfile(event)}>
          <label>Bio<textarea name="bio" defaultValue={data.profile?.bio || ""} maxLength={2000} /></label>
          <label>Interests, comma separated<input name="interests" defaultValue={data.profile?.interests?.join(", ") || ""} /></label>
          <label>Cover image URL<input name="coverImageUrl" type="url" defaultValue={data.profile?.coverImageUrl || ""} /></label>
          <button className="button dark" type="submit">Save profile</button>
        </form>
      </article>
      <article className="dashboard-panel" id="portfolio"><h2>Verified land portfolio</h2>
        {data.lands.length ? data.lands.map((land) => <div className="dashboard-row" key={land.id}><div><b>{land.plotId} · {land.title}</b><span>{land.district}, {land.state} · {land.status} · {land.encumbrances.length} liens · {land.disputes.length} disputes</span><PlotLocationNote metadata={land.metadata} /></div></div>) : <Empty text="No land holdings are connected to this developer account." />}
      </article>
    </section>
    <section className="dashboard-columns">
      <article className="dashboard-panel" id="projects"><div className="dashboard-panel-heading"><h2>Projects</h2><span>{data.projects.length} total</span></div>
        {data.projects.map((project) => <article className="dashboard-property" key={project.id}>
          <div className="dashboard-panel-heading"><h3>{project.title}</h3>
            <select aria-label={`Update ${project.title} project status`} value={project.status} onChange={(event) => void updateProjectStatus(project, event.target.value)}>
              {["PLANNING", "ACTIVE", "COMPLETED", "CANCELLED"].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <p>{project.description || "No project description"} · {project._count.lands} linked plots</p>
          {project.lands.map((land) => <div className="dashboard-row" key={land.plotId}><div><b>{land.plotId}</b><span>{land.title} · {[land.district, land.state].filter(Boolean).join(", ")} · {land.status}{land.lockTransferId ? " · sale locked" : ""}{land.encumbrances.length ? " · encumbered" : ""}{land.disputes.length ? " · disputed" : ""}</span><PlotLocationNote metadata={land.metadata} /></div></div>)}
        </article>)}
        <form className="dashboard-login-form" onSubmit={(event) => void createProject(event)}>
          <h3>Create project</h3>
          <label>Project name<input name="title" required maxLength={120} /></label>
          <label>Description<textarea name="description" required maxLength={2000} /></label>
          <label>Location<input name="location" required maxLength={200} /></label>
          <label>State<input name="state" required maxLength={100} /></label>
          <label>District<input name="district" required maxLength={100} /></label>
          <button className="button dark" type="submit">Create project</button>
        </form>
      </article>
      <article className="dashboard-panel" id="network"><h2>Enquiries &amp; verification</h2>
        {data.enquiries.length ? data.enquiries.map((enquiry) => <Row key={enquiry.id} title={`${enquiry.land?.plotId || "Project enquiry"} · ${enquiry.status}`} detail={enquiry.message} />) : <Empty text="No buyer enquiries yet." />}
        <p>{data.profile?.developerVerified ? "Developer verification complete." : "Government developer verification is required for the badge."}</p>
        {data.pendingRole && <p>Your developer access request is awaiting administrator review.</p>}
      </article>
    </section>
  </DashboardLayout>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="dashboard-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
function Row({ title, detail }: { title: string; detail: string }) {
  return <div className="dashboard-row"><div><b>{title}</b><span>{detail}</span></div></div>;
}
function Empty({ text }: { text: string }) { return <p className="dashboard-empty">{text}</p>; }

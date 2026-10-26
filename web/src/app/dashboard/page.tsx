"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardLayout, { DashboardError, DashboardLoading } from "../../components/DashboardLayout";
import PlotLocationNote from "../../components/PlotLocationNote";
import { dashboardFetch } from "../../lib/dashboard";

type LandRecord = {
  id: string; plotId: string; title: string; district?: string; status: string; metadata?: unknown;
};
type TransferRecord = {
  id: string; status: string; land?: { plotId: string; title: string; metadata?: unknown }; escrow?: { status: string };
};
type NotificationRecord = { id: string; title: string; message: string; createdAt: string };
type UserDashboardData = {
  lands: LandRecord[];
  transfers: TransferRecord[];
  notifications: NotificationRecord[];
  identity: { status?: string; provider?: string } | null;
};

export default function UserDashboard() {
  const [data, setData] = useState<UserDashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    dashboardFetch<UserDashboardData>("/api/v1/dashboard/user")
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <DashboardError message={error} requiredRole="USER" />;
  if (!data) return <DashboardLoading message="Loading your property dashboard..." />;

  const verifiedLand = data.lands.filter((land) => land.status === "VERIFIED").length;
  const activeTransfers = data.transfers.filter((transfer) =>
    ["INITIATED", "LOCKED", "ESCROW_FUNDED", "UNDER_REVIEW"].includes(transfer.status)
  ).length;

  return (
    <DashboardLayout
      role="USER"
      eyebrow="Owner portal"
      title="Your property dashboard"
      description="Keep track of your land records, sales, purchases, escrow, identity status, and security alerts."
    >
      <section className="dashboard-grid">
        <Metric label="Verified identity" value={data.identity?.status || "Not submitted"} detail={data.identity?.provider || "Complete verification to build trust"} />
        <Metric label="Owned plots" value={data.lands.length} detail={`${verifiedLand} government verified`} />
        <Metric label="Active transfers" value={activeTransfers} detail="Sales and purchases in progress" />
        <Metric label="Notifications" value={data.notifications.length} detail="Recent account activity" />
      </section>

      <section className="dashboard-shortcuts" aria-label="Account sections">
        <Shortcut href="/dashboard/sales" title="My sales" detail="Track seller-side transfer requests" />
        <Shortcut href="/dashboard/purchases" title="My purchases" detail="Review purchases and buyer verification" />
        <Shortcut href="/dashboard/escrow" title="Escrow" detail="Check payment and release status" />
        <Shortcut href="/dashboard/alerts" title="Security alerts" detail="Review account activity and notices" />
      </section>

      <section className="dashboard-columns">
        <article className="dashboard-panel">
          <div className="dashboard-panel-heading"><h2>My land</h2><Link href="/">Explore registry</Link></div>
          {data.lands.length ? data.lands.slice(0, 6).map((land) => (
            <div className="dashboard-row" key={land.id}>
              <div><b>{land.plotId}</b><span>{land.title}{land.district ? ` · ${land.district}` : ""}</span><PlotLocationNote metadata={land.metadata} /></div>
              <Status value={land.status} />
            </div>
          )) : <EmptyState text="No land is linked to your account yet." />}
        </article>
        <article className="dashboard-panel">
          <div className="dashboard-panel-heading"><h2>Recent transfers</h2><Link href="/dashboard/purchases">View activity</Link></div>
          {data.transfers.length ? data.transfers.slice(0, 6).map((transfer) => (
            <div className="dashboard-row" key={transfer.id}>
              <div><b>{transfer.land?.plotId || transfer.id}</b><span>{transfer.land?.title || "Land transfer"} · Escrow {transfer.escrow?.status || "PENDING"}</span><PlotLocationNote metadata={transfer.land?.metadata} /></div>
              <Status value={transfer.status} />
            </div>
          )) : <EmptyState text="No sales or purchases yet." />}
        </article>
      </section>

      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><h2>Recent activity</h2><Link href="/dashboard/alerts">All alerts</Link></div>
        {data.notifications.length ? data.notifications.slice(0, 5).map((notification) => (
          <div className="alert-row" key={notification.id}>
            <div><b>{notification.title}</b><span>{notification.message}</span></div>
            <time>{new Date(notification.createdAt).toLocaleDateString()}</time>
          </div>
        )) : <EmptyState text="You are all caught up. New account and transfer activity will appear here." />}
      </section>
    </DashboardLayout>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="dashboard-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function Shortcut({ href, title, detail }: { href: string; title: string; detail: string }) {
  return <Link className="dashboard-shortcut" href={href}><b>{title}<span aria-hidden="true">↗</span></b><small>{detail}</small></Link>;
}

function Status({ value }: { value: string }) {
  const tone = ["REJECTED", "DISPUTED", "UNDER_REVIEW"].includes(value) ? "danger" : ["PENDING", "LOCKED", "ESCROW_FUNDED"].includes(value) ? "warning" : "safe";
  return <mark className={tone}>{value.replaceAll("_", " ")}</mark>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="dashboard-empty">{text}</p>;
}

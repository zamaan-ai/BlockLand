"use client";

import { useEffect, useState } from "react";
import DashboardLayout, { DashboardError, DashboardLoading } from "../../../components/DashboardLayout";
import AadhaarAuthNotice from "../../../components/AadhaarAuthNotice";
import MapPlotDirectory from "../../../components/MapPlotDirectory";
import PlotLocationNote from "../../../components/PlotLocationNote";
import { dashboardFetch, loadMapPlots, type MapPlot } from "../../../lib/dashboard";

type BuyerLand = { plotId: string; title: string; status: string; district?: string; state?: string; metadata?: unknown; encumbrances: { id: string }[]; disputes: { id: string }[] };
type Purchase = { id: string; status: string; createdAt: string; cooldownEndsAt?: string | null; land: BuyerLand; escrow?: { status: string; refundReference?: string | null; releasedAt?: string | null }; approvals: { id: string; createdAt: string }[] };
type Saved = { id: string; land: BuyerLand & { transfers: { id: string }[] } };
type BuyerData = { purchases: Purchase[]; savedProperties: Saved[]; identity: { status?: string; provider?: string; createdAt?: string } | null; notifications: { id: string; title: string; message: string }[] };

export default function BuyerDashboard() {
  const [data, setData] = useState<BuyerData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [plotId, setPlotId] = useState("");
  const [identityError, setIdentityError] = useState("");
  const [identityMessage, setIdentityMessage] = useState("");
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityStep, setIdentityStep] = useState<"details" | "otp">("details");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [demoOtp, setDemoOtp] = useState("");
  const [mapPlots, setMapPlots] = useState<MapPlot[]>([]);
  async function load() {
    try {
      const [buyerData, plots] = await Promise.all([
        dashboardFetch<BuyerData>("/api/v1/dashboard/buyer"),
        loadMapPlots(),
      ]);
      setData(buyerData);
      setMapPlots(plots);
    }
    catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function remove(plotId: string) {
    try {
      const response = await dashboardFetch<{ message?: string }>(`/api/v1/dashboard/watchlist/${encodeURIComponent(plotId)}`, { method: "DELETE" });
      setMessage(response.message || "Property removed from watchlist.");
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  async function saveProperty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await dashboardFetch<{ message?: string }>(`/api/v1/dashboard/watchlist/${encodeURIComponent(plotId.trim())}`, { method: "POST" });
      setMessage(result.message || "Property added to watchlist.");
      setPlotId("");
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  async function fundEscrow(transferId: string) {
    try {
      const result = await dashboardFetch<{ message?: string }>(`/api/v1/transfers/${transferId}/escrow/fund`, { method: "POST" });
      setMessage(result.message || "Escrow funding recorded.");
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  async function requestIdentityOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIdentityBusy(true);
    setIdentityError("");
    setIdentityMessage("");
    setDemoOtp("");
    try {
      const result = await dashboardFetch<{ demo?: boolean; hint?: string; expiresIn?: number }>(
        "/api/v1/auth/identity/otp/send",
        { method: "POST", body: JSON.stringify({ phone }) },
      );
      setDemoOtp(result.demo ? result.hint || "" : "");
      setIdentityStep("otp");
      setIdentityMessage(result.demo
        ? "Demo OTP generated. This is not an official Aadhaar or identity check."
        : `OTP sent by SMS. It expires in ${Math.ceil((result.expiresIn || 600) / 60)} minutes.`);
    } catch (reason) {
      setIdentityError((reason as Error).message);
    } finally {
      setIdentityBusy(false);
    }
  }

  async function confirmIdentityOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIdentityBusy(true);
    setIdentityError("");
    try {
      const result = await dashboardFetch<{ identity: NonNullable<BuyerData["identity"]> }>(
        "/api/v1/auth/identity/otp/verify",
        { method: "POST", body: JSON.stringify({ phone, code: otp }) },
      );
      setIdentityMessage("Phone OTP confirmed. Identity remains pending until an approved identity provider verifies it.");
      setIdentityStep("details");
      setPhone("");
      setOtp("");
      setDemoOtp("");
      setData((current) => current ? { ...current, identity: result.identity } : current);
      await load();
    } catch (reason) {
      setIdentityError((reason as Error).message);
    } finally {
      setIdentityBusy(false);
    }
  }

  if (error) return <DashboardError message={error} requiredRole="BUYER" />;
  if (!data) return <DashboardLoading message="Loading buyer watchlist and purchase tracker..." />;

  return <DashboardLayout role="BUYER" eyebrow="Buyer portal" title="Purchase tracker" description="Review properties before purchase, follow transfer stages, and track escrow and identity status.">
    {message && <p className="dashboard-feedback" role="status">{message}</p>}
    <section className="dashboard-grid">
      <Metric label="Active purchases" value={data.purchases.filter((item) => !["COMPLETED", "REJECTED", "REFUNDED"].includes(item.status)).length} detail="Transfers in progress" />
      <Metric label="Saved properties" value={data.savedProperties.length} detail="Watchlist with registry status checks" />
      <Metric label="Completed purchases" value={data.purchases.filter((item) => item.status === "COMPLETED").length} detail="Ownership history retained" />
      <Metric label="Identity" value={data.identity?.status || "Not submitted"} detail={data.identity?.provider === "OTP_ONLY" ? "Phone OTP only · official identity verification pending" : "Complete identity verification before settlement"} />
    </section>
    <section className="dashboard-panel" id="watchlist"><div className="dashboard-panel-heading"><h2>Watchlist · verify before you buy</h2><a href="/">Browse properties</a></div>
      <form className="dashboard-login-form dashboard-watchlist-form" onSubmit={(event) => void saveProperty(event)}>
        <label>Save registry plot by plot ID<input value={plotId} onChange={(event) => setPlotId(event.target.value)} required placeholder="PLOT-..." /></label>
        <button className="button dark" type="submit">Add to watchlist</button>
      </form>
      {data.savedProperties.length ? data.savedProperties.map(({ id, land }) => {
        const caution = land.encumbrances.length > 0 || land.disputes.length > 0 || land.transfers.length > 0 || land.status !== "VERIFIED";
        const indicator = land.disputes.length || land.status === "DISPUTED" ? "Do not buy" : caution ? "Caution" : "Safe to buy";
        return <article className="dashboard-row" key={id}>
          <div><b>{land.plotId} · {land.title}</b><span>{land.district ? `${land.district}${land.state ? `, ${land.state}` : ""} · ` : ""}{indicator} · {land.status} · {land.encumbrances.length} liens · {land.disputes.length} disputes · {land.transfers.length ? "active lock" : "no active lock"}</span><PlotLocationNote metadata={land.metadata} /></div>
          <div className="dashboard-actions"><a href={`/land/${encodeURIComponent(land.plotId)}/verify`}>Open verification report</a><button className="button ghost" type="button" onClick={() => void remove(land.plotId)}>Remove</button></div>
        </article>;
      }) : <Empty text="Save a property from its registry page to monitor status, locks, liens, and disputes." />}
    </section>
    <section className="dashboard-panel" id="purchases"><h2>My purchases &amp; escrow</h2>
      {data.purchases.length ? data.purchases.map((purchase) => <article className="dashboard-property" key={purchase.id}>
        <div className="dashboard-panel-heading"><div><h3>{purchase.land.plotId} · {purchase.land.title}</h3><p>{[purchase.land.district, purchase.land.state].filter(Boolean).join(", ")}{purchase.land.district ? " · " : ""}Started {new Date(purchase.createdAt).toLocaleDateString()}</p><PlotLocationNote metadata={purchase.land.metadata} /></div><mark>{purchase.status.replaceAll("_", " ")}</mark></div>
        <p>Escrow: {purchase.escrow?.status || "not funded"}{purchase.escrow?.refundReference ? ` · refund ${purchase.escrow.refundReference}` : ""}{purchase.escrow?.releasedAt ? ` · released ${new Date(purchase.escrow.releasedAt).toLocaleDateString()}` : ""}</p>
        <p>Officer approvals: {purchase.approvals.length} · Cooling-off ends {purchase.cooldownEndsAt ? new Date(purchase.cooldownEndsAt).toLocaleString() : "not started"}</p>
        <p>Transfer steps: initiated → land locked → escrow funded → officer review → completed</p>
        {purchase.escrow?.status === "PENDING" && ["LOCKED", "INITIATED"].includes(purchase.status) && <button className="button dark" type="button" onClick={() => void fundEscrow(purchase.id)}>Fund demo escrow</button>}
      </article>) : <Empty text="Your purchase timeline will appear here after a seller initiates a transfer." />}
    </section>
    <MapPlotDirectory plots={mapPlots} audience="buyer" />
    <section className="dashboard-panel" id="identity">
      <h2>Identity verification</h2>
      <p>Confirm your phone number by OTP. This prototype does not connect to UIDAI or another identity provider, so phone confirmation remains pending and is not official identity verification.</p>
      <AadhaarAuthNotice role="BUYER" />
      {data.identity?.provider === "OTP_ONLY" && <p className="dashboard-feedback" role="status">Phone OTP confirmed on {data.identity.createdAt ? new Date(data.identity.createdAt).toLocaleString() : "this account"}. Official identity verification is still pending.</p>}
      {identityMessage && <p className="dashboard-feedback" role="status">{identityMessage}</p>}
      {identityError && <p className="dashboard-login-error" role="alert">{identityError}</p>}
      {identityStep === "details" ? (
        <form className="dashboard-login-form" onSubmit={(event) => void requestIdentityOtp(event)}>
          <label>Phone number in international format<input type="tel" autoComplete="tel" placeholder="+919876543210" pattern="\+[1-9][0-9]{7,14}" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
          <button className="button dark" type="submit" disabled={identityBusy}>{identityBusy ? "Requesting..." : "Send verification OTP"}</button>
        </form>
      ) : (
        <form className="dashboard-login-form" onSubmit={(event) => void confirmIdentityOtp(event)}>
          <p>Enter the six-digit code sent to {phone}.</p>
          {demoOtp && <p className="dashboard-feedback" role="status">Local demo OTP: <strong>{demoOtp}</strong></p>}
          <label>One-time password<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
          <div className="dashboard-actions">
            <button className="button dark" type="submit" disabled={identityBusy}>{identityBusy ? "Checking..." : "Confirm OTP"}</button>
            <button className="button ghost" type="button" disabled={identityBusy} onClick={() => { setIdentityStep("details"); setOtp(""); setDemoOtp(""); setIdentityError(""); }}>Back</button>
          </div>
        </form>
      )}
      <h2>Alerts</h2>
      {data.notifications.slice(0, 8).map((item) => <Row key={item.id} title={item.title} detail={item.message} />)}
      {!data.notifications.length && <Empty text="No new purchase alerts." />}
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

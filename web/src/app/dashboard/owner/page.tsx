"use client";

import { useEffect, useState } from "react";
import DashboardLayout, { DashboardError, DashboardLoading } from "../../../components/DashboardLayout";
import AadhaarAuthNotice from "../../../components/AadhaarAuthNotice";
import MapPlotDirectory from "../../../components/MapPlotDirectory";
import PlotLocationNote from "../../../components/PlotLocationNote";
import { dashboardFetch, loadMapPlots, type MapPlot } from "../../../lib/dashboard";

type Land = {
  id: string; plotId: string; title: string; state: string; district: string; area: number; status: string;
  metadata?: unknown;
  verificationRequests?: { id: string; status: string; submittedAt: string; rejectionReason?: string | null }[];
  tokenId?: string | null; blockchainTxHash?: string | null; ownerWallet?: string | null; transferFrozen: boolean;
  transferFreezeReason?: string | null; encumbrances: { id: string; type: string }[];
  disputes: { id: string; status: string }[]; fractionalOwnerships: { id: string; walletAddress: string; sharePercentage: number }[];
  documents: { id: string; originalName: string; sha256Hash: string; isVerified: boolean; documentType: string }[];
};
type OwnerData = {
  walletAddress?: string | null;
  lands: Land[]; transfers: { id: string; status: string; land: { plotId: string; title: string }; escrow?: { status: string } }[];
  documents: Land["documents"]; notifications: { id: string; title: string; message: string; createdAt: string }[];
  identity: { status?: string } | null; shares: { id: string; sharePercentage: number; land: { plotId: string; title: string }; user: { name: string } }[];
  events: { id: string; eventType: string; eventAt: string; land: { plotId: string } }[]; stats: { totalPlots: number; totalArea: number };
};

export default function LandownerDashboard() {
  const [data, setData] = useState<OwnerData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [mapPlots, setMapPlots] = useState<MapPlot[]>([]);

  async function load() {
    try {
      const [ownerData, plots] = await Promise.all([
        dashboardFetch<OwnerData>("/api/v1/dashboard/owner"),
        loadMapPlots(),
      ]);
      setData(ownerData);
      setMapPlots(plots);
    }
    catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function registerPlot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegistrationBusy(true);
    setRegistrationError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    try {
      const result = await dashboardFetch<{ land: { plotId: string } }>("/api/v1/lands", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          state: form.get("state"),
          district: form.get("district"),
          village: form.get("village"),
          surveyNumber: form.get("surveyNumber"),
          area: Number(form.get("area")),
          latitude: form.get("latitude") ? Number(form.get("latitude")) : undefined,
          longitude: form.get("longitude") ? Number(form.get("longitude")) : undefined,
        }),
      });
      formElement.reset();
      setMessage(`Plot registered with BlockLand ID ${result.land.plotId}. Government plot verification is pending.`);
      await load();
    } catch (reason) {
      setRegistrationError((reason as Error).message);
    } finally {
      setRegistrationBusy(false);
    }
  }

  async function toggleFreeze(land: Land) {
    setMessage("");
    try {
      const path = `/api/v1/dashboard/owner/${land.transferFrozen ? "unfreeze" : "freeze"}/${land.id}`;
      const response = await dashboardFetch<{ message?: string }>(path, { method: "POST", body: JSON.stringify({ reason: "Owner requested a temporary transfer freeze" }) });
      setMessage(response.message || "Plot security preference updated.");
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  async function cancelTransfer(transferId: string) {
    try {
      const result = await dashboardFetch<{ message?: string }>(`/api/v1/transfers/${transferId}/cancel`, { method: "PATCH" });
      setMessage(result.message || "Sale cancelled.");
      await load();
    } catch (reason) { setMessage((reason as Error).message); }
  }

  if (error) return <DashboardError message={error} requiredRole="LANDOWNER" />;
  if (!data) return <DashboardLoading message="Loading landowner holdings and activity..." />;
  const locked = data.lands.filter((land) => land.status === "LOCKED_FOR_SALE").length;
  const pending = data.lands.filter((land) => ["PENDING", "UNDER_REVIEW"].includes(land.status)).length;

  return <DashboardLayout role="LANDOWNER" eyebrow="Landowner portal" title="Your holdings" description="Manage verified plots, ownership records, sale restrictions, documents, and account alerts.">
    {message && <p className="dashboard-feedback" role="status">{message}</p>}
    <section className="dashboard-grid">
      <Metric label="Plots" value={data.stats.totalPlots} detail={`${data.stats.totalArea.toLocaleString()} registered area units`} />
      <Metric label="Verified plots" value={data.lands.filter((land) => land.status === "VERIFIED").length} detail="Government-verified records" />
      <Metric label="Pending actions" value={pending} detail={`${locked} plots currently locked for sale`} />
      <Metric label="Identity status" value={data.identity?.status || "Not submitted"} detail={`${data.notifications.length} recent alerts`} />
    </section>
    <section className="dashboard-panel" id="aadhaar-verification">
      <h2>Aadhaar authentication</h2>
      <AadhaarAuthNotice role="LANDOWNER" />
    </section>
    <section className="dashboard-panel" id="register-plot">
      <h2>Register a plot for verification</h2>
      <p className="muted">BlockLand assigns a unique Plot ID after submission. A government officer must verify the land record; a BlockLand Plot ID is not itself proof of legal ownership.</p>
      <form className="dashboard-login-form" onSubmit={(event) => void registerPlot(event)}>
        <label>Plot title<input name="title" required maxLength={160} /></label>
        <label>Description<textarea name="description" maxLength={4000} /></label>
        <label>State<input name="state" required maxLength={100} /></label>
        <label>District<input name="district" required maxLength={100} /></label>
        <label>Village<input name="village" required maxLength={100} /></label>
        <label>Official survey / plot number<input name="surveyNumber" required maxLength={100} /></label>
        <label>Area (in registered land units)<input name="area" type="number" min="0.01" step="any" required /></label>
        <label>Latitude (optional)<input name="latitude" type="number" min="-90" max="90" step="any" /></label>
        <label>Longitude (optional)<input name="longitude" type="number" min="-180" max="180" step="any" /></label>
        {registrationError && <p className="dashboard-login-error" role="alert">{registrationError}</p>}
        <button className="button dark" type="submit" disabled={registrationBusy}>{registrationBusy ? "Submitting plot..." : "Register plot and request verification"}</button>
      </form>
    </section>
    <MapPlotDirectory plots={mapPlots} audience="landowner" />
    <WalletConnect connectedWallet={data.walletAddress || null} onConnected={load} />
    <section className="dashboard-panel" id="properties">
      <div className="dashboard-panel-heading"><h2>My properties</h2><a href="/">Explore registry</a></div>
      {data.lands.length ? data.lands.map((land) => <article className="dashboard-panel dashboard-property" key={land.id}>
        <div className="dashboard-panel-heading"><div><h3>{land.plotId} · {land.title}</h3><p>{land.district}, {land.state} · {land.area} area units</p><PlotLocationNote metadata={land.metadata} /></div><Status value={land.status} /></div>
        {land.verificationRequests?.length ? <p>Plot ID verification: {land.verificationRequests[0].status.replaceAll("_", " ")} · submitted {new Date(land.verificationRequests[0].submittedAt).toLocaleDateString()}{land.verificationRequests[0].rejectionReason ? ` · ${land.verificationRequests[0].rejectionReason}` : ""}</p> : <p>Plot ID verification has not been submitted for this record.</p>}
        <p>{land.tokenId ? `Token ${land.tokenId}` : "Not yet blockchain recorded"}{land.blockchainTxHash ? ` · ${land.blockchainTxHash}` : ""}</p>
        <p>{land.encumbrances.length} active encumbrances · {land.disputes.length} open disputes · {land.fractionalOwnerships.length} share records</p>
        <button type="button" className="button ghost" disabled={land.status === "LOCKED_FOR_SALE"} onClick={() => void toggleFreeze(land)}>
          {land.transferFrozen ? "Unfreeze transfers" : "Freeze transfers"}
        </button>
        {land.transferFrozen && <small>Transfers frozen{land.transferFreezeReason ? `: ${land.transferFreezeReason}` : ""}</small>}
        <SaleForm land={land} onStarted={load} />
      </article>) : <Empty text="No plots are linked to your account." />}
    </section>
    <section className="dashboard-columns">
      <article className="dashboard-panel" id="ownership"><h2>Ownership &amp; shares</h2>
        {data.shares.length ? data.shares.map((share) => <Row key={share.id} title={share.land.plotId} detail={`${share.user.name} · ${share.sharePercentage}% share`} />) : <Empty text="No fractional ownership records." />}
        <h3>Ownership history</h3>
        {data.events.slice(0, 12).map((event) => <Row key={event.id} title={event.eventType.replaceAll("_", " ")} detail={`${event.land.plotId} · ${new Date(event.eventAt).toLocaleString()}`} />)}
      </article>
      <article className="dashboard-panel" id="documents"><h2>Documents</h2>
        {data.documents.length ? data.documents.map((doc) => <Row key={doc.id} title={doc.originalName} detail={`${doc.documentType} · SHA-256 ${doc.sha256Hash} · ${doc.isVerified ? "verified" : "pending review"}`} />) : <Empty text="No documents uploaded." />}
        <DocumentUpload lands={data.lands} onUploaded={load} />
      </article>
    </section>
    <section className="dashboard-panel"><h2>Sales &amp; escrow</h2>
      {data.transfers.length ? data.transfers.map((transfer) => <div key={transfer.id}>
        <Row title={`${transfer.land.plotId} · ${transfer.land.title}`} detail={`${transfer.status} · escrow ${transfer.escrow?.status || "pending"}`} />
        {["LOCKED", "INITIATED"].includes(transfer.status) && transfer.escrow?.status !== "FUNDED" && <button className="button ghost" type="button" onClick={() => void cancelTransfer(transfer.id)}>Cancel sale before escrow funding</button>}
      </div>) : <Empty text="No active sales or escrow records." />}
    </section>
    <section className="dashboard-panel"><h2>Security alerts</h2>
      {data.notifications.length ? data.notifications.slice(0, 10).map((item) => <Row key={item.id} title={item.title} detail={`${item.message} · ${new Date(item.createdAt).toLocaleString()}`} />) : <Empty text="No recent alerts." />}
    </section>
  </DashboardLayout>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="dashboard-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
function Row({ title, detail }: { title: string; detail: string }) {
  return <div className="dashboard-row"><div><b>{title}</b><span>{detail}</span></div></div>;
}
function Status({ value }: { value: string }) {
  return <mark className={["DISPUTED", "UNDER_REVIEW"].includes(value) ? "danger" : ["PENDING", "LOCKED_FOR_SALE"].includes(value) ? "warning" : "safe"}>{value.replaceAll("_", " ")}</mark>;
}
function Empty({ text }: { text: string }) { return <p className="dashboard-empty">{text}</p>; }

function SaleForm({ land, onStarted }: { land: Land; onStarted: () => Promise<void> }) {
  const [buyerWallet, setBuyerWallet] = useState("");
  const [amount, setAmount] = useState("");
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState<{ message: string; nonce: string; signature: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function prepare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const authorization = await dashboardFetch<{ message: string; nonce: string }>("/api/v1/transfers/prepare", {
        method: "POST",
        body: JSON.stringify({ landId: land.id, toWalletAddress: buyerWallet, amount }),
      });
      const ethereum = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!ethereum) throw new Error("A wallet extension is required to sign the sale authorization.");
      const accounts = await ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0] || accounts[0].toLowerCase() !== land.ownerWallet?.toLowerCase()) throw new Error("Connect the wallet recorded as the verified owner of this plot.");
      const signature = await ethereum.request({ method: "personal_sign", params: [authorization.message, accounts[0]] }) as string;
      setChallenge({ ...authorization, signature });
      setMessage("Sale authorization signed. Enter the one-time code sent to your registered email.");
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function startSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await dashboardFetch<{ message?: string }>("/api/v1/transfers", {
        method: "POST",
        body: JSON.stringify({ landId: land.id, toWalletAddress: buyerWallet, amount, sellerSignature: challenge.signature, saleNonce: challenge.nonce, saleOtp: otp }),
      });
      setMessage(result.message || "Sale started and plot locked.");
      setChallenge(null);
      setOtp("");
      await onStarted();
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }

  if (land.transferFrozen || land.encumbrances.length || land.disputes.length || !["VERIFIED", "TRANSFERRED"].includes(land.status)) {
    return <p className="dashboard-empty">Sale unavailable while this plot is frozen, restricted, disputed, or unverified.</p>;
  }
  return <form className="dashboard-login-form dashboard-sale-form" onSubmit={challenge ? startSale : prepare}>
    <h3>Start a sale · wallet signature + email OTP</h3>
    <label>Buyer registered wallet<input value={buyerWallet} onChange={(event) => setBuyerWallet(event.target.value)} required /></label>
    <label>Sale amount (INR)<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
    {challenge && <label>Email OTP<input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} minLength={6} maxLength={6} required /></label>}
    {message && <p role="status">{message}</p>}
    <button className="button dark" type="submit" disabled={busy}>{busy ? "Please wait..." : challenge ? "Initiate locked sale" : "Sign and request OTP"}</button>
  </form>;
}

function WalletConnect({ connectedWallet, onConnected }: { connectedWallet: string | null; onConnected: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const ethereum = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!ethereum) throw new Error("Install or enable a compatible wallet extension first.");
      const accounts = await ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0]) throw new Error("No wallet account was selected.");
      const challenge = await dashboardFetch<{ message: string }>("/api/v1/auth/wallet/challenge", {
        method: "POST", body: JSON.stringify({ walletAddress: accounts[0] }),
      });
      const signature = await ethereum.request({ method: "personal_sign", params: [challenge.message, accounts[0]] }) as string;
      await dashboardFetch("/api/v1/auth/wallet/verify", {
        method: "POST", body: JSON.stringify({ walletAddress: accounts[0], signature }),
      });
      setMessage("Wallet signature verified and linked to your account.");
      await onConnected();
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="dashboard-panel">
    <div className="dashboard-panel-heading"><h2>Wallet &amp; sale authorization</h2><span>{connectedWallet ? `Verified ${connectedWallet}` : "No plot owner wallet linked"}</span></div>
    <p>Link a wallet using a signed challenge before starting a sale. Sale authorizations also require an email OTP.</p>
    {message && <p role="status">{message}</p>}
    <button className="button ghost" type="button" onClick={() => void connect()} disabled={busy || Boolean(connectedWallet)}>{busy ? "Verifying wallet..." : connectedWallet ? "Wallet verified" : "Connect and verify wallet"}</button>
  </section>;
}

function DocumentUpload({ lands, onUploaded }: { lands: Land[]; onUploaded: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      setMessage("Choose a document file to upload.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("landId", String(form.get("landId") || ""));
      body.set("documentType", String(form.get("documentType") || "OTHER"));
      const response = await dashboardFetch<{ message?: string }>("/api/v1/documents/upload", { method: "POST", body });
      setMessage(response.message || "Document uploaded and queued for hash pinning.");
      formElement.reset();
      await onUploaded();
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <form className="dashboard-login-form" onSubmit={(event) => void upload(event)}>
    <h3>Upload a private document</h3>
    <label>Related property<select name="landId" required>{lands.map((land) => <option key={land.id} value={land.id}>{land.plotId} · {land.title}</option>)}</select></label>
    <label>Document type<select name="documentType">{["LAND_TITLE", "SURVEY_PLAN", "ID_PROOF", "OWNERSHIP_DEED", "TRANSFER_DEED", "OTHER"].map((type) => <option key={type}>{type}</option>)}</select></label>
    <label>File<input name="file" type="file" required /></label>
    {message && <p role="status">{message}</p>}
    <button className="button dark" type="submit" disabled={busy || !lands.length}>{busy ? "Uploading..." : "Upload and hash document"}</button>
  </form>;
}

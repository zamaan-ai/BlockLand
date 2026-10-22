"use client";

import { useEffect, useState } from "react";

type DashboardRole = "LANDOWNER" | "BUYER";
type DemoIdentity = { status: "DEMO_VERIFIED"; reference: string; completedAt: string };
type Step = "ready" | "otp";

const DEMO_OTP = "123456";

function localDemoEnabled() {
  return process.env.NODE_ENV === "development"
    && typeof window !== "undefined"
    && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

export default function AadhaarAuthNotice({ role }: { role: DashboardRole }) {
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [step, setStep] = useState<Step>("ready");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState<DemoIdentity | null>(null);
  const [storageKey, setStorageKey] = useState("");

  useEffect(() => {
    if (!localDemoEnabled()) return;
    setDemoEnabled(true);
    const user = localStorage.getItem("bl_user");
    let accountKey = role.toLowerCase();
    if (user) {
      try {
        const parsed = JSON.parse(user) as { id?: string; email?: string };
        accountKey = parsed.id || parsed.email || accountKey;
      } catch {
        accountKey = role.toLowerCase();
      }
    }
    const key = `bl_aadhaar_demo_${accountKey}_${role.toLowerCase()}`;
    setStorageKey(key);
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as DemoIdentity;
        if (parsed.status === "DEMO_VERIFIED") setIdentity(parsed);
      } catch {
        localStorage.removeItem(key);
      }
    }
  }, [role]);

  function confirmDemo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (otp !== DEMO_OTP) {
      setError("Incorrect demo code. Use 123456.");
      return;
    }
    const result: DemoIdentity = {
      status: "DEMO_VERIFIED",
      reference: `DEMO-KYC-${Date.now().toString(36).toUpperCase()}`,
      completedAt: new Date().toISOString(),
    };
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(result));
    setIdentity(result);
    setOtp("");
    setStep("ready");
  }

  if (!demoEnabled) {
    return <p className="auth-notice" role="status">
      Aadhaar authentication is not connected to an authorized provider. No Aadhaar number is requested or verified here. Phone OTP is not Aadhaar verification.
    </p>;
  }

  return <div>
    <p className="auth-notice" role="note">Demo simulation only · no Aadhaar submitted · not UIDAI verified</p>
    {identity ? (
      <div className="dashboard-feedback" role="status">
        Demo flow complete · <strong>DEMO ONLY — NOT UIDAI VERIFIED</strong><br />
        Reference: {identity.reference} · Completed {new Date(identity.completedAt).toLocaleString()}
      </div>
    ) : step === "ready" ? (
      <button className="button ghost" type="button" onClick={() => { setError(""); setStep("otp"); }}>
        Start mock Aadhaar e-KYC
      </button>
    ) : (
      <form className="dashboard-login-form" onSubmit={confirmDemo}>
        <p>Mock consent accepted for this demonstration. No Aadhaar details are required.</p>
        <p className="dashboard-feedback" role="status">Demo OTP: <strong>{DEMO_OTP}</strong></p>
        <label>Demo one-time password<input inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
        {error && <p className="dashboard-login-error" role="alert">{error}</p>}
        <div className="dashboard-actions">
          <button className="button dark" type="submit">Complete demo verification</button>
          <button className="button ghost" type="button" onClick={() => { setStep("ready"); setOtp(""); setError(""); }}>Cancel</button>
        </div>
      </form>
    )}
  </div>;
}

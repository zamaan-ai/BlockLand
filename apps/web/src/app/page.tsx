"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { API_URL } from "../lib/dashboard";

type AccountRole = "LANDOWNER" | "BUYER" | "GOVERNMENT";
type ActiveRole = AccountRole | "USER" | "DEVELOPER" | "ADMIN";
type LoginRole = ActiveRole;
type AuthResult = {
  message?: string;
  data?: {
    accessToken: string;
    user: { name?: string; email?: string; role: ActiveRole; roles?: { role: ActiveRole; active: boolean }[] };
    roleRequestPending?: boolean;
  };
  error?: string;
};

const dashboardFor: Record<ActiveRole, string> = {
  USER: "/dashboard",
  LANDOWNER: "/dashboard/owner",
  BUYER: "/dashboard/buyer",
  DEVELOPER: "/dashboard/developer",
  GOVERNMENT: "/officer",
  ADMIN: "/admin",
};

export default function HomePage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<LoginRole>("LANDOWNER");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const devRole = params.get("devRole");
    const isLocalDev = process.env.NODE_ENV === "development" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

    if (isLocalDev && devRole && dashboardFor[devRole as ActiveRole]) {
      const mockUser = {
        id: "dev-demo-user",
        email: `${devRole.toLowerCase()}@local.dev`,
        name: `${devRole} Demo User`,
        role: devRole as ActiveRole,
        roles: [{ role: devRole as ActiveRole, active: true }],
      };
      localStorage.setItem("bl_access", "dev-demo-token");
      localStorage.setItem("bl_user", JSON.stringify(mockUser));
      window.location.replace(dashboardFor[devRole as ActiveRole]);
      return;
    }

    const token = localStorage.getItem("bl_access");
    if (!token) return;
    void fetch(`${API_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json();
        const user = result.data?.user as { activeRole?: ActiveRole; role?: ActiveRole } | undefined;
        const activeRole = user?.activeRole || user?.role;
        if (activeRole) window.location.replace(dashboardFor[activeRole]);
      })
      .catch((reason: Error) => console.error("Unable to restore the signed-in session.", reason));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFeedback("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "").trim();
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password, role } : { email, password, name, role }),
      });
      const result = await response.json() as AuthResult;
      if (!response.ok) throw new Error(result.message || result.error || "Unable to sign in.");
      if (!result.data?.accessToken || !result.data.user) throw new Error("Authentication response was incomplete.");

      if (result.data.roleRequestPending) {
        localStorage.removeItem("bl_access");
        localStorage.removeItem("bl_user");
        setFeedback(result.message || "Officer access is pending administrator approval. You can sign in after approval.");
        setMode("login");
        return;
      }

      localStorage.setItem("bl_access", result.data.accessToken);
      localStorage.setItem("bl_user", JSON.stringify(result.data.user));
      window.location.assign(dashboardFor[result.data.user.role]);
    } catch (reason) {
      setError(reason instanceof TypeError
        ? `Unable to reach the BlockLand API at ${API_URL}. Check that the API server is running.`
        : (reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-home">
    <section className="auth-card" aria-labelledby="auth-title">
      <Link className="auth-brand" href="/">BlockLand<span>.</span></Link>
      <p className="eyebrow">Land records, made clear</p>
      <h1 id="auth-title">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
      <p className="auth-intro">{mode === "login" ? "Sign in to open your role-specific BlockLand dashboard." : "Choose the dashboard you need. Government access requires administrator approval."}</p>

      <form className="dashboard-login-form auth-form" onSubmit={(event) => void submit(event)}>
        {mode === "register" && <label>Your name<input name="name" autoComplete="name" maxLength={120} required /></label>}
        <label>Dashboard role
          <select value={role} onChange={(event) => setRole(event.target.value as LoginRole)}>
            {mode === "login" && <option value="USER">User</option>}
            <option value="LANDOWNER">Landowner</option>
            <option value="BUYER">Buyer</option>
            {mode === "login" && <option value="DEVELOPER">Developer</option>}
            <option value="GOVERNMENT">Government officer</option>
            {mode === "login" && <option value="ADMIN">Administrator</option>}
          </select>
        </label>
        {mode === "register" && role === "GOVERNMENT" && <p className="auth-notice">This creates a regular account and submits an officer-access request. An administrator must approve it before the Government dashboard is available.</p>}
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} maxLength={128} required /></label>
        {error && <p className="dashboard-login-error" role="alert">{error}</p>}
        {feedback && <p className="auth-notice" role="status">{feedback}</p>}
        <button className="button dark full" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>

      <button className="auth-mode-toggle" type="button" onClick={() => { const nextMode = mode === "login" ? "register" : "login"; setMode(nextMode); if (nextMode === "register" && !["LANDOWNER", "BUYER", "GOVERNMENT"].includes(role)) setRole("LANDOWNER"); setError(""); setFeedback(""); }}>
        {mode === "login" ? "New to BlockLand? Create an account" : "Already have an account? Sign in"}
      </button>
      <Link className="auth-explore-link" href="/explore">Explore the public property registry</Link>
    </section>
  </main>;
}

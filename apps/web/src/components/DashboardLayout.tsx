"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL } from "../lib/dashboard";

type DashboardRole = "USER" | "LANDOWNER" | "BUYER" | "DEVELOPER" | "GOVERNMENT" | "ADMIN";
type DashboardUser = { name?: string; email?: string; role?: DashboardRole; roles?: { role: DashboardRole; active: boolean }[] };

const roleLinks: Record<DashboardRole, { label: string; href: string }[]> = {
  USER: [
    { label: "Overview", href: "/dashboard" },
    { label: "Sales", href: "/dashboard/sales" },
    { label: "Purchases", href: "/dashboard/purchases" },
    { label: "Escrow", href: "/dashboard/escrow" },
    { label: "Alerts", href: "/dashboard/alerts" },
  ],
  LANDOWNER: [
    { label: "Overview", href: "/dashboard/owner" },
    { label: "Properties", href: "/dashboard/owner#properties" },
    { label: "Ownership", href: "/dashboard/owner#ownership" },
    { label: "Documents", href: "/dashboard/owner#documents" },
  ],
  BUYER: [
    { label: "Overview", href: "/dashboard/buyer" },
    { label: "Watchlist", href: "/dashboard/buyer#watchlist" },
    { label: "Purchases", href: "/dashboard/buyer#purchases" },
    { label: "Identity", href: "/dashboard/buyer#identity" },
  ],
  DEVELOPER: [
    { label: "Overview", href: "/dashboard/developer" },
    { label: "Portfolio", href: "/dashboard/developer#portfolio" },
    { label: "Projects", href: "/dashboard/developer#projects" },
    { label: "Network", href: "/dashboard/developer#network" },
  ],
  GOVERNMENT: [
    { label: "Overview", href: "/government" },
    { label: "Verification queue", href: "/government#verification-queue" },
    { label: "Transfer review", href: "/government#transfer-review" },
    { label: "Risk cases", href: "/government#risk-cases" },
  ],
  ADMIN: [
    { label: "Overview", href: "/admin" },
    { label: "Users", href: "/admin#users" },
    { label: "Audit log", href: "/admin#audit-log" },
    { label: "Government queue", href: "/government" },
  ],
};

export default function DashboardLayout({
  role,
  eyebrow,
  title,
  description,
  children,
}: {
  role: DashboardRole;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [switching, setSwitching] = useState(false);
  const [roleRequestMessage, setRoleRequestMessage] = useState("");

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem("bl_user");
      if (savedUser) setUser(JSON.parse(savedUser) as DashboardUser);
      const token = localStorage.getItem("bl_access");
      if (process.env.NODE_ENV === "development"
        && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
        && token === "dev-demo-token") {
        setRoleRequestMessage("Local demo mode — sample data only; dashboard actions are disabled.");
        if (!savedUser) {
          const demoUser: DashboardUser = {
            name: `${role} Demo User`,
            email: `${role.toLowerCase()}@local.dev`,
            role,
            roles: [{ role, active: true }],
          };
          localStorage.setItem("bl_user", JSON.stringify(demoUser));
          setUser(demoUser);
        }
        return;
      }
      if (token) {
        void fetch(`${API_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
          .then(async (response) => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || result.error || "Unable to refresh dashboard roles.");
            const currentUser = result.data.user as DashboardUser & { roleAssignments?: { role: DashboardRole; active: boolean }[]; activeRole?: DashboardRole };
            const refreshedUser: DashboardUser = {
              ...currentUser,
              role: currentUser.activeRole || currentUser.role,
              roles: currentUser.roleAssignments || currentUser.roles,
            };
            setUser(refreshedUser);
            localStorage.setItem("bl_user", JSON.stringify(refreshedUser));
          })
          .catch((reason: Error) => {
            console.error("Unable to refresh active dashboard roles.", reason);
            setRoleRequestMessage(reason.message);
          });
      }
    } catch (error) {
      console.error("Unable to read the signed-in dashboard user.", error);
    }
  }, []);

  function signOut() {
    localStorage.removeItem("bl_access");
    localStorage.removeItem("bl_user");
    window.location.assign("/");
  }

  async function requestDeveloperRole() {
    try {
      const response = await fetch(`${API_URL}/api/v1/dashboard/developer-role-request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("bl_access") || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to submit the developer role request.");
      setRoleRequestMessage(result.message || "Developer access request submitted.");
    } catch (reason) {
      setRoleRequestMessage((reason as Error).message);
    }
  }

  async function switchRole(nextRole: DashboardRole) {
    if (nextRole === role || switching) return;
    setSwitching(true);
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/switch-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("bl_access") || ""}` },
        body: JSON.stringify({ role: nextRole }),
      });
      const result = await response.json();
      if (!response.ok || !result.data?.accessToken) throw new Error(result.message || "Unable to switch dashboard role.");
      localStorage.setItem("bl_access", result.data.accessToken);
      localStorage.setItem("bl_user", JSON.stringify(result.data.user));
      const destinations: Record<DashboardRole, string> = {
        USER: "/dashboard", LANDOWNER: "/dashboard/owner", BUYER: "/dashboard/buyer",
        DEVELOPER: "/dashboard/developer", GOVERNMENT: "/officer", ADMIN: "/admin",
      };
      window.location.assign(destinations[nextRole]);
    } catch (reason) {
      window.alert((reason as Error).message);
      setSwitching(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-appbar">
        <Link className="dashboard-brand" href="/">BlockLand<span>.</span></Link>
        <nav className="dashboard-nav" aria-label={`${role.toLowerCase()} dashboard`}>
          {roleLinks[role].map((item) => (
            <Link href={item.href} key={item.href}>{item.label}</Link>
          ))}
        </nav>
        <div className="dashboard-account">
          <span>{user?.name || user?.email || role}</span>
          {(user?.roles?.filter((assignment) => assignment.active).length || 0) > 1 && (
            <label className="dashboard-role-switch">
              <span className="sr-only">Switch dashboard role</span>
              <select aria-label="Switch dashboard role" value={role} disabled={switching} onChange={(event) => void switchRole(event.target.value as DashboardRole)}>
                {user?.roles?.filter((assignment) => assignment.active).map((assignment) => (
                  <option key={assignment.role} value={assignment.role}>{assignment.role.replaceAll("_", " ")}</option>
                ))}
              </select>
            </label>
          )}
          {user?.roles?.some((assignment) => assignment.active && ["USER", "LANDOWNER", "BUYER"].includes(assignment.role))
            && !user.roles.some((assignment) => assignment.active && assignment.role === "DEVELOPER")
            && <button type="button" onClick={() => void requestDeveloperRole()}>Request developer access</button>}
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </div>
      {roleRequestMessage && <p className="dashboard-feedback" role="status">{roleRequestMessage}</p>}
      <header className="dashboard-header">
        <div>
          <span className="eyebrow dashboard-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Link className="button ghost" href="/explore">Public registry</Link>
      </header>
      {children}
    </main>
  );
}

export function DashboardLoading({ message }: { message: string }) {
  return <main className="dashboard-shell"><p className="dashboard-message">{message}</p></main>;
}

export function DashboardError({ message, requiredRole }: { message: string; requiredRole: DashboardRole }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true);
    setSignInError("");
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role: requiredRole }),
      });
      const result = await response.json();
      if (!response.ok || !result.data?.accessToken) {
        throw new Error(result.message || result.error || "Unable to sign in.");
      }

      const signedInUser = result.data.user as DashboardUser;
      const assignedRoles = signedInUser.roles?.filter((assignment) => assignment.active).map((assignment) => assignment.role) || [];
      const allowedRoles = requiredRole === "GOVERNMENT" ? ["GOVERNMENT", "ADMIN"] : [requiredRole];
      if (!signedInUser.role || (!allowedRoles.includes(signedInUser.role) && !assignedRoles.some((assigned) => allowedRoles.includes(assigned)))) {
        throw new Error(`This account does not have ${requiredRole.toLowerCase()} dashboard access.`);
      }

      localStorage.setItem("bl_access", result.data.accessToken);
      localStorage.setItem("bl_user", JSON.stringify(signedInUser));
      const destination: Record<DashboardRole, string> = {
        USER: "/dashboard", LANDOWNER: "/dashboard/owner", BUYER: "/dashboard/buyer",
        DEVELOPER: "/dashboard/developer", GOVERNMENT: "/officer", ADMIN: "/admin",
      };
      const activeRole = signedInUser.role || requiredRole;
      window.location.assign(destination[activeRole]);
    } catch (reason) {
      setSignInError((reason as Error).message);
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-message dashboard-error dashboard-access-card">
        <span className="eyebrow dashboard-eyebrow">{requiredRole.toLowerCase()} portal</span>
        <h1>Sign in to continue</h1>
        <p>{message}</p>
        <form className="dashboard-login-form" onSubmit={signIn}>
          <label>Email<input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {signInError && <p className="dashboard-login-error" role="alert">{signInError}</p>}
          <button className="button dark full" type="submit" disabled={signingIn}>{signingIn ? "Signing in..." : "Sign in to dashboard"}</button>
        </form>
        <Link className="dashboard-back-link" href="/">Return to BlockLand</Link>
      </div>
    </main>
  );
}

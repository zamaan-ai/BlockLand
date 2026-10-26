export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type DashboardRole = "USER" | "LANDOWNER" | "BUYER" | "DEVELOPER" | "GOVERNMENT" | "ADMIN";
export type MapPlot = {
  id: string;
  plotId: string;
  title: string;
  description: string;
  state: string;
  district: string;
  village: string;
  area: number;
  status: string;
  latitude: number | null;
  longitude: number | null;
  metadata: unknown;
  encumbrances?: { id: string; type: string }[];
  disputes?: { id: string; status: string }[];
  transfers?: { id: string; status: string }[];
};

const mapPlotIds = [
  "BL-00372",
  "BL-00841",
  "BL-01120",
  "BL-DEMO-FROZEN",
  "BL-DEMO-JOINT",
  "BL-DEMO-LOCKED",
  "BL-DEMO-RESTRICTED",
];

const localMapPlots: MapPlot[] = [
  { id: "demo-plot-00372", plotId: "BL-00372", title: "2.4 acres near Financial District", description: "Residential plot near Nanakramguda Financial District with clear approach roads.", state: "Telangana", district: "Hyderabad", village: "Nanakramguda", area: 2.4, status: "VERIFIED", latitude: 17.4412, longitude: 78.3489, metadata: { zoning: "Residential", recordedYear: 2018, historyEvents: 6, locationPrecision: "PLOT_COORDINATE" }, encumbrances: [], disputes: [], transfers: [] },
  { id: "demo-plot-00841", plotId: "BL-00841", title: "Greenfield parcel, Sector 79", description: "Greenfield parcel in Gurugram Sector 79, blockchain recorded.", state: "Haryana", district: "Gurugram", village: "Sector 79", area: 1.2, status: "VERIFIED", latitude: 28.4089, longitude: 77.0677, metadata: { recordedYear: 2021, locationPrecision: "PLOT_COORDINATE" }, encumbrances: [], disputes: [], transfers: [] },
  { id: "demo-plot-01120", plotId: "BL-01120", title: "ORR frontage plot", description: "ORR frontage plot in Bengaluru.", state: "Karnataka", district: "Bengaluru", village: "ORR Corridor", area: 3.1, status: "VERIFIED", latitude: 12.9716, longitude: 77.5946, metadata: { zoning: "Commercial", locationPrecision: "PLOT_COORDINATE" }, encumbrances: [], disputes: [], transfers: [] },
  { id: "demo-plot-frozen", plotId: "BL-DEMO-FROZEN", title: "Emergency freeze demo plot", description: "Synthetic plot frozen after a fraud report.", state: "Maharashtra", district: "Pune", village: "Demo Freeze Village", area: 1.1, status: "UNDER_REVIEW", latitude: 18.5204, longitude: 73.8567, metadata: { locationPrecision: "DISTRICT_APPROXIMATE" }, encumbrances: [], disputes: [], transfers: [] },
  { id: "demo-plot-joint", plotId: "BL-DEMO-JOINT", title: "Joint ownership approval demo", description: "Synthetic joint-owner plot requiring co-owner approvals.", state: "Karnataka", district: "Bengaluru", village: "Demo Joint Village", area: 2.8, status: "VERIFIED", latitude: 12.9716, longitude: 77.5946, metadata: { locationPrecision: "DISTRICT_APPROXIMATE" }, encumbrances: [], disputes: [], transfers: [{ id: "demo-transfer-joint", status: "UNDER_REVIEW" }] },
  { id: "demo-plot-locked", plotId: "BL-DEMO-LOCKED", title: "Anti-fraud locked-sale demo plot", description: "Demo land with an active escrow-backed sale.", state: "Telangana", district: "Hyderabad", village: "Demo Village", area: 1.5, status: "LOCKED_FOR_SALE", latitude: 17.385, longitude: 78.4867, metadata: { locationPrecision: "DISTRICT_APPROXIMATE" }, encumbrances: [], disputes: [], transfers: [{ id: "demo-transfer-locked", status: "ESCROW_FUNDED" }] },
  { id: "demo-plot-restricted", plotId: "BL-DEMO-RESTRICTED", title: "Anti-fraud disputed demo plot", description: "Demo land blocked by dispute and encumbrance.", state: "Haryana", district: "Gurugram", village: "Demo Sector", area: 2.1, status: "DISPUTED", latitude: 28.4595, longitude: 77.0266, metadata: { locationPrecision: "DISTRICT_APPROXIMATE" }, encumbrances: [{ id: "demo-mortgage", type: "MORTGAGE" }], disputes: [{ id: "demo-court-dispute", status: "OPEN" }], transfers: [] },
];

function isLocalDemoEnabled() {
  return process.env.NODE_ENV === "development"
    && typeof window !== "undefined"
    && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

function demoRoleForPath(path: string): DashboardRole {
  if (path.startsWith("/api/v1/admin/")) return "ADMIN";
  if (path.startsWith("/api/v1/dashboard/owner")) return "LANDOWNER";
  if (path.startsWith("/api/v1/dashboard/buyer")) return "BUYER";
  if (path.startsWith("/api/v1/dashboard/developer")) return "DEVELOPER";
  if (path.startsWith("/api/v1/dashboard/officer")) return "GOVERNMENT";
  if (path.startsWith("/api/v1/dashboard/second-approvals")) return "ADMIN";
  return "USER";
}

function startLocalDemoSession(role: DashboardRole) {
  const user = {
    id: "dev-demo-user",
    email: `${role.toLowerCase()}@local.dev`,
    name: `${role} Demo User`,
    role,
    roles: [{ role, active: true }],
  };
  localStorage.setItem("bl_access", "dev-demo-token");
  localStorage.setItem("bl_user", JSON.stringify(user));
}

function localDemoData(path: string) {
  if (path.startsWith("/api/v1/lands")) return { lands: localMapPlots, count: localMapPlots.length };
  if (path.startsWith("/api/v1/admin/stats")) {
    return { stats: { totalLands: 0, totalUsers: 0, verifiedUsers: 0, pendingLands: 0, activeTransfers: 0, openFraudFlags: 0 } };
  }

  if (path.startsWith("/api/v1/admin/users")) return { users: [], count: 0 };
  if (path.startsWith("/api/v1/admin/audit-logs")) return { logs: [], count: 0 };
  if (path.startsWith("/api/v1/admin/role-requests")) return { requests: [], count: 0 };
  if (path.startsWith("/api/v1/admin/system-health")) {
    return { health: { database: "demo", api: "demo", checkedAt: new Date().toISOString() }, monitoring: {} };
  }
  if (path.startsWith("/api/v1/dashboard/second-approvals")) return { transfers: [] };
  if (path.startsWith("/api/v1/dashboard/owner")) {
    return { walletAddress: null, lands: [], transfers: [], documents: [], notifications: [], identity: null, shares: [], events: [], stats: { totalPlots: 0, totalArea: 0 } };
  }
  if (path.startsWith("/api/v1/dashboard/buyer")) {
    const status = localStorage.getItem("bl_demo_identity_status");
    return {
      purchases: [],
      savedProperties: [],
      identity: status ? { status, provider: "OTP_ONLY" } : null,
      notifications: [],
    };
  }
  if (path.startsWith("/api/v1/dashboard/developer")) {
    return { profile: null, projects: [], lands: [], enquiries: [], followers: 0, following: 0, pendingRole: null };
  }
  if (path.startsWith("/api/v1/dashboard/officer")) {
    return { verificationQueue: [], transfers: [], disputes: [], encumbrances: [], fraudFlags: [], objections: [], auditLogs: [], stats: [] };
  }
  if (path.startsWith("/api/v1/dashboard/user")) return { lands: [], transfers: [], notifications: [], identity: null };
  return null;
}

export async function loadMapPlots(): Promise<MapPlot[]> {
  const response = await dashboardFetch<{ lands: MapPlot[] }>("/api/v1/lands?q=BL-");
  const plotsById = new Map(response.lands.map((plot) => [plot.plotId, plot]));
  return mapPlotIds.flatMap((plotId) => {
    const plot = plotsById.get(plotId);
    return plot ? [plot] : [];
  });
}

export function getDashboardToken() {
  return localStorage.getItem("bl_access");
}

export async function dashboardFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getDashboardToken();
  if (isLocalDemoEnabled() && (!token || token === "dev-demo-token")) {
    if (!token) startLocalDemoSession(demoRoleForPath(path));
    const method = (options.method || "GET").toUpperCase();

    if (path === "/api/v1/auth/identity/otp/send" && method === "POST") {
      localStorage.setItem("bl_demo_identity_otp", "123456");
      return { demo: true, hint: "123456", expiresIn: 600 } as T;
    }
    if (path === "/api/v1/auth/identity/otp/verify" && method === "POST") {
      const body = JSON.parse(String(options.body || "{}")) as { code?: string };
      if (body.code !== localStorage.getItem("bl_demo_identity_otp")) {
        throw new Error("Invalid or expired demo OTP. Use the code shown after requesting it.");
      }
      localStorage.removeItem("bl_demo_identity_otp");
      localStorage.setItem("bl_demo_identity_status", "PENDING");
      return {
        identity: { id: "demo-identity", provider: "OTP_ONLY", status: "PENDING", createdAt: new Date().toISOString() },
      } as T;
    }
    if (method !== "GET") {
      throw new Error("Local demo mode is read-only. Start the API to use dashboard actions.");
    }
    const data = localDemoData(path);
    if (data !== null) return data as T;
  }

  if (!token) {
    throw new Error("Sign in to access your dashboard.");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !(typeof FormData !== "undefined" && options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || result.error || `Request failed (${response.status})`);
  }
  return result.data as T;
}

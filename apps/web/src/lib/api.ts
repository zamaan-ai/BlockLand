const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {}
): Promise<{ success: boolean; data: T; message?: string }> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("blockland_token") : null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `API error ${res.status}`);
  return json;
}

export { API };

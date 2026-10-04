/**
 * Browser-facing proxy for Spectrum "create shared user".
 * Credentials stay in this process (Server/.env). The browser only receives
 * the player's number and the line Photon assigned.
 */

const PORT = 8787;
const E164 = /^\+[1-9]\d{6,14}$/;
const VITE_ORIGINS = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);

/** 10-digit US numbers become +1…; anything else must already be E.164. */
export function normalizePhoneNumber(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, "");
  const candidate = /^\d{10}$/.test(compact) ? `+1${compact}` : compact;
  return E164.test(candidate) ? candidate : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !VITE_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function spectrumAuth(): { projectId: string; token: string } | { error: string } {
  const projectId = process.env.PROJECT_ID;
  const projectSecret = process.env.PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    return { error: "Photon credentials are not configured" };
  }
  return { projectId, token: Buffer.from(`${projectId}:${projectSecret}`, "utf8").toString("base64") };
}

function spectrumUrl(projectId: string, path: string): string {
  return `https://spectrum.photon.codes/projects/${encodeURIComponent(projectId)}${path}`;
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function shortMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    const value = record[key];
    if (typeof value === "string") {
      const text = value.trim();
      if (text && text.length <= 180) return text;
    }
  }
  return undefined;
}

function statusForSpectrum(status: number): number {
  if (status === 401 || status === 403) return 502;
  if (status >= 400 && status < 500) return status;
  return 502;
}

async function createSharedUser(phoneNumber: string): Promise<{ status: number; body: unknown }> {
  const auth = spectrumAuth();
  if ("error" in auth) {
    return { status: 500, body: { error: auth.error } };
  }
  const { projectId, token } = auth;

  let response: Response;
  try {
    response = await fetch(spectrumUrl(projectId, "/users/"), {
      method: "POST",
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "shared", phoneNumber }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.warn("[users] could not reach Photon:", err instanceof Error ? err.message : "network error");
    return { status: 502, body: { error: "Could not reach Photon" } };
  }

  const payload = (await response.json().catch(() => null)) as {
    succeed?: boolean;
    data?: { phoneNumber?: unknown; assignedPhoneNumber?: unknown };
  } | null;

  const assigned =
    typeof payload?.data?.assignedPhoneNumber === "string" ? payload.data.assignedPhoneNumber.trim() : "";
  const echoed = typeof payload?.data?.phoneNumber === "string" ? payload.data.phoneNumber.trim() : phoneNumber;

  if (!response.ok || payload?.succeed !== true || !assigned) {
    const status = statusForSpectrum(response.status || 502);
    const error =
      response.status === 401 || response.status === 403
        ? "Photon rejected the project credentials"
        : (shortMessage(payload) ?? `Photon could not register that number (${response.status || "network"})`);
    console.warn(`[users] Spectrum create user failed: HTTP ${response.status}`);
    return { status, body: { error } };
  }

  return {
    status: 200,
    body: { phoneNumber: echoed, assignedPhoneNumber: assigned },
  };
}

/**
 * Placeholder for a real Photon conversation reset on start-over.
 * Delete-and-readd is known not to work (it breaks the allowlist / assigned line).
 * TBD: new thread or new assigned line without deleting the shared user.
 * Do not call Photon delete from this stub.
 */
export async function resetPhotonConversation(
  phoneNumber: string,
): Promise<{ ok: true; skipped: true }> {
  console.info("[users] Photon conversation reset skipped (delete-and-readd does not work)", phoneNumber);
  return { ok: true, skipped: true };
}

async function readPhone(
  request: Request,
): Promise<{ ok: true; phoneNumber: string } | { ok: false; status: number; body: unknown }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { ok: false, status: 400, body: { error: "Send JSON with a phoneNumber" } };
  }

  const raw = parsed && typeof parsed === "object" ? (parsed as { phoneNumber?: unknown }).phoneNumber : undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, status: 400, body: { error: "Enter a phone number" } };
  }

  const phoneNumber = normalizePhoneNumber(raw);
  if (!phoneNumber) {
    return { ok: false, status: 400, body: { error: "Enter a valid phone number, like 5551234567 or +15551234567" } };
  }
  return { ok: true, phoneNumber };
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const users = url.pathname === "/api/users" || url.pathname === "/api/users/";

  if (request.method === "OPTIONS" && users) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (!users) {
    return json(404, { error: "Not found" }, origin);
  }
  if (request.method !== "POST") {
    return json(405, { error: "Use POST" }, origin);
  }

  const parsed = await readPhone(request);
  if (!parsed.ok) {
    return json(parsed.status, parsed.body, origin);
  }

  const result = await createSharedUser(parsed.phoneNumber);
  return json(result.status, result.body, origin);
}

export function startUserRegistrationServer(): void {
  try {
    Bun.serve({
      port: PORT,
      hostname: "127.0.0.1",
      fetch: handle,
    });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: unknown }).code : undefined;
    if (code === "EADDRINUSE") {
      console.log(`[users] already listening on http://127.0.0.1:${PORT}`);
      return;
    }
    throw err;
  }
  console.log(`[users] listening on http://127.0.0.1:${PORT}`);
}

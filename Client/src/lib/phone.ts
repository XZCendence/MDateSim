export const PLAYER_PHONE_KEY = "mdate.playerPhone";

export function readSavedPhone(): string {
  try {
    return localStorage.getItem(PLAYER_PHONE_KEY) ?? "";
  } catch {
    return "";
  }
}

export type Registration = {
  phoneNumber: string;
  assignedPhoneNumber: string;
};

export async function registerSavedPhone(phoneNumber: string): Promise<Registration> {
  return postUser("/api/users", phoneNumber);
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
  console.info("[phone] Photon conversation reset skipped (delete-and-readd does not work)", phoneNumber);
  return { ok: true, skipped: true };
}

async function postUser(path: string, phoneNumber: string): Promise<Registration> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber }),
  });
  const body = (await res.json().catch(() => null)) as
    | { error?: string; phoneNumber?: string; assignedPhoneNumber?: string }
    | null;
  if (!res.ok || !body?.assignedPhoneNumber) {
    throw new Error(body?.error || "Could not register that number");
  }
  return {
    phoneNumber: body.phoneNumber ?? phoneNumber,
    assignedPhoneNumber: body.assignedPhoneNumber,
  };
}

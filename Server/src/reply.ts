/** Parsing of the tags a date appends to a reply: [demand:x] and [affection:+N]. */

const DEMAND_TAG = /\[demand:([a-z_]+)\]/gi;
const AFFECTION_TAG = /\[affection:\s*([+-]?\d+)\s*\]/gi;
const AFFECTION_TAG_ANY = /\[affection:[^\]]*\]/gi;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

/** Keep a parsed delta inside i32 so the reducer accepts it. The score clamp is separate. */
export function clampDelta(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(I32_MIN, Math.min(I32_MAX, Math.trunc(n)));
}

export function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Pull [demand:x] and [affection:+N] tags off the reply, in either order.
 * A missing or junk affection tag is a delta of 0. The text is what gets sent.
 */
export function splitReply(reply: string): { text: string; demand?: string; affectionDelta: number } {
  let affectionDelta = 0;
  for (const m of reply.matchAll(AFFECTION_TAG)) {
    affectionDelta = clampDelta(Number(m[1]));
  }
  let demand: string | undefined;
  for (const m of reply.matchAll(DEMAND_TAG)) {
    demand = m[1]!.toLowerCase();
  }
  const text = reply.replace(AFFECTION_TAG_ANY, "").replace(DEMAND_TAG, "").trim();
  return { text, demand, affectionDelta };
}

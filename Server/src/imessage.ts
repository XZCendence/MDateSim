import type { Identity } from "spacetimedb";
import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { chat, type ChatMessage } from "./grok";
import { DEFAULT_PERSONA, PERSONAS, personaFromIntro, type Persona } from "./personas";
import { startUserRegistrationServer } from "./registerUser";

const personaById = (id: string): Persona => (PERSONAS as Record<string, Persona>)[id] ?? DEFAULT_PERSONA;
import { connectSpacetime } from "./db";

startUserRegistrationServer();

// Spectrum bridges a single agent loop to many messaging interfaces.
// Docs: https://photon.codes/docs/spectrum-ts
const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

// Game state lives in SpacetimeDB (see spacetimedb/src/index.ts).
// A first lobby pick creates a game_session with no spaceId; the player's first
// text claims it by matching the date they picked. Start over / switching dates
// keeps that spaceId and changes dateId, so this same thread replies as the new
// persona. History is the message table (empty after a reset).
const db = await connectSpacetime();
const HISTORY_LIMIT = 30;

/** The session this iMessage thread is linked to. Several may carry the same spaceId after
 * re-picks from the lobby; the newest one is the live one. */
function sessionForSpace(spaceId: string) {
  let best: ReturnType<typeof db.db.gameSession.iter> extends Iterable<infer R> ? R | undefined : never;
  for (const s of db.db.gameSession.iter()) {
    if (s.spaceId !== spaceId) continue;
    if (!best || s.startedAt.microsSinceUnixEpoch > best.startedAt.microsSinceUnixEpoch) best = s;
  }
  return best;
}

/** Wipe the relationship state so a (re)claimed session starts as a brand new date. */
async function startFresh(player: Identity, spaceId: string) {
  const affection = db.db.affection.player.find(player)?.value ?? 0;
  await Promise.allSettled([
    db.reducers.clearMessages({ player }),
    affection !== 0 ? db.reducers.adjustAffection({ player, delta: -affection }) : Promise.resolve(),
    db.reducers.setDemandFor({ player, demand: "" }),
  ]);
  fallbackHistory.delete(spaceId);
}

/** Unlinked threads keep whichever persona they started with, so they don't flip per message. */
const unlinkedPersona = new Map<string, Persona>();

/** Link this thread to the newest unclaimed lobby session for `dateId`, then start fresh. */
async function claimSession(spaceId: string, dateId: string) {
  unlinkedPersona.set(spaceId, personaById(dateId));
  try {
    // Prefer the newest-wins reducer; fall back to the strict one if the module predates it.
    const r = db.reducers as unknown as Record<string, ((a: { dateId: string; spaceId: string }) => Promise<void>) | undefined>;
    await (r.claimLatestSession ?? r.claimSession)!({ dateId, spaceId });
  } catch (err) {
    // No unclaimed lobby session for that date (or several). Still chat, just unlinked.
    console.warn(`[${spaceId}] could not claim a session for ${dateId}:`, String(err));
    return undefined;
  }
  const session = sessionForSpace(spaceId);
  if (session) {
    await startFresh(session.player, spaceId);
    console.log(`[${spaceId}] claimed ${dateId} session for ${session.player.toHexString().slice(0, 10)}…`);
  }
  return session;
}

function historyFor(player: Identity): ChatMessage[] {
  return [...db.db.message.player.filter(player)]
    .sort((a, b) => Number(a.sentAt.microsSinceUnixEpoch - b.sentAt.microsSinceUnixEpoch))
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as ChatMessage["role"], content: m.text }));
}

/** Unlinked threads (no lobby session) keep history in memory so the demo still works. */
const fallbackHistory = new Map<string, ChatMessage[]>();

/** Last date + start we saw for a linked space, so a lobby reset drops in-memory history. */
const linkedStamp = new Map<string, { dateId: string; startedAt: bigint }>();

function forgetFallbackIfReset(session: {
  spaceId?: string;
  dateId: string;
  startedAt: { microsSinceUnixEpoch: bigint };
} | undefined): void {
  if (!session?.spaceId) return;
  const startedAt = session.startedAt.microsSinceUnixEpoch;
  const prev = linkedStamp.get(session.spaceId);
  if (prev && (prev.dateId !== session.dateId || prev.startedAt !== startedAt)) {
    fallbackHistory.delete(session.spaceId);
  }
  linkedStamp.set(session.spaceId, { dateId: session.dateId, startedAt });
}

db.db.gameSession.onUpdate((_ctx, prev, next) => {
  const spaceId = next.spaceId || prev.spaceId;
  if (
    spaceId &&
    (prev.dateId !== next.dateId ||
      prev.startedAt.microsSinceUnixEpoch !== next.startedAt.microsSinceUnixEpoch)
  ) {
    fallbackHistory.delete(spaceId);
  }
  forgetFallbackIfReset(next);
});

/** `/date rin` re-targets this thread at a different date's unclaimed session (demo helper). */
async function handleCommand(spaceId: string, text: string): Promise<string | undefined> {
  if (/^\/reset\b/i.test(text)) {
    const session = sessionForSpace(spaceId);
    if (session) await startFresh(session.player, spaceId);
    await db.reducers.unlinkSpace({ spaceId }).catch((err) => console.warn("unlinkSpace:", String(err)));
    fallbackHistory.delete(spaceId);
    unlinkedPersona.delete(spaceId);
    return "(fresh start. pick a date in the lobby and text me the intro line)";
  }
  const m = /^\/date\s+(\w+)/i.exec(text);
  if (!m) return undefined;
  const p = (PERSONAS as Record<string, Persona | undefined>)[m[1]!.toLowerCase()];
  if (!p) return `no date named ${m[1]}. options: ${Object.keys(PERSONAS).join(", ")}`;
  const session = await claimSession(spaceId, p.id);
  return session ? `(now texting with ${p.name})` : `(no lobby session waiting for ${p.name}, chatting unlinked)`;
}

/** The date of the most recent unclaimed lobby pick (within `withinMs`), if any. With no name
 * in the first text, the person who just clicked in the lobby is almost always the texter. */
function newestUnclaimedDateId(withinMs = 15 * 60_000): string | undefined {
  let best: { dateId: string; t: bigint } | undefined;
  const cutoff = BigInt(Date.now() - withinMs) * 1000n;
  for (const s of db.db.gameSession.iter()) {
    if (s.spaceId) continue;
    const t = s.startedAt.microsSinceUnixEpoch;
    if (t < cutoff) continue;
    if (!best || t > best.t) best = { dateId: s.dateId, t };
  }
  return best?.dateId;
}

/** True when the player has no logged messages yet (so an intro is a genuine first text). */
function history_is_fresh(player: Identity): boolean {
  for (const _ of db.db.message.player.filter(player)) return false;
  return true;
}

function buildSystem(persona: Persona, affection: number, demand: string | undefined, demandMet: boolean, phase = "texting"): string {
  let s = `${persona.system}\n\nYour current affection for the player is ${affection} on a scale of -100 to 100. Let it color your tone. The affection tag is the change from this message, added to that score. The score stays between -100 and 100, but the change itself is not capped: +200 from -100 lands at 100, and -200 from 100 lands at -100. Match the size of the change to how the message actually felt.`;
  if (phase === "irl") {
    s += `\nYou are on an IRL date right now: the player is standing in front of the camera. Be bold and physical; ask them to do things with a demand tag early and often (every message or two), and escalate.`;
  } else {
    s += `\nYou are only texting right now; the camera is off. Demands are rare teases, mostly save them for the IRL date.`;
  }
  if (demand) {
    s += demandMet
      ? `\nYou asked them to "${demand}" in front of the camera and they did it. Acknowledge it in your own way.`
      : `\nYou have asked them to "${demand}" in front of the camera and they haven't done it yet.`;
  }
  return s;
}

function isTargetNotAllowed(err: unknown): boolean {
  return String(err).includes("Target not allowed for this project");
}

const DEMAND_TAG = /\[demand:([a-z_]+)\]/gi;
const AFFECTION_TAG = /\[affection:\s*([+-]?\d+)\s*\]/gi;
const AFFECTION_TAG_ANY = /\[affection:[^\]]*\]/gi;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

/** Keep a parsed delta inside i32 so the reducer accepts it. The score clamp is separate. */
function clampDelta(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(I32_MIN, Math.min(I32_MAX, Math.trunc(n)));
}

function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Pull [demand:x] and [affection:+N] tags off the reply, in either order.
 * A missing or junk affection tag is a delta of 0. The text is what gets sent.
 */
function splitReply(reply: string): { text: string; demand?: string; affectionDelta: number } {
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

// When the Kinect records a successful gesture, she reacts in the thread on her own.
db.db.gestureEvent.onInsert(async (_ctx, event) => {
  if (!event.success) return;
  const session = [...db.db.gameSession.iter()].find((s) => s.player.isEqual(event.player));
  if (!session?.spaceId) return;
  const persona = personaById(session.dateId);
  const affection = db.db.affection.player.find(session.player)?.value ?? 0;
  const history = historyFor(session.player);
  try {
    const space = await imessage(app).space.get(session.spaceId);
    const raw = await chat([
      { role: "system", content: buildSystem(persona, affection, undefined, false, "irl") },
      ...history,
      {
        role: "user",
        content: `[The camera just saw the player do the "${event.gesture}" you asked for. React in one or two texts. You may end with a new demand tag if you want more. Do not add an affection tag.]`,
      },
    ]);
    const { text, demand: next } = splitReply(raw);
    if (!text) return;
    await space.send(text);
    await db.reducers.logMessage({ player: session.player, role: "assistant", text });
    if (next) {
      db.reducers.setDemandFor({ player: session.player, demand: next }).catch((err) =>
        console.warn(`[${session.spaceId}] setDemandFor(${next}) rejected:`, String(err)),
      );
    }
    console.log(`[${session.spaceId}] ${persona.name} (reacting to ${event.gesture}): ${text}`);
  } catch (err) {
    console.error(`[${session.spaceId}] gesture reaction failed:`, err);
  }
});

console.log("[imessage] listening");
for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;
  const text = message.content.text.trim();
  if (!text) continue;

  const cmd = await handleCommand(space.id, text);
  if (cmd) {
    await space.send(cmd);
    continue;
  }

  // An intro line from the lobby QR means "new date": re-claim even if this thread is already
  // linked, so switching from Bianca to Ling Long (or re-picking) starts clean.
  const intro = personaFromIntro(text);
  let session = sessionForSpace(space.id);
  if (intro && (!session || session.dateId !== intro.id || !history_is_fresh(session.player))) {
    session = (await claimSession(space.id, intro.id)) ?? session;
  } else if (!session) {
    const guess = newestUnclaimedDateId();
    if (guess) session = await claimSession(space.id, guess);
    if (!session) {
      unlinkedPersona.set(space.id, unlinkedPersona.get(space.id) ?? DEFAULT_PERSONA);
    }
  }
  const persona = session
    ? personaById(session.dateId)
    : (intro ?? unlinkedPersona.get(space.id) ?? DEFAULT_PERSONA);
  if (!session) unlinkedPersona.set(space.id, persona);

  let history: ChatMessage[];
  let affection = 0;
  let demand: string | undefined;
  let demandMet = false;
  let phase = "texting";
  if (session) {
    history = historyFor(session.player);
    affection = db.db.affection.player.find(session.player)?.value ?? 0;
    const state = db.db.dateState.player.find(session.player);
    demand = state?.demand;
    demandMet = state?.demandMet ?? false;
    phase = state?.phase ?? "texting";
    await db.reducers.logMessage({ player: session.player, role: "user", text });
  } else {
    history = fallbackHistory.get(space.id) ?? [];
    history.push({ role: "user", content: text });
    fallbackHistory.set(space.id, history.slice(-HISTORY_LIMIT));
    history = history.slice(0, -1);
  }

  try {
    const reply = await app.responding(space, () =>
      chat([
        { role: "system", content: buildSystem(persona, affection, demand, demandMet, phase) },
        ...history,
        { role: "user", content: text },
      ]),
    );
    const { text: replyText, demand: newDemand, affectionDelta } = splitReply(reply);
    if (!replyText) continue;
    await space.send(replyText);
    if (session) {
      await db.reducers.logMessage({ player: session.player, role: "assistant", text: replyText });
      if (affectionDelta !== 0) {
        db.reducers.adjustAffection({ player: session.player, delta: affectionDelta }).catch((err) =>
          console.warn(`[${space.id}] adjustAffection(${affectionDelta}) rejected:`, String(err)),
        );
      }
      if (newDemand && !demand) {
        db.reducers.setDemandFor({ player: session.player, demand: newDemand }).catch((err) =>
          console.warn(`[${space.id}] setDemandFor(${newDemand}) rejected:`, String(err)),
        );
      }
    } else {
      fallbackHistory.get(space.id)?.push({ role: "assistant", content: replyText });
    }
    console.log(`[${space.id}] ${persona.name}${session ? "" : " (unlinked)"}: ${replyText}${newDemand ? `  [demand:${newDemand}]` : ""}  [affection:${formatDelta(affectionDelta)}]`);
  } catch (err) {
    console.error(`[${space.id}] grok failed:`, err);
    if (isTargetNotAllowed(err)) continue;
    try {
      await space.send("ugh my phone is being weird, say that again?");
    } catch (sendErr) {
      console.error(`[${space.id}] could not send fallback:`, sendErr);
    }
  }
}

import type { Identity } from "spacetimedb";
import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { chat, type ChatMessage } from "./grok";
import { DEFAULT_PERSONA, PERSONAS, personaFromIntro, type Persona } from "./personas";
import { connectSpacetime } from "./db";

// Spectrum bridges a single agent loop to many messaging interfaces.
// Docs: https://photon.codes/docs/spectrum-ts
const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

// Game state lives in SpacetimeDB (see spacetimedb/src/index.ts).
// A lobby pick creates a game_session with no spaceId; the player's first
// text claims it by matching the date they picked, which links this iMessage
// thread to their lobby identity. From then on history + affection persist.
const db = await connectSpacetime();
const HISTORY_LIMIT = 30;

function sessionForSpace(spaceId: string) {
  for (const s of db.db.gameSession.iter()) {
    if (s.spaceId === spaceId) return s;
  }
  return undefined;
}

async function claimSession(spaceId: string, firstText: string) {
  const persona = personaFromIntro(firstText) ?? DEFAULT_PERSONA;
  try {
    await db.reducers.claimSession({ dateId: persona.id, spaceId });
  } catch (err) {
    // No unclaimed lobby session for that date (or several). Still chat, just unlinked.
    console.warn(`[${spaceId}] could not claim a session for ${persona.id}:`, String(err));
  }
  return sessionForSpace(spaceId);
}

function historyFor(player: Identity): ChatMessage[] {
  return [...db.db.message.player.filter(player)]
    .sort((a, b) => Number(a.sentAt.microsSinceUnixEpoch - b.sentAt.microsSinceUnixEpoch))
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as ChatMessage["role"], content: m.text }));
}

/** Unlinked threads (no lobby session) keep history in memory so the demo still works. */
const fallbackHistory = new Map<string, ChatMessage[]>();

/** `/date rin` re-targets this thread at a different date's unclaimed session (demo helper). */
async function handleCommand(spaceId: string, text: string): Promise<string | undefined> {
  const m = /^\/date\s+(\w+)/i.exec(text);
  if (!m) return undefined;
  const p = PERSONAS[m[1]!.toLowerCase()];
  if (!p) return `no date named ${m[1]}. options: ${Object.keys(PERSONAS).join(", ")}`;
  fallbackHistory.delete(spaceId);
  const session = await claimSession(spaceId, p.intro);
  return session ? `(now texting with ${p.name})` : `(no lobby session waiting for ${p.name}, chatting unlinked)`;
}

function buildSystem(persona: Persona, affection: number, demand: string | undefined, demandMet: boolean): string {
  let s = `${persona.system}\n\nYour current affection for the player is ${affection} on a scale of -100 to 100. Let it color your tone.`;
  if (demand) {
    s += demandMet
      ? `\nYou asked them to "${demand}" in front of the camera and they did it. Acknowledge it in your own way.`
      : `\nYou have asked them to "${demand}" in front of the camera and they haven't done it yet.`;
  }
  return s;
}

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

  const session = sessionForSpace(space.id) ?? (await claimSession(space.id, text));
  const persona = session ? (PERSONAS[session.dateId] ?? DEFAULT_PERSONA) : (personaFromIntro(text) ?? DEFAULT_PERSONA);

  let history: ChatMessage[];
  let affection = 0;
  let demand: string | undefined;
  let demandMet = false;
  if (session) {
    history = historyFor(session.player);
    affection = db.db.affection.player.find(session.player)?.value ?? 0;
    const state = db.db.dateState.player.find(session.player);
    demand = state?.demand;
    demandMet = state?.demandMet ?? false;
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
        { role: "system", content: buildSystem(persona, affection, demand, demandMet) },
        ...history,
        { role: "user", content: text },
      ]),
    );
    if (!reply) continue;
    await space.send(reply);
    if (session) {
      await db.reducers.logMessage({ player: session.player, role: "assistant", text: reply });
    } else {
      fallbackHistory.get(space.id)?.push({ role: "assistant", content: reply });
    }
    console.log(`[${space.id}] ${persona.name}${session ? "" : " (unlinked)"}: ${reply}`);
  } catch (err) {
    console.error(`[${space.id}] grok failed:`, err);
    await space.send("ugh my phone is being weird, say that again?");
  }
}

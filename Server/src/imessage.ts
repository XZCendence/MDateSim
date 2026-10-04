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
  const p = (PERSONAS as Record<string, Persona | undefined>)[m[1]!.toLowerCase()];
  if (!p) return `no date named ${m[1]}. options: ${Object.keys(PERSONAS).join(", ")}`;
  fallbackHistory.delete(spaceId);
  const session = await claimSession(spaceId, p.intro);
  return session ? `(now texting with ${p.name})` : `(no lobby session waiting for ${p.name}, chatting unlinked)`;
}

function buildSystem(persona: Persona, affection: number, demand: string | undefined, demandMet: boolean, phase = "texting"): string {
  let s = `${persona.system}\n\nYour current affection for the player is ${affection} on a scale of -100 to 100. Let it color your tone.`;
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

const DEMAND_TAG = /\s*\[demand:([a-z_]+)\]\s*$/i;

/** Pull a trailing [demand:x] tag off the reply. Returns the clean text and the demand, if any. */
function splitDemand(reply: string): { text: string; demand?: string } {
  const m = DEMAND_TAG.exec(reply);
  if (!m) return { text: reply };
  return { text: reply.replace(DEMAND_TAG, "").trim(), demand: m[1]!.toLowerCase() };
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
        content: `[The camera just saw the player do the "${event.gesture}" you asked for. React in one or two texts. You may end with a new demand tag if you want more.]`,
      },
    ]);
    const { text, demand: next } = splitDemand(raw);
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

  const session = sessionForSpace(space.id) ?? (await claimSession(space.id, text));
  const persona = session ? personaById(session.dateId) : (personaFromIntro(text) ?? DEFAULT_PERSONA);

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
    const { text: replyText, demand: newDemand } = splitDemand(reply);
    if (!replyText) continue;
    await space.send(replyText);
    if (session) {
      await db.reducers.logMessage({ player: session.player, role: "assistant", text: replyText });
      if (newDemand && !demand) {
        db.reducers.setDemandFor({ player: session.player, demand: newDemand }).catch((err) =>
          console.warn(`[${space.id}] setDemandFor(${newDemand}) rejected:`, String(err)),
        );
      }
    } else {
      fallbackHistory.get(space.id)?.push({ role: "assistant", content: replyText });
    }
    console.log(`[${space.id}] ${persona.name}${session ? "" : " (unlinked)"}: ${replyText}${newDemand ? `  [demand:${newDemand}]` : ""}`);
  } catch (err) {
    console.error(`[${space.id}] grok failed:`, err);
    await space.send("ugh my phone is being weird, say that again?");
  }
}

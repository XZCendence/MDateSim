/**
 * The IRL date director. While a player's date_state.phase is "irl", the date drives:
 * she notices you arrive, tells you to look at her, talks, makes demands at good (or bad)
 * moments, nags when you ignore them, gives up, and reacts when the Kinect sees you comply.
 *
 * Inputs : presence + gesture_event rows (from Irl/date_runner.py), and what the player says
 *          on the date screen (POST /api/say text, POST /api/listen audio).
 * Outputs: assistant rows in `message` (the date screen shows them as subtitles and speaks
 *          them via /api/tts), affection changes, and date_state.demand.
 * Nothing here texts the player; iMessage stays the between-dates channel.
 */
import type { Identity } from "spacetimedb";
import type { DbConnection } from "./module_bindings/index";
import { chat, type ChatMessage } from "./grok";
import { DEFAULT_PERSONA, PERSONAS, type Persona } from "./personas";
import { routes } from "./registerUser";
import { formatDelta, inferDemand, splitReply } from "./reply";
import { transcribe } from "./voice";

// Jumping jacks are parked for the demo (detection was unreliable); the detector still exists in Irl/.
const IRL_DEMANDS = ["look", "kneel", "beg", "bow", "dance", "heart", "blow_kiss", "kiss"] as const;
const DEMAND_HINTS: Record<string, string> = {
  look: "face you and hold eye contact",
  kneel: "get on their knees",
  beg: "kneel with hands clasped, begging",
  bow: "bow deeply from the waist",
  jacks: "five straight-arm jumping jacks",
  dance: "dance for a few seconds",
  heart: "heart shape with hands over the head",
  blow_kiss: "blow a kiss",
  kiss: "lean right into the camera for a kiss",
};

// Spoken lines must land in about a second. The reasoning models take 10-35 s per reply, which is
// fine for texting and useless for a live date, so the director uses the fast one.
const IRL_MODEL = process.env.XAI_IRL_MODEL ?? "grok-4.20-0309-non-reasoning";
const TICK_MS = 1000;
const PRESENCE_FRESH_MS = 6000;
const NAG_EVERY_MS = 10_000;
const MAX_NAGS = 2;
const GIVE_UP_MS = 38_000;
const ABANDONED_MS = 60_000; // out of the camera's view this long = they left; end the date
const HISTORY_LIMIT = 24;

interface DateRun {
  enteredAt: number;
  greeted: boolean;
  saidWaiting: boolean;
  saidLeft: boolean;
  outOfViewSince?: number;
  busy: boolean;
  quietUntil: number; // she is still speaking the last line until then
  nextBeatAt: number;
  demand?: string;
  demandSince: number;
  nags: number;
  chatBeats: number; // lines of plain conversation since the last demand was resolved
  needBeats: number; // how many of those she wants before asking for the next thing (1 or 2)
  heard: string[];
  did: string[];
}

const personaById = (id: string): Persona => (PERSONAS as Record<string, Persona>)[id] ?? DEFAULT_PERSONA;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function startDirector(db: DbConnection): void {
  const runs = new Map<string, DateRun>();

  const findPlayer = (hex: string): Identity | undefined => {
    const want = hex.toLowerCase().replace(/^0x/, "");
    for (const s of db.db.gameSession.iter()) {
      if (s.player.toHexString().toLowerCase().replace(/^0x/, "") === want) return s.player;
    }
    return undefined;
  };

  function history(player: Identity): ChatMessage[] {
    return [...db.db.message.player.filter(player)]
      .sort((a, b) => Number(a.sentAt.microsSinceUnixEpoch - b.sentAt.microsSinceUnixEpoch))
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role as ChatMessage["role"], content: m.text }));
  }

  // Freshness is measured from when WE received the heartbeat, not the row's server timestamp:
  // this machine's clock and the database's can disagree by many seconds.
  const presenceSeenAt = new Map<string, number>();
  db.db.presence.onInsert((_ctx, row) => void presenceSeenAt.set(row.player.toHexString(), Date.now()));
  db.db.presence.onUpdate((_ctx, _old, row) => void presenceSeenAt.set(row.player.toHexString(), Date.now()));

  function presenceOf(player: Identity): { known: boolean; inView: boolean; facing: boolean } {
    const p = db.db.presence.player.find(player);
    const seenAt = presenceSeenAt.get(player.toHexString());
    if (!p || seenAt === undefined || Date.now() - seenAt > PRESENCE_FRESH_MS) {
      return { known: false, inView: false, facing: false };
    }
    return { known: true, inView: p.inView, facing: p.facing };
  }

  /** Has there been enough plain conversation since the last demand to ask for another? */
  const readyToAsk = (run: DateRun) => !run.demand && run.chatBeats >= run.needBeats;
  const newRound = (run: DateRun) => {
    run.chatBeats = 0;
    run.needBeats = Math.random() < 0.5 ? 1 : 2;
  };

  function system(persona: Persona, player: Identity, run: DateRun, allowDemand: boolean): string {
    const affection = db.db.affection.player.find(player)?.value ?? 0;
    const pres = presenceOf(player);
    const sees = !pres.known
      ? "The camera feed is down, so you can't see them right now."
      : !pres.inView
        ? "You can't see them; they are out of frame."
        : pres.facing
          ? "You can see them. They are facing you."
          : "You can see them, but they are looking away from you.";
    return `${persona.system}

## RIGHT NOW: you are on the IRL date
Ignore the texting rules above. You are in the room, speaking OUT LOUD to the player, who is standing
in front of you. Your words are voiced and shown as subtitles, so: natural spoken sentences, ONE or TWO
short ones (under 25 words total), no emoji, no asterisks or stage directions, proper capitalization.
Short lines keep the date moving; long speeches kill it.
You can SEE them through the camera. ${sees}
You lead this date and you do not wait to be spoken to, but it is a date, not a drill. The rhythm:
one or two normal or funny exchanges (banter, a question about them, a story, a complaint, a roast),
THEN you ask them to do one thing for you, you react to it, and you go back to talking.
${allowDemand ? "RIGHT NOW you may ask them to do something if this line calls for it." : "RIGHT NOW: just talk. Do NOT ask them to do anything physical in this line, and do NOT use a demand tag."}
To make them do something, say it in your own words AND end with one tag, written EXACTLY like
[demand:kneel] (the word demand, a colon, the name). Without the tag the camera does not check. Allowed tags:
${IRL_DEMANDS.map((d) => `[demand:${d}] (${DEMAND_HINTS[d]})`).join(", ")}.
At most one demand tag per line, and never while another demand is still open.
Never ask for jumping jacks, squats, push-ups or any exercise not in that list; the camera cannot judge them.${run.demand ? `\nOpen demand: "${run.demand}" (${DEMAND_HINTS[run.demand] ?? run.demand}). They have not done it yet.` : "\nNo demand is open."}
Your affection for them is ${affection} (-100 to 100); let it color your tone.
Lines in [square brackets] from the user are stage directions describing what just happened. Never
read them aloud or mention the camera system. End every line with an affection tag as usual.`;
  }

  /** Generate, log, and apply one spoken line. */
  async function say(player: Identity, run: DateRun, direction: string, heard?: string, mayDemand = true): Promise<void> {
    const allowDemand = mayDemand && !run.demand;
    const session = db.db.gameSession.player.find(player);
    if (!session) return;
    const persona = personaById(session.dateId);
    run.busy = true;
    try {
      // Read history before logging what they said: the subscription cache lags the reducer.
      const past = history(player);
      if (heard) await db.reducers.logMessage({ player, role: "user", text: heard });
      const raw = await chat(
        [
          { role: "system", content: system(persona, player, run, allowDemand) },
          ...past,
          ...(heard ? [{ role: "user" as const, content: heard }] : []),
          { role: "user", content: `[${direction}]` },
        ],
        { model: IRL_MODEL, temperature: 0.95, maxTokens: 200 },
      );
      const { text: rawText, demand: tagged, affectionDelta } = splitReply(raw);
      // If they clearly ordered something but forgot the tag, still arm the camera for it.
      const demand = allowDemand ? (tagged ?? inferDemand(rawText)) : undefined;
      const text = rawText.replace(/\s*\n+\s*/g, " ").trim(); // one subtitle, one utterance
      if (!text) return;
      // The date may have ended while Grok was thinking (tab closed); don't speak into the void.
      if (db.db.dateState.player.find(player)?.phase !== "irl") return;
      await db.reducers.logMessage({ player, role: "assistant", text });
      if (affectionDelta !== 0) {
        db.reducers.adjustAffection({ player, delta: affectionDelta }).catch(() => {});
      }
      const now = Date.now();
      run.quietUntil = now + 1200 + text.length * 65; // rough speaking time
      run.nextBeatAt = run.quietUntil + rand(4000, 7000);
      if (demand && !run.demand && (IRL_DEMANDS as readonly string[]).includes(demand)) {
        await db.reducers.setDemandFor({ player, demand });
        run.demand = demand;
        run.demandSince = run.quietUntil; // the clock starts when she finishes asking
        run.nags = 0;
      } else if (!run.demand) {
        run.chatBeats += 1; // a line of plain conversation
      }
      console.log(`[date ${player.toHexString().slice(0, 10)}] ${persona.name}: ${text}${demand ? `  [demand:${demand}]` : ""}  [affection:${formatDelta(affectionDelta)}]`);
    } catch (err) {
      console.error("[date] line failed:", err);
      run.nextBeatAt = Date.now() + 4000;
    } finally {
      run.busy = false;
    }
  }

  async function step(player: Identity, run: DateRun): Promise<void> {
    const now = Date.now();
    if (run.busy) return;
    const pres = presenceOf(player);
    const state = db.db.dateState.player.find(player);
    // Keep our view of the open demand in sync with the DB (the Kinect may have closed it).
    if (run.demand && (!state?.demand || state.demandMet)) run.demand = undefined;

    // What the player says cuts in immediately; everything else waits for her to finish speaking.
    const heard = run.heard.shift();
    if (heard) {
      const ask = readyToAsk(run);
      return say(player, run, `They said that to you out loud, in person. Answer like a person would: react, tease, ask something back.${ask ? " If it fits, you can then ask them to do something for you (with its tag)." : ""}`, heard, ask);
    }
    if (now < run.quietUntil) return;

    const did = run.did.shift();
    if (did) {
      // A reaction names the gesture they just did ("good jumping jacks"), so only a real tag counts here.
      return say(player, run, `You just watched them do it: ${did} (${DEMAND_HINTS[did] ?? did}). React to it in character, then keep the conversation going. Do not ask for anything else yet.`, undefined, false);
    }

    if (!run.greeted) {
      if (pres.known && pres.inView) {
        run.greeted = true;
        return say(player, run, "They just walked up and are standing in front of you. Greet them in character and make them look at you. End with [demand:look].");
      }
      if (!pres.known && now - run.enteredAt > 8000) {
        run.greeted = true;
        return say(player, run, "The date has started. Greet them in character. Do not use a demand tag yet.");
      }
      if (!run.saidWaiting && now - run.enteredAt > 7000) {
        run.saidWaiting = true;
        return say(player, run, "The date has started but they are not standing in front of you yet. Call them over, impatiently. No demand tag.");
      }
      return;
    }

    if (pres.known && !pres.inView) {
      run.outOfViewSince ??= now;
      if (now - run.outOfViewSince > ABANDONED_MS) {
        console.log(`[date ${player.toHexString().slice(0, 10)}] out of view for a minute, ending the date`);
        await db.reducers.endIrlDateFor({ player }).catch((err) => console.warn("endIrlDateFor:", String(err)));
        return;
      }
      if (!run.saidLeft && now - run.outOfViewSince > 4000) {
        run.saidLeft = true;
        return say(player, run, "They walked out of your sight in the middle of the date. React. No demand tag.");
      }
      return;
    }
    run.outOfViewSince = undefined;
    run.saidLeft = false;

    if (run.demand) {
      const waited = now - run.demandSince;
      if (waited > GIVE_UP_MS) {
        const gaveUpOn = run.demand;
        run.demand = undefined;
        newRound(run);
        await db.reducers.setDemandFor({ player, demand: "" }).catch(() => {});
        return say(player, run, `They never did what you asked (${gaveUpOn}). You have given up on it. You are hurt or disgusted; show it. Use a clearly negative affection tag. No demand tag.`, undefined, false);
      }
      if (run.nags < MAX_NAGS && waited > NAG_EVERY_MS * (run.nags + 1)) {
        run.nags += 1;
        return say(player, run, `They still have not done what you asked (${run.demand}: ${DEMAND_HINTS[run.demand] ?? ""}). Nag them, more insistent than last time. Do not add a demand tag.${pres.known && !pres.facing ? " They are not even looking at you." : ""}`);
      }
      return;
    }

    if (now >= run.nextBeatAt) {
      const looking = pres.known && !pres.facing ? " They are looking away from you, which you notice." : "";
      if (readyToAsk(run)) {
        return say(player, run, `You have chatted enough. Now ask them to do one thing for you, in your own words and for your own reasons, and end with its demand tag.${Math.random() < 0.35 ? " Spring it on them out of nowhere." : ""}${looking}`);
      }
      return say(player, run, `Keep the date going with ONE normal or funny thing: a question about them, an observation, a short story from your day, a complaint, a roast. No demand.${looking}`, undefined, false);
    }
  }

  setInterval(() => {
    const live = new Set<string>();
    for (const state of db.db.dateState.iter()) {
      if (state.phase !== "irl") continue;
      const hex = state.player.toHexString();
      live.add(hex);
      let run = runs.get(hex);
      if (!run) {
        const now = Date.now();
        run = { enteredAt: now, greeted: false, saidWaiting: false, saidLeft: false, busy: false, quietUntil: 0, nextBeatAt: now, demandSince: 0, nags: 0, chatBeats: 0, needBeats: 1, heard: [], did: [] };
        runs.set(hex, run);
        console.log(`[date ${hex.slice(0, 10)}] IRL date started`);
      }
      step(state.player, run).catch((err) => console.error("[date] step failed:", err));
    }
    for (const hex of [...runs.keys()]) {
      if (!live.has(hex)) {
        runs.delete(hex);
        console.log(`[date ${hex.slice(0, 10)}] IRL date ended`);
      }
    }
  }, TICK_MS);

  // The Kinect saw a gesture land.
  db.db.gestureEvent.onInsert((_ctx, event) => {
    if (!event.success) return;
    const run = runs.get(event.player.toHexString());
    if (!run) return;
    run.demand = undefined;
    newRound(run);
    run.did.push(event.gesture);
  });

  // What the player says on the date screen.
  const jsonRes = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  function hear(hex: string, text: string): Response {
    const player = findPlayer(hex);
    const run = player && runs.get(player.toHexString());
    if (!player || !run) return jsonRes(409, { error: "No IRL date in progress for that player" });
    run.heard.push(text.slice(0, 500));
    return jsonRes(200, { text });
  }

  routes.set("/api/say", async (req) => {
    const body = (await req.json().catch(() => null)) as { player?: string; text?: string } | null;
    if (!body?.player || !body.text?.trim()) return jsonRes(400, { error: "player and text are required" });
    return hear(body.player, body.text.trim());
  });

  routes.set("/api/listen", async (req, url) => {
    const hex = url.searchParams.get("player");
    if (!hex) return jsonRes(400, { error: "player is required" });
    const audio = new Uint8Array(await req.arrayBuffer());
    if (audio.length < 2000) return jsonRes(400, { error: "No audio" });
    try {
      const text = await transcribe(audio, req.headers.get("Content-Type") ?? "audio/webm");
      if (!text) return jsonRes(200, { text: "" });
      return hear(hex, text);
    } catch (err) {
      console.error("[listen]", err);
      return jsonRes(502, { error: "Could not transcribe" });
    }
  });

  console.log("[date] director running");
}

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import PoseView from "../components/PoseView";
import type { Mood } from "../data/dates";
import { useSession } from "../lib/session";
import { getIdentityHex, getMyRows, getSpacetime, subscribeSpacetime } from "../lib/spacetime";
import bgUrl from "../assets/characterselectbg.png";

/**
 * The IRL date, full screen on the laptop (visual-novel style).
 *
 * The date is driven server-side by Server/src/director.ts: it writes spoken lines into the
 * `message` table and demands into `date_state`. This page shows the character, types each
 * line out as a subtitle, speaks it through /api/tts, and shows what they want you to do.
 * You answer by doing it in front of the Kinect, typing, or holding the mic button.
 */

const DEMAND_LABEL: Record<string, string> = {
  look: "Look at {name}",
  kneel: "Get on your knees",
  beg: "Beg. Knees. Hands together.",
  bow: "Bow",
  jacks: "Five jumping jacks",
  dance: "Dance",
  heart: "Heart hands over your head",
  blow_kiss: "Blow a kiss",
  kiss: "Lean in for a kiss",
};

const TYPE_MS = 32; // fallback typing speed when there is no audio to pace against

export default function DateScreen() {
  const session = useSession();
  const navigate = useNavigate();
  const mine = useSyncExternalStore(subscribeSpacetime, getMyRows, getMyRows);

  const [entered, setEntered] = useState(false);
  const [line, setLine] = useState<{ id: bigint; text: string } | null>(null);
  const [shown, setShown] = useState(0); // typewriter position
  const [speaking, setSpeaking] = useState(false);
  const [youSaid, setYouSaid] = useState("");
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState(false); // a demand was just met

  const audio = useRef<HTMLAudioElement | null>(null);
  const lastSpoken = useRef<bigint>(-1n);
  const queue = useRef<{ id: bigint; text: string }[]>([]);
  const playing = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const typeMs = useRef(TYPE_MS); // per-character delay for the current line
  const dateId = session?.dateId;

  // ---- speaking: play queued lines one at a time, subtitle in step with the voice ----
  const playNext = useCallback(() => {
    if (playing.current) return;
    const next = queue.current.shift();
    if (!next || !dateId) return;
    playing.current = true;
    // The subtitle starts with the voice and is paced to finish with it, so you never read
    // the whole line before hearing it.
    const begin = (seconds?: number) => {
      const chars = Math.max(next.text.length, 1);
      typeMs.current = seconds ? Math.max(14, Math.min(110, (seconds * 1000 * 0.92) / chars)) : TYPE_MS;
      setLine(next);
      setShown(0);
      setSpeaking(true);
    };
    const done = () => {
      playing.current = false;
      setSpeaking(false);
      playNext();
    };
    const silent = () => {
      begin();
      window.setTimeout(done, 1200 + next.text.length * 60);
    };
    const el = audio.current;
    if (!el) return silent();
    fetch(`/api/tts?dateId=${encodeURIComponent(dateId)}&text=${encodeURIComponent(next.text)}`)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`tts ${res.status}`))))
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        let started = false;
        el.src = url;
        el.onplaying = () => {
          if (started) return;
          started = true;
          // MP3 blobs sometimes report no duration; ~16 kB per second is close enough.
          begin(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : blob.size / 16000);
        };
        el.onended = () => {
          URL.revokeObjectURL(url);
          done();
        };
        el.onerror = () => (started ? done() : silent());
        return el.play();
      })
      .catch((err) => {
        console.warn("[date] voice unavailable, subtitles only:", err);
        silent();
      });
  }, [dateId]);

  // New assistant rows since we walked in become spoken lines.
  useEffect(() => {
    if (!entered) return;
    for (const m of mine.messages) {
      if (m.id <= lastSpoken.current) continue;
      lastSpoken.current = m.id;
      if (m.role === "assistant") queue.current.push({ id: m.id, text: m.text });
      else setYouSaid(m.text);
    }
    playNext();
  }, [entered, mine.messages, playNext]);

  // Typewriter.
  useEffect(() => {
    if (!line || shown >= line.text.length) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), typeMs.current);
    return () => window.clearTimeout(t);
  }, [line, shown]);

  // A demand flipping to "met" gets a little celebration.
  const met = Boolean(mine.demand && mine.demandMet);
  useEffect(() => {
    if (!met) return;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 2500);
    return () => window.clearTimeout(t);
  }, [met]);

  // Leaving the page ends the date.
  useEffect(() => {
    return () => {
      getSpacetime()?.reducers.endIrlDate({}).catch(() => {});
    };
  }, []);

  function enter() {
    // Created inside the click so the browser lets us play audio from here on.
    audio.current = new Audio();
    lastSpoken.current = mine.messages.reduce((max, m) => (m.id > max ? m.id : max), -1n);
    getSpacetime()
      ?.reducers.beginIrlDate({})
      .catch((err: unknown) => console.error("[spacetime] beginIrlDate failed", err));
    setEntered(true);
  }

  function leave() {
    audio.current?.pause();
    navigate("/dates");
  }

  async function say(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const player = getIdentityHex();
    if (!text || !player) return;
    setDraft("");
    setYouSaid(text);
    await fetch("/api/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player, text }),
    }).catch((err) => console.error("[date] say failed", err));
  }

  async function startTalking() {
    if (recorder.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => chunks.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        const player = getIdentityHex();
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (!player || blob.size < 2000) return;
        const res = await fetch(`/api/listen?player=${encodeURIComponent(player)}`, {
          method: "POST",
          headers: { "Content-Type": blob.type },
          body: blob,
        }).catch(() => null);
        const body = (await res?.json().catch(() => null)) as { text?: string } | null;
        if (body?.text) setYouSaid(body.text);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      console.error("[date] microphone unavailable", err);
    }
  }

  function stopTalking() {
    setRecording(false);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  if (!session) {
    return (
      <div className="vn vn-gate">
        <div className="vn-gate-card">
          <h1>No date yet</h1>
          <p>Pick someone in the lobby first.</p>
          <Link to="/lobby" className="button">Go to lobby</Link>
        </div>
      </div>
    );
  }

  const date = session.character;
  const openDemand = mine.demand && !mine.demandMet ? mine.demand : undefined;
  const mood: Mood = flash
    ? "flustered"
    : speaking
      ? mine.affection <= -20
        ? "mad"
        : "talking"
      : openDemand
        ? "waiting"
        : mine.affection >= 60
          ? "love"
          : mine.affection >= 20
            ? "happy"
            : mine.affection <= -20
              ? "mad"
              : "idle";
  const sprite = date.sprites[mood] ?? date.sprites.idle ?? date.image;
  const hearts = Math.max(0, Math.min(100, (mine.affection + 100) / 2));

  return (
    <div className="vn" style={{ backgroundImage: `url(${bgUrl})`, ["--accent" as string]: date.accent }}>
      <div className="vn-shade" />

      <div className="vn-top">
        <div className="vn-affection" title={`Affection ${mine.affection}`}>
          <span>♥</span>
          <div><div style={{ width: `${hearts}%` }} /></div>
          <span className="vn-affection-num">{mine.affection}</span>
        </div>
        <button className="vn-leave" onClick={leave}>End date</button>
      </div>

      {sprite && (
        <img
          key={mood}
          src={sprite}
          alt={date.name}
          className={`vn-sprite${speaking ? " is-speaking" : ""}${flash ? " is-flash" : ""}`}
        />
      )}

      {entered && openDemand && (
        <div className="vn-demand">{(DEMAND_LABEL[openDemand] ?? openDemand).replace("{name}", date.name)}</div>
      )}
      {entered && flash && <div className="vn-demand is-met">Good.</div>}

      <div className="vn-pose">
        <PoseView width={300} height={225} />
      </div>

      {entered ? (
        <div className="vn-dialogue">
          <div className="vn-name">{date.name}</div>
          <p className="vn-text">
            {line ? line.text.slice(0, shown) : "…"}
            {line && shown < line.text.length && <span className="vn-caret">▍</span>}
          </p>
          {youSaid && <p className="vn-you">You: {youSaid}</p>}
          <form className="vn-reply" onSubmit={say}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Say something to ${date.name}…`}
            />
            <button type="submit">Say</button>
            <button
              type="button"
              className={recording ? "vn-mic is-on" : "vn-mic"}
              onPointerDown={startTalking}
              onPointerUp={stopTalking}
              onPointerLeave={stopTalking}
            >
              {recording ? "Listening…" : "Hold to talk"}
            </button>
          </form>
        </div>
      ) : (
        <div className="vn-gate">
          <div className="vn-gate-card">
            <h1>{date.name} is waiting</h1>
            <p>Stand where the camera can see you, turn your sound on, and walk in.</p>
            <button onClick={enter}>Enter the date</button>
            <p><Link to="/dates">Not yet</Link></p>
          </div>
        </div>
      )}
    </div>
  );
}

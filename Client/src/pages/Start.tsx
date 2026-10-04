import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, Navigate, useParams } from "react-router-dom";
import { findDate } from "../data/dates";
import { PLAYER_PHONE_KEY, readSavedPhone, registerSavedPhone, type Registration } from "../lib/phone";
import { smsLink } from "../lib/sms";
import AffectionDelta from "../components/AffectionDelta";
import { getMyRows, subscribeSpacetime } from "../lib/spacetime";
import bgUrl from "../assets/characterselectbg.png";

/**
 * The texting stage, shown on the laptop while the player texts from their phone.
 *   1. give your number  2. scan the QR and send the first text  3. the conversation mirrors here
 * There is no "start the date" button: when the date calls you over by text, date_state flips
 * to "irl" and Layout swaps this page for the date screen.
 */

function prettyPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export default function Start() {
  const { dateId } = useParams();
  const date = findDate(dateId);
  const mine = useSyncExternalStore(subscribeSpacetime, getMyRows, getMyRows);
  const [savedPhone, setSavedPhone] = useState(readSavedPhone);
  const [draft, setDraft] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!savedPhone) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    setRegistration(null);

    registerSavedPhone(savedPhone)
      .then((next) => {
        if (!controller.signal.aborted) setRegistration(next);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not register that number");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });

    return () => controller.abort();
  }, [savedPhone, attempt]);

  const chat = mine.messages;
  const lastId = chat.at(-1)?.id;
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastId]);

  if (!date) return <Navigate to="/lobby" replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    const phone = draft.trim();
    if (!phone) return;
    localStorage.setItem(PLAYER_PHONE_KEY, phone);
    setSavedPhone(phone);
    setAttempt((n) => n + 1);
  }

  function useDifferentNumber() {
    localStorage.removeItem(PLAYER_PHONE_KEY);
    setSavedPhone("");
    setDraft("");
    setRegistration(null);
    setError(null);
  }

  const href = registration ? smsLink(registration.assignedPhoneNumber, date.intro) : null;
  const chatting = chat.length > 0;
  const step = chatting ? 3 : !savedPhone || error ? 1 : 2;
  const first = date.name.split(" ")[0];
  const hearts = Math.max(0, Math.min(100, (mine.affection + 100) / 2));

  return (
    <div className="start" style={{ backgroundImage: `url(${bgUrl})`, ["--accent" as string]: date.accent }}>
      <div className="start-shade" />
      {date.image && <img src={date.image} alt={date.name} className="start-sprite" />}

      <div className="start-hud" title={`Affection ${mine.affection}`}>
        <span className="start-hud-label">Affection</span>
        <div className="start-affection">
          <span aria-hidden>♥</span>
          <div className="start-affection-track">
            <div className="start-affection-fill" style={{ width: `${hearts}%` }} />
          </div>
          <span className="start-affection-num">{mine.affection}</span>
        </div>
        <AffectionDelta affection={mine.affection} />
      </div>

      <div className="start-card">
        <Link to="/lobby" className="start-back">← Pick someone else</Link>
        <h1>{date.name}</h1>
        <ol className="start-steps" aria-label="Progress">
          <li className={step > 1 ? "done" : step === 1 ? "now" : ""}>Your number</li>
          <li className={step > 2 ? "done" : step === 2 ? "now" : ""}>Send a text</li>
          <li className={step === 3 ? "now" : ""}>Get asked out</li>
        </ol>

        {step === 1 && (
          <>
            <p className="start-lead">{first} texts over iMessage. What number are you texting from?</p>
            <form className="start-form" onSubmit={submit}>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                name="phoneNumber"
                placeholder="(555) 123-4567"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                required
              />
              <button type="submit">Continue</button>
            </form>
            {error && <p className="start-error" role="alert">{error}</p>}
          </>
        )}

        {step === 2 && (
          <>
            {pending || !href || !registration ? (
              <p className="start-lead">Getting {first}'s number for you…</p>
            ) : (
              <>
                <p className="start-lead">Scan with your phone camera and hit send.</p>
                <a href={href} className="start-qr" aria-label={`Text ${date.name}`}>
                  <QRCodeSVG value={href} size={220} marginSize={2} fgColor="#1b1024" bgColor="#ffffff" />
                </a>
                <p className="start-number">
                  or text <strong>{prettyPhone(registration.assignedPhoneNumber)}</strong>
                </p>
                <p className="start-wait"><span className="start-dot" /> Waiting for your first text…</p>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="start-chat" aria-live="polite">
              {chat.map((m) => (
                <div key={String(m.id)} className={m.role === "user" ? "bubble me" : "bubble them"}>
                  {m.text}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <p className="start-wait">
              <span className="start-dot" /> Keep texting. When {first} wants to see you, the date starts right here.
            </p>
          </>
        )}

        {savedPhone && !pending && step !== 1 && (
          <button type="button" className="start-ghost" onClick={useDifferentNumber}>
            Not {prettyPhone(registration?.phoneNumber ?? savedPhone)}? Use a different number
          </button>
        )}
      </div>
    </div>
  );
}

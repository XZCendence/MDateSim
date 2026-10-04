import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, Navigate, useParams } from "react-router-dom";
import { findDate } from "../data/dates";
import { PLAYER_PHONE_KEY, readSavedPhone, registerSavedPhone, type Registration } from "../lib/phone";
import { smsLink } from "../lib/sms";

export default function Start() {
  const { dateId } = useParams();
  const date = findDate(dateId);
  const [savedPhone, setSavedPhone] = useState(readSavedPhone);
  const [draft, setDraft] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  return (
    <section className="center">
      <h1>Text {date.name} to start</h1>
      <p className="muted">
        Enter the phone you'll text from. We register it so {date.name} can reply, then the QR opens
        Messages with the line and a first text ready to go.
      </p>

      {!savedPhone && (
        <form className="row" onSubmit={submit}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            name="phoneNumber"
            placeholder="Your phone number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            required
          />
          <button type="submit">Continue</button>
        </form>
      )}

      {savedPhone && pending && <p className="muted">Registering your number…</p>}

      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}

      {href && registration && (
        <>
          <a href={href} className="qr" aria-label={`Text ${date.name}`}>
            <QRCodeSVG value={href} size={240} marginSize={2} fgColor={date.accent} bgColor="#ffffff" />
          </a>
          <p className="small">
            Or text <strong>{registration.assignedPhoneNumber}</strong> directly.
          </p>
          <p className="muted small">
            This number is registered, so {date.name} can text you back. Your first text also unlocks their
            ability to message you.
          </p>
        </>
      )}

      {savedPhone && !pending && (
        <p>
          <button type="button" className="ghost" onClick={useDifferentNumber}>
            Use a different number
          </button>
        </p>
      )}

      <Link to="/dates" className="button">
        I've sent it, plan a date
      </Link>
    </section>
  );
}

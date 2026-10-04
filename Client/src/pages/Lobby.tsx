import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DateCard from "../components/DateCard";
import { DATES, type DateProfile } from "../data/dates";
import { readSavedPhone, resetPhotonConversation } from "../lib/phone";
import { useSession } from "../lib/session";
import { getSpacetime } from "../lib/spacetime";
import bgUrl from "../assets/characterselectbg.png";
import previewUrl from "../assets/preview.png";

export default function Lobby() {
  const navigate = useNavigate();
  const session = useSession();
  const [restarting, setRestarting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function continueDate() {
    if (!session || pending) return;
    navigate(`/start/${session.dateId}`);
  }

  async function startOverWith(date: DateProfile) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const phone = readSavedPhone();
      if (phone) await resetPhotonConversation(phone);
      await getSpacetime()?.reducers.pickDate({ dateId: date.id });
      navigate(`/start/${date.id}`);
    } catch (err: unknown) {
      console.error("[lobby] start over failed", err);
      setError(err instanceof Error ? err.message : "Could not start over");
    } finally {
      setPending(false);
    }
  }

  function pick(date: DateProfile) {
    if (pending) return;
    if (!session) {
      getSpacetime()?.reducers.pickDate({ dateId: date.id }).catch((err: unknown) => {
        console.error("[spacetime] pickDate failed", err);
      });
      navigate(`/start/${date.id}`);
      return;
    }
    if (restarting || session.dateId !== date.id) {
      void startOverWith(date);
      return;
    }
    continueDate();
  }

  return (
    <div className="lobby-bg" style={{ backgroundImage: `url(${bgUrl})` }}>
      <div className="lobby-header">
        <img src={previewUrl} alt="Choose your date" className="lobby-title" />
      </div>
      {session && (
        <div className="lobby-actions">
          {restarting ? (
            <>
              <p className="small">Pick who to start over with.</p>
              <button type="button" className="ghost" disabled={pending} onClick={() => setRestarting(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <p className="small">
                You're dating <strong>{session.character.name}</strong>
              </p>
              <button type="button" disabled={pending} onClick={continueDate}>
                Continue
              </button>
              <button type="button" className="ghost" disabled={pending} onClick={() => setRestarting(true)}>
                Start over
              </button>
            </>
          )}
          {pending && <p className="muted small">Starting over…</p>}
          {error && (
            <p className="muted small" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="lobby-chars">
        {DATES.map((d) => (
          <DateCard
            key={d.id}
            date={d}
            onPick={pick}
            selected={session?.dateId === d.id}
            buttonLabel={
              !session
                ? undefined
                : restarting || session.dateId !== d.id
                  ? `Start over with ${d.name}`
                  : `Continue with ${d.name}`
            }
          />
        ))}
      </div>
    </div>
  );
}

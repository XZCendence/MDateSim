import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { findDate } from "../data/dates";
import { loadSession, saveSession, type IrlDate, type Session } from "../lib/session";

const ACTIVITIES = ["Coffee", "Dinner", "Arcade", "Park walk", "Movie night"];

export default function Dates() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [when, setWhen] = useState("");
  const [activity, setActivity] = useState(ACTIVITIES[0]);

  if (!session) {
    return (
      <section className="center">
        <h1>No date yet</h1>
        <p className="muted">Head to the lobby and ask someone out first.</p>
        <Link to="/lobby" className="button">Go to lobby</Link>
      </section>
    );
  }

  const date = findDate(session.dateId);

  function schedule(e: FormEvent) {
    e.preventDefault();
    if (!when || !session) return;
    const next: Session = {
      ...session,
      irlDates: [...session.irlDates, { id: crypto.randomUUID(), when, activity }],
    };
    saveSession(next);
    setSession(next);
    setWhen("");
    // TODO: call a SpacetimeDB reducer here so the Kinect side (Irl/) and the
    // iMessage loop (Server/) both see the scheduled date.
  }

  function cancel(id: string) {
    if (!session) return;
    const next = { ...session, irlDates: session.irlDates.filter((d) => d.id !== id) };
    saveSession(next);
    setSession(next);
  }

  return (
    <section>
      <h1>IRL dates with {date?.name ?? "???"}</h1>
      <p className="muted">
        When the date starts, she takes over. Stand in front of the Kinect and do what she says.
      </p>

      <form className="row" onSubmit={schedule}>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          required
        />
        <select value={activity} onChange={(e) => setActivity(e.target.value)}>
          {ACTIVITIES.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <button type="submit">Schedule</button>
      </form>

      <ul className="list">
        {session.irlDates.length === 0 && <li className="muted">Nothing planned yet.</li>}
        {session.irlDates
          .slice()
          .sort((a, b) => a.when.localeCompare(b.when))
          .map((d: IrlDate) => (
            <li key={d.id}>
              <span>
                <strong>{d.activity}</strong> · {new Date(d.when).toLocaleString()}
              </span>
              <button className="ghost" onClick={() => cancel(d.id)}>
                Cancel
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}

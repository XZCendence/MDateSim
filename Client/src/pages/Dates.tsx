import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Timestamp } from "spacetimedb";
import { useSession } from "../lib/session";
import { getMyRows, getSpacetime, subscribeSpacetime } from "../lib/spacetime";

const ACTIVITIES = ["Coffee", "Dinner", "Arcade", "Park walk", "Movie night"];

export default function Dates() {
  const session = useSession();
  const navigate = useNavigate();
  const mine = useSyncExternalStore(subscribeSpacetime, getMyRows, getMyRows);
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

  const date = session.character;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!when) return;
    await getSpacetime()?.reducers.scheduleIrlDate({
      scheduledFor: Timestamp.fromDate(new Date(when)),
      activity,
    });
    setWhen("");
  }

  /** Walk into the date: the full-screen page takes over and the date starts watching. */
  function enter(id?: bigint) {
    if (id !== undefined) {
      getSpacetime()?.reducers.setIrlDateStatus({ id, status: "active" }).catch(() => {});
    }
    navigate("/date");
  }

  function cancel(id: bigint) {
    getSpacetime()?.reducers.setIrlDateStatus({ id, status: "cancelled" }).catch((err: unknown) => {
      console.error("[spacetime] setIrlDateStatus failed", err);
    });
  }

  const upcoming = mine.irlDates
    .filter((d) => d.status !== "cancelled")
    .sort((a, b) => Number(a.scheduledFor.microsSinceUnixEpoch - b.scheduledFor.microsSinceUnixEpoch));

  return (
    <section>
      <h1>IRL dates with {date.name}</h1>
      <p className="muted">
        When the date starts, {date.name} takes over. Stand in front of the Kinect and do what you're told.
      </p>
      <p className="row">
        <button onClick={() => enter()}>
          {mine.phase === "irl" ? "Back to the date" : `Enter the date with ${date.name}`}
        </button>
      </p>
      <p className="small">
        Affection: <strong>{mine.affection}</strong>
        {mine.demand && (
          <>
            {" · "}{date.name} wants you to <strong>{mine.demand}</strong>
            {mine.demandMet ? " (done)" : " (waiting)"}
          </>
        )}
      </p>

      <form className="row" onSubmit={submit}>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        <select value={activity} onChange={(e) => setActivity(e.target.value)}>
          {ACTIVITIES.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <button type="submit">Schedule</button>
      </form>

      <ul className="list">
        {upcoming.length === 0 && <li className="muted">Nothing planned yet.</li>}
        {upcoming.map((d) => (
          <li key={String(d.id)}>
            <span>
              <strong>{d.activity}</strong> · {d.scheduledFor.toDate().toLocaleString()}
              {d.status !== "scheduled" && <span className="muted"> · {d.status}</span>}
            </span>
            {d.status === "scheduled" && (
              <span>
                <button onClick={() => enter(d.id)} style={{ margin: 0 }}>
                  {d.scheduledFor.toDate().getTime() <= Date.now() ? "It's time. Enter" : "Enter early"}
                </button>
                <button className="ghost" onClick={() => cancel(d.id)}>
                  Cancel
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

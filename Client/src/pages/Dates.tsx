import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Timestamp } from "spacetimedb";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { reducers, tables } from "@bindings/index";
import { useSession } from "../lib/session";

const ACTIVITIES = ["Coffee", "Dinner", "Arcade", "Park walk", "Movie night"];

export default function Dates() {
  const session = useSession();
  const { identity } = useSpacetimeDB();
  const [when, setWhen] = useState("");
  const [activity, setActivity] = useState(ACTIVITIES[0]);

  // Subscribe to whole tables and filter by our identity client-side: the
  // identity is undefined until the connection is up, and hooks can't be conditional.
  const mine = <T extends { player: { isEqual(o: unknown): boolean } }>(rows: readonly T[]) =>
    identity ? rows.filter((r) => r.player.isEqual(identity)) : [];
  const [allIrlDates, ready] = useTable(tables.irlDate);
  const [allAffection] = useTable(tables.affection);
  const [allDateStates] = useTable(tables.dateState);
  const irlDates = mine(allIrlDates);
  const affection = mine(allAffection);
  const dateStates = mine(allDateStates);
  const schedule = useReducer(reducers.scheduleIrlDate);
  const setStatus = useReducer(reducers.setIrlDateStatus);

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
  const state = dateStates[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!when) return;
    await schedule({ scheduledFor: Timestamp.fromDate(new Date(when)), activity });
    setWhen("");
  }

  const upcoming = [...irlDates]
    .filter((d) => d.status !== "cancelled")
    .sort((a, b) => Number(a.scheduledFor.microsSinceUnixEpoch - b.scheduledFor.microsSinceUnixEpoch));

  return (
    <section>
      <h1>IRL dates with {date.name}</h1>
      <p className="muted">
        When the date starts, she takes over. Stand in front of the Kinect and do what she says.
      </p>
      <p className="small">
        Affection: <strong>{affection[0]?.value ?? 0}</strong>
        {state?.demand && (
          <>
            {" · "}She wants you to <strong>{state.demand}</strong>
            {state.demandMet ? " (done)" : " (waiting)"}
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
        {ready && upcoming.length === 0 && <li className="muted">Nothing planned yet.</li>}
        {upcoming.map((d) => (
          <li key={String(d.id)}>
            <span>
              <strong>{d.activity}</strong> · {d.scheduledFor.toDate().toLocaleString()}
              {d.status !== "scheduled" && <span className="muted"> · {d.status}</span>}
            </span>
            {d.status === "scheduled" && (
              <button className="ghost" onClick={() => setStatus({ id: d.id, status: "cancelled" })}>
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

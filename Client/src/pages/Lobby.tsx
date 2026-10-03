import { useNavigate } from "react-router-dom";
import DateCard from "../components/DateCard";
import { DATES, type DateProfile } from "../data/dates";
import { startSession, useSession } from "../lib/session";

export default function Lobby() {
  const navigate = useNavigate();
  const session = useSession();

  function pick(date: DateProfile) {
    startSession(date.id);
    navigate(`/start/${date.id}`);
  }

  return (
    <section>
      <h1>
        {session ? `You're dating ${session.character.name}` : "Pick your date"}
      </h1>
      <p className="muted">
        {session
          ? "Continue with your date or choose someone new."
          : "Choose carefully. They'll remember."}
      </p>
      <div className="grid">
        {DATES.map((d) => (
          <DateCard
            key={d.id}
            date={d}
            onPick={pick}
            selected={session?.dateId === d.id}
          />
        ))}
      </div>
    </section>
  );
}

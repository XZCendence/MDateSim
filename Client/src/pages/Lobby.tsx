import { useNavigate } from "react-router-dom";
import DateCard from "../components/DateCard";
import { DATES, type DateProfile } from "../data/dates";
import { startSession } from "../lib/session";

export default function Lobby() {
  const navigate = useNavigate();

  function pick(date: DateProfile) {
    startSession(date.id);
    navigate(`/start/${date.id}`);
  }

  return (
    <section>
      <h1>Pick your date</h1>
      <p className="muted">Choose carefully. She'll remember.</p>
      <div className="grid">
        {DATES.map((d) => (
          <DateCard key={d.id} date={d} onPick={pick} />
        ))}
      </div>
    </section>
  );
}

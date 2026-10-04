import { useNavigate } from "react-router-dom";
import DateCard from "../components/DateCard";
import { DATES, type DateProfile } from "../data/dates";
import { useSession } from "../lib/session";
import { getSpacetime } from "../lib/spacetime";
import bgUrl from "../assets/characterselectbg.png";
import { useHeartWipe } from "../components/HeartWipe";

export default function Lobby() {
  const navigate = useNavigate();
  const session = useSession();
  const wipe = useHeartWipe();

  function pick(date: DateProfile) {
    getSpacetime()?.reducers.pickDate({ dateId: date.id }).catch((err: unknown) => {
      console.error("[spacetime] pickDate failed", err);
    });
    wipe(() => navigate(`/start/${date.id}`));
  }

  return (
    <div className="lobby-bg" style={{ backgroundImage: `url(${bgUrl})` }}>
      <div className="lobby-header">
        <h1 className="lobby-heading">Choose your date</h1>
      </div>
      <div className="lobby-chars">
        {DATES.map((d) => (
          <DateCard key={d.id} date={d} onPick={pick} selected={session?.dateId === d.id} />
        ))}
      </div>
    </div>
  );
}

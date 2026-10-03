import type { DateProfile } from "../data/dates";

interface Props {
  date: DateProfile;
  onPick: (date: DateProfile) => void;
}

export default function DateCard({ date, onPick }: Props) {
  return (
    <article className="card" style={{ "--accent": date.accent } as React.CSSProperties}>
      <div className="avatar" aria-hidden>
        {date.name[0]}
      </div>
      <h2>
        {date.name} <span className="muted">{date.age}</span>
      </h2>
      <p className="tagline">{date.tagline}</p>
      <p>{date.bio}</p>
      <p className="muted small">IRL: {date.irlStyle}</p>
      <button onClick={() => onPick(date)}>Ask her out</button>
    </article>
  );
}

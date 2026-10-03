import type { DateProfile } from "../data/dates";

interface Props {
  date: DateProfile;
  onPick: (date: DateProfile) => void;
}

export default function DateCard({ date, onPick }: Props) {
  return (
    <div className="date-card" style={{ "--accent": date.accent } as React.CSSProperties}>
    <article className="card">
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
    <div className="date-picture">
      {date.image ? (
        <img src={date.image} alt={`${date.name} standing in her idle pose`} />
      ) : (
        <div className="date-picture-placeholder" role="img" aria-label={`${date.name} picture placeholder`}>
          <svg viewBox="0 0 240 300" aria-hidden="true">
            <circle cx="120" cy="90" r="42" />
            <path d="M40 280v-45a80 80 0 0 1 160 0v45Z" />
          </svg>
          <span>{date.name}</span>
        </div>
      )}
    </div>
    </div>
  );
}

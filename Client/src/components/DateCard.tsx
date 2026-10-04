import { useState } from "react";
import type { CSSProperties } from "react";
import type { DateProfile } from "../data/dates";

interface Props {
  date: DateProfile;
  onPick: (date: DateProfile) => void;
  selected?: boolean;
}

export default function DateCard({ date, onPick, selected = false }: Props) {
  const [hovered, setHovered] = useState(false);
  const src = hovered && date.hoverImage ? date.hoverImage : date.image;

  return (
    <div
      className={`date-char${selected ? " is-selected" : ""}`}
      style={{ "--accent": date.accent } as CSSProperties}
    >
      <div className="date-picture">
        {src ? (
          <img src={src} alt={date.name} />
        ) : (
          <div className="date-picture-placeholder" role="img" aria-label={`${date.name} placeholder`}>
            <svg viewBox="0 0 240 300" aria-hidden="true">
              <circle cx="120" cy="90" r="42" />
              <path d="M40 280v-45a80 80 0 0 1 160 0v45Z" />
            </svg>
            <span>{date.name}</span>
          </div>
        )}
      </div>
      <div
        className="date-hitzone"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onPick(date)}
      />
      <div className="char-tooltip">
        <h2>{date.name}</h2>
        <p>{date.bio}</p>
      </div>
    </div>
  );
}

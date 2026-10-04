import { useState } from "react";
import type { CSSProperties } from "react";
import type { DateProfile } from "../data/dates";

interface Props {
  date: DateProfile;
  onPick: (date: DateProfile) => void;
  selected?: boolean;
}

export default function DateCard({ date, onPick, selected = false }: Props) {
  // Dev: open /lobby#hover to see the tooltips without a mouse.
  const [hovered, setHovered] = useState(() => import.meta.env.DEV && window.location.hash === "#hover");
  const src = hovered && date.hoverImage ? date.hoverImage : date.image;

  return (
    <div
      className={`date-char${selected ? " is-selected" : ""}${hovered ? " is-hovered" : ""}`}
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
        role="button"
        tabIndex={0}
        aria-label={`Ask ${date.name} out`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => onPick(date)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick(date);
          }
        }}
      />
      <div className="char-tooltip" role="tooltip">
        <h2>{date.name}</h2>
        <p>{date.bio}</p>
        <span className="char-cta">{selected ? "♥ Keep dating" : "♥ Ask out"}</span>
      </div>
    </div>
  );
}

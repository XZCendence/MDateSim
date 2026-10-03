import type { CSSProperties } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useSession } from "../lib/session";

export default function Layout() {
  const session = useSession();
  const character = session?.character;
  return (
    <div className="shell" style={character ? { "--accent": character.accent } as CSSProperties : undefined}>
      <header className="topbar">
        <NavLink to="/lobby" className="brand">
          MDateSim
        </NavLink>
        <nav>
          <NavLink to="/lobby">Lobby</NavLink>
          <NavLink to="/dates">IRL Dates</NavLink>
        </nav>
      </header>
      {character && (
        <aside className="selected-date" aria-label="Your selected date">
          <div className="selected-date-portrait">
            {character.image ? <img src={character.image} alt={character.name} /> : <span>{character.name[0]}</span>}
          </div>
          <div className="selected-date-copy">
            <p className="small muted">Your date</p>
            <h2>{character.name}</h2>
            <p className="tagline">{character.tagline}</p>
          </div>
          <Link to={`/start/${character.id}`} className="button">Text {character.name}</Link>
        </aside>
      )}
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

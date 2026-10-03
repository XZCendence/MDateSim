import { NavLink, Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/lobby" className="brand">
          MDateSim
        </NavLink>
        <nav>
          <NavLink to="/lobby">Lobby</NavLink>
          <NavLink to="/dates">IRL Dates</NavLink>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

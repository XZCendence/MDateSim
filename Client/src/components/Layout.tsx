import { Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div className="shell">
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

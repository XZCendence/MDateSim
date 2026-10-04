import { Outlet } from "react-router-dom";
import PoseView from "./PoseView";

export default function Layout() {
  return (
    <div className="shell">
      <main className="content">
        <Outlet />
      </main>
      <PoseView />
    </div>
  );
}

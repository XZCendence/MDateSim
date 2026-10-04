import { useEffect, useRef, useSyncExternalStore } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { getMyRows, subscribeSpacetime } from "../lib/spacetime";
import PoseView from "./PoseView";

export default function Layout() {
  const navigate = useNavigate();
  const { phase } = useSyncExternalStore(subscribeSpacetime, getMyRows, getMyRows);
  const prev = useRef(phase);

  // The date starts from the text conversation: when the texting agent calls the player over,
  // date_state flips to "irl" and whatever page the laptop is on becomes the date.
  useEffect(() => {
    if (phase === "irl" && prev.current !== "irl") navigate("/date");
    prev.current = phase;
  }, [phase, navigate]);

  return (
    <div className="shell">
      <main className="content">
        <Outlet />
      </main>
      <PoseView />
    </div>
  );
}

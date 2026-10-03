import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Lobby from "./pages/Lobby";
import Start from "./pages/Start";
import Dates from "./pages/Dates";

/**
 * Flow: /lobby (pick a date) -> /start/:dateId (QR to text her)
 *       -> /dates (schedule IRL dates, which hand off to the Kinect in Irl/)
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/lobby" replace />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/start/:dateId" element={<Start />} />
        <Route path="/dates" element={<Dates />} />
        <Route path="*" element={<Navigate to="/lobby" replace />} />
      </Route>
    </Routes>
  );
}

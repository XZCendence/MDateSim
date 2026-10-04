import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Lobby from "./pages/Lobby";
import Start from "./pages/Start";
import Title from "./pages/Title";
import Dates from "./pages/Dates";
import DateScreen from "./pages/DateScreen";

/**
 * Flow: / (title) -> /lobby (pick a date) -> /start/:dateId (QR to text her)
 *       -> /dates (schedule IRL dates) -> /date (the IRL date itself, full screen on the
 *          laptop: the date speaks, watches you through the Kinect, and makes demands)
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Title />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/start/:dateId" element={<Start />} />
        <Route path="/dates" element={<Dates />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="/date" element={<DateScreen />} />
    </Routes>
  );
}

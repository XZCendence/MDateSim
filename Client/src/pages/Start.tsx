import { QRCodeSVG } from "qrcode.react";
import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { findDate } from "../data/dates";
import { smsLink } from "../lib/sms";
import { startSession } from "../lib/session";
import { useReducer } from "spacetimedb/react";
import { reducers } from "@bindings/index";

const LINE = import.meta.env.VITE_DATE_LINE_NUMBER;

export default function Start() {
  const { dateId } = useParams();
  const date = findDate(dateId);
  const pickDate = useReducer(reducers.pickDate);
  useEffect(() => {
    if (!date) return;
    startSession(date.id);
    // Creates the game_session the texting loop will claim on her first text.
    pickDate({ dateId: date.id }).catch((err) => console.error("pickDate failed", err));
  }, [date, pickDate]);
  if (!date) return <Navigate to="/lobby" replace />;

  const href = smsLink(LINE, date.intro);

  return (
    <section className="center">
      <h1>Text {date.name} to start</h1>
      <p className="muted">
        Scan with your phone. It opens Messages with her number and a first text ready to go.
      </p>
      <a href={href} className="qr" aria-label={`Text ${date.name}`}>
        <QRCodeSVG value={href} size={240} marginSize={2} fgColor={date.accent} bgColor="#ffffff" />
      </a>
      <p className="small">
        Or text <strong>{LINE}</strong> directly.
      </p>
      <p className="muted small">
        First time? The line only replies to numbers added to the Photon project. Your first text
        also unlocks her ability to message you.
      </p>
      <Link to="/dates" className="button">
        I've texted her, plan a date
      </Link>
    </section>
  );
}

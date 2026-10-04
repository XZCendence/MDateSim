/**
 * The date laptop's server: the local API (/api/tts, /api/say, /api/listen, /api/users) plus the
 * IRL director. Run this on the machine with the Kinect and the date screen.
 *
 *   bun run irl      date only (someone else runs the texting loop)
 *   bun run date     date + texting loop in one process (the usual demo setup)
 *
 * Run exactly ONE director and ONE texting loop across the team, or lines double up.
 */
import { connectSpacetime } from "./db";
import { startDirector } from "./director";
import { startUserRegistrationServer } from "./registerUser";

if (!startUserRegistrationServer()) {
  console.error("[irl] port 8787 is taken. Stop the other server (e.g. `bun run imessage`) and use `bun run date` to run both together.");
  process.exit(1);
}
startDirector(await connectSpacetime());

if (process.argv.includes("--texting")) {
  await import("./imessage");
}

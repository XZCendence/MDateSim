// One-off outbound iMessage: bun scripts/send.ts "+1XXXXXXXXXX" "text"
import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";

const [to, ...rest] = process.argv.slice(2);
const body = rest.join(" ") || "hey, it's your date from MDateSim 💕";
if (!to) {
  console.error("usage: bun scripts/send.ts <E.164 phone> [message]");
  process.exit(1);
}

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

const space = await imessage(app).space.create(to);
const sent = await space.send(body);
console.log("sent", sent?.id ?? "(no id)", "to", to);
await app.stop();
process.exit(0);

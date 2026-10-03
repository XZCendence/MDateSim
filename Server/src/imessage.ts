import { Spectrum } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { chat, type ChatMessage } from "./grok";
import { DEFAULT_PERSONA, PERSONAS, personaFromIntro, type Persona } from "./personas";

// Spectrum bridges a single agent loop to many messaging interfaces.
// Docs: https://photon.codes/docs/spectrum-ts
const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

/** Per-conversation state. In-memory for now; move to SpacetimeDB when the schema exists. */
interface Convo {
  persona: Persona;
  history: ChatMessage[];
}
const convos = new Map<string, Convo>();
const HISTORY_LIMIT = 30;

function convoFor(spaceId: string, firstText: string): Convo {
  let c = convos.get(spaceId);
  if (!c) {
    c = { persona: personaFromIntro(firstText) ?? DEFAULT_PERSONA, history: [] };
    convos.set(spaceId, c);
    console.log(`[${spaceId}] new conversation as ${c.persona.name}`);
  }
  return c;
}

/** `/date rin` switches persona mid-conversation (handy for demos). */
function handleCommand(c: Convo, text: string): string | undefined {
  const m = /^\/date\s+(\w+)/i.exec(text);
  if (!m) return undefined;
  const p = PERSONAS[m[1]!.toLowerCase()];
  if (!p) return `no date named ${m[1]}. options: ${Object.keys(PERSONAS).join(", ")}`;
  c.persona = p;
  c.history = [];
  return `(now texting with ${p.name})`;
}

console.log("[imessage] listening");
for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;
  const text = message.content.text.trim();
  if (!text) continue;

  const c = convoFor(space.id, text);
  const cmd = handleCommand(c, text);
  if (cmd) {
    await space.send(cmd);
    continue;
  }

  c.history.push({ role: "user", content: text });
  if (c.history.length > HISTORY_LIMIT) c.history.splice(0, c.history.length - HISTORY_LIMIT);

  try {
    const reply = await app.responding(space, () =>
      chat([{ role: "system", content: c.persona.system }, ...c.history]),
    );
    if (!reply) continue;
    c.history.push({ role: "assistant", content: reply });
    await space.send(reply);
    console.log(`[${space.id}] ${c.persona.name}: ${reply}`);
  } catch (err) {
    console.error(`[${space.id}] grok failed:`, err);
    await space.send("ugh my phone is being weird, say that again?");
  }
}

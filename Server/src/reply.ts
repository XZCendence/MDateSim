/**
 * Parsing of the tags a date appends to a reply: [demand:x], [affection:+N], [date:start].
 *
 * Models are sloppy about the exact form ([jacks], [demand: jumping jacks], [+5], [Affection +5]),
 * so this accepts anything bracketed that clearly means one of those, and strips EVERY bracketed
 * group from the text: nothing in square brackets is ever dialogue.
 */

const BRACKETED = /\[([^\[\]\n]{1,60})\]/g;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

export const DEMAND_NAMES = ["look", "beg", "kneel", "bow", "jacks", "dance", "heart", "blow_kiss", "kiss"] as const;

const DEMAND_ALIASES: Record<string, string> = {
  jumping_jacks: "jacks",
  jumpingjacks: "jacks",
  jumping_jack: "jacks",
  jack: "jacks",
  blowkiss: "blow_kiss",
  blow_a_kiss: "blow_kiss",
  heart_hands: "heart",
  hearts: "heart",
  look_at_me: "look",
  eye_contact: "look",
  knees: "kneel",
  kneeling: "kneel",
  on_your_knees: "kneel",
  begging: "beg",
  bowing: "bow",
  dancing: "dance",
};

/** Keep a parsed delta inside i32 so the reducer accepts it. The score clamp is separate. */
export function clampDelta(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(I32_MIN, Math.min(I32_MAX, Math.trunc(n)));
}

export function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function asDemand(inner: string): string | undefined {
  const key = inner
    .toLowerCase()
    .replace(/^\s*(demand|pose|gesture|action|emote)\s*[:=\-]?\s*/, "")
    .trim()
    .replace(/[\s\-]+/g, "_");
  const name = DEMAND_ALIASES[key] ?? key;
  return (DEMAND_NAMES as readonly string[]).includes(name) ? name : undefined;
}

export function splitReply(reply: string): { text: string; demand?: string; affectionDelta: number; startDate: boolean } {
  let affectionDelta = 0;
  let demand: string | undefined;
  let startDate = false;
  for (const m of reply.matchAll(BRACKETED)) {
    const inner = m[1]!.trim();
    const affection = /^(?:affection\s*[:=]?\s*)?([+-]\s*\d+)$/i.exec(inner) ?? /^affection\s*[:=]?\s*(\d+)$/i.exec(inner);
    if (affection) {
      affectionDelta = clampDelta(Number(affection[1]!.replace(/\s+/g, "")));
    } else if (/^date\s*[:=]?\s*start$/i.test(inner)) {
      startDate = true;
    } else {
      demand = asDemand(inner) ?? demand;
    }
  }
  const text = reply
    .replace(BRACKETED, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
  return { text, demand, affectionDelta, startDate };
}

/**
 * Last resort for a spoken line that clearly orders a gesture but forgot the tag entirely.
 * Only imperative phrasings, so "good, you knelt" doesn't count.
 */
export function inferDemand(text: string): string | undefined {
  const t = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/\bjumping jacks?\b/, "jacks"],
    [/\bbeg\b(?! (your|my) pardon)/, "beg"],
    [/\b(get|go|down) on your knees\b|\bkneel\b(?! ?(ed|ing))/, "kneel"],
    [/\bblow (me )?a kiss\b/, "blow_kiss"],
    [/\bkiss me\b|\bgive me a kiss\b/, "kiss"],
    [/\bheart\b.*\bhands?\b|\bhands?\b.*\bheart\b|\bmake (me )?a heart\b/, "heart"],
    [/\bdance\b(?! requirement)/, "dance"],
    [/\bbow\b/, "bow"],
    [/\blook at me\b|\beyes on me\b/, "look"],
  ];
  for (const [re, name] of rules) if (re.test(t)) return name;
  return undefined;
}

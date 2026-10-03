/**
 * The roster of dates a player can pick in the lobby.
 * Ids come from the shared roster keys used by the module and the personas.
 */
import emIdle from "../assets/bianca/Em-idle.webp";
import lingLongIdle from "../assets/linglong/linglong-idle.webp";
import { DATE_IDS, type DateId } from "../../../Server/spacetimedb/src/dateIds";

export interface DateProfile {
  id: DateId;
  name: string;
  age: number;
  tagline: string;
  bio: string;
  /** Short hint about what she'll demand on IRL dates (Kinect gestures). */
  irlStyle: string;
  /** Pre-filled text the player sends to start the conversation. */
  intro: string;
  accent: string;
  image?: string;
}

const ROSTER: Record<DateId, DateProfile> = {
  bianca: {
    id: "bianca",
    name: "Bianca",
    age: 22,
    tagline: "Sweet until she isn't.",
    bio: "Art student, cat person, replies within seconds. Expects the same from you.",
    irlStyle: "Bow when you greet her. Every time.",
    intro: "hi bianca, it's me from the lobby 🌸",
    accent: "#f472b6",
    image: emIdle,
  },
  rin: {
    id: "rin",
    name: "Ling Long",
    age: 24,
    tagline: "Competitive about everything.",
    bio: "Ex-athlete turned streamer. Will turn your date into a workout.",
    irlStyle: "Squats, jumping jacks, whatever she feels like.",
    intro: "yo ling long, ready to lose?",
    accent: "#60a5fa",
    image: lingLongIdle,
  },
};

export const DATES: DateProfile[] = DATE_IDS.map((id) => ROSTER[id]);

export function findDate(id: string | undefined): DateProfile | undefined {
  return DATES.find((d) => d.id === id);
}

/**
 * The roster of dates a player can pick in the lobby.
 * Keep this in sync with whatever persona the Server's iMessage loop uses.
 */
import emIdle from "../assets/Em-idle.webp";

export interface DateProfile {
  id: string;
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

export const DATES: DateProfile[] = [
  {
    id: "sakura",
    name: "Bianca",
    age: 22,
    tagline: "Sweet until she isn't.",
    bio: "Art student, cat person, replies within seconds. Expects the same from you.",
    irlStyle: "Bow when you greet her. Every time.",
    intro: "hi bianca, it's me from the lobby 🌸",
    accent: "#f472b6",
    image: emIdle,
  },
  {
    id: "rin",
    name: "Ling Long",
    age: 24,
    tagline: "Competitive about everything.",
    bio: "Ex-athlete turned streamer. Will turn your date into a workout.",
    irlStyle: "Squats, jumping jacks, whatever she feels like.",
    intro: "yo ling long, ready to lose?",
    accent: "#60a5fa",
  },
];

export function findDate(id: string | undefined): DateProfile | undefined {
  return DATES.find((d) => d.id === id);
}

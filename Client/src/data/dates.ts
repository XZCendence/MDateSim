/**
 * The roster of dates a player can pick in the lobby.
 * Ids come from the shared roster keys used by the module and the personas.
 */
import emIdle from "../assets/bianca/Em-idle.webp";
import emHover from "../assets/bianca/Em-flustered.webp";
import lingLongIdle from "../assets/linglong/linglong-idle.webp";
import lingLongHover from "../assets/linglong/image (2).png";
import emHappy from "../assets/bianca/Em-happy.png";
import emLove from "../assets/bianca/Em-love.webp";
import emMad from "../assets/bianca/Em-mad.webp";
import lingLongLaugh from "../assets/linglong/linglong-1.webp";
import lingLongPhone from "../assets/linglong/linglong-2.webp";
import lingLongTalk from "../assets/linglong/linglong-4.webp";
import lingLongDone from "../assets/linglong/linglong-5.webp";
import { DATE_IDS, type DateId } from "../../../Server/spacetimedb/src/dateIds";

export interface DateProfile {
  id: DateId;
  name: string;
  bio: string;
  /** Pre-filled text the player sends to start the conversation. */
  intro: string;
  accent: string;
  image?: string;
  hoverImage?: string;
  /** Sprites for the IRL date screen, by mood. Missing moods fall back to `image`. */
  sprites: Partial<Record<Mood, string>>;
}

export type Mood = "idle" | "talking" | "waiting" | "happy" | "love" | "mad" | "flustered";

const ROSTER: Record<DateId, DateProfile> = {
  bianca: {
    id: "bianca",
    name: "Bianca Em",
    bio: "CS student and hackathon builder. Sweet, until she decides you're hers.",
    intro: "hi bianca, it's me from the lobby 🌸",
    accent: "#f472b6",
    image: emIdle,
    hoverImage: emHover,
    sprites: { idle: emIdle, happy: emHappy, love: emLove, mad: emMad, flustered: emHover },
  },
  rin: {
    id: "rin",
    name: "Ling Long",
    bio: "Systems engineer at Cluely. Tsinghua University, top of the universities in the world. Work ends at 5.",
    intro: "hey ling long, it's me from the lobby",
    accent: "#60a5fa",
    image: lingLongIdle,
    hoverImage: lingLongHover,
    sprites: {
      idle: lingLongIdle,
      talking: lingLongTalk,
      waiting: lingLongPhone,
      happy: lingLongLaugh,
      love: lingLongLaugh,
      mad: lingLongDone,
      flustered: lingLongLaugh,
    },
  },
};

export const DATES: DateProfile[] = DATE_IDS.map((id) => ROSTER[id]);

export function findDate(id: string | undefined): DateProfile | undefined {
  return DATES.find((d) => d.id === id);
}

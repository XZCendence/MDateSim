/**
 * The roster of dates a player can pick in the lobby.
 * Ids come from the shared roster keys used by the module and the personas.
 */
import emIdle from "../assets/bianca/Em-idle.webp";
import emHover from "../assets/bianca/Em-flustered.webp";
import lingLongIdle from "../assets/linglong/linglong-idle.webp";
import lingLongHover from "../assets/linglong/image (2).png";
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
}

const ROSTER: Record<DateId, DateProfile> = {
  bianca: {
    id: "bianca",
    name: "Bianca Em",
    bio: "CS student and hackathon builder. Sweet, until she decides you're hers.",
    intro: "hi bianca, it's me from the lobby 🌸",
    accent: "#f472b6",
    image: emIdle,
    hoverImage: emHover,
  },
  rin: {
    id: "rin",
    name: "Ling Long",
    bio: "Systems engineer at Cluely. Tsinghua University, top of the universities in the world. Work ends at 5.",
    intro: "hey ling long, it's me from the lobby",
    accent: "#60a5fa",
    image: lingLongIdle,
    hoverImage: lingLongHover,
  },
};

export const DATES: DateProfile[] = DATE_IDS.map((id) => ROSTER[id]);

export function findDate(id: string | undefined): DateProfile | undefined {
  return DATES.find((d) => d.id === id);
}

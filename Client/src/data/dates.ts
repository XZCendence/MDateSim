/**
 * The roster of dates a player can pick in the lobby.
 * Keep this in sync with whatever persona the Server's iMessage loop uses.
 */
import emIdle from "../assets/bianca/Em-idle.webp";
import emHover from "../assets/bianca/Em-flustered.webp";
import lingLongIdle from "../assets/linglong/linglong-idle.webp";
import lingLongHover from "../assets/linglong/image (2).png";

export interface DateProfile {
  id: string;
  name: string;
  bio: string;
  /** Pre-filled text the player sends to start the conversation. */
  intro: string;
  accent: string;
  image?: string;
  hoverImage?: string;
}

export const DATES: DateProfile[] = [
  {
    id: "bianca",
    name: "Bianca Em",
    bio: "CS student and hackathon builder. Is sweet and sometimes scary!",
    intro: "Hello!",
    accent: "#f472b6",
    image: emIdle,
    hoverImage: emHover,
  },
  {
    id: "rin",
    name: "Ling Long",
    bio: "Systems Engineer at Cluely. Tsinghua University Alumni.",
    intro: "Hello!",
    accent: "#60a5fa",
    image: lingLongIdle,
    hoverImage: lingLongHover,
  },
];

export function findDate(id: string | undefined): DateProfile | undefined {
  return DATES.find((d) => d.id === id);
}

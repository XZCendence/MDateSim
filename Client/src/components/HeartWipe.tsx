import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Full-screen page transition: a grid of pink heart tiles closes in from the edges of the
 * screen to the centre (with a dithered front), the page changes underneath, then the grid
 * opens back up from the centre outward.
 *
 *   const wipe = useHeartWipe();
 *   wipe(() => navigate("/lobby"));
 */

const CELL_PX = 72; // target tile size
const IN_SPREAD = 520; // ms between the outermost and innermost tile starting
const IN_ANIM = 380; // ms per tile (keep in sync with .hw-in in index.css)
const JITTER = 150; // ms of per-tile randomness: this is the dither
const HOLD = 140; // ms fully covered before the reveal
const OUT_SPREAD = 420;
const OUT_ANIM = 320;
const SHADES = ["#ff4f9a", "#ff6aab", "#ff86bd"];

type Phase = "idle" | "in" | "out";
interface Cell {
  inDelay: number;
  outDelay: number;
  shade: string;
  heart: number; // heart scale, for a little variety
}
interface Grid {
  cols: number;
  rows: number;
  cells: Cell[];
}

function buildGrid(): Grid {
  const cols = Math.max(6, Math.ceil(window.innerWidth / CELL_PX));
  const rows = Math.max(4, Math.ceil(window.innerHeight / CELL_PX));
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 1 at the screen edge, 0 at the centre; square falloff so it closes like a frame.
      const edge = Math.max(Math.abs(c - cx) / Math.max(cx, 1), Math.abs(r - cy) / Math.max(cy, 1));
      const checker = (c + r) % 2; // ordered dither: every other tile lags half a beat
      const noise = Math.random();
      cells.push({
        inDelay: (1 - edge) * IN_SPREAD + checker * 70 + noise * (JITTER - 70),
        outDelay: edge * OUT_SPREAD + checker * 50 + noise * 60,
        shade: SHADES[(checker + (noise > 0.8 ? 2 : 0)) % SHADES.length]!,
        heart: 0.85 + noise * 0.3,
      });
    }
  }
  return { cols, rows, cells };
}

const HeartWipeContext = createContext<(action: () => void) => void>((action) => action());

export function useHeartWipe(): (action: () => void) => void {
  return useContext(HeartWipeContext);
}

export function HeartWipeProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [grid, setGrid] = useState<Grid | null>(null);
  const busy = useRef(false);

  const wipe = useCallback((action: () => void) => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (busy.current || reduced) return action();
    busy.current = true;
    setGrid(buildGrid());
    setPhase("in");
    window.setTimeout(() => {
      action();
      setPhase("out");
      window.setTimeout(() => {
        setPhase("idle");
        setGrid(null);
        busy.current = false;
      }, OUT_SPREAD + OUT_ANIM + 160);
    }, IN_SPREAD + JITTER + IN_ANIM + HOLD);
  }, []);

  // Dev preview: open any page with #wipe to watch the transition without clicking through.
  useEffect(() => {
    if (import.meta.env.DEV && window.location.hash === "#wipe") wipe(() => {});
  }, [wipe]);

  return (
    <HeartWipeContext.Provider value={wipe}>
      {children}
      {grid && phase !== "idle" && (
        <div
          className={`hw hw-${phase}`}
          aria-hidden
          style={{ ["--cols" as string]: grid.cols, ["--rows" as string]: grid.rows } as CSSProperties}
        >
          {grid.cells.map((cell, i) => (
            <div
              key={i}
              className="hw-cell"
              style={
                {
                  "--in": `${Math.round(cell.inDelay)}ms`,
                  "--out": `${Math.round(cell.outDelay)}ms`,
                  "--shade": cell.shade,
                  "--heart": cell.heart,
                } as CSSProperties
              }
            >
              <svg viewBox="0 0 32 30" className="hw-heart">
                <path d="M16 29 C16 29 1 19.5 1 9.2 C1 4.2 4.9 1 9 1 C12 1 14.6 2.7 16 5.3 C17.4 2.7 20 1 23 1 C27.1 1 31 4.2 31 9.2 C31 19.5 16 29 16 29 Z" />
              </svg>
            </div>
          ))}
        </div>
      )}
    </HeartWipeContext.Provider>
  );
}

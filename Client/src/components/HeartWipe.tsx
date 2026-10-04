import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";

/**
 * Full-screen page transition, drawn by one WebGL fragment shader: a grid of pink heart tiles
 * closes in from the edges of the screen to the centre (with a dithered front), the page
 * changes underneath, then the grid opens back up from the centre outward.
 *
 *   const wipe = useHeartWipe();
 *   wipe(() => navigate("/lobby"));
 *
 * Every tile is computed per pixel on the GPU, so there are no DOM nodes to animate.
 * Dev preview: open any page with #wipe.
 */

const CELL_PX = 72; // target tile size in CSS pixels
// Timeline, in seconds. The shader uses the same numbers (see FRAG).
const IN_TOTAL = 0.52 + 0.15 + 0.46; // spread + dither + per-tile animation
const HOLD = 0.14;
const OUT_TOTAL = 0.42 + 0.11 + 0.32;

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;    // canvas size in device pixels
uniform float uCell;  // tile size in device pixels
uniform float uIn;    // seconds since the close-in started
uniform float uOut;   // seconds since the open-up started (0 before)

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dot2(vec2 v) { return dot(v, v); }
float backOut(float t) { float c = 2.2; float u = t - 1.0; return 1.0 + (c + 1.0) * u * u * u + c * u * u; }

// Signed distance to a heart, tip at (0,0), top near y = 1 (Inigo Quilez).
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 grid = ceil(uRes / uCell);
  vec2 size = uRes / grid;
  vec2 id = floor(frag / size);
  vec2 local = fract(frag / size) - 0.5;            // -0.5 .. 0.5 inside the tile, y down
  float px = 1.0 / size.x;                          // one device pixel, in tile units

  vec2 c = (grid - 1.0) * 0.5;
  float edge = max(abs(id.x - c.x) / max(c.x, 1.0), abs(id.y - c.y) / max(c.y, 1.0)); // 1 at screen edge
  float checker = mod(id.x + id.y, 2.0);            // ordered dither: every other tile lags
  float n = hash(id);

  float dIn = (1.0 - edge) * 0.52 + checker * 0.07 + n * 0.08;
  float dOut = edge * 0.42 + checker * 0.05 + n * 0.06;
  float tIn = clamp((uIn - dIn) / 0.38, 0.0, 1.0);
  float tHeart = clamp((uIn - dIn - 0.06) / 0.40, 0.0, 1.0);
  float tOut = clamp((uOut - dOut) / 0.32, 0.0, 1.0);
  float gone = tOut * tOut;                         // ease-in shrink on the way out

  // Tile: grows from its centre with rounded corners that square off as it lands.
  float grow = (1.0 - pow(1.0 - tIn, 3.0)) * (1.0 - gone);
  float halfSize = 0.5 * grow + px;                 // +1px so neighbours overlap, no seams
  float radius = 0.22 * (1.0 - grow);
  vec2 q = abs(local) - (halfSize - radius);
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float tile = smoothstep(px, -px, box) * step(0.001, tIn);

  vec3 shade = mix(vec3(1.0, 0.31, 0.60), vec3(1.0, 0.42, 0.67), checker);
  if (n > 0.8) shade = vec3(1.0, 0.53, 0.74);
  shade *= 1.0 + 0.28 * sin(tIn * 3.14159);         // lights up as it lands, settles back
  shade *= 1.0 + 0.5 * gone;

  // Heart: pops in a beat after its tile, with overshoot and a little spin.
  float hs = (0.85 + 0.3 * n) * backOut(tHeart) * step(0.001, tHeart) * (1.0 - gone);
  float ang = (1.0 - tHeart) * -0.45 + gone * 0.5;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 hp = rot * vec2(local.x, -local.y) / (0.52 * max(hs, 0.001)) + vec2(0.0, 0.56);
  float hd = sdHeart(hp) * 0.52 * hs;               // back to tile units
  float heart = smoothstep(px, -px, hd) * step(0.001, hs);
  float glow = exp(-max(hd, 0.0) * 22.0) * 0.30 * step(0.001, hs);

  vec3 col = mix(shade + glow, vec3(1.0, 0.94, 0.97), heart);
  gl_FragColor = vec4(col * tile, tile);            // premultiplied alpha
}`;

interface Gl {
  gl: WebGLRenderingContext;
  uRes: WebGLUniformLocation | null;
  uCell: WebGLUniformLocation | null;
  uIn: WebGLUniformLocation | null;
  uOut: WebGLUniformLocation | null;
}

function setup(canvas: HTMLCanvasElement): Gl | null {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("[wipe] shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("[wipe] link:", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return {
    gl,
    uRes: gl.getUniformLocation(prog, "uRes"),
    uCell: gl.getUniformLocation(prog, "uCell"),
    uIn: gl.getUniformLocation(prog, "uIn"),
    uOut: gl.getUniformLocation(prog, "uOut"),
  };
}

const HeartWipeContext = createContext<(action: () => void) => void>((action) => action());

export function useHeartWipe(): (action: () => void) => void {
  return useContext(HeartWipeContext);
}

export function HeartWipeProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<Gl | null | undefined>(undefined); // undefined = not tried yet, null = unavailable
  const busy = useRef(false);

  const wipe = useCallback((action: () => void) => {
    const canvas = canvasRef.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (busy.current || reduced || !canvas) return action();
    if (glRef.current === undefined) glRef.current = setup(canvas);
    const ctx = glRef.current;
    if (!ctx) return action(); // no WebGL: just change the page

    const { gl } = ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(ctx.uRes, canvas.width, canvas.height);
    gl.uniform1f(ctx.uCell, CELL_PX * dpr);
    canvas.style.display = "block";
    busy.current = true;

    const start = performance.now();
    let outStart = 0;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      if (!outStart && t >= IN_TOTAL + HOLD) {
        outStart = now;
        action(); // fully covered: swap the page underneath
      }
      const tOut = outStart ? (now - outStart) / 1000 : 0;
      gl.uniform1f(ctx.uIn, t);
      gl.uniform1f(ctx.uOut, tOut);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (tOut < OUT_TOTAL + 0.05) {
        requestAnimationFrame(frame);
      } else {
        canvas.style.display = "none";
        busy.current = false;
      }
    };
    requestAnimationFrame(frame);
  }, []);

  // Dev preview: open any page with #wipe to watch the transition without clicking through.
  useEffect(() => {
    if (import.meta.env.DEV && window.location.hash === "#wipe") wipe(() => {});
  }, [wipe]);

  return (
    <HeartWipeContext.Provider value={wipe}>
      {children}
      <canvas ref={canvasRef} className="hw-canvas" aria-hidden />
    </HeartWipeContext.Provider>
  );
}

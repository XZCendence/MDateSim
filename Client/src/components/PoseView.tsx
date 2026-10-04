import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Live 3D armature of the player, fed by the Kinect machine's pose websocket
 * (Irl/pose_stream.py). Draws MediaPipe's metric landmarks (origin mid-hip,
 * metres) as a skeleton over a floor grid. Fixed bottom-right for now.
 */

const WS_URL = import.meta.env.VITE_POSE_WS ?? "ws://127.0.0.1:8765";

// MediaPipe pose connections (33-landmark model).
const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // shoulders + arms
  [15, 17], [15, 19], [15, 21], [17, 19], [16, 18], [16, 20], [16, 22], [18, 20], // hands
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], // feet
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10], // face
];

type Frame = {
  local: number[][] | null;
  vis: number[] | null;
  demand: string | null;
  status: string;
  progress: number;
};

export default function PoseView({ width = 320, height = 240 }: { width?: number; height?: number }) {
  const mount = useRef<HTMLDivElement>(null);
  const frameRef = useRef<Frame | null>(null);
  const [connected, setConnected] = useState(false);
  const [hud, setHud] = useState<{ demand: string | null; status: string; progress: number }>({
    demand: null,
    status: "",
    progress: 0,
  });

  // websocket -> latest frame
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry: number | undefined;
    let alive = true;
    const connect = () => {
      if (!alive) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        frameRef.current = null;
        retry = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const f = JSON.parse(ev.data) as Frame;
          frameRef.current = f;
          setHud((h) =>
            h.demand === f.demand && h.status === f.status && Math.abs(h.progress - f.progress) < 0.02
              ? h
              : { demand: f.demand, status: f.status, progress: f.progress },
          );
        } catch {
          /* ignore bad frames */
        }
      };
    };
    connect();
    return () => {
      alive = false;
      if (retry) window.clearTimeout(retry);
      ws?.close();
    };
  }, []);

  // three.js scene
  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 20);
    camera.position.set(1.6, 1.1, 2.6);
    camera.lookAt(0, 0.2, 0);

    const grid = new THREE.GridHelper(4, 16, 0x3a3a50, 0x26263a);
    grid.position.y = -1.0; // roughly the floor for a standing adult (origin is mid-hip)
    scene.add(grid);

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f472b6";
    const boneMat = new THREE.LineBasicMaterial({ color: new THREE.Color(accent) });
    const bonePos = new Float32Array(CONNECTIONS.length * 2 * 3);
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute("position", new THREE.BufferAttribute(bonePos, 3));
    const bones = new THREE.LineSegments(boneGeo, boneMat);
    scene.add(bones);

    const jointGeo = new THREE.SphereGeometry(0.025, 8, 8);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const joints = new THREE.InstancedMesh(jointGeo, jointMat, 33);
    scene.add(joints);

    const m = new THREE.Matrix4();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    let raf = 0;
    let spin = 0;

    const render = () => {
      raf = requestAnimationFrame(render);
      const f = frameRef.current;
      const pts = f?.local;
      const vis = f?.vis;
      if (pts && vis) {
        // MediaPipe: y down, z toward camera negative. Three: y up, z toward viewer positive.
        const P = (i: number) => new THREE.Vector3(-pts[i]![0]!, -pts[i]![1]!, -pts[i]![2]!);
        let k = 0;
        for (const [a, b] of CONNECTIONS) {
          const ok = vis[a]! > 0.5 && vis[b]! > 0.5;
          const pa = ok ? P(a) : new THREE.Vector3();
          const pb = ok ? P(b) : new THREE.Vector3();
          bonePos[k++] = pa.x; bonePos[k++] = pa.y; bonePos[k++] = pa.z;
          bonePos[k++] = pb.x; bonePos[k++] = pb.y; bonePos[k++] = pb.z;
        }
        boneGeo.attributes.position!.needsUpdate = true;
        for (let i = 0; i < 33; i++) {
          if (vis[i]! > 0.5) {
            const p = P(i);
            joints.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
          } else {
            joints.setMatrixAt(i, hidden);
          }
        }
        joints.instanceMatrix.needsUpdate = true;
        bones.visible = joints.visible = true;
      } else {
        bones.visible = joints.visible = false;
      }
      // slow orbit so the 3D reads as 3D
      spin += 0.003;
      camera.position.set(Math.sin(spin) * 2.8, 1.1, Math.cos(spin) * 2.8);
      camera.lookAt(0, 0.1, 0);
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      boneGeo.dispose();
      jointGeo.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [width, height]);

  return (
    <div className="pose-view" style={{ width, height }}>
      <div ref={mount} />
      <div className="pose-view-hud">
        <span className={connected ? "dot on" : "dot"} />
        {connected ? (hud.demand ? `${hud.demand}: ${hud.status}` : hud.status || "watching") : "kinect offline"}
      </div>
      {hud.demand && (
        <div className="pose-view-bar">
          <div style={{ width: `${Math.round(hud.progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

"""Broadcast live pose landmarks to the website over a local WebSocket.

    stream = PoseStream()            # serves ws://127.0.0.1:8765 on a background thread
    stream.publish(pose, demand="kneel", status="get lower", progress=0.4)

Each message is JSON:
    {"t": 1712345.6, "local": [[x,y,z], ...33], "vis": [...33],
     "demand": "kneel"|null, "status": "...", "progress": 0.0-1.0}

`local` is MediaPipe's metric pose (metres, origin at mid-hip, y down, z toward
the camera is negative), so the browser can draw a body-relative 3D armature with
no camera calibration. When no one is in view, `local` is null.

Zero coupling: if nothing is connected, publish() is a no-op that costs a dict build.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time

try:
    import websockets
    from websockets.asyncio.server import serve
except ImportError:  # pragma: no cover
    websockets = None

HOST, PORT = "127.0.0.1", 8765


class PoseStream:
    def __init__(self, host: str = HOST, port: int = PORT, max_hz: float = 20.0):
        self.host, self.port = host, port
        self.min_interval = 1.0 / max_hz
        self._clients: set = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._last = 0.0
        if websockets is None:
            print("[stream] websockets not installed; pose streaming disabled (pip install websockets)")
            return
        threading.Thread(target=self._run, name="pose-stream", daemon=True).start()

    # ---- server thread ----
    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._serve())

    async def _serve(self) -> None:
        async with serve(self._handler, self.host, self.port):
            print(f"[stream] pose websocket on ws://{self.host}:{self.port}")
            await asyncio.Future()

    async def _handler(self, ws) -> None:
        self._clients.add(ws)
        try:
            async for _ in ws:  # we ignore inbound; keeps the connection alive
                pass
        finally:
            self._clients.discard(ws)

    async def _broadcast(self, payload: str) -> None:
        dead = []
        for ws in list(self._clients):
            try:
                await ws.send(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)

    # ---- producer side ----
    @property
    def connected(self) -> int:
        return len(self._clients)

    def publish(self, pose, demand: str | None = None, status: str = "", progress: float = 0.0, **extra) -> None:
        if self._loop is None or not self._clients:
            return
        now = time.monotonic()
        if now - self._last < self.min_interval:
            return
        self._last = now
        msg = {
            "t": time.time(),
            "local": None if pose is None else [[round(float(v), 4) for v in p] for p in pose.local],
            "vis": None if pose is None else [round(float(v), 3) for v in pose.visibility],
            "demand": demand,
            "status": status,
            "progress": round(float(progress), 3),
            **extra,
        }
        asyncio.run_coroutine_threadsafe(self._broadcast(json.dumps(msg)), self._loop)

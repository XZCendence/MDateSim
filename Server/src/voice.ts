/**
 * xAI speech: text-to-speech for the date's voice on IRL dates, speech-to-text for
 * hearing the player. Note the paths are xAI's own (/v1/tts, /v1/stt), not the
 * OpenAI-style /v1/audio/* ones, which this team's key is not allowed to call.
 */
import { PERSONAS, type Persona } from "./personas";

const BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";

function apiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set (see Server/.env.example)");
  return key;
}

/** Make a chat reply speakable: drop [demand:x]/[affection:+n] tags, emoji and stage noise. */
export function speakable(text: string): string {
  return text
    .replace(/\[[^\[\]\n]{1,60}\]/g, "")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Synthesize `text` in a voice (see GET /v1/tts/voices). Returns MP3 bytes. */
export async function speak(text: string, voiceId: string, language = "en"): Promise<Uint8Array> {
  const res = await fetch(`${BASE_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ text: speakable(text), voice_id: voiceId, language }),
  });
  if (!res.ok) throw new Error(`xAI tts ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Synthesize a line as one of the dates. */
export function speakAs(dateId: string, text: string): Promise<Uint8Array> {
  const persona: Persona | undefined = (PERSONAS as Record<string, Persona | undefined>)[dateId];
  if (!persona) throw new Error(`unknown date ${dateId}`);
  return speak(text, persona.voice);
}

/** Transcribe audio (mp3/wav/m4a/webm bytes). Returns the text. */
export async function transcribe(audio: Uint8Array | Blob, mimeType = "audio/mpeg"): Promise<string> {
  const form = new FormData();
  const blob = audio instanceof Blob ? audio : new Blob([audio], { type: mimeType });
  form.append("file", blob, `audio.${mimeType.split("/")[1]?.split(";")[0] ?? "mp3"}`);
  const res = await fetch(`${BASE_URL}/stt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`xAI stt ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { text?: string }).text?.trim() ?? "";
}

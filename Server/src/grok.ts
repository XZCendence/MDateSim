/**
 * Minimal xAI (Grok) chat client. The API is OpenAI-compatible, so this is a
 * plain fetch with no SDK. Reads XAI_API_KEY / XAI_MODEL from the environment.
 */
export type Role = "system" | "user" | "assistant";
export interface ChatMessage {
  role: Role;
  content: string;
}

const BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
const MODEL = process.env.XAI_MODEL ?? "grok-4.3";

function apiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set (see Server/.env.example)");
  return key;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** One chat completion; returns the assistant text. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: opts.model ?? MODEL,
      messages,
      temperature: opts.temperature ?? 0.9,
      max_tokens: opts.maxTokens ?? 300,
    }),
  });
  if (!res.ok) {
    throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message.content?.trim() ?? "";
}

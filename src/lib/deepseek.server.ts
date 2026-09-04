/**
 * DeepSeek API client (server-only).
 * Handles model routing, timeouts, rate limiting, retries with exponential
 * backoff and clear, surfaceable errors.
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type DeepSeekModel = "deepseek-chat" | "deepseek-reasoner";

/** Subjects that benefit from the R1 reasoning model. */
const REASONING_HINTS = [
  "math",
  "algebra",
  "geometry",
  "calculus",
  "statistic",
  "physic",
  "chemistry",
  "logic",
  "proof",
  "coding",
  "programming",
  "computer science",
  "engineering",
  "data structure",
  "algorithm",
];

export function pickModel(subject: string | null | undefined): DeepSeekModel {
  const s = (subject ?? "").toLowerCase();
  return REASONING_HINTS.some((hint) => s.includes(hint)) ? "deepseek-reasoner" : "deepseek-chat";
}

export class DeepSeekError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
    this.retryable = retryable;
  }
}

function apiKey(): string {
  const key = process.env["DEEPSEEK_API_KEY"];
  if (!key) {
    throw new DeepSeekError("The DeepSeek API key is not configured.", 500, false);
  }
  return key;
}

function friendly(status: number, body: string): DeepSeekError {
  if (status === 401 || status === 403) {
    return new DeepSeekError("DeepSeek rejected the API key. Check that it is valid.", status, false);
  }
  if (status === 402) {
    return new DeepSeekError("The DeepSeek account is out of credit.", status, false);
  }
  if (status === 429) {
    return new DeepSeekError("DeepSeek is rate limiting requests. Try again shortly.", status, true);
  }
  if (status >= 500) {
    return new DeepSeekError("DeepSeek is temporarily unavailable.", status, true);
  }
  return new DeepSeekError(`DeepSeek request failed (${status}): ${body.slice(0, 300)}`, status, false);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CallOptions = {
  messages: ChatMessage[];
  model?: DeepSeekModel;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  stream?: boolean;
  signal?: AbortSignal;
};

/** Single fetch attempt against DeepSeek. */
async function attempt(options: CallOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.stream ? 120_000 : 90_000);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      signal: options.signal ?? controller.signal,
      body: JSON.stringify({
        model: options.model ?? "deepseek-chat",
        messages: options.messages,
        stream: Boolean(options.stream),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw friendly(response.status, body);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/** Retry wrapper: bounded exponential backoff with jitter on retryable failures. */
async function withRetries(options: CallOptions, maxAttempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await attempt(options);
    } catch (error) {
      lastError = error;
      const retryable =
        (error instanceof DeepSeekError && error.retryable) ||
        (error instanceof Error && error.name === "AbortError");
      if (!retryable || i === maxAttempts - 1) break;
      await sleep(600 * 2 ** i + Math.random() * 400);
    }
  }
  if (lastError instanceof DeepSeekError) throw lastError;
  throw new DeepSeekError("Could not reach DeepSeek. Please try again.", 503, true);
}

/** Buffered completion. Returns the assistant text. */
export async function deepseekText(options: CallOptions): Promise<string> {
  const response = await withRetries({ ...options, stream: false });
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** JSON completion, parsed and validated by the caller. */
export async function deepseekJson<T>(options: CallOptions): Promise<T> {
  const raw = await deepseekText({ ...options, json: true });
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new DeepSeekError("DeepSeek returned an unreadable response. Please try again.", 502, true);
  }
}

/**
 * Streaming completion. Yields plain text deltas as they arrive.
 */
export async function* deepseekStream(options: CallOptions): AsyncGenerator<string> {
  const response = await withRetries({ ...options, stream: true }, 2);
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore malformed keep-alive chunks
      }
    }
  }
}

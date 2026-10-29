/**
 * Plainly API on Vercel – lets anyone use Plainly without a Claude account.
 *
 * Lives next to index.html, so the app calls it on the same address (no CORS needed).
 * Adds your secret key (a Vercel environment variable), calls the model with streaming,
 * and passes the stream back. Nothing is stored or logged.
 *
 * Two providers, picked by which key is set:
 * - OPENROUTER_API_KEY: OpenRouter (e.g. its free models). Its OpenAI-style stream is
 *   converted to the Anthropic-style events index.html already reads.
 * - ANTHROPIC_API_KEY: the Claude Messages API, streamed back as is.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BODY_BYTES = 4 * 1024 * 1024;  // Vercel request bodies are limited to ~4.5 MB
const MAX_IMAGES = 6;
const MAX_TOKENS = { quick: 1200, default: 2000, complex: 8000 };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const JSON_SYSTEM = "Reply with only the JSON value requested, no other text. It will be machine-parsed.";

// Default models per tier. Any of them can be overridden with MODEL_COMPLEX / MODEL_DEFAULT / MODEL_QUICK.
const DEFAULT_MODELS = {
  openrouter: { complex: "google/gemma-4-31b-it:free", default: "google/gemma-4-31b-it:free", quick: "google/gemma-4-26b-a4b-it:free" },
  anthropic: { complex: "claude-sonnet-5-5", default: "claude-sonnet-5-5", quick: "claude-haiku-5-5" }
};

export async function POST(request) {
  const env = process.env;
  const provider = env.OPENROUTER_API_KEY ? "openrouter" : env.ANTHROPIC_API_KEY ? "anthropic" : null;
  if (!provider) return json({ error: "server_not_configured" }, 500);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "prompt_too_large" }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: "invalid_request" }, 400); }

  // A prompt string, or a short list of user/assistant turns.
  let turns = Array.isArray(body.input) ? body.input : [{ role: "user", content: String(body.input || "") }];
  turns = turns.filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim());
  const messages = [];
  for (const t of turns) {
    const last = messages[messages.length - 1];
    if (last && last.role === t.role) last.content += "\n\n" + t.content; else messages.push({ role: t.role, content: t.content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "invalid_request" }, 400);

  // Photos or scanned pages go with the last user turn.
  const images = (Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [])
    .filter(i => i && IMAGE_TYPES.includes(i.media_type) && typeof i.data === "string");
  const final = messages[messages.length - 1];
  final.content = provider === "openrouter"
    ? [...images.map(i => ({ type: "image_url", image_url: { url: `data:${i.media_type};base64,${i.data}` } })), { type: "text", text: final.content }]
    : [...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })), { type: "text", text: final.content }];

  const tier = ["quick", "default", "complex"].includes(body.tier) ? body.tier : "default";
  const envModel = { complex: env.MODEL_COMPLEX, default: env.MODEL_DEFAULT, quick: env.MODEL_QUICK }[tier];
  const model = envModel || DEFAULT_MODELS[provider][tier];
  const system = body.json ? JSON_SYSTEM : undefined;

  let upstream;
  try {
    upstream = provider === "openrouter"
      ? await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "x-title": "Plainly" },
          body: JSON.stringify({
            model, max_tokens: MAX_TOKENS[tier], stream: true,
            messages: system ? [{ role: "system", content: system }, ...messages] : messages
          })
        })
      : await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: MAX_TOKENS[tier], stream: true, messages, system })
        });
  } catch { return json({ error: "upstream_error" }, 502); }

  if (!upstream.ok) {
    // Log only the provider's own error message, never the request, so no document text reaches the logs.
    let detail = ""; try { const e = (await upstream.json()).error; detail = (e && (e.message || e.type)) || ""; } catch {}
    console.error(`[${provider}] ${model} → ${upstream.status} ${String(detail).slice(0, 300)}`);
    const busy = upstream.status === 429 || upstream.status === 529;
    const code = busy ? "rate_limited" : upstream.status === 413 ? "prompt_too_large" : upstream.status === 400 ? "invalid_request" : "upstream_error";
    return json({ error: code }, busy ? 429 : 502);
  }
  const stream = provider === "openrouter" ? upstream.body.pipeThrough(openRouterToAnthropic()) : upstream.body;
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Turns OpenRouter's OpenAI-style SSE chunks into the Anthropic-style events index.html reads. */
export function openRouterToAnthropic() {
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "";
  const send = (ctl, ev) => ctl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
  const handle = (ctl, line) => {
    if (!line.startsWith("data:")) return;  // ": OPENROUTER PROCESSING" keep-alives and blank lines
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk; try { chunk = JSON.parse(data); } catch { return; }
    if (chunk.error) {
      const busy = chunk.error.code === 429 || chunk.error.code === 529;
      return send(ctl, { type: "error", error: { type: busy ? "overloaded_error" : "api_error" } });
    }
    const choice = chunk.choices && chunk.choices[0];
    if (!choice) return;
    const text = choice.delta && choice.delta.content;
    if (text) send(ctl, { type: "content_block_delta", delta: { type: "text_delta", text } });
    if (choice.finish_reason) send(ctl, { type: "message_delta", delta: { stop_reason: choice.finish_reason === "length" ? "max_tokens" : "end_turn" } });
  };
  return new TransformStream({
    transform(bytes, ctl) {
      buf += dec.decode(bytes, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { handle(ctl, buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    flush(ctl) { if (buf) handle(ctl, buf); }
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

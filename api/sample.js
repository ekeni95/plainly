/**
 * Plainly API on Vercel – lets anyone use Plainly without a Claude account.
 *
 * Lives next to index.html, so the app calls it on the same address (no CORS needed).
 * Adds your secret ANTHROPIC_API_KEY (a Vercel environment variable), calls the
 * Claude Messages API with streaming, and passes the stream back. Nothing is stored or logged.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY_BYTES = 4 * 1024 * 1024;  // Vercel request bodies are limited to ~4.5 MB
const MAX_IMAGES = 6;
const MAX_TOKENS = { quick: 1200, default: 2000, complex: 8000 };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(request) {
  const env = process.env;
  if (!env.ANTHROPIC_API_KEY) return json({ error: "server_not_configured" }, 500);

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
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const final = messages[messages.length - 1];
  final.content = [
    ...images.filter(i => i && IMAGE_TYPES.includes(i.media_type) && typeof i.data === "string")
      .map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
    { type: "text", text: final.content }
  ];

  const tier = ["quick", "default", "complex"].includes(body.tier) ? body.tier : "default";
  const model = tier === "complex" ? (env.MODEL_COMPLEX || "claude-sonnet-5-5")
    : tier === "quick" ? (env.MODEL_QUICK || "claude-haiku-5-5")
    : (env.MODEL_DEFAULT || "claude-sonnet-5-5");

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model, max_tokens: MAX_TOKENS[tier], stream: true, messages,
        system: body.json ? "Reply with only the JSON value requested, no other text. It will be machine-parsed." : undefined
      })
    });
  } catch { return json({ error: "upstream_error" }, 502); }

  if (!upstream.ok) {
    const busy = upstream.status === 429 || upstream.status === 529;
    const code = busy ? "rate_limited" : upstream.status === 413 ? "prompt_too_large" : upstream.status === 400 ? "invalid_request" : "upstream_error";
    return json({ error: code }, busy ? 429 : 502);
  }
  return new Response(upstream.body, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

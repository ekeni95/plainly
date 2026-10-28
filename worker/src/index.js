/**
 * Plainly API – a tiny Cloudflare Worker that lets the app use Claude
 * without patients needing a Claude account.
 *
 * The browser sends the prompt (and optional page images) to POST /api/sample.
 * The Worker adds your secret Anthropic API key, calls the Claude Messages API
 * with streaming on, and passes the stream straight back to the browser.
 *
 * Nothing is stored or logged here: no database, no console.log of content.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY_BYTES = 6 * 1024 * 1024;   // prompt + images per request
const MAX_IMAGES = 6;
const MAX_TOKENS = { quick: 1200, default: 2000, complex: 8000 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOk && origin ? origin : (allowed[0] || "*"),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/api/health") return json({ ok: true }, 200, cors);
    if (url.pathname !== "/api/sample" || request.method !== "POST") return json({ error: "not_found" }, 404, cors);
    if (!originOk) return json({ error: "forbidden_origin" }, 403, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "server_not_configured" }, 500, cors);

    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > MAX_BODY_BYTES) return json({ error: "prompt_too_large" }, 413, cors);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: "prompt_too_large" }, 413, cors);
      body = JSON.parse(raw);
    } catch { return json({ error: "invalid_request" }, 400, cors); }

    // Build Claude messages from what the page sends: a prompt string, or a short list of turns.
    let turns = Array.isArray(body.input) ? body.input : [{ role: "user", content: String(body.input || "") }];
    turns = turns
      .filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
      .map(t => ({ role: t.role, content: t.content }));
    // Merge consecutive same-role turns and make sure we start and end on a user turn.
    const messages = [];
    for (const t of turns) {
      const last = messages[messages.length - 1];
      if (last && last.role === t.role) last.content += "\n\n" + t.content; else messages.push({ ...t });
    }
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "invalid_request" }, 400, cors);

    // Attach images (base64 JPEG/PNG/WebP/GIF) to the final user turn.
    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    const okTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const final = messages[messages.length - 1];
    final.content = [
      ...images.filter(i => i && okTypes.includes(i.media_type) && typeof i.data === "string")
        .map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
      { type: "text", text: final.content }
    ];

    const tier = ["quick", "default", "complex"].includes(body.tier) ? body.tier : "default";
    const model = tier === "complex" ? (env.MODEL_COMPLEX || "claude-sonnet-5-5")
      : tier === "quick" ? (env.MODEL_QUICK || "claude-haiku-5-5")
      : (env.MODEL_DEFAULT || "claude-sonnet-5-5");

    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS[tier],
        stream: true,
        system: body.json ? "Reply with only the JSON value requested, no other text. It will be machine-parsed." : undefined,
        messages
      })
    });

    if (!upstream.ok) {
      const code = upstream.status === 429 || upstream.status === 529 ? "rate_limited"
        : upstream.status === 413 ? "prompt_too_large"
        : upstream.status === 400 ? "invalid_request" : "upstream_error";
      return json({ error: code }, upstream.status === 429 || upstream.status === 529 ? 429 : 502, cors);
    }

    // Pass Claude's server-sent events straight through to the browser.
    return new Response(upstream.body, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

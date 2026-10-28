# Plainly API (Cloudflare Worker)

This small backend lets anyone use Plainly **without a Claude account**. The app sends
the document to this Worker; the Worker adds your secret Anthropic API key, asks Claude,
and streams the answer back. Nothing is stored or logged.

**Cost:** Cloudflare Workers' free plan is enough for a prototype. You only pay for
Anthropic API usage. Set a monthly spend limit in the Anthropic Console (step 1).

> ⚠️ Prototype only. Use test or fake documents until the GDPR checks in the PRD are done
> (data processing agreement, consent, data protection impact assessment).

## 1. Get an Anthropic API key
1. Sign in at <https://console.anthropic.com>.
2. Add a little credit under **Billing**, and set a **spend limit** (e.g. €10/month).
3. Create a key under **API keys** and copy it (starts with `sk-ant-`).

## 2. Deploy the Worker (about 5 minutes)
You need a free Cloudflare account (<https://dash.cloudflare.com/sign-up>) and Node.js 18+.

```bash
cd worker
npx wrangler login                          # opens the browser to sign in to Cloudflare
npx wrangler deploy                         # prints your Worker address
npx wrangler secret put ANTHROPIC_API_KEY   # paste the sk-ant-… key when asked
```

The deploy prints an address like `https://plainly-api.<your-name>.workers.dev`.
Check it works: open `https://plainly-api.<your-name>.workers.dev/api/health` – it should say `{"ok":true}`.

## 3. Point the app at it
In `index.html`, fill in the meta tag near the top:

```html
<meta name="plainly-api" content="https://plainly-api.<your-name>.workers.dev">
```

Commit and push. GitHub Pages updates in a minute or two, and the app now works for everyone.

## Settings (in `wrangler.toml`)
- `ALLOWED_ORIGINS` – which sites may use your key. Default: `https://ekeni95.github.io`.
  Add others comma-separated (e.g. `http://localhost:8000` for local testing).
- `MODEL_COMPLEX`, `MODEL_DEFAULT`, `MODEL_QUICK` – which Claude model each kind of request uses.

## Before going beyond a prototype
- Add a bot check (e.g. Cloudflare Turnstile) and per-visitor rate limits.
- Ask Anthropic about zero data retention, or run Claude via Amazon Bedrock / Google Vertex AI in an EU region.
- Sign a data processing agreement and complete a DPIA – medical documents are special-category data under the GDPR.

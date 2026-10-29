# Make Plainly work without a Claude account

Inside Claude (claude.ai) the app uses the visitor's own Claude account. To let **anyone**
use it, run it with a small backend that holds **your** Anthropic API key. Two free options:

| | **Vercel (recommended)** | Cloudflare Worker |
|---|---|---|
| Setup | Click-through in the browser, no command line | A few terminal commands |
| Hosts | The app **and** the backend, on one address | Only the backend; the app stays on GitHub Pages |
| Updates | Every push to GitHub deploys automatically | Run `wrangler deploy` again |
| Free plan | Hobby (personal, non-commercial use) | Workers Free |

Either way, you only pay for Anthropic API usage. **Set a monthly spend limit.**

> ⚠️ Prototype only. Use test or anonymised documents until the GDPR checks in the PRD are done.

## Step 1 – Anthropic API key (both options)
1. Sign in at <https://console.anthropic.com>.
2. Under **Billing**, add a little credit and set a **spend limit** (e.g. €10 a month).
3. Under **API keys**, create a key and copy it (it starts with `sk-ant-`).

## Option A – Vercel (about 5 minutes, no command line)
1. Go to <https://vercel.com/signup> and sign up **with GitHub** (Hobby plan, free).
2. Click **Add New… → Project** and **Import** `ekeni95/plainly`.
   (If it isn't listed, click *Adjust GitHub App Permissions* and allow the repository.)
3. Leave **Framework Preset** on *Other* and the build settings empty.
4. Open **Environment Variables** and add:
   - Name `ANTHROPIC_API_KEY`, value: your `sk-ant-…` key.
   - Or, to use OpenRouter instead (see below), name `OPENROUTER_API_KEY`.
5. Click **Deploy**. After about a minute you get an address like `https://plainly-xyz.vercel.app`.
6. Check it: open `https://plainly-xyz.vercel.app/api/health` – it should show `{"ok":true,"configured":true}`.

That's it: the app on that address now works for everyone. It finds its backend automatically,
so you don't need to change `index.html`. Every push to `main` updates the site.

Optional: add `MODEL_COMPLEX`, `MODEL_DEFAULT`, `MODEL_QUICK` as environment variables to choose other Claude models
(defaults: `claude-sonnet-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`).

### Using OpenRouter (free models)
If `OPENROUTER_API_KEY` is set, the Vercel backend uses OpenRouter instead of Anthropic, and
`/api/health` shows `"provider":"openrouter"`. Create the key at <https://openrouter.ai/keys>.
Default models: `google/gemma-4-31b-it:free` (explanations and questions; falls back to the 26B model when busy) and
`google/gemma-4-26b-a4b-it:free` (quick calls); both read images. Override them with the same
`MODEL_*` variables, using OpenRouter model names.

Limits of the free tier, shared by every visitor:
- 20 requests a minute and 50 a day (1,000 a day once you've bought 10 credits).
  One explanation, one "Tell me more" and one question already use 3.
- Free models may log or train on prompts, and EU routing is only on OpenRouter's paid business plans.
  If free models are refused, allow free-model providers that train on data in your OpenRouter privacy settings.
  **Use only fake or anonymised documents.**

## Option B – Cloudflare Worker
See [worker/README.md](worker/README.md).

The functions run in Frankfurt (`fra1`), set in `vercel.json`. This keeps Plainly's own processing in the EU;
the call to Claude still goes to Anthropic's API (see below).

## Before going beyond a prototype
- Add a bot check (e.g. Cloudflare Turnstile or Vercel Firewall rules) and per-visitor rate limits.
- Ask Anthropic about zero data retention, or run Claude via Amazon Bedrock / Google Vertex AI in an EU region.
- Sign a data processing agreement and complete a DPIA – medical documents are special-category data under the GDPR.

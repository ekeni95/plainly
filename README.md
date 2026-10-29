# Plainly – your medical papers, explained

Prototype web app that turns medical documents (letters, results, reports) into plain-language explanations in any language, with a traffic-light summary, next steps, cost cover (demo) and links to trusted procedure videos.

**How explanations work:** inside Claude (claude.ai), the app uses the visitor's own Claude account. To let anyone use it without a Claude account, deploy it with a small backend that holds your Anthropic API key – on **Vercel** (recommended, no command line: `api/`) or as a **Cloudflare Worker** (`worker/`). See **[DEPLOY.md](DEPLOY.md)**. Without a backend, the GitHub Pages version shows a notice that it needs Claude.

- Single file: `index.html`
- Interface languages: English, Deutsch, Français, Nederlands, Español
- Built to WCAG 2.2 AA; dyslexia-friendly typography (Lexend)
- Account, insurance and doctor-check features are demos with made-up data

Plainly is a prototype. It explains documents; it does not diagnose or give medical advice.

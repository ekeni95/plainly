// Lets the app check that the Plainly API is running on this site.
export function GET() {
  const provider = process.env.OPENROUTER_API_KEY ? "openrouter" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
  return new Response(JSON.stringify({ ok: true, configured: !!provider, provider }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

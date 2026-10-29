// Lets the app check that the Plainly API is running on this site.
export function GET() {
  return new Response(JSON.stringify({ ok: true, configured: !!process.env.ANTHROPIC_API_KEY }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

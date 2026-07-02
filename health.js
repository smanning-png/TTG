// Quick health check. Visit https://your-site.vercel.app/api/health in a browser.
// - If you see JSON: the API layer is deployed and working.
// - If you see a 404 page: the api/ folder isn't deployed (fix your repo/deploy).
// It also tells you whether the API key env var is set, WITHOUT revealing the key.

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    apiFunctionsDeployed: true,
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    note: process.env.ANTHROPIC_API_KEY
      ? "API key is set. If the tool still errors, check the error banner text."
      : "API key is MISSING. Add ANTHROPIC_API_KEY in your host's environment variables and redeploy."
  });
}

// Serverless proxy for the Franchise SDR Talk Track Generator.
// The browser calls THIS endpoint (same origin) with { system, messages }.
// This function adds the secret API key server-side and forwards to Anthropic,
// so the key is never exposed in the client. Deploys as a Vercel function at /api/talk-track.

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Set it in your hosting environment variables." });
    return;
  }

  try {
    // Vercel parses JSON bodies automatically; fall back to manual parse just in case.
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { system, messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Request must include a non-empty messages array." });
      return;
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 450,
        system: system || "",
        messages
      })
    });

    const data = await anthropicRes.json();

    // Pass through Anthropic's status and body so the client can handle errors uniformly.
    res.status(anthropicRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Proxy error: ${err.message}` });
  }
}

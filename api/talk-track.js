// Optional Vercel-compatible proxy for the Franchise SDR Talk Track Generator.
// Databricks Apps use server.js, but this keeps the same /api/talk-track route
// working if the project is ever deployed on a serverless host.

import { createTalkTrackResponse } from "../lib/openai-talk-track.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch (err) {
    res.status(400).json({ error: `Request body must be valid JSON: ${err.message}` });
    return;
  }

  const result = await createTalkTrackResponse(body);
  res.status(result.status).json(result.data);
}

// Quick health check. Visit https://your-site/api/health in a browser.
// - If you see JSON: the API layer is deployed and working.
// - If you see a 404 page: the server route isn't deployed.
// It also tells you whether the API key env var is set, without revealing the key.

import { getHealthPayload } from "../lib/openai-talk-track.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(getHealthPayload());
}

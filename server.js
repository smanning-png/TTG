import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createTalkTrackResponse, getHealthPayload } from "./lib/openai-talk-track.js";

function loadLocalEnv() {
  try {
    const raw = readFileSync(".env", "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`Could not load .env: ${err.message}`);
  }
}

loadLocalEnv();

const root = process.cwd();
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || process.env.DATABRICKS_APP_PORT || 3000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health") {
    sendJson(res, 200, getHealthPayload());
    return;
  }

  if (pathname === "/api/talk-track") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const result = await createTalkTrackResponse(body);
      sendJson(res, result.status, result.data);
    } catch (err) {
      sendJson(res, 400, { error: `Request body must be valid JSON: ${err.message}` });
    }
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function handleStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^[/\\]+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const bytes = await readFile(filePath);
    res.writeHead(200, {
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=3600",
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(bytes);
  } catch (err) {
    res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err.code === "ENOENT" ? "Not found" : err.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url.pathname);
    return;
  }
  await handleStatic(req, res, url.pathname);
});

server.listen(port, host, () => {
  console.log(`Talk Track Generator running on ${host}:${port}`);
});

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
});

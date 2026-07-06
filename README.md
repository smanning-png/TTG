# Franchise SDR Talk Track Generator

This folder is ready to run as a Databricks App. The SDR page calls `/api/talk-track`
on the same domain. The Node server keeps `OPENAI_API_KEY` private and sends the
request to OpenAI from the server side, so the key never appears in the browser.

The page also includes built-in backup talk tracks. If the AI call is slow, missing
a key, rate-limited, or temporarily unavailable, the rep still gets a usable next
line and can keep the call moving.

## Files

```text
talk-track-generator/
├── index.html                 # SDR-facing app
├── server.js                  # Databricks Node server
├── app.yaml                   # Databricks app runtime config
├── lib/openai-talk-track.js   # OpenAI proxy logic
├── package.json               # Node start script
├── .env.example               # Local env template
└── api/                       # Optional Vercel-compatible API files
```

## Databricks Setup

### 1. Add the OpenAI key to Databricks Secrets

Create a Databricks secret:

```bash
databricks secrets create-scope talk-track-generator
databricks secrets put-secret talk-track-generator openai-api-key
```

Then attach that secret to the Databricks App as a resource named:

```text
openai_api_key
```

`app.yaml` maps that resource into the server-only environment variable
`OPENAI_API_KEY`.

Do not paste the API key into source code, GitHub, or `app.yaml`.

### 2. Create the Databricks App

In Databricks:

1. Open the app switcher.
2. Choose **Databricks Apps**.
3. Click **Create app**.
4. Choose **Create a custom app**.
5. Name it something like `talk-track-generator`.
6. In **App resources**, add a **Secret** resource.
7. Use scope `talk-track-generator`, key `openai-api-key`, permission `READ`.
8. Set the resource name exactly to `openai_api_key`.

### 3. Upload or connect the code

Fastest path:

1. Upload this whole folder to a Databricks workspace folder.
2. In the app page, click **Deploy**.
3. Select the workspace folder that contains these files.
4. Click **Deploy**.

Git-backed path:

1. Push this folder to GitHub.
2. In the Databricks App, connect the Git repository.
3. Deploy from the branch that contains these files.

### 4. Test the API health check

After deployment, open:

```text
https://YOUR-DATABRICKS-APP-URL/api/health
```

You want:

```json
{
  "provider": "openai",
  "apiKeyConfigured": true,
  "fallbackAvailable": true
}
```

If `apiKeyConfigured` is `false`, the app is running but the secret/resource is
not wired correctly.

### 5. Test the SDR flow

1. Open the app URL.
2. Enter your first name.
3. Enter a franchise brand and industry.
4. Click **Start call**.
5. Tap a prospect response.

The next talk track should appear quickly. If OpenAI is unavailable, the built-in
backup line appears instead of stopping the call.

## Environment Variables

`OPENAI_API_KEY` is required for AI-generated turns.

Optional:

```text
OPENAI_MODEL=gpt-5.4-mini
OPENAI_MAX_OUTPUT_TOKENS=500
OPENAI_REASONING_EFFORT=low
```

The default model is `gpt-5.4-mini`, chosen for low-latency live call turns.

## Local Testing

For local testing, create a `.env` file from `.env.example` and run:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

Local testing still keeps the key server-side.

# Franchise SDR Talk Track Generator — Deployment Guide

This folder is everything you need to host the tool at a real URL for your SDR team.
It uses a small backend proxy so your Anthropic API key stays secret and never
touches the reps' browsers.

## What's in here

```
talk-track-deploy/
├── index.html            ← the tool itself (the SDR-facing page)
├── api/
│   └── talk-track.js      ← backend proxy that holds the API key and calls Anthropic
├── vercel.json            ← hosting config
└── README.md              ← this file
```

The page calls `/api/talk-track` on its own domain. That function adds the secret
key server-side and forwards the request to Anthropic. Reps never see the key.

---

## Deploy on Vercel (recommended, ~10 minutes, free tier is fine)

You'll need: an Anthropic API key (console.anthropic.com → API Keys) and a free
Vercel account (vercel.com).

### Option 1 — Drag-and-drop (no tools to install)

1. Go to **vercel.com** and sign up / log in.
2. Zip this whole `talk-track-deploy` folder (or keep it as a folder).
3. In Vercel, click **Add New… → Project**, then drag the folder in
   (or connect it from GitHub if you prefer — see Option 2).
4. Before it finishes, open **Settings → Environment Variables** and add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your Anthropic key (starts with `sk-ant-...`)
   - Apply to: Production (and Preview if you want).
5. Click **Deploy**. When it's done, Vercel gives you a URL like
   `https://your-project.vercel.app` — that's the link you share with the team.

### Option 2 — From the command line (if you have Node installed)

```bash
npm i -g vercel          # one-time install
cd talk-track-deploy
vercel                   # follow the prompts to create the project
vercel env add ANTHROPIC_API_KEY   # paste your key when asked, choose Production
vercel --prod            # deploy to your live URL
```

---

## Deploy on Netlify (alternative)

Netlify works too, with one small change: Netlify functions live in a
`netlify/functions/` folder instead of `api/`.

1. Create `netlify/functions/talk-track.js` with the same logic as `api/talk-track.js`
   (Netlify uses a slightly different handler signature — ask and I'll generate it).
2. Add a `netlify.toml` mapping `/api/talk-track` to that function.
3. In Netlify: **Site settings → Environment variables**, add `ANTHROPIC_API_KEY`.
4. Deploy the folder.

If you'd rather use Netlify, tell me and I'll hand you the Netlify-shaped files ready to go.

---

## Testing it works

1. **First, check the API layer is live.** Visit `https://YOUR-URL/api/health` in a browser.
   - You should see JSON with `"apiKeyConfigured": true`.
   - If you get a **404 page**, the `api/` folder didn't deploy — see Troubleshooting.
   - If it shows `"apiKeyConfigured": false`, your key env var isn't set — see Troubleshooting.
2. Open your deployed URL, enter your first name, start a call, tap a response.
   You should get a generated next line within a few seconds.

---

## Troubleshooting the error banner

The tool now tells you the real cause in the banner. Match it below:

| Banner says | Cause | Fix |
|---|---|---|
| **Error 404: the /api/talk-track function isn't deployed** | Only the HTML was pushed; the `api/` folder isn't in your deploy | Make sure your repo contains `api/talk-track.js` (and `api/health.js`) at the paths shown above, commit them, and redeploy. This is the most common issue. |
| **Server is missing ANTHROPIC_API_KEY** | The key env var isn't set on the host | Add `ANTHROPIC_API_KEY` in your host's Environment Variables, then **redeploy** (env changes don't apply to existing deployments until you redeploy). |
| **Error 401 / authentication_error** | The key is wrong or revoked | Paste a fresh key from console.anthropic.com and redeploy. |
| **Error 429** | Rate or spend limit hit | Check usage/limits in the Anthropic console. |
| **Connection issue (...)** | The browser couldn't reach the endpoint at all | Confirm the site is actually deployed and you're loading it over `https://` from the host (not opening the HTML file locally). |

### Most likely fix for a GitHub deploy

If you pushed to GitHub and connected it to Vercel, the **entire folder** must be in
the repo, not just `index.html`. Your repo should look exactly like this:

```
your-repo/
├── index.html
├── vercel.json
├── api/
│   ├── talk-track.js
│   └── health.js
└── README.md
```

If `api/` is missing from the repo, the function endpoint returns 404 and you get the
connection/retry banner. Add the folder, commit, push, and Vercel will redeploy.

---

## Testing it works (details)

1. Open your deployed URL.
2. Enter your first name at the sign-in screen.
3. Start a call with any brand (e.g. "Ace Hardware").
4. Tap a response — you should get a generated next line within a few seconds.
   If you see "Connection issue" or an error banner, check that
   `ANTHROPIC_API_KEY` is set in your hosting environment variables and redeploy.

---

## Security notes

- The API key lives only in the hosting environment variable, never in the HTML.
- Anyone with the URL can use the tool (and therefore spend against your API key).
  For an internal team that's usually fine; if you want to lock it down, put it
  behind your company SSO / a simple password, or Vercel's built-in password
  protection (Project → Settings → Deployment Protection).
- The model used is `claude-sonnet-4-6`. You can change it in `api/talk-track.js`.

---

## Cost

Each tapped response is one short Claude call (max 450 output tokens). On Sonnet
that's a fraction of a cent per turn. A rep doing 100 dials a day with a few turns
each is still very cheap, but monitor usage in the Anthropic console and set a
spend limit there if you want a hard ceiling.

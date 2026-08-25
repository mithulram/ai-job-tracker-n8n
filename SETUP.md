# Setup Guide

## 1. Repo secrets (required once, for the collection pipeline)

The workflow needs three repo Actions secrets. Set them at **Settings → Secrets and variables → Actions → New repository secret**, or with the GitHub CLI:

```bash
gh secret set ADZUNA_APP_ID --body "<your Adzuna app id>"
gh secret set ADZUNA_APP_KEY --body "<your Adzuna app key>"
gh secret set GROQ_API_KEY --body "<your Groq API key>"
```

Get free keys at:
- Adzuna: https://developer.adzuna.com/ (email signup, no card)
- Groq: https://console.groq.com/ (email signup, no card)

`GITHUB_TOKEN` does **not** need to be set manually — every GitHub Actions run gets one automatically, scoped to the repo, with `contents: write` + `issues: write` already declared in `.github/workflows/run.yml`.

## 2. Enable GitHub Pages

**Settings → Pages → Build and deployment → Source: "Deploy from a branch" → Branch: `main`, folder: `/docs` → Save.**

(GitHub Pages only supports serving from the repo root or a folder literally named `/docs` — that's why the dashboard lives in `docs/index.html` rather than a custom-named folder.)

The dashboard will be live at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

## 3. Point the dashboard at your repo (only if you forked/renamed)

Edit the constants at the top of the `<script>` block in `docs/index.html`:

```js
const OWNER = 'mithulram';
const REPO = 'ai-job-tracker-n8n';
const BRANCH = 'main';
const GOOGLE_CLIENT_ID = '...';   // from step 5 below
const WORKER_URL = '...';         // from step 6 below, ending in /search
```

Live search stays silently disabled (the sign-in button just doesn't render) until `GOOGLE_CLIENT_ID` is set to a real value — so it's safe to deploy the dashboard before finishing the Google/Cloudflare setup.

## 4. Customize the search

Everything editable lives in the **Config** node inside `workflows/workflow.json` (or regenerate it by editing `scripts/build_workflow.js` and running `node scripts/build_workflow.js`):

- `searchKeyword1` / `searchKeyword2` — Adzuna search phrases
- `location` / `adzunaCountry` — where to search
- `resumeText` — **replace this placeholder with your real resume text**
- `fitScoreThreshold` — minimum score to open a GitHub Issue (default 75)
- `maxJobsToScorePerRun` — caps LLM calls per run to stay inside Groq's free-tier rate limit
- `greenhouseBoard1` / `greenhouseBoard2` — any public Greenhouse company slug, e.g. `gitlab`, `stripe`

## 5. Google Sign-In setup (for live search)

You need a Google Cloud **OAuth Client ID** — free, no billing/card required for this.

1. Go to https://console.cloud.google.com/ and sign in with any Google account.
2. Top left, click the project dropdown → **New Project**. Give it any name (e.g. "job-tracker"), click **Create**, then make sure it's selected as the active project.
3. In the left sidebar (or search bar), go to **APIs & Services → OAuth consent screen**.
   - User Type: **External** → Create.
   - Fill in the required fields (app name, your email as support/contact email). You can leave scopes and test users blank/default.
   - Save through to completion. You do **not** need to submit for verification for personal/demo use — it works in "Testing" mode for your own sign-ins, or switch to "In production" if you want anyone to be able to sign in without a "unverified app" warning (still free, no card).
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: anything (e.g. "job-tracker-web").
   - **Authorized JavaScript origins** — add exactly your GitHub Pages origin, no path:
     ```
     https://<your-username>.github.io
     ```
   - Leave "Authorized redirect URIs" empty (Google Identity Services' token flow used here doesn't need one).
   - Click **Create**. Copy the **Client ID** (looks like `1234567890-abc...apps.googleusercontent.com`).
5. Paste that Client ID into `GOOGLE_CLIENT_ID` in `docs/index.html` (step 3 above) and into `worker/wrangler.toml`'s `GOOGLE_CLIENT_ID` var. Commit and push.

Nothing here is secret — OAuth Client IDs are meant to be public and are safe to commit.

## 6. Cloudflare Worker setup (live matching backend)

Free tier, no card required to sign up (verified against Cloudflare's published Workers/KV pricing docs — Workers: 100,000 requests/day; KV: 100k reads/day, 1,000 writes/day, 1GB storage). Re-check Cloudflare's current terms before relying on this, since free-tier limits can change.

1. Create a free account at https://dash.cloudflare.com/sign-up (email + password, no card).
2. Install Wrangler (Cloudflare's CLI) if you don't have it, and log in:
   ```bash
   cd worker
   npm install
   npx wrangler login   # opens a browser to authorize the CLI against your Cloudflare account
   ```
3. Create the KV namespace used for rate limiting:
   ```bash
   npx wrangler kv namespace create RATE_LIMIT_KV
   ```
   This prints an `id`. Copy it into `worker/wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "RATE_LIMIT_KV"
   id = "paste-the-id-here"
   ```
4. Edit `worker/wrangler.toml`:
   - `GOOGLE_CLIENT_ID` → the Client ID from step 5.
   - `ALLOWED_ORIGIN` → your GitHub Pages origin, e.g. `https://<your-username>.github.io`.
5. Set the one real secret (never put this in wrangler.toml or any committed file):
   ```bash
   npx wrangler secret put GROQ_API_KEY
   # paste your Groq API key when prompted
   ```
6. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints your Worker's URL, e.g. `https://ai-job-tracker-live-search.<your-subdomain>.workers.dev`.
7. Paste `<that URL>/search` into `WORKER_URL` in `docs/index.html` (step 3 above). Commit and push.

### Tuning the rate limits

`worker/src/index.js` has three constants near the top — `JOBS_PER_SEARCH`, `COOLDOWN_MS`, `DAILY_SEARCH_CAP` — sized against Groq's and Cloudflare KV's current free-tier limits (see README for the exact math). If you're on a paid Groq/Cloudflare tier, or Groq's free limits change, adjust these and redeploy with `npx wrangler deploy`.

### Local development for the Worker

```bash
cd worker
npx wrangler dev
```
This runs the Worker locally (Miniflare-backed, no Cloudflare account needed for local-only testing) at `http://localhost:8787`. Useful for testing changes before deploying.

## 7. Trigger a collection-pipeline run

- Automatically: every 3 hours via the cron in `.github/workflows/run.yml`
- Manually: **Actions tab → "Job Tracker Run" → Run workflow**

## Running the n8n workflow locally (development)

```bash
npm install -g n8n

export N8N_BLOCK_ENV_ACCESS_IN_NODE=false
export N8N_RUNNERS_ENABLED=true
export N8N_RESTRICT_FILE_ACCESS_TO=$(pwd)
export JOBS_FILE_PATH=$(pwd)/data/jobs.json
export ADZUNA_APP_ID=...
export ADZUNA_APP_KEY=...
export GROQ_API_KEY=...
export GITHUB_TOKEN=...
export GITHUB_REPOSITORY=<your-username>/ai-job-tracker-n8n

n8n import:workflow --input=workflows/workflow.json
n8n execute --id=ai-job-tracker-001
```

You can also open the n8n editor UI (`npx n8n`) and import `workflows/workflow.json` there to click through the canvas visually — see the demo script below.

---

## Demo recording script (do this locally, on your machine)

This produces the `docs/demo.gif` referenced in the README — the centerpiece evidence that this is a real, working n8n workflow, not just a diagram. The key thing to capture is **watching the run execute node-by-node on the canvas** (n8n visually lights up each node green as it completes), not just the end result.

Anything with a screen recorder works (e.g. free tools like ScreenToGif on Windows, Kap on macOS, or Peek/OBS on Linux).

1. Open a terminal in a local clone of this repo.
2. Run `npx n8n` (or `n8n start`) and wait for it to print a local URL (usually `http://localhost:5678`). Open that URL in your browser.
3. Complete the one-time n8n account setup screen (local only, no data leaves your machine).
4. Click **Import from File** (or drag-and-drop) and select `workflows/workflow.json` from this repo.
5. Zoom out (press `1` on the canvas, or use the fit-to-screen button bottom-left) so the whole graph and sticky notes are visible, and start recording here.
6. Click the orange **Execute workflow** button (bottom center).
7. **This is the important part to capture**: watch each node light up in sequence as it runs — Config → the four parallel fetches → Combine Sources → Normalize → Read/Dedupe → the IF branch → Score With Groq → Parse → the parallel Save and Alert branches. n8n draws a live progress indicator on each node and a green checkmark when it completes; let the recording run long enough to show this happening, not just the final all-green state.
8. Once finished, double-click the **Dedupe Against History** or **Create GitHub Issue** node briefly to show the actual code/config behind it (matches the close-up screenshots already in the README) — a few seconds is enough.
9. Switch tabs to `https://github.com/<your-username>/ai-job-tracker-n8n/issues` and show a newly created "🎯 NN% match: ..." issue, if one fired (only appears if a job scored ≥ the threshold that run — if none did, you can temporarily lower `fitScoreThreshold` in the Config node to force one for the demo, then set it back and re-run to keep the real threshold as the deployed behavior).
10. Switch tabs to the live dashboard (`https://<your-username>.github.io/<repo-name>/`) and refresh — show the new job card appearing with its score badge, reasoning, and Apply link.
11. Stop the recording.
12. Export/save the recording as an animated GIF (or short MP4) and save it as:

    ```
    docs/demo.gif
    ```

13. Commit and push it:

    ```bash
    git add docs/demo.gif
    git commit -m "docs: add demo recording"
    git push
    ```

That's it — the README already links to `docs/demo.gif`, so it will render automatically once the file exists.

## Screenshots for the README

Already captured and committed (`docs/screenshots/workflow-canvas.png`, `workflow-combine-sources-closeup.png`, `workflow-dedupe-closeup.png`, `workflow-github-issue-closeup.png`, `dashboard-desktop.png`, `dashboard-mobile.png`). If you customize the workflow or dashboard significantly, feel free to re-capture and overwrite these the same way (n8n canvas zoomed to fit, node detail panels open for the close-ups).

# Setup Guide

## 1. Repo secrets (required once)

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

**Settings → Pages → Build and deployment → Source: "Deploy from a branch" → Branch: `main`, folder: `/dashboard` → Save.**

The dashboard will be live at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

## 3. Point the dashboard at your repo (only if you forked/renamed)

Edit the constants at the top of the `<script>` block in `dashboard/index.html`:

```js
const OWNER = 'mithulram';
const REPO = 'ai-job-tracker-n8n';
const BRANCH = 'main';
```

## 4. Customize the search

Everything editable lives in the **Config** node inside `workflows/workflow.json` (or regenerate it by editing `scripts/build_workflow.js` and running `node scripts/build_workflow.js`):

- `searchKeyword1` / `searchKeyword2` — Adzuna search phrases
- `location` / `adzunaCountry` — where to search
- `resumeText` — **replace this placeholder with your real resume text**
- `fitScoreThreshold` — minimum score to open a GitHub Issue (default 75)
- `maxJobsToScorePerRun` — caps LLM calls per run to stay inside Groq's free-tier rate limit
- `greenhouseBoard1` / `greenhouseBoard2` — any public Greenhouse company slug, e.g. `gitlab`, `stripe`

## 5. Trigger a run

- Automatically: every 3 hours via the cron in `.github/workflows/run.yml`
- Manually: **Actions tab → "Job Tracker Run" → Run workflow**

## Running locally (development)

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

This produces the `docs/demo.gif` referenced in the README. Anything with a screen recorder works (e.g. free tools like ScreenToGif on Windows, Kap on macOS, or Peek/OBS on Linux).

1. Open a terminal in a local clone of this repo.
2. Run `npx n8n` and wait for it to print a local URL (usually `http://localhost:5678`). Open that URL in your browser.
3. Complete the one-time n8n account setup screen (local only, no data leaves your machine).
4. Click **Import from File** (or drag-and-drop) and select `workflows/workflow.json` from this repo.
5. Point the camera/recording area at the n8n canvas so the sticky notes and node layout are visible.
6. Click the **Test workflow** button (bottom right) to trigger a manual execution.
7. Let it run — you'll see each node light up green as it completes (Adzuna/Greenhouse fetch → normalize → dedupe → Groq scoring → save → GitHub Issue).
8. Once finished, switch tabs to `https://github.com/<your-username>/ai-job-tracker-n8n/issues` and show the newly created "🎯 NN% match: ..." issue (only appears if a job scored ≥ the threshold in that run — if none did, you can temporarily lower `fitScoreThreshold` in the Config node to force one for the demo, then set it back).
9. Switch tabs to the live dashboard (`https://<your-username>.github.io/ai-job-tracker-n8n/`) and refresh — show the new job card appearing with its score badge, reasoning, and Apply link.
10. Stop the recording.
11. Export/save the recording as an animated GIF (or short MP4) and save it as:

    ```
    docs/demo.gif
    ```

12. Commit and push it:

    ```bash
    git add docs/demo.gif
    git commit -m "docs: add demo recording"
    git push
    ```

That's it — the README already links to `docs/demo.gif`, so it will render automatically once the file exists.

## Screenshots for the README

While you're recording, also grab a couple of static screenshots and save them under `docs/screenshots/`:

- `docs/screenshots/dashboard.png` — the live dashboard with real job cards
- `docs/screenshots/workflow-canvas.png` — the n8n canvas with sticky notes visible
- `docs/screenshots/github-issue.png` — an example auto-created GitHub Issue

Then uncomment the matching `<img>` lines in `README.md`.

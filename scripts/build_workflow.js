// Generates workflows/workflow.json programmatically so node IDs/connections stay consistent.
// Run: node scripts/build_workflow.js
const fs = require('fs');
const path = require('path');

const uid = (n) => `node-${n}`;

const nodes = [];
const connections = {};

function addNode(n) {
  nodes.push(n);
  return n;
}

function connect(fromName, toName, fromOutput = 0, toInput = 0) {
  connections[fromName] = connections[fromName] || { main: [] };
  while (connections[fromName].main.length <= fromOutput) connections[fromName].main.push([]);
  connections[fromName].main[fromOutput].push({ node: toName, type: 'main', index: toInput });
}

// ---------- Sticky notes (documentation on canvas) ----------
addNode({
  id: uid('sticky-1'), name: 'Sticky: Overview', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
  position: [-400, -420],
  parameters: {
    width: 620, height: 260, color: 4,
    content: '## AI Job Application Tracker & Alert System\n\nRuns headlessly every 3h via GitHub Actions (`n8n execute --file=workflows/workflow.json`).\n\n1. Fetch jobs (Adzuna + Greenhouse boards)\n2. Normalize + merge sources\n3. Dedupe against data/jobs.json\n4. Score new jobs with Groq LLM against my resume\n5. Save results back to data/jobs.json\n6. Open a GitHub Issue for any match scoring >= 75\n\nEdit search keywords / location / resume text in the **Config** node below.'
  }
});

addNode({
  id: uid('sticky-2'), name: 'Sticky: Sources', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
  position: [-400, -100],
  parameters: { width: 620, height: 200, color: 5, content: '### Step 1 — Fetch job postings\nAdzuna API (Germany, role keywords from Config) + two public Greenhouse company job boards (no auth needed). Results are normalized into a common shape: job_id, title, company, location, url, description, source.' }
});

addNode({
  id: uid('sticky-3'), name: 'Sticky: Dedupe', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
  position: [420, -100],
  parameters: { width: 460, height: 200, color: 6, content: '### Step 2 — Dedupe\nReads the committed data/jobs.json (already checked out by the Action) and drops any job whose job_id has already been seen, so we only spend LLM calls on genuinely new postings.' }
});

addNode({
  id: uid('sticky-4'), name: 'Sticky: Scoring', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
  position: [980, -100],
  parameters: { width: 460, height: 200, color: 7, content: '### Step 3 — Score with Groq\nEach new job + my resume text is sent to Groq (openai/gpt-oss-120b). The model returns fit_score (0-100), reasoning, and a cover_letter_opener as strict JSON.' }
});

addNode({
  id: uid('sticky-5'), name: 'Sticky: Save & Alert', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
  position: [1500, -100],
  parameters: { width: 520, height: 260, color: 3, content: '### Step 4 — Save + Alert\nAll scored jobs (old + new) are written back to data/jobs.json, which the Action commits. Any new job with fit_score >= 75 gets a GitHub Issue opened via the GITHUB_TOKEN the Action already has — no extra signup, this is the "alert".' }
});

// ---------- Trigger ----------
addNode({ id: uid('trigger'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-380, 140], parameters: {} });

// ---------- Config ----------
addNode({
  id: uid('config'), name: 'Config', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [-140, 140],
  parameters: {
    mode: 'manual',
    duplicateItem: false,
    assignments: {
      assignments: [
        { id: 'a1a', name: 'searchKeyword1', type: 'string', value: 'Werkstudent Software Engineer' },
        { id: 'a1b', name: 'searchKeyword2', type: 'string', value: 'AI Solutions Architect' },
        { id: 'a2', name: 'location', type: 'string', value: 'Germany' },
        { id: 'a3', name: 'adzunaCountry', type: 'string', value: 'de' },
        { id: 'a4', name: 'resultsPerSource', type: 'number', value: 10 },
        { id: 'a5', name: 'fitScoreThreshold', type: 'number', value: 75 },
        { id: 'a5b', name: 'maxJobsToScorePerRun', type: 'number', value: 12 },
        { id: 'a6', name: 'githubRepo', type: 'string', value: '={{$env.GITHUB_REPOSITORY || "mithulram/ai-job-tracker-n8n"}}' },
        {
          id: 'a7', name: 'resumeText', type: 'string',
          value: 'CANDIDATE PROFILE (edit this block with your real resume text):\nMaster\'s student in Informatics at the University of Passau, Germany. Student Research Assistant (ASOA) working on automotive cybersecurity and risk/threat modeling. 3+ years of Java backend and mobile development experience with Spring Boot, Flutter, and Firebase. Core skills: Spring Boot, Flutter, Firebase, Microsoft Azure, Python, REST API design. Certifications: Microsoft Certified Azure Solutions Architect Expert, Azure Administrator Associate, Oracle Java SE 11 Developer, PCAP Python Certified Associate Programmer, Advanced C++. Career goal: transition into an AI Solutions Architect role, integrating AI/LLM systems with cloud infrastructure and scalable backend services. Currently seeking Werkstudent / part-time software engineering roles in Germany while completing the Master\'s degree, with a longer-term target of AI Solutions Architect / Cloud Engineer positions.'
        },
        { id: 'a8', name: 'greenhouseBoard1', type: 'string', value: 'gitlab' },
        { id: 'a9', name: 'greenhouseBoard2', type: 'string', value: 'stripe' }
      ]
    }
  }
});

// ---------- Fetch sources ----------
addNode({
  id: uid('adzuna'), name: 'Adzuna - Fetch Jobs (Keyword 1)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [140, -140],
  parameters: {
    url: '=https://api.adzuna.com/v1/api/jobs/{{$json.adzunaCountry}}/search/1',
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: 'app_id', value: '={{$env.ADZUNA_APP_ID}}' },
        { name: 'app_key', value: '={{$env.ADZUNA_APP_KEY}}' },
        { name: 'what', value: '={{$json.searchKeyword1}}' },
        { name: 'where', value: '={{$json.location}}' },
        { name: 'results_per_page', value: '={{$json.resultsPerSource}}' },
        { name: 'content-type', value: 'application/json' }
      ]
    },
    options: { timeout: 20000 }
  }
});

addNode({
  id: uid('adzuna2'), name: 'Adzuna - Fetch Jobs (Keyword 2)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [140, -20],
  parameters: {
    url: '=https://api.adzuna.com/v1/api/jobs/{{$json.adzunaCountry}}/search/1',
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: 'app_id', value: '={{$env.ADZUNA_APP_ID}}' },
        { name: 'app_key', value: '={{$env.ADZUNA_APP_KEY}}' },
        { name: 'what', value: '={{$json.searchKeyword2}}' },
        { name: 'where', value: '={{$json.location}}' },
        { name: 'results_per_page', value: '={{$json.resultsPerSource}}' },
        { name: 'content-type', value: 'application/json' }
      ]
    },
    options: { timeout: 20000 }
  }
});

addNode({
  id: uid('gh1'), name: 'Greenhouse - Board 1', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [140, 140],
  parameters: {
    url: '=https://boards-api.greenhouse.io/v1/boards/{{$json.greenhouseBoard1}}/jobs',
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'content', value: 'true' }] },
    options: { timeout: 20000 }
  }
});

addNode({
  id: uid('gh2'), name: 'Greenhouse - Board 2', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [140, 300],
  parameters: {
    url: '=https://boards-api.greenhouse.io/v1/boards/{{$json.greenhouseBoard2}}/jobs',
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'content', value: 'true' }] },
    options: { timeout: 20000 }
  }
});

// ---------- Combine the 4 parallel source branches into one ----------
// Without this, connecting 4 nodes directly into one Code node's input causes
// n8n to fire that Code node once per incoming branch (4x), not once with all
// data combined - since our Code node's logic runs its own full merge/dedupe
// pass each time it fires, that silently quadruples (and corrupts) the job list.
// Merge in "append" mode waits for all 4 branches and fires the next node exactly once.
addNode({
  id: uid('mergesources'), name: 'Combine Sources', type: 'n8n-nodes-base.merge', typeVersion: 3.2, position: [280, 140],
  parameters: { mode: 'append', numberInputs: 4 }
});

// ---------- Normalize & merge ----------
addNode({
  id: uid('normalize'), name: 'Normalize & Merge Sources', type: 'n8n-nodes-base.code', typeVersion: 2, position: [420, 140],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: `
function hashId(source, rawId) {
  const str = source + ':' + String(rawId);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 1200);
}

const config = $('Config').first().json;
const out = [];

// Adzuna (two keyword searches)
for (const adzunaNode of ['Adzuna - Fetch Jobs (Keyword 1)', 'Adzuna - Fetch Jobs (Keyword 2)']) {
  let adzuna;
  try { adzuna = $(adzunaNode).first().json; } catch (e) { continue; }
  for (const r of (adzuna.results || [])) {
    out.push({
      job_id: hashId('adzuna', r.id),
      title: r.title ? stripHtml(r.title) : 'Untitled role',
      company: (r.company && r.company.display_name) || 'Unknown company',
      location: (r.location && r.location.display_name) || config.location,
      url: r.redirect_url || '',
      description: stripHtml(r.description),
      source: 'adzuna',
      posted_at: r.created || null
    });
  }
}

// Greenhouse boards
for (const boardNode of ['Greenhouse - Board 1', 'Greenhouse - Board 2']) {
  let boardJson;
  try { boardJson = $(boardNode).first().json; } catch (e) { continue; }
  for (const j of (boardJson.jobs || [])) {
    out.push({
      job_id: hashId('greenhouse', j.id),
      title: j.title ? stripHtml(j.title) : 'Untitled role',
      company: boardJson.name || (boardNode.includes('1') ? config.greenhouseBoard1 : config.greenhouseBoard2),
      location: (j.location && j.location.name) || 'Unknown',
      url: j.absolute_url || '',
      description: stripHtml(j.content),
      source: 'greenhouse',
      posted_at: j.updated_at || null
    });
  }
}

// Keep only postings that look relevant to the target roles (keeps LLM-scoring volume
// within Groq's free-tier rate limits and avoids wasting calls on irrelevant jobs).
const relevanceRegex = /(software|developer|engineer|backend|full[- ]?stack|cloud|devops|architect|\bAI\b|machine learning|informatik|werkstudent)/i;
const relevant = out.filter(j => relevanceRegex.test(j.title) || relevanceRegex.test(j.description));

return relevant.map(item => ({ json: item }));
`
  }
});

// ---------- Read existing jobs.json ----------
addNode({
  id: uid('readfile'), name: 'Read Existing jobs.json', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: [420, 340],
  parameters: {
    operation: 'read',
    fileSelector: '={{$env.JOBS_FILE_PATH || "data/jobs.json"}}',
    options: {}
  }
});

// ---------- Dedupe ----------
addNode({
  id: uid('dedupe'), name: 'Dedupe Against History', type: 'n8n-nodes-base.code', typeVersion: 2, position: [700, 140],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: `
let existingJobs = [];
try {
  // Use n8n's binary-data helper rather than assuming binary.data.data is inline
  // base64 - on filesystem-backed binary storage (e.g. GitHub Actions runners)
  // it's a storage reference, not the raw content, and reading it directly
  // silently decodes to garbage instead of throwing.
  const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
  const text = buffer.toString('utf-8');
  existingJobs = JSON.parse(text || '[]');
} catch (e) {
  existingJobs = [];
}
if (!Array.isArray(existingJobs)) existingJobs = [];

const staticData = $getWorkflowStaticData('global');
staticData.existingJobs = existingJobs;

const seen = new Set(existingJobs.map(j => j.job_id));
const merged = $('Normalize & Merge Sources').all().map(i => i.json);

const seenThisRun = new Set();
const newJobs = [];
for (const job of merged) {
  if (seen.has(job.job_id) || seenThisRun.has(job.job_id)) continue;
  seenThisRun.add(job.job_id);
  newJobs.push(job);
}

if (newJobs.length === 0) {
  staticData.noNewJobs = true;
  return [{ json: { _noNewJobs: true } }];
}
staticData.noNewJobs = false;

// Cap how many jobs get sent to the LLM in a single run to stay within Groq's
// free-tier rate limits. Any jobs beyond the cap are simply picked up next run
// (they stay "new" since they're not written to jobs.json until scored).
const config = $('Config').first().json;
const cap = config.maxJobsToScorePerRun || 12;
const capped = newJobs.slice(0, cap);

return capped.map(job => ({ json: job }));
`
  }
});

// ---------- Score with Groq ----------
addNode({
  id: uid('groq'), name: 'Score With Groq', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [980, 140],
  parameters: {
    method: 'POST',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '=Bearer {{$env.GROQ_API_KEY}}' },
        { name: 'Content-Type', value: 'application/json' }
      ]
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({\n  model: "openai/gpt-oss-120b",\n  temperature: 0.2,\n  response_format: { type: "json_object" },\n  messages: [\n    { role: "system", content: "You are a strict JSON API that scores how well a candidate resume fits a job posting. Respond with ONLY a valid JSON object, no markdown, no commentary." },\n    { role: "user", content: "RESUME:\\n" + $(\'Config\').first().json.resumeText + \"\\n\\nJOB POSTING:\\nTitle: \" + $json.title + \"\\nCompany: \" + $json.company + \"\\nLocation: \" + $json.location + \"\\nDescription: \" + ($json.description || \'\').slice(0, 600) + \"\\n\\nReturn a JSON object with exactly these keys: fit_score (integer 0-100, how well the resume matches this job), reasoning (2-3 sentences explaining the score), cover_letter_opener (one enthusiastic sentence for a cover letter opener tailored to this job).\" }\n  ]\n}) }}',
    options: {
      timeout: 30000,
      batching: { batch: { batchSize: 1, batchInterval: 7000 } }
    }
  }
});

// ---------- Parse score ----------
addNode({
  id: uid('parsescore'), name: 'Parse Groq Score', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1240, 140],
  parameters: {
    mode: 'runOnceForEachItem',
    jsCode: `
const job = $('Dedupe Against History').item.json;
let parsed = { fit_score: 0, reasoning: 'Could not parse model response.', cover_letter_opener: '' };
try {
  const content = $input.item.json.choices[0].message.content;
  const p = JSON.parse(content);
  parsed = {
    fit_score: Math.max(0, Math.min(100, Math.round(Number(p.fit_score) || 0))),
    reasoning: String(p.reasoning || ''),
    cover_letter_opener: String(p.cover_letter_opener || '')
  };
} catch (e) {
  parsed.reasoning = 'Scoring error: ' + e.message;
}

return {
  json: {
    ...job,
    fit_score: parsed.fit_score,
    reasoning: parsed.reasoning,
    cover_letter_opener: parsed.cover_letter_opener,
    scored_at: new Date().toISOString()
  }
};
`
  }
});

// ---------- No new jobs passthrough (skip scoring gracefully) ----------
addNode({
  id: uid('ifnewjobs'), name: 'IF New Jobs Found', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [700, 340],
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      combinator: 'and',
      conditions: [{ id: 'c1', leftValue: '={{$json._noNewJobs}}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }]
    }
  }
});

// ---------- Merge scored + history, write file ----------
addNode({
  id: uid('mergesave'), name: 'Merge With History', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1500, 340],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: `
const staticData = $getWorkflowStaticData('global');
const existingJobs = staticData.existingJobs || [];

let newlyScored = [];
try { newlyScored = $('Parse Groq Score').all().map(i => i.json); } catch (e) { newlyScored = []; }

const all = [...existingJobs, ...newlyScored];
all.sort((a, b) => new Date(b.posted_at || b.scored_at || 0) - new Date(a.posted_at || a.scored_at || 0));

const jsonStr = JSON.stringify(all, null, 2);
return [{
  json: { totalJobs: all.length, newJobsScored: newlyScored.length },
  binary: {
    data: {
      data: Buffer.from(jsonStr, 'utf-8').toString('base64'),
      mimeType: 'application/json',
      fileName: 'jobs.json'
    }
  }
}];
`
  }
});

addNode({
  id: uid('writefile'), name: 'Write jobs.json', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: [1780, 340],
  parameters: {
    operation: 'write',
    fileName: '={{$env.JOBS_FILE_PATH || "data/jobs.json"}}',
    dataPropertyName: 'data',
    options: {}
  }
});

// ---------- High fit filter + GitHub issue ----------
addNode({
  id: uid('filterhighfit'), name: 'Filter High-Fit Matches', type: 'n8n-nodes-base.filter', typeVersion: 2.2, position: [1500, 20],
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      combinator: 'and',
      conditions: [{ id: 'f1', leftValue: '={{$json.fit_score}}', rightValue: '={{$("Config").first().json.fitScoreThreshold}}', operator: { type: 'number', operation: 'gte' } }]
    }
  }
});

addNode({
  id: uid('githubissue'), name: 'Create GitHub Issue', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1780, 20],
  parameters: {
    method: 'POST',
    url: '=https://api.github.com/repos/{{$("Config").first().json.githubRepo}}/issues',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '=Bearer {{$env.GITHUB_TOKEN}}' },
        { name: 'Accept', value: 'application/vnd.github+json' },
        { name: 'X-GitHub-Api-Version', value: '2022-11-28' }
      ]
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({\n  title: "🎯 " + $json.fit_score + "% match: " + $json.title + " @ " + $json.company,\n  body: "**Fit score:** " + $json.fit_score + "/100\\n**Company:** " + $json.company + "\\n**Location:** " + $json.location + "\\n**Source:** " + $json.source + "\\n\\n**Why it matches:**\\n" + $json.reasoning + "\\n\\n**Suggested cover letter opener:**\\n> " + $json.cover_letter_opener + "\\n\\n**Apply:** " + $json.url\n}) }}',
    options: { timeout: 20000 }
  }
});

// ---------- Wiring ----------
connect('Manual Trigger', 'Config');
connect('Config', 'Adzuna - Fetch Jobs (Keyword 1)');
connect('Config', 'Adzuna - Fetch Jobs (Keyword 2)');
connect('Config', 'Greenhouse - Board 1');
connect('Config', 'Greenhouse - Board 2');
connect('Adzuna - Fetch Jobs (Keyword 1)', 'Combine Sources', 0, 0);
connect('Adzuna - Fetch Jobs (Keyword 2)', 'Combine Sources', 0, 1);
connect('Greenhouse - Board 1', 'Combine Sources', 0, 2);
connect('Greenhouse - Board 2', 'Combine Sources', 0, 3);
connect('Combine Sources', 'Normalize & Merge Sources');
connect('Normalize & Merge Sources', 'Read Existing jobs.json');
connect('Read Existing jobs.json', 'Dedupe Against History');
connect('Dedupe Against History', 'IF New Jobs Found');
connect('IF New Jobs Found', 'Merge With History', 0, 0); // true branch (no new jobs) -> skip straight to save (writes existing jobs back unchanged)
connect('IF New Jobs Found', 'Score With Groq', 1, 0); // false branch (has new jobs) -> score them
connect('Score With Groq', 'Parse Groq Score');
connect('Parse Groq Score', 'Merge With History');
connect('Parse Groq Score', 'Filter High-Fit Matches');
connect('Merge With History', 'Write jobs.json');
connect('Filter High-Fit Matches', 'Create GitHub Issue');

const workflow = {
  id: 'ai-job-tracker-001',
  name: 'AI Job Application Tracker & Alert System',
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {}
};

const outPath = path.join(__dirname, '..', 'workflows', 'workflow.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2));
console.log('Wrote', outPath, 'with', nodes.length, 'nodes');

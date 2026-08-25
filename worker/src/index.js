/**
 * Live job-matching Worker.
 *
 * Deliberately NOT routed through n8n / GitHub Actions: a cold-start Actions
 * runner takes 30-90s to spin up, which would make an interactive "search"
 * feel broken. This Worker calls Groq directly and returns in a couple of
 * seconds. n8n stays the engine for the scheduled collection pipeline
 * (fetching + committing data/jobs.json) - this Worker only *reads* that
 * file and scores a slice of it live, per request.
 *
 * Endpoints:
 *   POST /search   { idToken, resumeText }  -> { results: [...], jobsScored, dailyRemaining }
 *   OPTIONS *       CORS preflight
 *
 * Required bindings (see wrangler.toml / README):
 *   env.RATE_LIMIT_KV   - KV namespace for per-user cooldown + shared daily counter
 *   env.GROQ_API_KEY    - secret, set via `wrangler secret put GROQ_API_KEY`
 *   env.GOOGLE_CLIENT_ID - the OAuth Client ID from Google Cloud Console (not secret,
 *                          but kept as a var so it's not hardcoded in two places)
 *   env.ALLOWED_ORIGIN  - the GitHub Pages origin allowed to call this Worker via CORS
 *
 * Tunable constants below (JOBS_PER_SEARCH, COOLDOWN_MS, DAILY_SEARCH_CAP) were sized
 * against Groq's published free-tier limits for openai/gpt-oss-120b, checked at the time
 * this was built (https://console.groq.com/docs/rate-limits):
 *   RPM 30, RPD 1000, TPM 8000, TPD 200000
 * and Cloudflare Workers KV's free tier (100k reads/day, 1000 writes/day):
 * https://developers.cloudflare.com/workers/platform/pricing/
 * Re-check both before raising these numbers - free-tier terms can change.
 */

const JOBS_PER_SEARCH = 6; // Groq calls per search. 6 jobs * ~4000-5000 tokens total keeps
// a single search comfortably under Groq's 8000 TPM, and DAILY_SEARCH_CAP * 6 stays
// well under both Groq's 1000 RPD / 200000 TPD and KV's 1000 writes/day (2 writes/search).
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h per-user cooldown
const DAILY_SEARCH_CAP = 40; // shared across all users; 40*6=240 Groq requests/day,
// ~40*4500=180000 tokens/day - both under Groq's free-tier daily caps with headroom.
const GROQ_MODEL = 'openai/gpt-oss-120b';
const JOBS_DATA_URL = 'https://raw.githubusercontent.com/mithulram/ai-job-tracker-n8n/main/data/jobs.json';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(str) {
  return new TextDecoder().decode(base64UrlDecode(str));
}

/**
 * Verifies a Google ID token's RS256 signature against Google's published JWKS,
 * and checks aud/iss/exp. Throws on any failure - callers must not proceed on error.
 * This is a real cryptographic verification (WebCrypto RSASSA-PKCS1-v1_5), not just
 * a decode-and-trust of the payload.
 */
async function verifyGoogleIdToken(idToken, expectedAudience) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64UrlDecodeToString(headerB64));
  const payload = JSON.parse(base64UrlDecodeToString(payloadB64));

  if (header.alg !== 'RS256') throw new Error('Unexpected alg: ' + header.alg);

  const jwksRes = await fetch(GOOGLE_JWKS_URL);
  if (!jwksRes.ok) throw new Error('Could not fetch Google JWKS');
  const jwks = await jwksRes.json();
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('No matching Google signing key for this token');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
  if (!valid) throw new Error('Invalid token signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('Token expired');
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('Unexpected issuer: ' + payload.iss);
  }
  if (payload.aud !== expectedAudience) throw new Error('Unexpected audience');

  return payload; // includes .sub, the stable Google user id
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function scoreJobWithGroq(job, resumeText, apiKey) {
  const body = {
    model: GROQ_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a strict JSON API that scores how well a candidate resume fits a job posting. Respond with ONLY a valid JSON object, no markdown, no commentary.',
      },
      {
        role: 'user',
        content:
          'RESUME:\n' +
          resumeText +
          '\n\nJOB POSTING:\nTitle: ' +
          job.title +
          '\nCompany: ' +
          job.company +
          '\nLocation: ' +
          job.location +
          '\nDescription: ' +
          (job.description || '').slice(0, 600) +
          '\n\nReturn a JSON object with exactly these keys: fit_score (integer 0-100, how well the resume matches this job), reasoning (2-3 sentences explaining the score), cover_letter_opener (one enthusiastic sentence for a cover letter opener tailored to this job).',
      },
    ],
  };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  let parsed = { fit_score: 0, reasoning: 'Could not parse model response.', cover_letter_opener: '' };
  try {
    const content = data.choices[0].message.content;
    const p = JSON.parse(content);
    parsed = {
      fit_score: Math.max(0, Math.min(100, Math.round(Number(p.fit_score) || 0))),
      reasoning: String(p.reasoning || ''),
      cover_letter_opener: String(p.cover_letter_opener || ''),
    };
  } catch (e) {
    parsed.reasoning = 'Scoring error: ' + e.message;
  }

  return {
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    source: job.source,
    fit_score: parsed.fit_score,
    reasoning: parsed.reasoning,
    cover_letter_opener: parsed.cover_letter_opener,
  };
}

async function handleSearch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, env);
  }

  const { idToken, resumeText } = body || {};
  if (!idToken || typeof idToken !== 'string') {
    return jsonResponse({ error: 'Missing idToken' }, 400, env);
  }
  if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length < 30) {
    return jsonResponse({ error: 'Please paste a longer resume (at least a few sentences).' }, 400, env);
  }

  let claims;
  try {
    claims = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return jsonResponse({ error: 'Sign-in verification failed: ' + e.message }, 401, env);
  }
  const userId = claims.sub;

  // --- Shared daily cap check (protects the whole app's Groq quota) ---
  const dailyKey = `dailycount:${todayKey()}`;
  const dailyCountRaw = await env.RATE_LIMIT_KV.get(dailyKey);
  const dailyCount = dailyCountRaw ? parseInt(dailyCountRaw, 10) : 0;
  if (dailyCount >= DAILY_SEARCH_CAP) {
    return jsonResponse(
      {
        error: 'daily_limit_reached',
        message: `This demo has hit its shared daily search limit (${DAILY_SEARCH_CAP}/day, sized to stay inside Groq's free tier). Please try again tomorrow (resets at 00:00 UTC).`,
      },
      429,
      env
    );
  }

  // --- Per-user cooldown check ---
  const cooldownKey = `cooldown:${userId}`;
  const cooldownUntilRaw = await env.RATE_LIMIT_KV.get(cooldownKey);
  const now = Date.now();
  if (cooldownUntilRaw) {
    const cooldownUntil = parseInt(cooldownUntilRaw, 10);
    if (now < cooldownUntil) {
      const remainingMs = cooldownUntil - now;
      return jsonResponse(
        {
          error: 'rate_limited',
          message: 'You already searched recently.',
          retryAfterMs: remainingMs,
          retryAt: new Date(cooldownUntil).toISOString(),
        },
        429,
        env
      );
    }
  }

  // --- Fetch current job pool ---
  const jobsRes = await fetch(JOBS_DATA_URL, { cf: { cacheTtl: 60 } });
  if (!jobsRes.ok) {
    return jsonResponse({ error: 'Could not load the current job pool. Try again shortly.' }, 502, env);
  }
  let jobs = await jobsRes.json();
  if (!Array.isArray(jobs)) jobs = [];

  jobs.sort((a, b) => new Date(b.posted_at || b.scored_at || 0) - new Date(a.posted_at || a.scored_at || 0));
  const toScore = jobs.slice(0, JOBS_PER_SEARCH);

  if (toScore.length === 0) {
    return jsonResponse({ results: [], jobsScored: 0, message: 'No jobs in the pool yet.' }, 200, env);
  }

  const results = [];
  for (const job of toScore) {
    try {
      const scored = await scoreJobWithGroq(job, resumeText, env.GROQ_API_KEY);
      results.push(scored);
    } catch (e) {
      // Skip a single failed job rather than failing the whole search.
      results.push({
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        source: job.source,
        fit_score: 0,
        reasoning: 'Scoring temporarily unavailable for this posting.',
        cover_letter_opener: '',
        _error: true,
      });
    }
  }
  results.sort((a, b) => b.fit_score - a.fit_score);

  // --- Record usage (2 KV writes: user cooldown + shared daily counter) ---
  await env.RATE_LIMIT_KV.put(cooldownKey, String(now + COOLDOWN_MS), { expirationTtl: Math.ceil(COOLDOWN_MS / 1000) + 60 });
  await env.RATE_LIMIT_KV.put(dailyKey, String(dailyCount + 1), { expirationTtl: 60 * 60 * 48 });

  return jsonResponse(
    {
      results,
      jobsScored: results.length,
      dailyRemaining: Math.max(0, DAILY_SEARCH_CAP - (dailyCount + 1)),
      nextSearchAt: new Date(now + COOLDOWN_MS).toISOString(),
    },
    200,
    env
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname === '/search' && request.method === 'POST') {
      return handleSearch(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404, env);
  },
};

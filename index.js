const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.SPLIT_API_KEY;
const WORKSPACE_ID = process.env.SPLIT_WORKSPACE_ID;
const ENVIRONMENT_ID = process.env.SPLIT_ENVIRONMENT_ID;

if (!API_KEY || !WORKSPACE_ID || !ENVIRONMENT_ID) {
  console.error('Missing required environment variables: SPLIT_API_KEY, SPLIT_WORKSPACE_ID, SPLIT_ENVIRONMENT_ID');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rateLimit = { limit: null, remaining: null };

function updateRateLimit(headers) {
  if (headers['x-ratelimit-limit'])     rateLimit.limit     = parseInt(headers['x-ratelimit-limit']);
  if (headers['x-ratelimit-remaining']) rateLimit.remaining = parseInt(headers['x-ratelimit-remaining']);
}

function adaptiveSleep() {
  if (rateLimit.remaining === null) return sleep(500);
  const { limit, remaining } = rateLimit;
  let ms;
  if (limit && remaining / limit < 0.1)       ms = 2000;
  else if (limit && remaining / limit < 0.25)  ms = 1000;
  else                                          ms = 100;
  console.log(`  ⏱  rate limit ${remaining}/${limit ?? '?'} remaining — sleeping ${ms}ms`);
  return sleep(ms);
}

async function apiRequest(fn, retries = 3) {
  try {
    const res = await fn();
    updateRateLimit(res.headers);
    return res;
  } catch (error) {
    if (error.response?.status === 429 && retries > 0) {
      const retryAfter = error.response.headers['retry-after'];
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 15000;
      console.log(`⏳ Rate limited — waiting ${waitMs / 1000}s before retry (${retries} left)...`);
      await sleep(waitMs);
      return apiRequest(fn, retries - 1);
    }
    throw error;
  }
}

const client = axios.create({
  baseURL: 'https://api.split.io/internal/api/v2',
  headers: { 'x-api-key': API_KEY },
});

async function listAllFlags() {
  const flags = [];
  const limit = 50;
  let offset = 0;

  while (true) {
    await adaptiveSleep();
    const { data } = await apiRequest(() => client.get(`/splits/ws/${WORKSPACE_ID}/`, {
      params: { limit, offset },
    }));

    const items = data.objects ?? data.splits ?? data.data ?? [];
    flags.push(...items);
    console.log(`  Listed ${flags.length}${data.totalCount ? ' / ' + data.totalCount : ''} flags...`);

    if ((data.totalCount && flags.length >= data.totalCount) || items.length < limit) break;
    offset += limit;
  }

  return flags;
}

async function fetchFlagDefinition(flagName) {
  await adaptiveSleep();
  const { data } = await apiRequest(() => client.get(
    `/splits/ws/${WORKSPACE_ID}/${encodeURIComponent(flagName)}/environments/${ENVIRONMENT_ID}`
  ));
  return data;
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

async function main() {
  const startTime = Date.now();
  console.log('Listing flags...');
  const flags = await listAllFlags();
  console.log(`Found ${flags.length} flags. Fetching definitions...`);

  const outDir = path.join(__dirname, 'flags');
  fs.mkdirSync(outDir, { recursive: true });

  const total = flags.length;
  for (let i = 0; i < total; i++) {
    const name = flags[i].name;
    const progress = `(${i + 1}/${total})`;
    try {
      const definition = await fetchFlagDefinition(name);
      const filePath = path.join(outDir, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(definition, null, 2));
      console.log(`  ${progress} Saved ${name}.json`);
    } catch (err) {
      if (err.response?.status === 404) {
        console.log(`  ${progress} ${name}: no definition in this environment`);
      } else {
        console.error(`  ${progress} Failed to fetch ${name}: ${err.message}`);
      }
    }
  }

  console.log(`Done. (${formatElapsed(Date.now() - startTime)})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

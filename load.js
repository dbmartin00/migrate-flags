const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.SPLIT_API_KEY;
const DEST_WORKSPACE_ID = process.env.SPLIT_DEST_WORKSPACE_ID;
const DEST_ENVIRONMENT_ID = process.env.SPLIT_DEST_ENVIRONMENT_ID;
if (!API_KEY || !DEST_WORKSPACE_ID || !DEST_ENVIRONMENT_ID) {
  console.error('Missing required environment variables: SPLIT_API_KEY, SPLIT_DEST_WORKSPACE_ID, SPLIT_DEST_ENVIRONMENT_ID');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = axios.create({
  baseURL: 'https://api.split.io/internal/api/v2',
  headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
});

const DEFINITION_FIELDS = ['treatments', 'defaultTreatment', 'baselineTreatment', 'trafficAllocation', 'rules', 'defaultRule', 'comment'];

async function validateWorkspace() {
  const { data } = await client.get('/workspaces', { params: { limit: 100, offset: 0 } });
  const workspaces = data.objects ?? data.workspaces ?? data.data ?? [];
  const match = workspaces.find((w) => w.id === DEST_WORKSPACE_ID || w.name === DEST_WORKSPACE_ID);
  if (!match) {
    const names = workspaces.map((w) => `${w.name} (${w.id})`).join('\n  ');
    console.error(`Workspace "${DEST_WORKSPACE_ID}" not found. Available workspaces:\n  ${names}`);
    process.exit(1);
  }
  console.log(`Destination workspace: ${match.name} (${match.id})`);
}

async function createFlag(flagName, trafficType) {
  await sleep(1000);
  await client.post(`/splits/ws/${DEST_WORKSPACE_ID}/trafficTypes/${encodeURIComponent(trafficType)}`, {
    name: flagName,
    description: 'Migrated from source workspace',
  });
}

async function defineFlag(flagName, definition) {
  const body = Object.fromEntries(
    Object.entries(definition).filter(([key]) => DEFINITION_FIELDS.includes(key))
  );
  await sleep(1000);
  await client.post(
    `/splits/ws/${DEST_WORKSPACE_ID}/${encodeURIComponent(flagName)}/environments/${DEST_ENVIRONMENT_ID}`,
    body
  );
}

async function main() {
  await validateWorkspace();

  const flagsDir = path.join(__dirname, 'flags');
  const files = fs.readdirSync(flagsDir).filter((f) => f.endsWith('.json'));
  const total = files.length;
  console.log(`Found ${total} flag files. Loading...`);

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const flagName = path.basename(file, '.json');
    const progress = `(${i + 1}/${total})`;
    const definition = JSON.parse(fs.readFileSync(path.join(flagsDir, file), 'utf8'));

    const trafficType = definition.trafficType?.name ?? definition.trafficType;
    if (!trafficType) {
      console.error(`  ${progress} ${flagName}: no trafficType in definition, skipping`);
      continue;
    }

    let created = false;
    try {
      await createFlag(flagName, trafficType);
      created = true;
    } catch (err) {
      if (err.response?.status === 409) {
        // Flag already exists, proceed to define
      } else {
        console.error(`  ${progress} ${flagName}: failed to create (${err.response?.status ?? err.message}), skipping`);
        continue;
      }
    }

    try {
      await defineFlag(flagName, definition);
      console.log(`  ${progress} ${flagName}: ${created ? 'created + defined' : 'already existed, defined'}`);
    } catch (err) {
      console.error(`  ${progress} ${flagName}: ${created ? 'created' : 'already existed'}, failed to define (${err.response?.status ?? err.message})`);
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

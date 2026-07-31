#!/usr/bin/env node
// Railway cron entrypoint (service: fantasy-nfl-cron, hourly).
// All schedule logic lives server-side in POST /api/cron/tick — this script
// just fires the tick and reports the outcome so failures show in cron logs.
// Env: API_URL (default prod), CRON_SECRET (must match the API service).

const url = (process.env.API_URL || 'https://api-fantasynfl.cogs.tech') + '/api/cron/tick';

fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-cron-secret': process.env.CRON_SECRET || ''
  },
  body: '{}'
})
  .then(async (r) => {
    const body = await r.json().catch(() => ({}));
    console.log(`tick ${r.status}:`, JSON.stringify(body));
    process.exit(r.ok && body.success ? 0 : 1);
  })
  .catch((e) => {
    console.error('tick failed:', e.message);
    process.exit(1);
  });

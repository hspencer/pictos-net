#!/usr/bin/env node
/**
 * Issue, list and revoke machine credentials for the PICTOS API v1.
 *
 *   node scripts/service-credentials.mjs issue  --site <siteId> --principal service:vera [--label "Vera server"] [--daily-limit 200] [--scopes comprender,componer]
 *   node scripts/service-credentials.mjs list   --site <siteId>
 *   node scripts/service-credentials.mjs revoke --site <siteId> --key <keyId>
 *   node scripts/service-credentials.mjs issue  --local
 *
 * Remote commands write the `service-credentials` blob store of the given
 * Netlify site (next.pictos.net and pictos.net are different sites) and need a
 * personal access token in NETLIFY_AUTH_TOKEN. The token `pk_…` is printed
 * once and never stored: only its sha256 reaches Blobs. `--local` stores
 * nothing; it prints a PICTOS_DEV_SERVICE_TOKEN line for the gitignored .env
 * used by `netlify dev`.
 * Node 18 compatible (runs outside the Vite build).
 */

import { getStore } from '@netlify/blobs';
import {
  CREDENTIALS_STORE, V1_SCOPES, mintServiceToken, credentialRecord,
} from '../netlify/functions/_shared/serviceCredentials.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const name = rest[i];
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[name.slice(2)] = true;
    else { flags[name.slice(2)] = next; i += 1; }
  }
  return { command, flags };
}

function remoteStore(flags) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (typeof flags.site !== 'string') throw new Error('--site <siteId> is required (Netlify site ID, not the domain)');
  if (!token) throw new Error('NETLIFY_AUTH_TOKEN is not set');
  return getStore({ name: CREDENTIALS_STORE, siteID: flags.site, token });
}

async function issue(flags) {
  const minted = mintServiceToken();
  if (flags.local) {
    console.log('# Add to the gitignored .env and restart `netlify dev`. Principal: service:dev');
    console.log(`PICTOS_DEV_SERVICE_TOKEN=${minted.token}`);
    return;
  }
  const store = remoteStore(flags);
  const record = credentialRecord({
    ...minted,
    principal: flags.principal,
    label: typeof flags.label === 'string' ? flags.label : '',
    dailyCallLimit: flags['daily-limit'] === undefined ? 200 : Number(flags['daily-limit']),
    scopes: typeof flags.scopes === 'string' ? flags.scopes.split(',').map(scope => scope.trim()) : V1_SCOPES,
  });
  await store.setJSON(`keys/${minted.keyId}`, record);
  console.error(`Issued ${minted.keyId} for ${record.principal} (${record.scopes.join(', ')}; ${record.daily_call_limit} calls/day).`);
  console.error('Store this token in the caller\'s server-side secret store now; it cannot be shown again:');
  console.log(minted.token);
}

async function list(flags) {
  const store = remoteStore(flags);
  const { blobs } = await store.list({ prefix: 'keys/' });
  for (const { key } of blobs) {
    const record = await store.get(key, { type: 'json' });
    console.log([
      record.key_id, record.principal, record.scopes.join(','), `${record.daily_call_limit}/day`,
      `created ${record.created_at}`, record.revoked_at ? `REVOKED ${record.revoked_at}` : 'active', record.label,
    ].join('  '));
  }
}

async function revoke(flags) {
  if (typeof flags.key !== 'string') throw new Error('--key <keyId> is required');
  const store = remoteStore(flags);
  const record = await store.get(`keys/${flags.key}`, { type: 'json' });
  if (!record) throw new Error(`No credential ${flags.key}`);
  if (record.revoked_at) { console.log(`${flags.key} was already revoked at ${record.revoked_at}`); return; }
  await store.setJSON(`keys/${flags.key}`, { ...record, revoked_at: new Date().toISOString() });
  console.log(`Revoked ${flags.key} (${record.principal}). Effective on the next request.`);
}

const { command, flags } = parseArgs(process.argv.slice(2));
const commands = { issue, list, revoke };
if (!commands[command]) {
  console.error('Usage: service-credentials.mjs <issue|list|revoke> [--site <siteId> | --local] …');
  process.exit(2);
}
commands[command](flags).catch(error => { console.error(error.message); process.exit(1); });

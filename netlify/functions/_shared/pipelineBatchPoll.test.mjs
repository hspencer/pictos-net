import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handler as poll } from '../api-pipeline-batch-poll.js';
import { getBlobStore } from './blobs.js';

const cwd = process.cwd();
const previous = { NETLIFY_DEV: process.env.NETLIFY_DEV, NETLIFY_BLOBS_CONTEXT: process.env.NETLIFY_BLOBS_CONTEXT };
let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-batch-poll-'));
  process.chdir(dir); process.env.NETLIFY_DEV = 'true'; delete process.env.NETLIFY_BLOBS_CONTEXT;
});
after(() => {
  process.chdir(cwd);
  for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (params, email) => poll(
  { httpMethod: 'GET', headers: {}, queryStringParameters: params },
  { clientContext: { user: { email } } },
);

test('job state and row results reach only the user who created the job', async () => {
  const jobs = getBlobStore('pipeline-jobs');
  await jobs.setJSON('owner/job/pb-1', { email: 'ana@example.org' });
  await jobs.setJSON('owner/library/lib-1', { email: 'ana@example.org', jobId: 'pb-1' });
  await jobs.setJSON('lib-1/state', { id: 'pb-1', state: 'running' });
  await jobs.setJSON('pb-1/row-1', { prompt: 'p' });

  assert.deepEqual(JSON.parse((await get({ libraryId: 'lib-1' }, 'eve@example.org')).body), { none: true });
  const stolen = await get({ libraryId: 'lib-1', jobId: 'pb-1', rowId: 'row-1' }, 'eve@example.org');
  assert.equal(stolen.statusCode, 404);
  // The failed attempt did not consume the row.
  assert.equal(JSON.parse((await get({ libraryId: 'lib-1', jobId: 'pb-1', rowId: 'row-1' }, 'ana@example.org')).body).prompt, 'p');
  assert.equal(JSON.parse((await get({ libraryId: 'lib-1' }, 'ana@example.org')).body).state, 'running');
});

test('a job without an owner record reads as none', async () => {
  const jobs = getBlobStore('pipeline-jobs');
  await jobs.setJSON('lib-2/state', { id: 'pb-2', state: 'running' });
  assert.deepEqual(JSON.parse((await get({ libraryId: 'lib-2' }, 'ana@example.org')).body), { none: true });
});

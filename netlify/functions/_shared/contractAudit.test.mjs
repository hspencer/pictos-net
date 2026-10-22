// The audit log separates "the provider answered" from "the answer meets the
// contract" (plan F2, task 2), so the usage report no longer counts rejected
// outputs as successes.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nlu from '../../../schemas/pictos-nlu-schema/tests/generation/valid.json' with { type: 'json' };
import { contractAudit } from './pipelineContracts.js';
import { getRangeSummary } from './usage.js';
import { handler as claude } from '../api-claude.js';

const toolUse = (name, input) => ({ content: [{ type: 'tool_use', id: 't', name, input }] });
const composition = { elements: [{ id: 'persona', concept: 'Agent', children: [{ id: 'vaso', concept: 'Object' }] }], prompt: "'persona' sostiene 'vaso'." };
const broken = { ...structuredClone(nlu), visual_guidelines: { ...nlu.visual_guidelines, temporal: 'AHORA-PRIVATE-VALUE' } };

test('valid phase 1 and 2 outputs pass; a broken enum fails with path and rule only', () => {
  assert.deepEqual(contractAudit(toolUse('analyze_utterance', nlu)), { ok: true, provider_ok: true, contract_ok: true });
  assert.deepEqual(contractAudit(toolUse('compose_pictogram', composition)), { ok: true, provider_ok: true, contract_ok: true });
  const rejected = contractAudit(toolUse('analyze_utterance', broken));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.provider_ok, true);
  assert.equal(rejected.contract_ok, false);
  assert.ok(rejected.contract_issues.includes('/visual_guidelines/temporal enum'));
  assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE|AHORA/);
});

test('a missing tool call fails; tools without a contract checkable here stay unjudged', () => {
  assert.equal(contractAudit({ content: [{ type: 'text', text: 'x' }] }).contract_ok, false);
  const spatial = contractAudit(toolUse('regenerate_spatial_prompt', { prompt: 'x' }));
  assert.equal(spatial.contract_ok, null);
  assert.equal(spatial.ok, true);
});

const keys = ['NETLIFY_DEV', 'NETLIFY_BLOBS_CONTEXT', 'PICTOS_ANTHROPIC_KEY'];
const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
const previousCwd = process.cwd();
let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-contract-audit-'));
  process.chdir(dir); process.env.NETLIFY_DEV = 'true'; delete process.env.NETLIFY_BLOBS_CONTEXT;
  process.env.PICTOS_ANTHROPIC_KEY = 'test-key';
});
after(() => {
  mock.restoreAll(); process.chdir(previousCwd); fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

test('the usage report counts a provider answer that breaks the contract as an error', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ model: 'claude-haiku-4-5-20251001', stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 }, ...toolUse('analyze_utterance', broken) }));
  const result = await claude({ httpMethod: 'POST', body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'x' }] }) }, {});
  assert.equal(result.statusCode, 200);                       // the response itself is unchanged
  const today = new Date().toISOString().slice(0, 10);
  const report = await getRangeSummary({ from: today, to: today });
  const haiku = report.models['claude-haiku-4-5-20251001'];
  assert.equal(haiku.calls, 1);
  assert.equal(haiku.errors, 1);
  assert.equal(haiku.contract_errors, 1);
});

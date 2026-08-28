import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { auditCorpus } from './audit-corpus.mjs';
import { createPhaseExecution } from '../netlify/functions/_shared/pipelineContracts.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('audit is reproducible, read-only, private by default and never grants training eligibility', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-corpus-audit-'));
  try {
    const nlu = { utterance: 'PRIVATE UTTERANCE', lang: 'es', frames: [], logical_form: 'PRIVATE LOGIC' };
    const composition = { elements: [{ id: 'pictograma', concept: 'Root', children: [{ id: 'persona', concept: 'Agent' }] }], prompt: "'persona' al centro" };
    const execution = await createPhaseExecution(2, { model: 'claude-haiku-4-5-20251001', system: 'PRIVATE PROMPT', messages: [] }, composition);
    const row = { id: 'private-row-id', UTTERANCE: 'PRIVATE UTTERANCE', NLU: nlu, ...composition, bitmap: 'data:image/png;base64,PRIVATEBLOB', phaseExecutions: [execution] };
    fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify({ libraries: [{ filename: 'fixture.json' }] }));
    const libraryPath = path.join(directory, 'fixture.json');
    fs.writeFileSync(libraryPath, JSON.stringify({ rows: [row, { ...row, prompt: 'changed', NLU: { ...nlu, schemaVersion: '99' } }, { id: 'invalid', NLU: '{broken json', interventionLog: { sessions: { some: 'not a function' } }, phaseExecutions: [{ phase: 1, outputHash: 'stale' }] }] }));
    const before = digest(fs.readFileSync(libraryPath));
    const report = auditCorpus(directory);
    assert.deepEqual(auditCorpus(directory), report);
    assert.equal(digest(fs.readFileSync(libraryPath)), before);
    assert.equal(report.libraries, 1);
    assert.equal(report.rows, 3);
    assert.equal(report.nlu.invalidJson, 1);
    assert.equal(report.nlu.unknownDeclaredVersion, 1);
    assert.equal(report.provenance.matchingCurrentOutput, 1);
    assert.equal(report.provenance.staleOutput, 2);
    assert.equal(report.duplicates.rowIds.repeatedOccurrences, 1);
    assert.equal(report.duplicates.normalizedUtterances.repeatedOccurrences, 1);
    assert.equal(report.trainingEligibility, 'not_assessed');
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|private-row-id|persona|fixture\.json/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('audit rejects index path traversal without opening arbitrary content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-corpus-unsafe-'));
  try {
    fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify({ libraries: [{ filename: '../private.json' }] }));
    assert.throws(() => auditCorpus(directory), /Unsafe corpus index filename/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

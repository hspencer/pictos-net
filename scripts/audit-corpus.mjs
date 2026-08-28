#!/usr/bin/env node
/** Read-only structural inventory. No utterances, row ids, prompts, provider
 * request snapshots or image/audio blobs are emitted. No training eligibility
 * is inferred from public visibility, validation or the presence of a review. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateDocument as validateNlu, validateGeneration, VERSION as NLU_VERSION } from '../schemas/nlu-schema/index.js';
import { validateDocument as validateComposition, VERSION as COMPOSITION_VERSION } from '../schemas/pictogram-composition-schema/index.js';
import { canonicalJson } from '../netlify/functions/_shared/pipelineContracts.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const contentHash = value => hash(canonicalJson(value));
const present = value => typeof value === 'string' && value.trim().length > 0;
const increment = (map, key) => { map[key] = (map[key] ?? 0) + 1; };
const duplicates = map => ({ unique: map.size, groups: [...map.values()].filter(n => n > 1).length, repeatedOccurrences: [...map.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0) });
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

export function auditCorpus(directory) {
  const indexBytes = fs.readFileSync(path.join(directory, 'index.json'));
  const index = JSON.parse(indexBytes);
  const inventory = Array.isArray(index) ? index : index.libraries;
  if (!Array.isArray(inventory)) throw new Error('Corpus index must contain a libraries array');
  const report = {
    reportVersion: 1,
    contracts: { nlu: NLU_VERSION, composition: COMPOSITION_VERSION },
    indexHash: hash(indexBytes),
    libraries: 0, rows: 0, unreadableLibraries: 0, malformedRows: 0,
    withUtterance: 0, withVisualArtifact: 0, withUtteranceAndVisualArtifact: 0,
    withAudio: 0, withInterventionEvents: 0, withExplicitReviewMetadata: 0,
    withRightsMetadata: 0, withImportOriginalValues: 0,
    nlu: { missing: 0, invalidJson: 0, structurallyValidDocument: 0, invalidDocument: 0, meetsCurrentGenerationProfile: 0, unknownDeclaredVersion: 0, withoutDeclaredVersion: 0, errorsByKeyword: {} },
    composition: { missing: 0, structurallyValid: 0, invalid: 0, unknownDeclaredVersion: 0, withoutDeclaredVersion: 0, errorsByKeyword: {} },
    provenance: { withAcceptedExecutions: 0, missingAcceptedExecutions: 0, matchingCurrentOutput: 0, staleOutput: 0, missingOutputHash: 0, inputHashMismatch: 0 },
    manifest: [],
    trainingEligibility: 'not_assessed',
    limitations: [
      'Structural validity does not establish semantic correctness or training permission.',
      'Matching hashes establish consistency with supplied metadata, not authenticity or a complete attempt archive.',
      'Duplicate ids, normalized utterances and assets flag possible relationships, not established lineage.',
      'Current-contract failures do not establish historical or semantic invalidity; no contract version is assigned retrospectively.',
      'External SVG stores and private local libraries are outside this inventory.',
    ],
  };
  const rowIds = new Map(), utterances = new Map(), payloads = new Map(), targets = new Map();
  for (const entry of inventory) {
    const filename = typeof entry === 'string' ? entry : entry.filename;
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename.endsWith('.json')) throw new Error('Unsafe corpus index filename');
    let bytes, library;
    try { bytes = fs.readFileSync(path.join(directory, filename)); library = JSON.parse(bytes); }
    catch { report.unreadableLibraries++; continue; }
    const rows = Array.isArray(library) ? library : library.rows;
    if (!Array.isArray(rows)) { report.unreadableLibraries++; continue; }
    report.libraries++;
    report.manifest.push({ index: report.manifest.length, sourceHash: hash(bytes), bytes: bytes.length, rows: rows.length });
    for (const row of rows) {
      report.rows++;
      if (!row || typeof row !== 'object' || Array.isArray(row)) { report.malformedRows++; continue; }
      count(payloads, contentHash(row));
      if (present(row.id)) count(rowIds, hash(row.id));
      const utterance = present(row.UTTERANCE);
      const assets = ['bitmap', 'rawSvg', 'structuredSvg'].filter(key => present(row[key]));
      if (utterance) { report.withUtterance++; count(utterances, hash(row.UTTERANCE.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und'))); }
      if (assets.length) report.withVisualArtifact++;
      if (utterance && assets.length) report.withUtteranceAndVisualArtifact++;
      for (const key of assets) count(targets, hash(row[key]));
      if (present(row.audio)) report.withAudio++;
      if (Array.isArray(row.interventionLog?.sessions) && row.interventionLog.sessions.some(session => Array.isArray(session?.events) && session.events.length > 0)) report.withInterventionEvents++;
      if (row.review != null || row.readinessReview != null) report.withExplicitReviewMetadata++;
      if (row.rights != null || row.consent != null) report.withRightsMetadata++;
      if (row.importOriginalValues != null) report.withImportOriginalValues++;
      const executions = Array.isArray(row.phaseExecutions) ? row.phaseExecutions : [];
      if (executions.length) report.provenance.withAcceptedExecutions++; else report.provenance.missingAcceptedExecutions++;
      const latest = phase => executions.findLast(execution => execution?.phase === phase);
      let nlu = row.NLU;
      if (nlu === '') nlu = null;
      if (typeof nlu === 'string') { try { nlu = JSON.parse(nlu); } catch { report.nlu.invalidJson++; nlu = null; } }
      if (row.NLU == null || row.NLU === '') report.nlu.missing++;
      else if (nlu != null) {
        if (validateNlu(nlu)) report.nlu.structurallyValidDocument++;
        else { report.nlu.invalidDocument++; for (const issue of validateNlu.errors ?? []) increment(report.nlu.errorsByKeyword, issue.keyword ?? 'semantic-reference'); }
        if (validateGeneration(nlu)) report.nlu.meetsCurrentGenerationProfile++;
        const version = latest(1)?.contractVersion ?? nlu.schemaVersion ?? nlu.schema_version;
        if (version === undefined) report.nlu.withoutDeclaredVersion++;
        if (version !== undefined && !['1.0.1', NLU_VERSION].includes(version)) report.nlu.unknownDeclaredVersion++;
      }
      const composition = { elements: row.elements, prompt: row.prompt };
      if (row.elements == null && !row.prompt) report.composition.missing++;
      else if (validateComposition(composition)) report.composition.structurallyValid++;
      else { report.composition.invalid++; for (const issue of validateComposition.errors ?? []) increment(report.composition.errorsByKeyword, issue.keyword ?? 'semantic-reference'); }
      if (!latest(2)?.contractVersion) report.composition.withoutDeclaredVersion++;
      if (latest(2)?.contractVersion && latest(2).contractVersion !== COMPOSITION_VERSION) report.composition.unknownDeclaredVersion++;
      for (const phase of [1, 2]) {
        const execution = latest(phase);
        if (!execution) continue;
        if (!present(execution.outputHash)) report.provenance.missingOutputHash++;
        else if ((phase !== 1 || nlu != null) && execution.outputHash === contentHash(phase === 1 ? nlu : composition)) report.provenance.matchingCurrentOutput++;
        else report.provenance.staleOutput++;
        if (execution.inputSnapshot !== undefined && execution.inputHash !== contentHash(execution.inputSnapshot)) report.provenance.inputHashMismatch++;
      }
    }
  }
  report.duplicates = { rowIds: duplicates(rowIds), normalizedUtterances: duplicates(utterances), exactRowPayloads: duplicates(payloads), visualAssets: duplicates(targets) };
  report.corpusHash = contentHash(report.manifest);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/libraries'));
  try { console.log(JSON.stringify(auditCorpus(directory), null, 2)); }
  catch { console.error('Corpus audit failed: invalid or unreadable index. No source content was printed.'); process.exitCode = 1; }
}

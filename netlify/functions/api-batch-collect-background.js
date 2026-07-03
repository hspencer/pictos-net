/**
 * Netlify Background Function: collect the results of a finished batch job.
 *
 * Spec: specs/batch-generation.allium (rules CollectResults, ApplyRowOutcome).
 * Kicked once by api-batch-status when the Vertex job reaches a terminal
 * state (SUCCEEDED, FAILED or CANCELLED — cancelled jobs still exported
 * their completed lines, so collection always runs).
 *
 * Flow: stream predictions*.jsonl from the job's GCS output prefix, hash the
 * echoed prompt of each line to recover the rowId via the manifest, and
 * write ONE blob per row into the existing gemini-jobs store under the key
 * "batchrow-{jobId}-{rowId}". The client then drains each result through the
 * already-hardened api-gemini-poll path — this function never returns image
 * bytes to anyone. Background budget (15 min) absorbs large outputs.
 */

import { getBlobStore as getStore, connectBlobs } from './_shared/blobs.js';
import { verifyIdentityUser } from './_shared/identity.js';
import {
  promptHash, listGcsObjects, downloadGcsObject, deleteGcsObject,
} from './_shared/vertexBatch.js';

export const handler = async (event, context) => {
  connectBlobs(event);

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    console.error('[api-batch-collect] Invalid JSON body');
    return;
  }
  const { libraryId } = body ?? {};
  if (!libraryId) {
    console.error('[api-batch-collect] Missing libraryId');
    return;
  }

  const jobs = getStore('batch-jobs');
  const results = getStore('gemini-jobs');

  const job = await jobs.get(libraryId, { type: 'json' }).catch(() => null);
  if (!job || job.state !== 'collecting') {
    console.warn(`[api-batch-collect] no collectable job for library ${libraryId}`);
    return;
  }

  // Background functions get no verified clientContext: verify the forwarded
  // Identity JWT via GoTrue, and only the submitter may collect.
  const user = await verifyIdentityUser(event, context);
  if (!user || (user.email !== job.ownerEmail && user.email !== 'dev')) {
    console.warn('[api-batch-collect] Unauthorized collect attempt');
    // Reset the kick flag: the next status poll carries a fresh client
    // token and will re-kick collection. An expired token must not strand
    // the job in "collecting" forever.
    job.collectRequested = false;
    await jobs.setJSON(libraryId, job);
    return;
  }

  const hashToRow = new Map(job.items.map(i => [i.promptHash, i.rowId]));
  const outcomes = new Map(); // rowId → { ok, error }

  try {
    const prefix = `batch/output/${job.id}/`;
    const objects = (await listGcsObjects(prefix)).filter(n => n.includes('predictions'));
    console.log(`[api-batch-collect] job=${job.id} predictions files=${objects.length}`);

    for (const objectPath of objects) {
      const text = await downloadGcsObject(objectPath);
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        // Correlation: hash the echoed prompt text (first text part).
        const echoedPrompt = parsed?.request?.contents?.[0]?.parts?.find(p => typeof p.text === 'string')?.text;
        const rowId = echoedPrompt ? hashToRow.get(promptHash(echoedPrompt)) : undefined;
        if (!rowId) continue;

        const status = typeof parsed.status === 'string' ? parsed.status : '';
        const parts = parsed?.response?.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

        if (!status && imagePart?.inlineData?.data) {
          const bitmap = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
          await results.setJSON(`batchrow-${job.id}-${rowId}`, { bitmap });
          outcomes.set(rowId, { ok: true });
        } else {
          const error = (status || 'Batch line returned no image data').slice(0, 300);
          await results.setJSON(`batchrow-${job.id}-${rowId}`, { error });
          outcomes.set(rowId, { ok: false, error });
        }
      }
    }

    // Rows with no output line (job cancelled mid-run) fail explicitly —
    // the spec forbids silent gaps.
    for (const item of job.items) {
      if (!outcomes.has(item.rowId)) {
        const error = 'No result in batch output';
        await results.setJSON(`batchrow-${job.id}-${item.rowId}`, { error });
        outcomes.set(item.rowId, { ok: false, error });
      }
    }

    const okCount = [...outcomes.values()].filter(o => o.ok).length;
    job.succeededCount = okCount;
    job.failedCount = job.rowCount - okCount;
    job.state = okCount > 0 ? 'completed' : 'failed';
    job.collectedAt = new Date().toISOString();
    await jobs.setJSON(libraryId, job);

    // Best-effort GCS cleanup (bucket lifecycle rule is the safety net).
    await deleteGcsObject(`batch/input/${job.id}.jsonl`);
    for (const objectPath of await listGcsObjects(prefix)) {
      await deleteGcsObject(objectPath);
    }

    console.log(`[api-batch-collect] job=${job.id} done ok=${okCount}/${job.rowCount}`);
  } catch (error) {
    console.error(`[api-batch-collect] ${error.message}`);
    // Leave the job in "collecting" with collectRequested reset so the next
    // status poll can kick collection again — transient GCS failures should
    // not strand the job.
    job.collectRequested = false;
    await jobs.setJSON(libraryId, job);
  }
};

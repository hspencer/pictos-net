/**
 * Netlify Function: PICTOS machine API v1 — COMPRENDER.
 * POST /api/v1/comprender. Contract: schemas/pictos-api/pictos-api-comprender-{request,response}-1.0.0.schema.json.
 * All behaviour lives in _shared/apiV1.js; this file only binds the process.
 */
import { createV1Handler, PROCESS_RUNNERS } from './_shared/apiV1.js';

export const handler = createV1Handler('comprender', PROCESS_RUNNERS.comprender);

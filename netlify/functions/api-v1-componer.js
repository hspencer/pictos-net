/**
 * Netlify Function: PICTOS machine API v1 — COMPONER.
 * POST /api/v1/componer. Contract: schemas/pictos-api-schema/pictos-api-componer-{request,response}-1.0.0.schema.json.
 * All behaviour lives in _shared/apiV1.js; this file only binds the process.
 */
import { createV1Handler, PROCESS_RUNNERS } from './_shared/apiV1.js';

export const handler = createV1Handler('componer', PROCESS_RUNNERS.componer);

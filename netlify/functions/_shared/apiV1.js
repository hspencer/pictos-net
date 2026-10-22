/**
 * PICTOS machine API v1: one synchronous endpoint per pipeline phase.
 *
 * Each endpoint is a thin shell around the SAME prompts and acceptance
 * boundaries the browser and the batch pipeline use (pipelineContracts.js via
 * pipelineRunner.js). Model output that fails its contract is reported as
 * output_contract_invalid and never repaired or returned.
 *
 * Callers are services, not browsers: no CORS headers are emitted, and the
 * credential is a revocable machine key bound to a service principal
 * (serviceCredentials.js), never a Netlify Identity session.
 */

import { randomUUID } from 'node:crypto';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { connectBlobs } from './blobs.js';
import { logCall } from './usage.js';
import { providerErrorDetails } from './providerError.js';
import { PipelineContractError } from './pipelineContracts.js';
import { runPhase1, runPhase2 } from './pipelineRunner.js';
import { verifyServiceCredential, chargeServiceCall } from './serviceCredentials.js';
import {
  IDEMPOTENCY_KEY_PATTERN, requestFingerprint, beginIdempotent, completeIdempotent, abandonIdempotent,
} from './idempotency.js';
import { generationSchema, documentSchema as nluDocumentSchema } from '../../../schemas/pictos-nlu-schema/index.js';
import { documentSchema as compositionDocumentSchema, providerSchema as compositionProviderSchema } from '../../../schemas/pictos-composition-schema/index.js';
import commonSchema from '../../../schemas/pictos-api-schema/pictos-api-common-1.0.0.schema.json' with { type: 'json' };
import comprenderRequestSchema from '../../../schemas/pictos-api-schema/pictos-api-comprender-request-1.0.0.schema.json' with { type: 'json' };
import comprenderResponseSchema from '../../../schemas/pictos-api-schema/pictos-api-comprender-response-1.0.0.schema.json' with { type: 'json' };
import componerRequestSchema from '../../../schemas/pictos-api-schema/pictos-api-componer-request-1.0.0.schema.json' with { type: 'json' };
import componerResponseSchema from '../../../schemas/pictos-api-schema/pictos-api-componer-response-1.0.0.schema.json' with { type: 'json' };
import producirDraftSchema from '../../../schemas/pictos-api-schema/pictos-api-producir-0.1.0-draft.schema.json' with { type: 'json' };
import estructurarDraftSchema from '../../../schemas/pictos-api-schema/pictos-api-estructurar-0.1.0-draft.schema.json' with { type: 'json' };

export const API_VERSION = 'v1';
export const EXECUTOR = 'pictos.net';
// Netlify stops synchronous functions at 60 s; leave room for auth, blobs and logging.
export const PROVIDER_BUDGET = { retries: 1, maxTotalMs: 45_000 };

export const API_SCHEMAS = [
  commonSchema, comprenderRequestSchema, comprenderResponseSchema,
  componerRequestSchema, componerResponseSchema, producirDraftSchema, estructurarDraftSchema,
];

/** A validator for API envelopes that resolves the domain contracts by $id. */
export function createApiAjv() {
  const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
  const addFormats = addFormatsModule.default ?? addFormatsModule;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  ajv.addKeyword('x-status');
  for (const schema of [generationSchema, nluDocumentSchema, compositionDocumentSchema, compositionProviderSchema, ...API_SCHEMAS]) {
    ajv.addSchema(schema);
  }
  return ajv;
}

/**
 * Registry of the four process boundaries. Only implemented ones are served;
 * producir and estructurar are declared so their contracts are published and
 * tested before any endpoint exists.
 */
export const PROCESSES = {
  comprender: {
    implemented: true, phase: 1, version: 'nlu-1.1.0',
    requestSchema: comprenderRequestSchema.$id, responseSchema: comprenderResponseSchema.$id,
    artifactSchema: { id: generationSchema.$id, version: '1.1.0' },
  },
  componer: {
    implemented: true, phase: 2, version: 'composition-0.1.0',
    requestSchema: componerRequestSchema.$id, responseSchema: componerResponseSchema.$id,
    artifactSchema: { id: compositionDocumentSchema.$id, version: '0.1.0' },
  },
  producir: {
    implemented: false, phase: 3, version: '0.1.0-draft', asynchronous: true,
    requestSchema: `${producirDraftSchema.$id}#/$defs/Request`, responseSchema: `${producirDraftSchema.$id}#/$defs/Response`,
  },
  estructurar: {
    implemented: false, phase: 4, version: '0.1.0-draft', optional: true,
    requestSchema: `${estructurarDraftSchema.$id}#/$defs/Request`, responseSchema: `${estructurarDraftSchema.$id}#/$defs/Response`,
  },
};

/** Real executors: the shared phase runners, bounded for a synchronous function. */
export const PROCESS_RUNNERS = {
  comprender: {
    async run({ utterance, config = {}, model }) {
      let execution;
      const output = await runPhase1(utterance, { ...config, ...(model ? { comprenderModel: model } : {}) },
        recorded => { execution = recorded; }, PROVIDER_BUDGET);
      return { output, execution };
    },
  },
  componer: {
    inputPath: '/nlu',
    async run({ nlu, config = {}, model }) {
      let execution;
      const output = await runPhase2(nlu, { ...config, ...(model ? { componerModel: model } : {}) },
        recorded => { execution = recorded; }, PROVIDER_BUDGET);
      return { output, execution };
    },
  },
};

const STATUS_BY_CODE = {
  invalid_request: 400, unauthorized: 401, forbidden: 403, method_not_allowed: 405,
  idempotency_in_progress: 409, idempotency_key_reused: 422, input_contract_invalid: 422,
  quota_exceeded: 429, internal_error: 500, output_contract_invalid: 502,
  provider_error: 502, provider_unavailable: 503,
};

export class ApiError extends Error {
  constructor(code, message, { retryable = false, issues, retryAfterMs } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.issues = issues;
    this.retryAfterMs = retryAfterMs;
  }
}

function issuesFrom(errors = []) {
  return errors.map(error => {
    const extra = error.params?.unevaluatedProperty ?? error.params?.additionalProperty;
    return { path: error.instancePath || '/', message: extra ? `${error.message}: ${extra}` : (error.message ?? 'is invalid') };
  });
}

function respond(status, body, requestId, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-Id': requestId, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

export function errorResponse(processName, requestId, error) {
  const detail = {
    code: error.code, message: error.message, retryable: error.retryable,
    ...(error.issues?.length ? { issues: error.issues } : {}),
    ...(Number.isFinite(error.retryAfterMs) ? { retry_after_ms: Math.max(0, Math.round(error.retryAfterMs)) } : {}),
  };
  const body = {
    api_version: API_VERSION, executor: EXECUTOR, request_id: requestId,
    process: { name: processName, version: PROCESSES[processName].version }, error: detail,
  };
  const headers = error.code === 'unauthorized' ? { 'WWW-Authenticate': 'Bearer realm="pictos.net"' } : {};
  return respond(STATUS_BY_CODE[error.code] ?? 500, body, requestId, headers);
}

/** Map a runner failure without echoing provider bodies or model output. */
export function classifyFailure(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof PipelineContractError) {
    return new ApiError('output_contract_invalid', 'The model output did not satisfy the artifact contract and was rejected without repair.', {
      retryable: true, issues: issuesFrom(error.issues),
    });
  }
  if (error?.provider || error?.status || error?.statusCode) {
    const details = providerErrorDetails(error);
    return new ApiError(details.retryable ? 'provider_unavailable' : 'provider_error',
      `Provider ${details.provider} failed${details.providerStatus ? ` (HTTP ${details.providerStatus})` : ''}.`,
      { retryable: details.retryable, retryAfterMs: details.retryAfterMs ?? undefined });
  }
  return new ApiError('internal_error', 'Unexpected pictos.net failure.', { retryable: false });
}

function headerValue(headers = {}, name) {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1];
}

/**
 * Build a Netlify handler for one implemented process.
 *
 * spec.run(body) → { output, execution } where execution is the PhaseExecution
 * produced by createPhaseExecution. spec.inputPath marks request paths whose
 * failure is a domain input contract failure rather than an envelope error.
 * deps overrides stores, logging and the clock (tests).
 */
export function createV1Handler(processName, spec, deps = {}) {
  const definition = PROCESSES[processName];
  if (!definition?.implemented) throw new Error(`Process ${processName} is not implemented in API v1`);
  let validateRequest;

  return async function handler(event) {
    const requestId = randomUUID();
    const fail = error => errorResponse(processName, requestId, error);
    if (event.httpMethod !== 'POST') {
      const response = fail(new ApiError('method_not_allowed', 'Use POST.'));
      response.headers.Allow = 'POST';
      return response;
    }
    if (!deps.skipBlobsConnect) connectBlobs(event);

    const credential = await verifyServiceCredential(event.headers, { ...(deps.credentialStore ? { store: deps.credentialStore } : {}) });
    if (!credential.ok) return fail(new ApiError('unauthorized', 'A valid, unrevoked machine credential is required.'));
    if (!credential.scopes.includes(processName)) {
      return fail(new ApiError('forbidden', `This credential is not granted the ${processName} process.`));
    }

    let body;
    try { body = JSON.parse(event.body ?? ''); } catch {
      return fail(new ApiError('invalid_request', 'The request body must be JSON.'));
    }
    validateRequest ??= (deps.ajv ?? createApiAjv()).getSchema(definition.requestSchema);
    if (!validateRequest(body)) {
      const issues = issuesFrom(validateRequest.errors);
      const inputOnly = spec.inputPath && issues.every(issue => issue.path === spec.inputPath || issue.path.startsWith(`${spec.inputPath}/`));
      return fail(inputOnly
        ? new ApiError('input_contract_invalid', `The ${spec.inputPath.slice(1)} input does not satisfy its contract.`, { issues })
        : new ApiError('invalid_request', `The request does not match ${definition.requestSchema}.`, { issues }));
    }

    const idempotencyKey = headerValue(event.headers, 'idempotency-key') ?? null;
    if (idempotencyKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return fail(new ApiError('invalid_request', 'Idempotency-Key must match ^[A-Za-z0-9._:-]{8,128}$.'));
    }
    const idem = idempotencyKey && {
      principal: credential.principal, processName, key: idempotencyKey, fingerprint: requestFingerprint(body),
      ...(deps.idempotencyStore ? { store: deps.idempotencyStore } : {}),
    };
    if (idem) {
      const begun = await beginIdempotent(idem);
      if (begun.state === 'replay') {
        return respond(begun.status, { ...begun.body, replayed: true }, begun.body.request_id, { 'Idempotent-Replayed': 'true' });
      }
      if (begun.state === 'conflict') {
        return fail(new ApiError('idempotency_key_reused', 'This Idempotency-Key was already used with a different request body.'));
      }
      if (begun.state === 'in_progress') {
        return fail(new ApiError('idempotency_in_progress', 'A request with this Idempotency-Key is still running.', { retryable: true, retryAfterMs: 5000 }));
      }
    }

    const quota = await chargeServiceCall(credential.principal, credential.dailyCallLimit,
      { ...(deps.quotaStore ? { store: deps.quotaStore } : {}), ...(deps.now ? { now: deps.now() } : {}) });
    if (!quota.allowed) {
      if (idem) await abandonIdempotent(idem);
      return fail(new ApiError('quota_exceeded', `Daily call quota of ${credential.principal} exhausted (${quota.used}/${quota.limit}, UTC day).`, { retryable: true }));
    }

    const started = Date.now();
    const log = deps.logCall ?? logCall;
    try {
      const { output, execution } = await spec.run(body);
      const durationMs = Date.now() - started;
      const success = {
        api_version: API_VERSION, executor: EXECUTOR, request_id: requestId,
        idempotency_key: idempotencyKey, replayed: false,
        process: { name: processName, version: execution.promptVersion },
        schema: { id: execution.contractId, version: execution.contractVersion },
        model: { requested: execution.model, actual: execution.actualModel ?? null, provider: execution.provider },
        evidence: {
          contract_hash: execution.contractHash, prompt_hash: execution.promptHash,
          input_hash: execution.inputHash, output_hash: execution.outputHash,
          usage: execution.usage ?? null, duration_ms: execution.durationMs ?? durationMs,
          provider_request_id: execution.providerRequestId ?? null,
        },
        quota: { used: quota.used, limit: quota.limit },
        output,
      };
      if (idem) await completeIdempotent({ ...idem, status: 200, body: success });
      await log({
        email: credential.principal, phase: `api-v1-${processName}`, model: execution.model, units_charged: 0,
        ms: durationMs, tokens_in: execution.usage?.input_tokens ?? 0, tokens_out: execution.usage?.output_tokens ?? 0, ok: true,
      });
      return respond(200, success, requestId);
    } catch (thrown) {
      const error = classifyFailure(thrown);
      if (idem) await abandonIdempotent(idem);
      await log({
        email: credential.principal, phase: `api-v1-${processName}`, model: body.model ?? 'default', units_charged: 0,
        ms: Date.now() - started, tokens_in: thrown?.usage?.input_tokens ?? 0, tokens_out: thrown?.usage?.output_tokens ?? 0,
        ok: false, error_msg: error.code,
      });
      if (error.code === 'internal_error') console.error(`[api-v1-${processName}] request=${requestId}`, thrown?.message);
      return fail(error);
    }
  };
}

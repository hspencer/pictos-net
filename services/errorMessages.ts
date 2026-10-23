/**
 * One translated message per failure cause, each with the action to take
 * (plan F3). Classification uses error types and tags (kind, stage,
 * failureSource), never message text, except for the provider's finish
 * reason, which the server puts in the message on purpose.
 */
import { ExternalProviderQuotaError, ProviderRequestError, QuotaExceededError } from './providerErrors.ts';
import { ModelUnavailableError } from '../netlify/functions/_shared/modelCatalog.js';

type T = (key: string, vars?: Record<string, any>) => string;

// Finish or block reasons that mean the provider's safety filter stopped the image.
const SAFETY_REASONS = /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/;

export function describeError(err: unknown, t: T): string {
  const e = err as any;
  const ref = e?.requestId || '—';
  if (err instanceof ModelUnavailableError) return t('messages.modelNotAvailable', { model: e.label });
  if (err instanceof QuotaExceededError) return t('messages.errorPictosQuota', { used: e.units_used, limit: e.limit });
  if (e?.kind === 'timeout') return t('messages.errorTimeout');
  if (e?.kind === 'session') return t('messages.errorSession');
  if (err instanceof TypeError && /fetch/i.test(e.message)) return t('messages.errorNetwork');
  if (e?.code === 'pipeline_contract_invalid') {
    const fields = [...new Set((e.issues ?? []).map((i: any) => i.instancePath || '/'))].slice(0, 6).join(', ') || '/';
    return e.stage === 'input'
      ? t('messages.errorStoredDataNeedsReview', { fields })
      : t('messages.errorContractInvalid', { fields });
  }
  if (e?.kind === 'no_tool') return t('messages.errorContractInvalid', { fields: '/' });
  if (err instanceof ExternalProviderQuotaError) return t('messages.errorProviderQuota', { provider: e.provider, ref });
  if (err instanceof ProviderRequestError) {
    if (e.failureSource === 'no_image') {
      const reason = /finishReason=([A-Z_]+)/.exec(e.message)?.[1] ?? /blockReason=([A-Z_]+)/.exec(e.message)?.[1] ?? 'none';
      const blocked = SAFETY_REASONS.test(e.message);
      return t(blocked ? 'messages.errorNoImageBlocked' : 'messages.errorNoImage', { reason, ref });
    }
    if (e.failureSource === 'external_provider_billing') return t('messages.errorProviderBilling', { provider: e.provider, ref });
    return t('messages.errorProvider', {
      provider: e.provider, status: e.providerStatus ?? '—', ref,
      retry: t(e.retryable ? 'messages.errorRetryable' : 'messages.errorNotRetryable'),
    });
  }
  return e?.message ?? String(err);
}

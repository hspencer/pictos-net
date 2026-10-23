import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeError } from './errorMessages.ts';
import { QuotaExceededError, ExternalProviderQuotaError, ProviderRequestError } from './providerErrors.ts';
import { ModelUnavailableError } from '../netlify/functions/_shared/modelCatalog.js';

for (const lang of ['es-419', 'en-GB']) {
  const catalog = JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'));
  const used: string[] = [];
  const t = (key: string, vars: Record<string, any> = {}) => {
    used.push(key);
    const value = key.split('.').reduce((node: any, part) => node?.[part], catalog);
    assert.equal(typeof value, 'string', `${lang}: missing ${key}`);
    return value.replace(/\{(\w+)\}/g, (_: string, k: string) => String(vars[k]));
  };
  const say = (err: unknown) => { used.length = 0; const text = describeError(err, t); return { text, key: used[used.length - 1] }; };

  test(`${lang}: every cause has its own complete message and leaks no provider text`, () => {
    const cases: [unknown, string][] = [
      [new ModelUnavailableError('gemini-2.5-pro'), 'messages.modelNotAvailable'],
      [new QuotaExceededError(50, 50), 'messages.errorPictosQuota'],
      [Object.assign(new Error('Tiempo de espera agotado'), { kind: 'timeout' }), 'messages.errorTimeout'],
      [Object.assign(new Error('Sesión expirada'), { kind: 'session' }), 'messages.errorSession'],
      [new TypeError('Failed to fetch'), 'messages.errorNetwork'],
      [Object.assign(new Error('PROVIDER-TEXT'), { code: 'pipeline_contract_invalid', stage: 'input', issues: [{ instancePath: '/metadata/intent' }, { instancePath: '/metadata/intent' }] }), 'messages.errorStoredDataNeedsReview'],
      [Object.assign(new Error('PROVIDER-TEXT'), { code: 'pipeline_contract_invalid', issues: [{ instancePath: '/frames/0' }] }), 'messages.errorContractInvalid'],
      [Object.assign(new Error('PROVIDER-TEXT'), { kind: 'no_tool' }), 'messages.errorContractInvalid'],
      [new ExternalProviderQuotaError('gemini', 'gemini-3-pro-image', 'ref-q'), 'messages.errorProviderQuota'],
      [new ProviderRequestError('Gemini returned no image (finishReason=IMAGE_SAFETY)', 'gemini', null, 'job-1', true, null, 1, 'no_image'), 'messages.errorNoImageBlocked'],
      [new ProviderRequestError('Gemini returned no image (finishReason=STOP)', 'gemini', null, 'job-2', true, null, 1, 'no_image'), 'messages.errorNoImage'],
      [new ProviderRequestError('PROVIDER-TEXT', 'anthropic', 402, 'ref-b', false, null, 1, 'external_provider_billing'), 'messages.errorProviderBilling'],
      [new ProviderRequestError('PROVIDER-TEXT', 'openai', 500, 'ref-p', true), 'messages.errorProvider'],
    ];
    for (const [err, key] of cases) {
      const { text, key: first } = say(err);
      assert.equal(first, key, `${lang}: ${(err as Error).message}`);
      assert.doesNotMatch(text, /\{\w+\}|undefined|PROVIDER-TEXT/, `${lang}: ${key} -> ${text}`);
    }
    assert.match(say(cases[5][0]).text, /\/metadata\/intent/);
    assert.doesNotMatch(say(cases[5][0]).text, /intent, \/metadata\/intent/);      // paths deduplicated
    assert.match(say(cases[9][0]).text, /IMAGE_SAFETY.*job-1/);
  });
}

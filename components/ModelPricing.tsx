import React from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { MODEL_CATALOG } from '../netlify/functions/_shared/modelCatalog.js';
import { formatModelPrice, modelPriceNotes } from '../services/modelPricing';

export function ModelPricing({ model, quality }: { model: string; quality?: string }) {
  const { t } = useTranslation();
  const entry = Object.hasOwn(MODEL_CATALOG, model) ? MODEL_CATALOG[model] : undefined;
  if (!entry) return null;
  return <div className="text-[11px] text-slate-500 space-y-1">
    <p>{formatModelPrice(model, t, quality)}. {modelPriceNotes(model, t).join(' ')}</p>
    <p><a href={entry.pricingSource} target="_blank" rel="noopener noreferrer" className="underline">
      {t('config.priceSource')}
    </a>{' · '}{t('config.priceChecked', { date: entry.pricingCheckedAt })}</p>
  </div>;
}

/** Pure state transition for a terminal provider 429 in any pipeline phase. */
export function openProviderQuotaCircuit(jobState, rows, rowIndex, refundApplied, failure = {}) {
  const deferredRows = rows.slice(rowIndex + 1);
  const refundableUnits = deferredRows.length + 1;
  return {
    deferredRows,
    refundableUnits,
    state: {
      ...jobState,
      state: 'provider_quota_blocked',
      providerQuotaBlockedAtRowId: rows[rowIndex].rowId,
      ...(failure.provider ? { providerQuotaBlockedProvider: failure.provider, providerQuotaBlockedPhase: failure.phase, failureSource: failure.failureSource } : {}),
      refundedGenerationUnits: (jobState.refundedGenerationUnits ?? 0) + (refundApplied ? refundableUnits : 0),
      failedCount: jobState.rowCount - jobState.succeededCount,
    },
  };
}

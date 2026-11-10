// Read-only, explicitly invoked diagnostic. Never emits credentials or payloads.
// Run: node --env-file=.env research/diagnose-vertex.mjs
import { getVertexAccessToken } from '../netlify/functions/_shared/vertex.js';
async function main() {
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
const project = process.env.VERTEX_PROJECT_ID || credentials.project_id;
if (!project || !/^[a-z0-9-]+$/.test(project)) throw new Error('Valid Vertex project required');
const token = await getVertexAccessToken();
const headers = { Authorization: `Bearer ${token}` };
const safeError = (data, status) => ({ status, code: data?.error?.status || null,
 reasons: (data?.error?.details || []).map(d => d.reason).filter(x => typeof x === 'string' && /^[A-Z_]+$/.test(x)) });
async function read(url) {
 const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
 const data = await response.json();
 return response.ok ? { data } : { error: safeError(data, response.status) };
}
console.log(JSON.stringify({ project, location: process.env.VERTEX_LOCATION || 'global', windowHours: 24 }));
const quotas = await read(`https://cloudquotas.googleapis.com/v1/projects/${project}/locations/global/services/aiplatform.googleapis.com/quotaInfos?pageSize=100`);
console.log(JSON.stringify({ kind: 'quotaInfos', error: quotas.error, truncated: !!quotas.data?.nextPageToken,
 quotas: quotas.data?.quotaInfos?.filter(q => /gemini|generate|prediction/i.test(`${q.quotaId} ${q.metric}`)).map(q => ({
  quotaId: q.quotaId, metric: q.metric, isFixed: q.isFixed, isPrecise: q.isPrecise,
  dimensions: q.dimensions, dimensionsInfo: q.dimensionsInfos?.map(d => ({ dimensions: d.dimensions, value: d.details?.value })),
 })) }));
const query = new URLSearchParams({
 filter: 'metric.type="aiplatform.googleapis.com/publisher/online_serving/model_invocation_count"',
 'interval.startTime': new Date(Date.now() - 86400000).toISOString(),
 'interval.endTime': new Date().toISOString(),
 'aggregation.alignmentPeriod': '86400s', 'aggregation.perSeriesAligner': 'ALIGN_SUM', pageSize: '1000', view: 'FULL',
});
const metrics = await read(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${query}`);
const counts = new Map();
for (const series of metrics.data?.timeSeries || []) {
 const key = JSON.stringify({ model: series.resource?.labels?.model_user_id || series.resource?.labels?.model_id,
  location: series.resource?.labels?.location, responseCode: series.metric?.labels?.response_code,
  errorCategory: series.metric?.labels?.error_category });
 const count = (series.points || []).reduce((sum,p) => sum + Number(p.value?.int64Value || 0), 0);
 counts.set(key, (counts.get(key) || 0) + count);
}
console.log(JSON.stringify({ kind: 'invocations', error: metrics.error, truncated: !!metrics.data?.nextPageToken,
 counts: [...counts].map(([key,count]) => ({ ...JSON.parse(key), count })) }));

}
main().catch(() => { console.error(JSON.stringify({error: "Diagnostic unavailable; no credential or provider payload emitted"})); process.exitCode = 1; });

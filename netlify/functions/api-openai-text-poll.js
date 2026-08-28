import { connectBlobs, getBlobStore } from './_shared/blobs.js';

export const handler = async (event, context) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });
  const user = context?.clientContext?.user;
  const local = process.env.NETLIFY_DEV === 'true';
  if (!local && !user?.email) return reply(401, { error: 'Unauthorized' });
  const jobId = event.queryStringParameters?.jobId;
  if (typeof jobId !== 'string' || !/^openai-struct-[a-zA-Z0-9-]{1,100}$/.test(jobId)) return reply(400, { error: 'Invalid jobId' });
  connectBlobs(event);
  const store = getBlobStore('openai-text-jobs');
  const result = await store.get(jobId, { type: 'json' });
  if (!result) return reply(200, { pending: true });
  if (!local && result.owner !== user.email) return reply(403, { error: 'Forbidden' });
  const { owner, ...payload } = result;
  if (payload.response || payload.error) await store.delete(jobId);
  return reply(200, payload);
};

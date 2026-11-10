// Operational script: no credential values are printed or passed as CLI arguments.
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { NetlifyAPI } from '/opt/homebrew/lib/node_modules/netlify-cli/node_modules/@netlify/api/lib/index.js';
import { GoogleAuth } from 'google-auth-library';

const root = '/Users/hspencer/Sites/pictos-net';
const project = 'pictos-vertex-gmail';
const accountId = '697d5e4c404c6542af20217d';
const sites = [
  { name: 'next.pictos.net', id: 'c3a0cb25-110a-49a6-9d9b-05ccf7a72347' },
  { name: 'pictos.net', id: '24f068d3-f368-4526-a503-2f09af1def0b' },
];
const cfg = JSON.parse(fs.readFileSync('/Users/hspencer/Library/Preferences/netlify/config.json', 'utf8'));
const api = new NetlifyAPI(cfg.users[cfg.userId].auth.token);
const key = 'GOOGLE_SERVICE_ACCOUNT_JSON';
const emit = value => console.log(JSON.stringify(value));
const getEnv = (siteId, key) => api.getEnvVar({ accountId, siteId, key });
let stage = 'netlify-source';

async function main() {
  const source = await getEnv(sites[0].id, key);
  const raw = source.values.find(v => v.context === 'dev')?.value;
  const credential = JSON.parse(raw);
  if (credential.project_id !== project || credential.type !== 'service_account' || !credential.private_key) {
    throw new Error('Unexpected source credential');
  }
  const google = new GoogleAuth({ credentials: credential, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  stage = 'google-count-tokens-probe';
  const client = await google.getClient();
  const response = await client.request({
    url: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/gemini-2.5-flash-image:countTokens`,
    method: 'POST',
    data: { contents: [{ role: 'user', parts: [{ text: 'A cup of water.' }] }] },
  });
  emit({ project, credentialAuthenticated: true, probe: 'countTokens', model: 'gemini-2.5-flash-image', status: response.status, totalTokens: response.data.totalTokens });
  if (!Number.isFinite(response.data.totalTokens)) throw new Error('Token counting not verified');

  const current = [];
  stage = 'netlify-sites';
  for (const site of sites) {
    const meta = await api.getSite({ siteId: site.id });
    emit({ site: site.name, branch: meta.build_settings?.repo_branch, publishedCommit: meta.published_deploy?.commit_ref, publishedDeploy: meta.published_deploy?.id });
    const entries = {};
    for (const name of [key, 'VERTEX_PROJECT_ID', 'VERTEX_LOCATION']) {
      try { entries[name] = await getEnv(site.id, name); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    current.push({ site, entries });
  }
  if (!process.argv.includes('--apply')) return;
  stage = 'local-backup';

  const backupDir = `${root}/.netlify/vertex-audit`;
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const envFiles = ['.env', '.env.local'].filter(file => fs.existsSync(`${root}/${file}`));
  const local = envFiles.map(file => {
    const text = fs.readFileSync(`${root}/${file}`, 'utf8');
    const parsed = parseEnv(text);
    if (parsed[key] && parseEnv(text.split('\n').find(line => line.startsWith(`${key}=`)) || '')[key] !== parsed[key]) {
      throw new Error('Multiline local credential requires manual-safe editing');
    }
    fs.writeFileSync(`${backupDir}/${file}.before-20260828`, text, { flag: 'wx', mode: 0o600 });
    return { file, text };
  });

  for (const { site, entries } of current) {
    for (const name of [key, 'VERTEX_PROJECT_ID', 'VERTEX_LOCATION']) {
      stage = `netlify-update:${site.name}:${name}`;
      const old = entries[name];
      const secret = name === key;
      const value = secret ? JSON.stringify(credential) : name === 'VERTEX_PROJECT_ID' ? project : 'global';
      const contexts = secret
        ? (old?.values || source.values).map(v => ({ context: v.context, ...(v.context_parameter ? { context_parameter: v.context_parameter } : {}), value }))
        : [{ context: 'all', value }];
      const body = { key: name, is_secret: secret, scopes: old?.scopes || ['functions'], values: contexts };
      if (old) await api.updateEnvVar({ accountId, siteId: site.id, key: name, body });
      else await api.createEnvVars({ accountId, siteId: site.id, body: [body] });
      const saved = await getEnv(site.id, name);
      if (secret) {
        if (!saved.is_secret || JSON.parse(saved.values.find(v => v.context === 'dev').value).project_id !== project) {
          throw new Error('Credential metadata verification failed');
        }
      } else if (!saved.values.some(v => v.context === 'all' && v.value === value)) {
        throw new Error('Environment override verification failed');
      }
      emit({ site: site.name, updated: name, secret: saved.is_secret, scopes: saved.scopes, contexts: saved.values.map(v => v.context), project });
    }
  }

  for (const { file, text } of local) {
    stage = `local-update:${file}`;
    let result = text;
    for (const [name, value] of Object.entries({ [key]: JSON.stringify(credential), VERTEX_PROJECT_ID: project, VERTEX_LOCATION: 'global' })) {
      const re = new RegExp(`^${name}=.*$`, 'm');
      result = re.test(result) ? result.replace(re, () => `${name}=${value}`) : `${result.replace(/\n?$/, '\n')}${name}=${value}\n`;
    }
    const parsed = parseEnv(result);
    if (JSON.parse(parsed[key]).project_id !== project || parsed.VERTEX_PROJECT_ID !== project || parsed.VERTEX_LOCATION !== 'global') {
      throw new Error('Local environment verification failed');
    }
    fs.writeFileSync(`${root}/${file}`, result);
    emit({ file, project: parsed.VERTEX_PROJECT_ID, location: parsed.VERTEX_LOCATION, verified: true });
  }
}

main().catch(error => {
  // SDK errors can contain request headers/body. Never print the error object.
  emit({ failed: true, stage, name: error.name, status: error.status || error.response?.status || null, reasons: (error.response?.data?.error?.details || []).map(d => d.reason).filter(Boolean) });
  process.exitCode = 1;
});

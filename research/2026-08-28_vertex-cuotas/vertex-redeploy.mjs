// Rebuild published remote code only; never deploy the dirty local checkout.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { NetlifyAPI } from '/opt/homebrew/lib/node_modules/netlify-cli/node_modules/@netlify/api/lib/index.js';
const cfg = JSON.parse(fs.readFileSync('/Users/hspencer/Library/Preferences/netlify/config.json', 'utf8'));
const api = new NetlifyAPI(cfg.users[cfg.userId].auth.token);
const expected = '351a1d8dea1be0de982b711a82382086b686f2a8';
const targets = {
  next: { siteId: 'c3a0cb25-110a-49a6-9d9b-05ccf7a72347', branch: 'dev' },
  main: { siteId: '24f068d3-f368-4526-a503-2f09af1def0b', branch: 'main' },
};
const path = '.netlify/vertex-audit/deploys.json';
const emit = data => console.log(JSON.stringify(data));
async function main() {
  const records = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
  const target = process.argv[2];
  if (target === 'status') {
    for (const [name, saved] of Object.entries(records)) {
      const deploy = await api.getSiteDeploy({ siteId: targets[name].siteId, deployId: saved.deployId });
      emit({ target: name, state: deploy.state, commit: deploy.commit_ref, deployId: deploy.id, publishedAt: deploy.published_at, error: deploy.error_message || null });
    }
    return;
  }
  if (!targets[target]) throw new Error('Unknown target');
  const { siteId, branch } = targets[target];
  if (records[target]) throw new Error('A deploy was already requested; inspect status instead');
  const remote = execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { encoding: 'utf8' }).trim().split(/\s/)[0];
  const site = await api.getSite({ siteId });
  if (remote !== expected || site.published_deploy?.commit_ref !== expected || site.build_settings?.repo_branch !== branch) {
    throw new Error('Remote or published revision changed; do not redeploy automatically');
  }
  const result = await api.createSiteBuild({ siteId, title: 'config: unify Vertex project on pictos-vertex-gmail (no code changes)' });
  records[target] = { buildId: result.id, deployId: result.deploy_id, previousDeploy: site.published_deploy.id, commit: expected };
  fs.writeFileSync(path, JSON.stringify(records, null, 2), { mode: 0o600 });
  emit({ target, ...records[target] });
}
main().catch(error => { emit({ failed: true, name: error.name, status: error.status || null }); process.exitCode = 1; });

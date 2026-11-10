// Read-only deployment verification. Never print credentials or provider responses.
import fs from 'node:fs';
import { NetlifyAPI } from '/opt/homebrew/lib/node_modules/netlify-cli/node_modules/@netlify/api/lib/index.js';
const cfg = JSON.parse(fs.readFileSync('/Users/hspencer/Library/Preferences/netlify/config.json', 'utf8'));
const api = new NetlifyAPI(cfg.users[cfg.userId].auth.token);
const expected = 'd5a121ddcaf7c50b60d9de0604726173eacc7fa5';
const sites = [
  {host:'next.pictos.net',siteId:'c3a0cb25-110a-49a6-9d9b-05ccf7a72347',branch:'dev'},
  {host:'pictos.net',siteId:'24f068d3-f368-4526-a503-2f09af1def0b',branch:'main'},
];
try {
 const results=await Promise.all(sites.map(async ({host,siteId,branch})=>{
  const [site,deploys]=await Promise.all([api.getSite({siteId}),api.listSiteDeploys({siteId,per_page:10})]);
  const deploy=deploys.find(d=>d.commit_ref===expected&&d.branch===branch&&d.context==='production');
  return {host,branch,configuredBranch:site.build_settings?.repo_branch,state:deploy?.state||'not_found',deployId:deploy?.id||null,commit:deploy?.commit_ref||null,publishedCommit:site.published_deploy?.commit_ref,publishedAt:deploy?.published_at||null,error:deploy?.error_message||null};
 }));
 const report={checkedAt:new Date().toISOString(),expected,sites:results};
 fs.writeFileSync('research/release-2.6.2-deploy-status.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} catch(error){console.error(JSON.stringify({failed:true,name:error.name,status:error.status||null}));process.exitCode=1;}

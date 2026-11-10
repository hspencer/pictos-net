import fs from 'node:fs/promises';
import { getStore } from '/Users/hspencer/Sites/pictos-net/node_modules/@netlify/blobs/dist/main.js';
const config = JSON.parse(await fs.readFile('/Users/hspencer/Library/Preferences/netlify/config.json', 'utf8'));
const store = getStore({name:'pictonet-usage',siteID:'24f068d3-f368-4526-a503-2f09af1def0b',token:config.users[config.userId].auth.token});
const keys=[];
for(let day=15;day<=22;day++) {
 const listing=await store.list({prefix:`audit/2026-10-${day}/`});
 keys.push(...listing.blobs.map(b=>b.key));
}
const records=[];
for(let i=0;i<keys.length;i+=8) {
 const chunk=await Promise.all(keys.slice(i,i+8).map(key=>store.get(key,{type:'json'})));
 for(const record of chunk) if(record) { const {email,...safe}=record;records.push(safe); }
}
const output={queriedAt:new Date().toISOString(),from:'2026-10-15',to:'2026-10-22',records};
await fs.writeFile('/Users/hspencer/Sites/pictos-net/research/diagnostico-2026-10-22/audit-sanitizado.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({count:records.length,errors:records.filter(r=>!r.ok)},null,2));

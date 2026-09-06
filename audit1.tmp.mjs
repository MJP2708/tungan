import { randomBytes, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
const sql=neon(env.DATABASE_URL_UNPOOLED);
const B='http://localhost:5500', WS='72388629-49ed-41c7-a3e1-9dd4d7e0627b';
const OWNER='b5ddd0fb-80fe-4575-a8a4-d3859f4b8567', WORKER='f79ca307-1f13-4088-9c63-27ea28188444';
const tok=async u=>{const t=randomBytes(32).toString('base64url');await sql`insert into session (id,user_id,expires_at) values (${createHash('sha256').update(t).digest('hex')},${u},${new Date(Date.now()+3600000).toISOString()})`;return t;};
const owner=await tok(OWNER), worker=await tok(WORKER);
const call=async(t,p,i={})=>{
  const r=await fetch(B+p,{...i,headers:{'content-type':'application/json',...(t?{cookie:`tungan_session=${t}`}:{}),...(i.headers??{})}});
  let body; try{body=await r.json()}catch{body=await r.text().catch(()=>'')}
  return {status:r.status, body};
};
const findings=[];
const chk=(name,cond,detail='')=>{ if(!cond) findings.push(`${name} — ${detail}`); console.log(`${cond?'✓':'✗'} ${name}${detail?' · '+detail:''}`); };

const future=new Date(Date.now()+3*86400000).toISOString();
const ids=[];
const mkTask=async(title)=>{const r=await call(owner,'/api/tasks',{method:'POST',headers:{'idempotency-key':randomBytes(8).toString('hex')},body:JSON.stringify({workspaceId:WS,title,assigneeUserId:WORKER,dueAt:future})}); ids.push(r.body.id); return r.body.id;};

console.log('\n══ GET routes, authenticated ══');
for (const [name,path] of [
  ['auth/me','/api/auth/me'],
  ['workspaces','/api/workspaces'],
  ['groups','/api/groups'],
  ['tasks','/api/tasks?workspaceId='+WS],
  ['inbox','/api/inbox?workspaceId='+WS],
  ['reminders','/api/reminders?workspaceId='+WS],
  ['usage','/api/usage?workspaceId='+WS],
  ['members','/api/workspaces/'+WS+'/members'],
  ['blocked','/api/workspaces/'+WS+'/blocked'],
  ['sweep','/api/workspaces/'+WS+'/sweep'],
  ['summary','/api/workspaces/'+WS+'/summary?days=30'],
  ['schedule','/api/workspaces/'+WS+'/schedule'],
  ['changes','/api/workspaces/'+WS+'/changes'],
  ['health','/api/health'],
]) {
  const r=await call(owner,path);
  chk(name.padEnd(12), r.status===200, `HTTP ${r.status}`);
}

console.log('\n══ ทุก route ต้องปฏิเสธคนที่ไม่ได้ล็อกอิน ══');
for (const [name,path,method] of [
  ['tasks','/api/tasks?workspaceId='+WS,'GET'],
  ['members','/api/workspaces/'+WS+'/members','GET'],
  ['summary','/api/workspaces/'+WS+'/summary','GET'],
  ['usage','/api/usage?workspaceId='+WS,'GET'],
  ['inbox','/api/inbox?workspaceId='+WS,'GET'],
]) {
  const r=await call(null,path,{method});
  chk(('no-session '+name).padEnd(22), r.status===401, `HTTP ${r.status}`);
}

console.log('\n══ workspace ที่ไม่ได้เป็นสมาชิก ══');
const [other]=await sql`insert into workspace (id,name) values (${'audit-ws-'+randomBytes(4).toString('hex')},'พื้นที่งานคนอื่น') returning id`;
for (const [name,path] of [
  ['tasks','/api/tasks?workspaceId='+other.id],
  ['members','/api/workspaces/'+other.id+'/members'],
  ['summary','/api/workspaces/'+other.id+'/summary'],
  ['blocked','/api/workspaces/'+other.id+'/blocked'],
  ['sweep','/api/workspaces/'+other.id+'/sweep'],
  ['usage','/api/usage?workspaceId='+other.id],
  ['inbox','/api/inbox?workspaceId='+other.id],
  ['reminders','/api/reminders?workspaceId='+other.id],
  ['schedule','/api/workspaces/'+other.id+'/schedule'],
  ['changes','/api/workspaces/'+other.id+'/changes'],
]) {
  const r=await call(owner,path);
  chk(('outsider '+name).padEnd(22), r.status===404||r.status===403, `HTTP ${r.status}`);
}
await sql`delete from workspace where id=${other.id}`;

console.log('\n══ mutating routes ══');
const t1=await mkTask('AUDIT: งานทดสอบ');
chk('POST /api/tasks', !!t1, t1??'ไม่ได้ id');
chk('GET /api/tasks/[id]', (await call(owner,'/api/tasks/'+t1)).status===200);
chk('GET review', (await call(owner,'/api/tasks/'+t1+'/review')).status===200);
chk('PATCH task', (await call(owner,'/api/tasks/'+t1,{method:'PATCH',body:JSON.stringify({title:'AUDIT: แก้ชื่อ'})})).status===200);
const q=await call(owner,'/api/tasks/'+t1+'/questions',{method:'POST',body:JSON.stringify({askedOfUserId:WORKER,question:'ทดสอบคำถาม'})});
chk('POST question', q.status===200||q.status===201, `HTTP ${q.status}`);
chk('GET questions', (await call(owner,'/api/tasks/'+t1+'/questions')).status===200);
if (q.body?.id) chk('POST answer', (await call(worker,'/api/questions/'+q.body.id+'/answer',{method:'POST',body:JSON.stringify({answer:'ตอบแล้ว'})})).status===200);
const rem=await call(owner,'/api/reminders',{method:'POST',headers:{'idempotency-key':randomBytes(8).toString('hex')},body:JSON.stringify({workspaceId:WS,taskId:t1,dueAt:future})});
chk('POST reminder', rem.status===200||rem.status===201, `HTTP ${rem.status}`);
if (rem.body?.id) {
  chk('PATCH reminder', (await call(owner,'/api/reminders/'+rem.body.id,{method:'PATCH',body:JSON.stringify({done:true})})).status===200);
  chk('DELETE reminder', (await call(owner,'/api/reminders/'+rem.body.id,{method:'DELETE'})).status===200);
}
chk('PATCH member nickname', (await call(owner,`/api/workspaces/${WS}/members/${WORKER}`,{method:'PATCH',body:JSON.stringify({nickname:'ทดสอบ'})})).status===200);
chk('PUT schedule', (await call(owner,`/api/workspaces/${WS}/schedule`,{method:'PUT',body:JSON.stringify({startsAt:'09:00',endsAt:'18:00'})})).status===200);
chk('DELETE task', (await call(owner,'/api/tasks/'+t1,{method:'DELETE'})).status===200);

await sql`delete from task where id = any(${ids.filter(Boolean)})`;
await sql`delete from session where expires_at < ${new Date(Date.now()+3700000).toISOString()}`;
console.log(`\n${findings.length? 'พบปัญหา '+findings.length+' ข้อ:\n  '+findings.join('\n  ') : 'ผ่านทั้งหมด'}`);

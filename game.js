// Flag Rush: free 30-second tap game. Game points are free, capped, have no cash value, and never require payment.
const crypto=require('crypto');
const R={PER_TAP:250,MIN_MS:29000,MAX_MS:40000,GAME_S:30,TPS:12,MAX_TAPS:360,RUNS_PER_DAY:5,DAY_CAP_PER_COUNTRY:300000,WEEK_CAP_PER_COUNTRY:5000000};
R.RUN_CAP=R.MAX_TAPS*R.PER_TAP;
const MIGRATIONS=['CREATE TABLE IF NOT EXISTS game_runs(id serial PRIMARY KEY,run_id text UNIQUE NOT NULL,country text NOT NULL,taps integer NOT NULL,pts integer NOT NULL,visitor_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())',
 'ALTER TABLE game_runs ADD COLUMN IF NOT EXISTS lid_hash text','CREATE INDEX IF NOT EXISTS game_runs_vh ON game_runs(visitor_hash,created_at)','CREATE INDEX IF NOT EXISTS game_runs_lh ON game_runs(lid_hash,created_at)'];
module.exports=function(app,{pool,db,save,KEY,WH,PG,weekOf}){
 const base=KEY||WH||PG||'local-dev-only-secret';
 const SK=crypto.createHmac('sha256',base).update('game-token-v1').digest(),SALT=crypto.createHmac('sha256',base).update('game-visitor-salt-v1').digest('hex');
 const mac=s=>crypto.createHmac('sha256',SK).update(s).digest('base64url');
 const sign=o=>{const p=Buffer.from(JSON.stringify(o)).toString('base64url');return p+'.'+mac(p)};
 const verify=t=>{try{t=String(t||'');if(t.length>500)return null;const[p,s]=t.split('.');if(!p||!s)return null;const e=mac(p);if(e.length!==s.length||!crypto.timingSafeEqual(Buffer.from(e),Buffer.from(s)))return null;return JSON.parse(Buffer.from(p,'base64url').toString())}catch(e){return null}};
 const ipOf=q=>String(q.ip||q.socket.remoteAddress||'');
 const H=s=>crypto.createHash('sha256').update(SALT+'|'+s).digest('hex');
 const vhOf=q=>H('ip|'+ipOf(q)),lhOf=l=>{l=String(l||'');return /^[A-Za-z0-9_-]{8,64}$/.test(l)?H('lid|'+l):null};
 const RL=new Map();setInterval(()=>RL.clear(),60000).unref();
 const lim=(q,r,next)=>{const k=ipOf(q),n=(RL.get(k)||0)+1;RL.set(k,n);if(n>20)return r.status(429).json({error:'Too many requests, slow down a bit.'});next()};
 // Day = UTC calendar day (same as the free capsule)
 const dayStart=()=>{const d=new Date();d.setUTCHours(0,0,0,0);return d.getTime()},nextReset=()=>dayStart()+864e5;
 const valid=c=>/^[A-Z]{2}$/.test(c);
 async function usage(vh,lh,c,client){const since=new Date(dayStart());
  if(pool){const x=await(client||pool).query('SELECT count(*)::int n,coalesce(sum(CASE WHEN country=$3 THEN pts ELSE 0 END),0)::int cp FROM game_runs WHERE created_at>=$4 AND (visitor_hash=$1 OR ($2::text IS NOT NULL AND lid_hash=$2))',[vh,lh,c||'',since]);return{n:x.rows[0].n,cp:x.rows[0].cp}}
  const L=(db.game||[]).filter(g=>g.t>=+since&&(g.vh===vh||(lh&&g.lh===lh)));return{n:L.length,cp:L.filter(g=>g.c===c).reduce((a,g)=>a+g.pts,0)}}
 app.get('/api/game/rules',(q,r)=>r.json(R));
 app.get('/api/game/status',lim,async(q,r)=>{try{const u=await usage(vhOf(q),lhOf(q.query.lid),String(q.query.c||'').toUpperCase());r.json({left:Math.max(0,R.RUNS_PER_DAY-u.n),max:R.RUNS_PER_DAY,countryToday:u.cp,nextReset:nextReset(),rules:R})}catch(e){console.error('game status',e.message);r.status(500).json({error:'Please try again.'})}});
 app.post('/api/game/start',lim,async(q,r)=>{try{const b=q.body||{},c=String(b.country||'').toUpperCase();if(!valid(c))return r.status(400).json({error:'Pick a country.'});
  const vh=vhOf(q),lh=lhOf(b.lid),u=await usage(vh,lh,c);if(u.n>=R.RUNS_PER_DAY)return r.status(429).json({error:'No runs left today. Come back after the daily reset.',left:0,nextReset:nextReset()});
  r.json({token:sign({k:'g',r:crypto.randomBytes(12).toString('base64url'),c,s:Date.now(),v:vh,l:lh}),country:c,seconds:R.GAME_S,left:R.RUNS_PER_DAY-u.n})}catch(e){console.error('game start',e.message);r.status(500).json({error:'Please try again.'})}});
 app.post('/api/game/finish',lim,async(q,r)=>{try{const b=q.body||{},p=verify(b.token),now=Date.now();
  if(!p||p.k!=='g'||!valid(p.c)||typeof p.r!=='string'||!Number.isFinite(p.s))return r.status(400).json({error:'Invalid run.'});
  const el=now-p.s;if(el<R.MIN_MS)return r.status(400).json({error:'Run finished too fast.'});if(el>R.MAX_MS)return r.status(400).json({error:'Run expired. Please play again.'});
  const taps=b.taps;if(!Number.isInteger(taps)||taps<0)return r.status(400).json({error:'Invalid tap count.'});if(taps>R.MAX_TAPS)return r.status(400).json({error:'Too many taps.'});
  if(b.perSec!=null){const s=b.perSec;if(!Array.isArray(s)||s.length>R.GAME_S+2||!s.every(x=>Number.isInteger(x)&&x>=0&&x<=R.TPS)||s.reduce((a,x)=>a+x,0)!==taps)return r.status(400).json({error:'Too many taps per second.'})}
  const vh=p.v,lh=p.l||null,cur=vhOf(q);let pts=Math.min(taps*R.PER_TAP,R.RUN_CAP),res;
  const run=async(client)=>{const u1=await usage(vh,lh,p.c,client),u2=cur!==vh?await usage(cur,null,p.c,client):{n:0,cp:0},n=Math.max(u1.n,u2.n),cp=Math.max(u1.cp,u2.cp);
   if(n>=R.RUNS_PER_DAY)return{err:429,msg:'No runs left today. Come back after the daily reset.'};
   const room=Math.max(0,R.DAY_CAP_PER_COUNTRY-cp),capped=pts>room;pts=Math.min(pts,room);return{n,capped}};
  if(pool){const cl=await pool.connect();try{await cl.query('BEGIN');await cl.query('SELECT pg_advisory_xact_lock(hashtext($1))',[vh]);res=await run(cl);
    if(!res.err){const ins=await cl.query('INSERT INTO game_runs(run_id,country,taps,pts,visitor_hash,lid_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (run_id) DO NOTHING',[p.r,p.c,taps,pts,vh,lh]);if(!ins.rowCount)res={err:409,msg:'This run was already submitted.'}}
    await cl.query(res.err?'ROLLBACK':'COMMIT')}catch(e){await cl.query('ROLLBACK').catch(()=>{});throw e}finally{cl.release()}}
  else{db.game??=[];db.gseen??={};if(db.gseen[p.r])res={err:409,msg:'This run was already submitted.'};else{res=await run();if(!res.err){db.gseen[p.r]=1;db.game.push({c:p.c,taps,pts,vh,lh,t:now});save()}}}
  if(res.err)return r.status(res.err).json({error:res.msg});
  r.json({ok:true,country:p.c,taps,pts,capped:res.capped,left:Math.max(0,R.RUNS_PER_DAY-res.n-1),nextReset:nextReset()})}catch(e){console.error('game finish',e.message);r.status(500).json({error:'Please try again.'})}});
 // all runs as {c,pts,t}
 async function runs(){if(pool){const x=await pool.query('SELECT country c,pts,(extract(epoch from created_at)*1000)::bigint t FROM game_runs WHERE pts>0');return x.rows.map(y=>({c:y.c,pts:+y.pts,t:+y.t}))}return(db.game||[]).filter(g=>g.pts>0).map(g=>({c:g.c,pts:g.pts,t:g.t}))}
 // capped per (week,country): [{week,start,c,pts,raw,t}]
 async function weekly(){const m={};for(const g of await runs()){const w=weekOf(g.t),k=w.key+'|'+g.c;m[k]??={week:w.key,start:w.start,c:g.c,raw:0,t:0};m[k].raw+=g.pts;m[k].t=Math.max(m[k].t,g.t)}
  return Object.values(m).map(x=>({...x,pts:Math.min(x.raw,R.WEEK_CAP_PER_COUNTRY)}))}
 async function byCountry(scope){const cur=weekOf(Date.now()).key,o={};for(const x of await weekly()){if(scope!=='all'&&x.week!==cur)continue;o[x.c]=(o[x.c]||0)+x.pts}return o}
 return{R,weekly,byCountry};
};
module.exports.MIGRATIONS=MIGRATIONS;module.exports.R=R;

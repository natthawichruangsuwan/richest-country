// Lucky Capsule: cosmetic-only collectibles. Nothing here is sold, has cash value, or affects totals/rank.
const crypto=require('crypto');
const ITEMS=[
 ['f_ice','frame','C','Ice Frame','🧊'],['f_sakura','frame','C','Sakura Frame','🌸'],['f_mint','frame','C','Mint Frame','🍃'],
 ['f_fire','frame','R','Fire Frame','🔥'],['f_neon','frame','R','Neon Frame','💡'],['f_galaxy','frame','L','Galaxy Frame','🌌'],
 ['n_glow','name','C','Soft Glow','✨'],['n_ocean','name','C','Ocean Blue','🌊'],['n_gold','name','R','Gold Shimmer','🪙'],
 ['n_sparkle','name','R','Sparkle','💫'],['n_rainbow','name','L','Rainbow Text','🌈'],
 ['p_star','pin','C','Star Pin','⭐'],['p_heart','pin','C','Heart Pin','💖'],['p_rocket','pin','R','Rocket Pin','🚀'],
 ['p_crown','pin','R','Crown Flag','👑'],['p_flame','pin','L','Flaming Flag','🔥'],
 ['b_early','badge','C','Early Supporter','🐣'],['b_lucky','badge','C','Lucky','🍀'],['b_streak7','badge','C','Streak-7','📅'],
 ['b_defender','badge','R','Defender','🛡️'],['b_legend','badge','L','Globe Legend','🌍']
].map(([id,cat,r,label,emoji])=>({id,cat,r,label,emoji}));
const BY=Object.fromEntries(ITEMS.map(x=>[x.id,x])),CATS=['frame','name','pin','badge'];
const RATES={C:70,R:25,L:5};
module.exports=function(app,{pool,db,save,KEY,WH,PG}){
 const base=KEY||WH||PG||'local-dev-only-secret';
 const SK=crypto.createHmac('sha256',base).update('gacha-token-v1').digest(),SALT=crypto.createHmac('sha256',base).update('gacha-ip-salt-v1').digest('hex');
 const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const mac=s=>crypto.createHmac('sha256',SK).update(s).digest('base64url');
 const sign=o=>{const p=b64(o);return p+'.'+mac(p)};
 const verify=t=>{try{t=String(t||'');if(t.length>400)return null;const[p,s]=t.split('.');if(!p||!s)return null;const e=mac(p);if(e.length!==s.length||!crypto.timingSafeEqual(Buffer.from(e),Buffer.from(s)))return null;return JSON.parse(Buffer.from(p,'base64url').toString())}catch(e){return null}};
 const itemTok=id=>sign({k:'i',id,n:crypto.randomBytes(6).toString('base64url')});
 const roll=()=>{const x=crypto.randomInt(100),r=x<RATES.L?'L':x<RATES.L+RATES.R?'R':'C',pool=ITEMS.filter(i=>i.r===r);return pool[crypto.randomInt(pool.length)]};
 const pull=()=>{const it=roll();return{item:it,token:itemTok(it.id)}};
 // verify equipped tokens from the client -> {frame:id,...} or null
 const verifyEquip=eq=>{if(!eq||typeof eq!=='object')return null;const o={};for(const c of CATS){const p=verify(eq[c]);if(p&&p.k==='i'&&BY[p.id]&&BY[p.id].cat===c)o[c]=p.id}return Object.keys(o).length?o:null};
 // sanitize stored ids (from Stripe metadata / DB)
 const cleanCos=v=>{try{if(typeof v==='string')v=JSON.parse(v);}catch(e){return null}if(!v||typeof v!=='object')return null;const o={};for(const c of CATS){const id=v[c];if(typeof id==='string'&&BY[id]&&BY[id].cat===c)o[c]=id}return Object.keys(o).length?o:null};
 const tixFor=cents=>Math.min(10,Math.floor((+cents||0)/500));
 async function grant(pid,cents){const n=tixFor(cents);if(!pid||n<1)return;
  if(pool){await pool.query('INSERT INTO gacha_tickets(payment_id,n) VALUES($1,$2) ON CONFLICT (payment_id) DO NOTHING',[pid,n]);return}
  db.gtix??={};if(!db.gtix[pid]){db.gtix[pid]={n,claimed:false};save()}}
 // simple in-memory rate limit
 const RL=new Map();setInterval(()=>RL.clear(),60000).unref();
 const ipOf=q=>String(q.ip||q.socket.remoteAddress||'');
 const lim=(q,r,next)=>{const k=ipOf(q),n=(RL.get(k)||0)+1;RL.set(k,n);if(n>30)return r.status(429).json({error:'Too many requests, slow down a bit.'});next()};
 const day=()=>new Date().toISOString().slice(0,10),nextReset=()=>{const d=new Date();d.setUTCHours(24,0,0,0);return d.getTime()};
 const iph=q=>crypto.createHash('sha256').update(SALT+'|'+ipOf(q)).digest('hex');
 app.get('/api/gacha/catalog',(q,r)=>r.json({items:ITEMS,rates:RATES,ticketCents:500,ticketCap:10}));
 app.get('/api/gacha/status',lim,async(q,r)=>{try{let used=false;const h=iph(q),d=day();
  if(pool)used=(await pool.query('SELECT 1 FROM gacha_free WHERE h=$1 AND day=$2',[h,d])).rowCount>0;else used=!!(db.gfree&&db.gfree[h+'|'+d]);
  r.json({freeAvailable:!used,nextReset:nextReset()})}catch(e){console.error('gacha status',e.message);r.status(500).json({error:'Please try again.'})}});
 app.post('/api/gacha/free',lim,async(q,r)=>{try{const h=iph(q),d=day();let ok;
  if(pool){ok=(await pool.query('INSERT INTO gacha_free(h,day) VALUES($1,$2) ON CONFLICT DO NOTHING',[h,d])).rowCount>0;if(ok&&Math.random()<.05)pool.query("DELETE FROM gacha_free WHERE day<current_date-2").catch(()=>{})}
  else{db.gfree??={};ok=!db.gfree[h+'|'+d];if(ok){db.gfree[h+'|'+d]=1;save()}}
  if(!ok)return r.status(429).json({error:'Free capsule already opened today.',nextReset:nextReset()});
  r.json({...pull(),nextReset:nextReset()})}catch(e){console.error('gacha free',e.message);r.status(500).json({error:'Please try again.'})}});
 app.post('/api/gacha/claim',lim,async(q,r)=>{try{const sid=String((q.body||{}).session_id||'');if(!/^cs_[A-Za-z0-9_]{8,250}$/.test(sid))return r.status(400).json({error:'bad session'});let n=0,found=false;
  if(pool){const x=await pool.query('UPDATE gacha_tickets SET claimed_at=now() WHERE payment_id=$1 AND claimed_at IS NULL RETURNING n',[sid]);if(x.rowCount){n=x.rows[0].n;found=true}else found=(await pool.query('SELECT 1 FROM gacha_tickets WHERE payment_id=$1',[sid])).rowCount>0}
  else{const t=db.gtix&&db.gtix[sid];if(t){found=true;if(!t.claimed){t.claimed=true;n=t.n;save()}}}
  if(!n)return r.json({tickets:[],pending:!found});
  r.json({tickets:Array.from({length:n},(_,i)=>sign({k:'t',p:sid,i}))})}catch(e){console.error('gacha claim',e.message);r.status(500).json({error:'Please try again.'})}});
 app.post('/api/gacha/ticket-pull',lim,async(q,r)=>{try{const p=verify((q.body||{}).ticket);if(!p||p.k!=='t'||typeof p.p!=='string'||!Number.isInteger(p.i))return r.status(400).json({error:'Invalid ticket.'});
  const tid=p.p+'#'+p.i;let ok;
  if(pool)ok=(await pool.query('INSERT INTO gacha_used(tid) VALUES($1) ON CONFLICT DO NOTHING',[tid])).rowCount>0;else{db.gused??={};ok=!db.gused[tid];if(ok){db.gused[tid]=1;save()}}
  if(!ok)return r.status(409).json({error:'This ticket was already used.'});r.json(pull())}catch(e){console.error('gacha ticket',e.message);r.status(500).json({error:'Please try again.'})}});
 return{verifyEquip,cleanCos,grant,verify,sign,tixFor};
};
module.exports.MIGRATIONS=['ALTER TABLE contributions ADD COLUMN IF NOT EXISTS cosmetics jsonb',
 'CREATE TABLE IF NOT EXISTS gacha_free(h text NOT NULL,day date NOT NULL,PRIMARY KEY(h,day))',
 'CREATE TABLE IF NOT EXISTS gacha_tickets(payment_id text PRIMARY KEY,n integer NOT NULL CHECK(n>0),created_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz)',
 'CREATE TABLE IF NOT EXISTS gacha_used(tid text PRIMARY KEY,used_at timestamptz NOT NULL DEFAULT now())'];

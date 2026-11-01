const express=require('express'),fs=require('fs'),crypto=require('crypto'),path=require('path');
const app=express(),PORT=process.env.PORT||3000,KEY=process.env.STRIPE_SECRET_KEY,WH=process.env.STRIPE_WEBHOOK_SECRET,MIN=Math.max(0.5,+process.env.MIN_AMOUNT||2),EMAIL=process.env.CONTACT_EMAIL||'contact@REPLACE-ME.example';
const BASE=process.env.BASE_URL||`http://localhost:${PORT}`,DB=process.env.DATA_FILE||path.join(__dirname,'data.json');
const PG=process.env.DATABASE_URL;let pool,db;
if(PG){const{Pool}=require('pg');pool=new Pool({connectionString:PG,max:5});
 pool.query(`CREATE TABLE IF NOT EXISTS contributions(id serial PRIMARY KEY,country text NOT NULL,name text NOT NULL,amount_cents integer NOT NULL CHECK(amount_cents>0),created_at timestamptz NOT NULL DEFAULT now(),payment_id text UNIQUE)`).then(()=>pool.query('ALTER TABLE contributions ADD COLUMN IF NOT EXISTS message text')).then(()=>pool.query('ALTER TABLE contributions ADD COLUMN IF NOT EXISTS link text')).then(()=>pool.query('ALTER TABLE contributions ADD COLUMN IF NOT EXISTS avatar text')).then(async()=>{for(const m of require('./gacha').MIGRATIONS)await pool.query(m)}).then(()=>pool.query('CREATE TABLE IF NOT EXISTS weekly_champions(week_key text PRIMARY KEY,country text NOT NULL,points bigint NOT NULL,finalized_at timestamptz NOT NULL DEFAULT now())')).then(async()=>{for(const m of require('./game').MIGRATIONS)await pool.query(m)}).then(async()=>{const cl=await pool.connect();try{await cl.query('BEGIN');await cl.query('CREATE TABLE IF NOT EXISTS app_meta(k text PRIMARY KEY,v text NOT NULL)');const ins=await cl.query("INSERT INTO app_meta(k,v) VALUES('pts_scale','100000') ON CONFLICT (k) DO NOTHING");if(ins.rowCount){const a=await cl.query('UPDATE game_runs SET pts=pts*10'),b=await cl.query('UPDATE weekly_champions SET points=points*10');console.log('pts rescale x10: game_runs',a.rowCount,'weekly_champions',b.rowCount)}await cl.query('COMMIT')}catch(e){await cl.query('ROLLBACK').catch(()=>{});throw e}finally{cl.release()}}).then(()=>console.log('db ready')).catch(e=>console.error('db init',e.message));}
else{db=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB)):{contribs:[],seen:{},ptsScale:100000};if(db.ptsScale!==100000){(db.game||[]).forEach(g=>g.pts*=10);for(const k in db.champs||{})db.champs[k].pts*=10;db.ptsScale=100000;fs.writeFileSync(DB,JSON.stringify(db))}}
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));app.set('trust proxy',1);let GX;
const clean=(m,n)=>String(m||'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const AVT={free1:0,free2:0,free3:0,free4:0,tier20_1:2000,tier20_2:2000,tier100_1:10000,tier100_2:10000,tier500_1:50000};
const cleanAv=(a,cents)=>{a=String(a||'');return Object.prototype.hasOwnProperty.call(AVT,a)&&cents>=AVT[a]?a:null};
const cleanLink=u=>{u=String(u||'').trim();if(!u||u.length>200||/[\s<>"'`\u0000-\u001f\u007f]/.test(u))return null;try{const x=new URL(u);if(!/^https?:$/.test(x.protocol)||!x.hostname.includes('.')||x.username||x.password)return null;return x.href.length<=200?x.href:null}catch(e){return null}};
async function credit(c,cents,name,id,msg,link,av,cos){cos=GX.cleanCos(cos);name=clean(name,30)||'Anonymous';msg=clean(msg,80)||null;cents=Math.trunc(cents);link=cents>=2000?cleanLink(link):null;av=cleanAv(av,cents);
 if(pool){await pool.query('INSERT INTO contributions(country,name,amount_cents,payment_id,message,link,avatar,cosmetics) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (payment_id) DO NOTHING',[c,name,cents,id||null,msg,link,av,cos?JSON.stringify(cos):null]);return;}
 if(id&&db.seen[id])return;if(id)db.seen[id]=1;db.contribs.push({c,cents,name,msg,link,av,...(cos?{cos}:{}),t:Date.now(),...(id?{pid:id}:{})});save();}
async function all(c){if(pool){const r=await pool.query("SELECT country c,name,amount_cents cents,(extract(epoch from created_at)*1000)::bigint t,message msg,link,avatar av,cosmetics cos,(payment_id IS NOT NULL AND payment_id LIKE 'seed\\_%') demo FROM contributions"+(c?" WHERE country=$1":"")+" ORDER BY id",c?[c]:[]);
  return r.rows.map(x=>({c:x.c,name:x.name,cents:x.cents,pts:PTS(x.cents),t:+x.t,msg:x.msg||null,link:x.link||null,av:x.av||null,cos:x.cos||null,demo:!!x.demo}));}
 return (c?db.contribs.filter(x=>x.c===c):db.contribs).map(({pid,...x})=>({...x,pts:PTS(x.cents),demo:typeof pid==='string'&&pid.startsWith('seed_')}));}
app.post('/webhook',express.raw({type:'*/*'}),async(req,res)=>{
 try{if(WH){const sig=req.headers['stripe-signature']||'';const p=Object.fromEntries(sig.split(',').map(x=>x.split('=')));
  const exp=crypto.createHmac('sha256',WH).update(p.t+'.'+req.body).digest('hex');
  if(!p.v1||!crypto.timingSafeEqual(Buffer.from(exp),Buffer.from(p.v1)))return res.status(400).send('bad sig');}
  const ev=JSON.parse(req.body);
  if(ev.type==='checkout.session.completed'&&ev.data.object.payment_status==='paid'){const s=ev.data.object;
   await credit(s.metadata.country,s.amount_total,s.metadata.name,s.id,s.metadata.message,s.metadata.link,s.metadata.avatar,s.metadata.cosmetics);try{await GX.grant(s.id,s.amount_total)}catch(e){console.error('gacha grant',e.message)}}
  res.json({ok:1});}catch(e){res.status(400).send('err')}});
app.use(express.json());GX=require('./gacha')(app,{pool,db,save,KEY,WH,PG});app.use(express.static(path.join(__dirname,'public')));
const BON=[[50000,.5],[10000,.3],[5000,.2],[2000,.1],[500,.05]],bonusOf=c=>(BON.find(([m])=>c>=m)||[0,0])[1],PTS=c=>Math.round(c/100*100000*(1+bonusOf(c)));
const TZ='America/Los_Angeles',_f=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short'});
const laParts=ms=>{const o={};for(const p of _f.formatToParts(new Date(ms)))o[p.type]=p.value;return o};
const laOff=ms=>{const p=laParts(ms);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(ms/1000)*1000};
const laMid=(y,m,d)=>{let g=Date.UTC(y,m-1,d);for(let i=0;i<3;i++)g=Date.UTC(y,m-1,d)-laOff(g);return g};
const WD={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};
function weekOf(ms){const p=laParts(ms),dd=new Date(Date.UTC(+p.year,+p.month-1,+p.day-WD[p.weekday]));const y=dd.getUTCFullYear(),m=dd.getUTCMonth()+1,d=dd.getUTCDate();
 const n=new Date(Date.UTC(y,m-1,d+7));return{key:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,start:laMid(y,m,d),end:laMid(n.getUTCFullYear(),n.getUTCMonth()+1,n.getUTCDate())}}
const inScope=(L,q)=>{if(q&&q.query&&q.query.scope==='all')return L;const w=weekOf(Date.now());return L.filter(x=>x.t>=w.start&&x.t<w.end)};
let CH=[],CHAMP=null;const GM=require('./game')(app,{pool,db,save,KEY,WH,PG,weekOf});
function winnerOf(L){const m={};for(const x of [...L].sort((a,b)=>a.t-b.t)){m[x.c]??={c:x.c,pts:0,t:0};m[x.c].pts+=x.pts;m[x.c].t=x.t}return Object.values(m).sort((a,b)=>b.pts-a.pts||a.t-b.t)[0]||null}
async function finalize(){try{const L=await all(),cur=weekOf(Date.now()),done=new Set(CH.map(x=>x.week)),wk={};
 for(const x of L){const w=weekOf(x.t);if(w.start>=cur.start)continue;(wk[w.key]??={w,L:[]}).L.push(x)}
 for(const g of await GM.weekly()){if(g.start>=cur.start)continue;(wk[g.week]??={w:weekOf(g.start),L:[]}).L.push({c:g.c,pts:g.pts,t:g.t})}
 if(pool){const r=await pool.query('SELECT week_key,country,points,(extract(epoch from finalized_at)*1000)::bigint f FROM weekly_champions');r.rows.forEach(x=>done.add(x.week_key));
  for(const k in wk)if(!done.has(k)){const v=winnerOf(wk[k].L);if(v)await pool.query('INSERT INTO weekly_champions(week_key,country,points) VALUES($1,$2,$3) ON CONFLICT (week_key) DO NOTHING',[k,v.c,v.pts])}
  CH=(await pool.query('SELECT week_key w,country c,points::bigint p FROM weekly_champions ORDER BY week_key DESC')).rows.map(x=>({week:x.w,c:x.c,pts:+x.p}));}
 else{db.champs??={};for(const k in wk)if(!db.champs[k]){const v=winnerOf(wk[k].L);if(v)db.champs[k]={c:v.c,pts:v.pts,f:Date.now()}}save();CH=Object.entries(db.champs).sort((a,b)=>a[0]<b[0]?1:-1).map(([w,v])=>({week:w,c:v.c,pts:v.pts}))}
 CH.forEach(x=>{const [y,m,d]=x.week.split('-').map(Number);x.start=laMid(y,m,d);x.end=weekOf(x.start).end});
 const prevKey=weekOf(cur.start-3600e3).key;CHAMP=(CH.find(x=>x.week===prevKey)||{}).c||null;}catch(e){console.error('finalize',e.message)}}
setTimeout(finalize,3000);setInterval(finalize,5*60e3);
const wkInfo=()=>{const w=weekOf(Date.now());return{week:w.key,start:w.start,end:w.end,now:Date.now(),champion:CHAMP}};
app.get('/api/champions',async(q,r)=>{await finalize();const n={};CH.forEach(x=>{n[x.c]??={c:x.c,titles:0,pts:0,last:x.week};n[x.c].titles++;n[x.c].pts+=x.pts});
 r.json({...wkInfo(),history:CH,table:Object.values(n).sort((a,b)=>b.titles-a.titles||b.pts-a.pts)})});
async function combined(L,q){const m={};for(const x of L){m[x.c]??={c:x.c,cents:0,pts:0,n:0,demo:true,donPts:0,gamePts:0};m[x.c].demo=m[x.c].demo&&x.demo;m[x.c].cents+=x.cents;m[x.c].donPts+=x.pts;m[x.c].n++;}
 const G=await GM.byCountry(q&&q.query&&q.query.scope==='all'?'all':'week');for(const c in G){m[c]??={c,cents:0,pts:0,n:0,demo:false,donPts:0,gamePts:0};m[c].gamePts=G[c]}for(const c in m)m[c].pts=m[c].donPts+m[c].gamePts;return m}
const valid=c=>/^[A-Z]{2}$/.test(c);
app.get('/api/config',async(q,r)=>{let notice=false;if(process.env.SHOW_DEMO_NOTICE!=='false'){try{notice=(await all()).some(x=>x.demo)}catch(e){}}r.json({demo:!KEY,min:MIN,email:EMAIL,demoNotice:notice})});
const dk=(x,i)=>{const n=String(x.name||'').trim().toLowerCase();return n?x.c+'|'+n:'#'+i};
function agg(L){const m={};L.forEach((x,i)=>{const k=dk(x,i);m[k]??={k,c:x.c,name:x.name,cents:0,pts:0,n:0,t:0,demo:true};const d=m[k];d.demo=d.demo&&x.demo;d.cents+=x.cents;d.pts+=x.pts;d.n++;
 if(x.t>=d.t&&x.msg)d.msg=x.msg;if(x.link&&x.cents>=2000&&x.t>=(d.lt||0)){d.link=x.link;d.lt=x.t}if(x.av&&x.t>=(d.at||0)){d.av=x.av;d.at=x.t}if(x.cos&&x.t>=(d.ct||0)){d.cos=x.cos;d.ct=x.t}d.t=Math.max(d.t,x.t);});
 return Object.values(m).map(({lt,at,ct,k,...d})=>({...d,av:d.av||null,cos:d.cos||null})).sort((a,b)=>b.pts-a.pts||a.t-b.t)}
const topOf=A=>A[0]?{c:A[0].c,name:A[0].name,av:A[0].av||null,cos:A[0].cos||null}:null;
app.get('/api/hall',async(q,r)=>{try{const A=agg(inScope(await all(),q));r.json({...wkInfo(),scope:q.query.scope==='all'?'all':'week',top:topOf(A),hall:A.slice(0,10)});}catch(e){console.error(e.message);r.status(500).json({error:'db'})}});
app.get('/api/leaderboard',async(q,r)=>{try{const L=inScope(await all(),q),RA=await all();const m=await combined(L,q);
 const A=agg(L),lk={},ak={},ck={};for(const d of agg(RA)){const k=dk(d,-1);if(d.link)lk[k]=d.link;if(d.av)ak[k]=d.av;if(d.cos)ck[k]=d.cos}
 r.json({...wkInfo(),scope:q.query.scope==='all'?'all':'week',rows:Object.values(m).sort((a,b)=>b.pts-a.pts),gameRules:{perTap:GM.R.PER_TAP,weekCap:GM.R.WEEK_CAP_PER_COUNTRY},top:topOf(A),recent:RA.slice(-15).reverse().map(({link,av,cos,...x})=>{const k=dk(x,-2);return{...x,link:lk[k]||null,av:ak[k]||(k[0]=='#'?av:null)||null,cos:ck[k]||(k[0]=='#'?cos:null)||null}})});}catch(e){console.error(e.message);r.status(500).json({error:'db'})}});
app.get('/api/country/:c',async(q,r)=>{try{const c=q.params.c.toUpperCase();if(!valid(c))return r.status(400).json({error:'bad country'});const A=agg(inScope(await all(),q));
 const B=(await combined(inScope(await all(c),q),q))[c]||{donPts:0,gamePts:0,pts:0};r.json({...wkInfo(),top:topOf(A),donors:A.filter(x=>x.c===c),breakdown:{donations:B.donPts,game:B.gamePts,total:B.pts}});}catch(e){console.error(e.message);r.status(500).json({error:'db'})}});
app.post('/api/contribute',async(q,r)=>{const{country:c,amount,name,message,link,avatar,cosmetics}=q.body;const cos=GX.verifyEquip(cosmetics);const cents=Math.round(+amount*100);
 if(!valid(c)||!(cents>=Math.round(MIN*100))||cents>99999900)return r.status(400).json({error:'The minimum contribution is $'+MIN+'.'});
 const lnk=cents>=2000?cleanLink(link):null;if(link&&String(link).trim()&&cents>=2000&&!lnk)return r.status(400).json({error:'Profile link must be a valid http(s) URL (max 200 characters).'});
 const av=cleanAv(avatar,cents);
 if(!KEY){try{await credit(c,cents,name,null,message,lnk,av,cos);}catch(e){return r.status(500).json({error:'Could not save. Please try again.'})}return r.json({demo:true,pts:PTS(cents)});}
 const f=new URLSearchParams({mode:'payment',success_url:BASE+'/?paid=1&usd='+cents+'&sid={CHECKOUT_SESSION_ID}',cancel_url:BASE+'/',
  'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(cents),
  'line_items[0][price_data][product_data][name]':'Contribution for '+c+' ('+PTS(cents).toLocaleString('en-US')+' points, display-only)','metadata[country]':c,'metadata[name]':clean(name,30),'metadata[message]':clean(message,80)});if(lnk)f.set('metadata[link]',lnk);if(av)f.set('metadata[avatar]',av);if(cos)f.set('metadata[cosmetics]',JSON.stringify(cos));
 const s=await(await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+KEY},body:f})).json();
 if(!s.url)return r.status(500).json({error:s.error?.message||'Payment could not be started. Please try again.'});r.json({url:s.url});});
app.get('/healthz',(q,r)=>r.send('ok'));
for(const p of['terms','privacy','refund'])app.get('/'+p,(q,r)=>r.sendFile(path.join(__dirname,'public',p+'.html')));
app.listen(PORT,()=>console.log('on',PORT,KEY?'LIVE':'DEMO'));

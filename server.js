const express=require('express'),fs=require('fs'),crypto=require('crypto'),path=require('path');
const app=express(),PORT=process.env.PORT||3000,KEY=process.env.STRIPE_SECRET_KEY,WH=process.env.STRIPE_WEBHOOK_SECRET,MIN=Math.max(0.5,+process.env.MIN_AMOUNT||2),EMAIL=process.env.CONTACT_EMAIL||'contact@REPLACE-ME.example';
const BASE=process.env.BASE_URL||`http://localhost:${PORT}`,DB=process.env.DATA_FILE||path.join(__dirname,'data.json');
let db=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB)):{contribs:[],seen:{}};
const save=()=>fs.writeFileSync(DB,JSON.stringify(db));
function credit(c,cents,name,id){if(id&&db.seen[id])return;if(id)db.seen[id]=1;
 db.contribs.push({c,cents,name:(name||'').slice(0,30)||'Anonymous',t:Date.now()});save();}
app.post('/webhook',express.raw({type:'*/*'}),(req,res)=>{
 try{if(WH){const sig=req.headers['stripe-signature']||'';const p=Object.fromEntries(sig.split(',').map(x=>x.split('=')));
  const exp=crypto.createHmac('sha256',WH).update(p.t+'.'+req.body).digest('hex');
  if(!p.v1||!crypto.timingSafeEqual(Buffer.from(exp),Buffer.from(p.v1)))return res.status(400).send('bad sig');}
  const ev=JSON.parse(req.body);
  if(ev.type==='checkout.session.completed'&&ev.data.object.payment_status==='paid'){const s=ev.data.object;
   credit(s.metadata.country,s.amount_total,s.metadata.name,s.id);}
  res.json({ok:1});}catch(e){res.status(400).send('err')}});
app.use(express.json());app.use(express.static(path.join(__dirname,'public')));
const valid=c=>/^[A-Z]{2}$/.test(c);
app.get('/api/config',(q,r)=>r.json({demo:!KEY,min:MIN,email:EMAIL}));
app.get('/api/leaderboard',(q,r)=>{const m={};for(const x of db.contribs){m[x.c]??={c:x.c,cents:0,n:0};m[x.c].cents+=x.cents;m[x.c].n++;}
 r.json({rows:Object.values(m).sort((a,b)=>b.cents-a.cents),recent:db.contribs.slice(-15).reverse()});});
app.get('/api/country/:c',(q,r)=>{const c=q.params.c.toUpperCase();const m={};
 for(const x of db.contribs.filter(x=>x.c===c)){const k=x.name;m[k]??={name:k,cents:0,n:0,t:0};m[k].cents+=x.cents;m[k].n++;m[k].t=Math.max(m[k].t,x.t);}
 r.json({donors:Object.values(m).sort((a,b)=>b.cents-a.cents)});});
app.post('/api/contribute',async(q,r)=>{const{country:c,amount,name}=q.body;const cents=Math.round(+amount*100);
 if(!valid(c)||!(cents>=Math.round(MIN*100))||cents>99999900)return r.status(400).json({error:'The minimum contribution is $'+MIN+'.'});
 if(!KEY){credit(c,cents,name);return r.json({demo:true});}
 const f=new URLSearchParams({mode:'payment',success_url:BASE+'/?paid=1',cancel_url:BASE+'/',
  'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(cents),
  'line_items[0][price_data][product_data][name]':'Contribution for '+c,'metadata[country]':c,'metadata[name]':(name||'').slice(0,30)});
 const s=await(await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+KEY},body:f})).json();
 if(!s.url)return r.status(500).json({error:s.error?.message||'Payment could not be started. Please try again.'});r.json({url:s.url});});
app.get('/healthz',(q,r)=>r.send('ok'));
for(const p of['terms','privacy','refund'])app.get('/'+p,(q,r)=>r.sendFile(path.join(__dirname,'public',p+'.html')));
app.listen(PORT,()=>console.log('on',PORT,KEY?'LIVE':'DEMO'));

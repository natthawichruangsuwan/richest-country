// Lucky Capsule (cosmetic only). Inventory lives in this browser's localStorage as server-signed tokens.
(function(){
const LS=(k,d)=>{try{const v=JSON.parse(localStorage[k]||'null');return v??d}catch(e){return d}},SV=(k,v)=>localStorage[k]=JSON.stringify(v);
const E=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt()+';');
let CAT={},RATES={C:70,R:25,L:5},ST={free:null,next:0};const RN={C:'Common',R:'Rare',L:'Legendary'},CN={frame:'Avatar Frame',name:'Name Effect',pin:'Globe Pin',badge:'Badge'};
const it=id=>CAT[id];
window.gFr=cos=>{const f=cos&&cos.frame;return f&&it(f)?' gfr gfr-'+f:''};
window.gNm=(n,cos)=>{const e=cos&&cos.name;return e&&it(e)?`<span class="gnm-${e}">${E(n)}</span>`:E(n)};
window.gBd=cos=>{const b=cos&&cos.badge,x=b&&it(b);return x?`<span class="gbd ${x.r}" title="${E(x.label)}">${x.emoji} ${E(x.label)}</span>`:''};
window.gPin=cos=>{const p=cos&&cos.pin,x=p&&it(p);return x?x.emoji:'👑'};
const inv=()=>LS('gInv',[]),eqT=()=>LS('gEq',{}),tix=()=>LS('gTix',[]);
const eqIds=()=>{const e=eqT(),o={};for(const c in e){const x=inv().find(v=>v.t==e[c]);if(x&&it(x.id))o[c]=x.id}return o};
window.gEquipTokens=()=>{const e=eqT(),o={};for(const c in e)if(inv().some(v=>v.t==e[c]))o[c]=e[c];return o};
const today=()=>new Date().toISOString().slice(0,10),freeUsed=()=>ST.free===false||localStorage.gFree==today();
const cd=()=>{const ms=Math.max(0,(ST.next||(()=>{const d=new Date();d.setUTCHours(24,0,0,0);return+d})())-Date.now()),h=Math.floor(ms/36e5),m=Math.floor(ms/6e4)%60,s=Math.floor(ms/1e3)%60;return`${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`};
window.gSec=()=>`<div class="gcap" id="gcap">${gInner()}</div>`;
function gInner(){const n=tix().length,f=freeUsed();
 return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><b>🎁 Lucky Capsule</b><a href="#" style="color:#ffd700;font-size:12px" onclick="event.preventDefault();gOpen('rates')">Drop rates</a></div>
<div class="s">Free cosmetic collectibles for fun. No cash value, no effect on rank or totals.</div>
<div class="gb"><button type="button" ${f?'class="off"':''} onclick="gOpen('free')">${f?'⏳ Free in <span class=gcd>'+cd()+'</span>':'🎁 Open free capsule'}</button><button type="button" ${n?'':'class="off"'} onclick="gOpen('ticket')">🎟️ Tickets: ${n}</button><button type="button" class="off" onclick="gOpen('col')">🗂️ My Collection</button></div>
<div class="s">Every $5 in a single payment also gives 1 capsule ticket (max 10).</div><div class="gpv" id="gpv">${gPrevH()}</div>`}
function gPrevH(){const c=eqIds();if(!Object.keys(c).length)return '<span class="s">Nothing equipped yet — open a capsule!</span>';const av=typeof AV!='undefined'&&AV?AV:'free1',nm=(document.getElementById('n')||{}).value||'You';
 return `<img class="av${gFr(c)}" src="/chars/${av}.webp" alt=""><div style="min-width:0">${gPin(c)} ${gNm(nm.trim()||'You',c)}${gBd(c)}<div class="s">Preview of your equipped look</div></div>`}
window.gPrev=()=>{const p=document.getElementById('gpv');if(p)p.innerHTML=gPrevH()};
const refresh=()=>{const g=document.getElementById('gcap');if(g)g.innerHTML=gInner()};
setInterval(()=>{document.querySelectorAll('.gcd').forEach(e=>e.textContent=cd())},1000);
let M=null;function modal(h){if(!M){M=document.createElement('div');M.className='gm';M.onclick=e=>{if(e.target==M)gClose()};document.body.appendChild(M)}M.innerHTML=`<div class="gbox"><button class="x" aria-label="Close" onclick="gClose()">✕</button>${h}</div>`;M.hidden=false}
window.gClose=()=>{if(M)M.hidden=true;refresh();gPrev()};
const ratesH=()=>`<h3>🎁 Lucky Capsule — drop rates</h3><table class="gtbl">${['C','R','L'].map(r=>`<tr><td class="r${r}"><b>${RN[r]}</b></td><td>${RATES[r]}%</td><td class="s">${Object.values(CAT).filter(x=>x.r==r).length} items, equal chance within rarity</td></tr>`).join('')}</table>
<p class="s">Every capsule always contains one cosmetic item. Items are decorations only: they have no cash value, cannot be sold or traded, and never change rankings or totals. The free capsule is 1 per day. Tickets are given automatically with contributions ($5 = 1 ticket, max 10 per payment) — you are never paying for a random item. This is just for fun, not gambling or an investment.</p>
<h4>All items</h4><div class="gcol">${Object.values(CAT).map(x=>`<div class="it" style="cursor:default"><span class="e">${x.emoji}</span><span class="r${x.r}">${RN[x.r]}</span><br>${E(x.label)}</div>`).join('')}</div>`;
function capH(lbl){return `<h3>${lbl}</h3><div class="gcp" id="gcp"><div class="b"></div><div class="t"></div></div><div id="gres" class="s" style="text-align:center">Opening…</div>`}
async function openWith(lbl,req){try{window.frClick&&window.frClick()}catch(_){}modal(capH(lbl));const cp=document.getElementById('gcp');cp.classList.add('sh');let r;try{r=await req()}catch(e){r={error:'Network error, please try again.'}}
 await new Promise(s=>setTimeout(s,matchMedia('(prefers-reduced-motion:reduce)').matches?100:1000));
 if(!r||r.error||!r.item){document.getElementById('gres').textContent=(r&&r.error)||'Something went wrong.';return}
 cp.classList.remove('sh');cp.classList.add('op');const x=r.item,I=inv();I.push({t:r.token,id:x.id});SV('gInv',I);
 setTimeout(()=>{const g=document.getElementById('gres');if(!g)return;g.outerHTML=`<div class="grv ${x.r}"><div class="e">${E(x.emoji)}</div><div class="r${x.r}" style="font-weight:800">${RN[x.r]||''}</div><div style="font-size:18px;font-weight:700">${E(x.label)}</div><div class="s">${CN[x.cat]||''}</div></div><div class="gb" style="display:flex;gap:6px"><button type="button" onclick="gEquip('${x.cat}','${E(r.token)}');gOpen('col')">Equip</button><button type="button" style="background:#ffffff22;color:#fff" onclick="gOpen('col')">My Collection</button></div>`},matchMedia('(prefers-reduced-motion:reduce)').matches?0:450)}
const post=async(u,b)=>{const x=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});const j=await x.json().catch(()=>({error:'Please try again.'}));if(j.nextReset)ST.next=j.nextReset;return j};
window.gEquip=(c,t)=>{const e=eqT();if(e[c]==t)delete e[c];else e[c]=t;SV('gEq',e)};
function colH(){const I=inv(),e=eqT(),cnt={},tok={};I.forEach(v=>{cnt[v.id]=(cnt[v.id]||0)+1;tok[v.id]??=v.t});const own=Object.keys(cnt).length;
 return `<h3>🗂️ My Collection <span class="s">${own}/${Object.keys(CAT).length}</span></h3><div class="gpv">${gPrevH()}</div><p class="s">Tap an item to equip or unequip it (one per category). Your equipped items show next to your name when you contribute. Saved in this browser only.</p>`+
 ['frame','name','pin','badge'].map(c=>`<h4>${CN[c]}</h4><div class="gcol">${Object.values(CAT).filter(x=>x.cat==c).map(x=>{const has=cnt[x.id],eq=has&&I.some(v=>v.id==x.id&&v.t==e[c]);return `<button type="button" class="it${eq?' eq':''}${has?'':' no'}" ${has?`onclick="gEquip('${c}','${E(tok[x.id])}');gOpen('col')"`:'disabled'}><span class="e">${has?x.emoji:'❔'}</span><span class="r${x.r}">${RN[x.r]}</span><br>${E(x.label)}${has>1?' ×'+has:''}${eq?'<br>✅ Equipped':''}</button>`}).join('')}</div>`).join('')}
window.gOpen=async t=>{if(t=='rates')return modal(ratesH());if(t=='col')return modal(colH());
 if(t=='free'){if(freeUsed())return modal(`<h3>🎁 Free capsule</h3><p>You already opened today's free capsule. Next one in <b class="gcd">${cd()}</b>.</p><p class="s">Tickets: ${tix().length}</p>`);
  return openWith('🎁 Free daily capsule',async()=>{const r=await post('/api/gacha/free');localStorage.gFree=today();if(r.error)ST.free=false;else ST.free=false;return r})}
 if(t=='ticket'){const T=tix();if(!T.length)return modal(`<h3>🎟️ Capsule tickets</h3><p>You have no tickets yet. Every $5 in a single contribution gives 1 ticket automatically (max 10 per payment). They appear here after the payment completes.</p>`);
  return openWith('🎟️ Ticket capsule',async()=>{const tk=T.shift();SV('gTix',T);return post('/api/gacha/ticket-pull',{ticket:tk})})}};
async function claim(){const p=new URLSearchParams(location.search),sid=p.get('sid');if(!sid||!/^cs_/.test(sid))return;
 for(let i=0;i<8;i++){let r;try{r=await post('/api/gacha/claim',{session_id:sid})}catch(e){r={}}
  if(r.tickets&&r.tickets.length){SV('gTix',tix().concat(r.tickets));refresh();modal(`<h3>🎟️ +${r.tickets.length} capsule ticket${r.tickets.length>1?'s':''}!</h3><p>Thanks for your support! Open them for a free cosmetic.</p><button type="button" onclick="gOpen('ticket')">Open a capsule</button>`);break}
  if(r.tickets&&!r.pending)break;await new Promise(s=>setTimeout(s,3000))}
 p.delete('sid');history.replaceState(null,'',location.pathname+(p.toString()?'?'+p:'')+location.hash)}
fetch('/api/gacha/catalog').then(r=>r.json()).then(c=>{CAT=Object.fromEntries(c.items.map(x=>[x.id,x]));RATES=c.rates;refresh();gPrev()}).catch(()=>{});
fetch('/api/gacha/status').then(r=>r.json()).then(s=>{if(s.nextReset)ST.next=s.nextReset;if(s.freeAvailable===false)ST.free=false;else if(s.freeAvailable&&localStorage.gFree==today()){}refresh()}).catch(()=>{});
claim();
})();

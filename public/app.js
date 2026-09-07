const screens = [...document.querySelectorAll('.screen')];
const progress = document.getElementById('progress');
const stepCount = document.getElementById('stepCount');
const toast = document.getElementById('toast');
const formState = { activities: new Set(), foods: new Set(), music: new Set(), extras: new Set() };
let current = 0;

function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.remove('show'), 2400); }
function updateProgress(){ if(current===0){progress.style.width='0%';stepCount.textContent='Welkom';return} if(current===screens.length-1){progress.style.width='100%';stepCount.textContent='Klaar';return} const q=current,total=screens.length-2;progress.style.width=`${Math.round(q/total*100)}%`;stepCount.textContent=`${q} / ${total}` }
function move(to){ if(to<0||to>=screens.length||to===current)return; const old=screens[current];old.classList.add('leaving');setTimeout(()=>{old.classList.remove('active','leaving');current=to;screens[current].classList.add('active');updateProgress();window.scrollTo({top:0,behavior:'smooth'})},220) }
function invalid(el,message){el.classList.remove('invalid');void el.offsetWidth;el.classList.add('invalid');el.focus();showToast(message)}
function validateStep(){const step=screens[current].dataset.step;if(step==='name'){const el=document.getElementById('name');if(el.value.trim().length<2){invalid(el,'Vul eerst je naam in.');return false}}if(step==='class'){const el=document.getElementById('className');if(!el.value.trim()){invalid(el,'Vul eerst je klas in.');return false}}if(step==='activities'&&!getGroupValues('activities','activityOther').length){showToast('Kies minimaal één activiteit.');return false}if(step==='food'&&!getGroupValues('foods','foodOther').length){showToast('Kies minimaal één soort eten.');return false}return true}
document.addEventListener('click',e=>{const next=e.target.closest('[data-next]'),back=e.target.closest('[data-back]');if(next&&validateStep())move(current+1);if(back)move(current-1)});
document.querySelectorAll('.choice-grid').forEach(grid=>{const group=grid.dataset.group;grid.addEventListener('click',e=>{const btn=e.target.closest('.choice');if(!btn)return;btn.classList.toggle('selected');const value=btn.dataset.value;if(value)btn.classList.contains('selected')?formState[group].add(value):formState[group].delete(value);if(btn.classList.contains('other-toggle')){const input=document.getElementById(btn.dataset.target);input.classList.toggle('hidden',!btn.classList.contains('selected'));if(btn.classList.contains('selected'))setTimeout(()=>input.focus(),120);else input.value=''}})});
document.querySelectorAll('.shake-on-type').forEach(el=>el.addEventListener('input',()=>{const card=el.closest('.question-card');card.classList.remove('typing-shake');void card.offsetWidth;card.classList.add('typing-shake')}));
function getGroupValues(group,otherId){const values=[...formState[group]];const other=document.getElementById(otherId)?.value.trim();if(other)values.push(`Anders: ${other}`);return values}
function getClientId(){let id=localStorage.getItem('67school_client_id');if(!id){id=(crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`);localStorage.setItem('67school_client_id',id)}return id}
function getDeviceInfo(){
  const ua=navigator.userAgent||'';
  let os='Onbekend';
  if(/Windows NT/i.test(ua))os='Windows';else if(/Android/i.test(ua))os='Android';else if(/iPhone|iPad|iPod/i.test(ua))os='iOS/iPadOS';else if(/Mac OS X/i.test(ua))os='macOS';else if(/Linux/i.test(ua))os='Linux';
  let browser='Onbekend';
  if(/Edg\//.test(ua))browser='Edge';else if(/Firefox\//.test(ua))browser='Firefox';else if(/Chrome\//.test(ua)&&!/Edg\//.test(ua))browser='Chrome';else if(/Safari\//.test(ua)&&!/Chrome\//.test(ua))browser='Safari';
  const uaData=navigator.userAgentData||{};
  const deviceType=uaData.mobile||/Mobi|Android|iPhone|iPod/i.test(ua)?'Telefoon':(/iPad|Tablet/i.test(ua)?'Tablet':'Computer');
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  return{
    clientId:getClientId(),deviceType,os,browser,
    browserBrands:Array.isArray(uaData.brands)?uaData.brands.map(x=>`${x.brand} ${x.version}`).join(', '):'',
    platform:uaData.platform||navigator.platform||'',
    screen:`${screen.width}×${screen.height}`,
    viewport:`${innerWidth}×${innerHeight}`,
    pixelRatio:String(devicePixelRatio||1),colorDepth:String(screen.colorDepth||''),
    language:navigator.language||'',languages:(navigator.languages||[]).join(', '),
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',
    hardwareConcurrency:String(navigator.hardwareConcurrency||''),deviceMemory:String(navigator.deviceMemory||''),
    maxTouchPoints:String(navigator.maxTouchPoints||0),cookieEnabled:String(navigator.cookieEnabled),
    doNotTrack:String(navigator.doNotTrack||''),
    connection:c?`type=${c.effectiveType||''}; downlink=${c.downlink||''}; rtt=${c.rtt||''}; saveData=${c.saveData||false}`:'',
    userAgent:ua.slice(0,500)
  }
}
document.getElementById('submitBtn').addEventListener('click',async()=>{const btn=document.getElementById('submitBtn');const payload={name:document.getElementById('name').value.trim(),className:document.getElementById('className').value.trim(),activities:getGroupValues('activities','activityOther'),foods:getGroupValues('foods','foodOther'),music:getGroupValues('music','musicOther'),extras:getGroupValues('extras','extrasOther'),idea:document.getElementById('idea').value.trim(),dietary:document.getElementById('dietary').value.trim(),device:getDeviceInfo()};btn.disabled=true;btn.textContent='Bezig…';try{const r=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Opslaan mislukt.');document.getElementById('doneName').textContent=payload.name.split(' ')[0];move(screens.length-1);setTimeout(()=>fireConfetti(220),260)}catch(err){showToast(err.message)}finally{btn.disabled=false;btn.textContent='Versturen ✨'}});
document.getElementById('restart').addEventListener('click',()=>location.reload());
function fireConfetti(amount=150){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const canvas=document.getElementById('confetti'),ctx=canvas.getContext('2d'),dpr=Math.min(devicePixelRatio||1,2);canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;ctx.scale(dpr,dpr);const palette=['#0b4f9c','#45688f','#7c8da3','#c5cfda','#d8e2ed'];const pieces=Array.from({length:amount},()=>({x:Math.random()*innerWidth,y:-20-Math.random()*innerHeight*.35,vx:(Math.random()-.5)*5,vy:3+Math.random()*4.5,r:3+Math.random()*4,a:Math.random()*Math.PI,va:(Math.random()-.5)*.18,c:palette[Math.floor(Math.random()*palette.length)]}));const start=performance.now();function frame(now){ctx.clearRect(0,0,innerWidth,innerHeight);for(const p of pieces){p.x+=p.vx;p.y+=p.vy;p.vy+=.035;p.a+=p.va;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.c;ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r);ctx.restore()}if(now-start<4200)requestAnimationFrame(frame);else ctx.clearRect(0,0,innerWidth,innerHeight)}requestAnimationFrame(frame)}
setTimeout(()=>fireConfetti(120),300);updateProgress();

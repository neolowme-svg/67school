const loginView=document.getElementById('loginView'),dashboard=document.getElementById('dashboard'),toast=document.getElementById('toast');
let pollTimer=null,backupTimer=null,searchTimer=null,lastStats=null,lastRowsSignature='',lastStatsSignature='',isLoading=false;
const openDevices=new Set();
function showToast(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),3000)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtDate(iso){try{return new Intl.DateTimeFormat('nl-NL',{dateStyle:'short',timeStyle:'short',second:'2-digit'}).format(new Date(iso))}catch{return iso||'–'}}
function sig(v){try{return JSON.stringify(v)}catch{return String(Date.now())}}
async function checkAuth(){const r=await fetch('/api/admin/me',{cache:'no-store'});const d=await r.json();if(d.authenticated){loginView.classList.add('hidden');dashboard.classList.remove('hidden');document.getElementById('passwordWarning').classList.toggle('hidden',d.adminPasswordConfigured);document.getElementById('storageMode').textContent=d.storageMode||'–';await Promise.all([load(true),loadStorage(),loadBackups(),loadMaintenance()]);connectLive()}else{loginView.classList.remove('hidden');dashboard.classList.add('hidden');if(!d.adminPasswordConfigured)document.getElementById('loginError').textContent='ADMIN_PASSWORD ontbreekt in Vercel.'}}
document.getElementById('loginForm').addEventListener('submit',async e=>{e.preventDefault();const p=document.getElementById('adminPassword').value;const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p})});const d=await r.json().catch(()=>({}));if(!r.ok){document.getElementById('loginError').textContent=d.error||'Inloggen mislukt';return}document.getElementById('loginError').textContent='';checkAuth()});
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/api/admin/logout',{method:'POST'});clearInterval(pollTimer);clearInterval(backupTimer);location.reload()});
function connectLive(){clearInterval(pollTimer);clearInterval(backupTimer);pollTimer=setInterval(()=>load(false),1000);backupTimer=setInterval(()=>{loadStorage();loadBackups(false);loadMaintenance(false)},10000)}
async function load(force=false){if(isLoading)return;isLoading=true;try{const q=document.getElementById('search').value.trim(),className=document.getElementById('classFilter').value;const r=await fetch(`/api/admin/results?q=${encodeURIComponent(q)}&className=${encodeURIComponent(className)}&t=${Date.now()}`,{cache:'no-store'});if(r.status===401){location.reload();return}const d=await r.json();if(!r.ok){showToast(d.error||'Laden mislukt');return}const oldTotal=lastStats?.total??0;lastStats=d.stats;const statsSignature=sig([d.stats,d.totalFiltered]);if(force||statsSignature!==lastStatsSignature){renderStats(d.stats,d.totalFiltered);renderClassFilter(d.stats.classes,className);lastStatsSignature=statsSignature}const rowsSignature=sig(d.rows);if(force||rowsSignature!==lastRowsSignature){captureOpenDevices();renderRows(d.rows);restoreOpenDevices();lastRowsSignature=rowsSignature}if(oldTotal&&d.stats.total>oldTotal)showToast(`${d.stats.total-oldTotal} nieuwe reactie(s) binnen`);document.getElementById('lastSync').textContent=`Bijgewerkt ${new Date().toLocaleTimeString('nl-NL')}`;}catch(e){console.error(e)}finally{isLoading=false}}
async function loadStorage(){const r=await fetch(`/api/admin/storage-status?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)return;const d=await r.json();document.getElementById('storageMode').textContent=d.storageMode||'–';document.getElementById('backupCount').textContent=d.backupCount??'–';document.getElementById('storedCount').textContent=d.responseCount??'–';document.getElementById('cronState').textContent='Na elke inzending + handmatig';}
function renderStats(s,filtered){document.getElementById('totalCount').textContent=s.total;document.getElementById('filteredCount').textContent=`${filtered} zichtbaar`;document.getElementById('todayCount').textContent=s.submittedToday;document.getElementById('topActivity').textContent=s.activities[0]?.label||'–';document.getElementById('topActivityCount').textContent=s.activities[0]?`${s.activities[0].count} keer gekozen`:'nog geen stemmen';document.getElementById('topFood').textContent=s.foods[0]?.label||'–';document.getElementById('topFoodCount').textContent=s.foods[0]?`${s.foods[0].count} keer gekozen`:'nog geen stemmen';renderBars('activityChart',s.activities);renderBars('foodChart',s.foods);renderBars('musicChart',s.music);renderBars('classChart',s.classes)}
function renderBars(id,items){const el=document.getElementById(id),max=Math.max(...items.map(x=>x.count),1);const html=items.length?items.slice(0,10).map(x=>`<div class="bar-row"><div class="bar-label" title="${esc(x.label)}">${esc(x.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(x.count/max*100)}%"></div></div><div class="bar-count">${x.count}</div></div>`).join(''):'<div class="empty">Nog geen gegevens</div>';if(el.innerHTML!==html)el.innerHTML=html}
function tags(arr){return(arr||[]).map(v=>`<span class="tag">${esc(v)}</span>`).join('')||'–'}
function captureOpenDevices(){document.querySelectorAll('.device-details[open]').forEach(el=>openDevices.add(el.dataset.id));document.querySelectorAll('.device-details:not([open])').forEach(el=>openDevices.delete(el.dataset.id))}
function restoreOpenDevices(){openDevices.forEach(id=>{const el=document.querySelector(`.device-details[data-id="${CSS.escape(id)}"]`);if(el)el.open=true})}
function deviceInfo(d={},id){const summary=[d.deviceType,d.os,d.browser,d.platform,d.screen].filter(Boolean).map(esc).join(' · ')||'Geen browserinfo';const details=Object.entries(d).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>`<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('');return `<details class="device-details" data-id="${esc(id)}"><summary>${summary}</summary><div class="device-grid">${details||'Geen extra info'}</div></details>`}
function renderRows(rows){const body=document.getElementById('resultRows'),empty=document.getElementById('emptyState');empty.classList.toggle('hidden',rows.length>0);body.innerHTML=rows.map(r=>`<tr data-row-id="${esc(r.id)}"><td><b>${esc(r.name)}</b></td><td>${esc(r.className)}</td><td>${tags(r.activities)}</td><td>${tags(r.foods)}</td><td>${esc(r.idea)||'<span style="opacity:.4">–</span>'}${r.dietary?`<br><small>Dieet/allergie: ${esc(r.dietary)}</small>`:''}</td><td>${deviceInfo(r.device,r.id)}</td><td>${fmtDate(r.createdAt)}</td><td><button class="danger-btn delete-response" data-id="${esc(r.id)}" data-name="${esc(r.name)}">Verwijder</button></td></tr>`).join('')}
function renderClassFilter(classes,current){const sel=document.getElementById('classFilter'),options=['<option value="">Alle klassen</option>',...classes.map(c=>`<option value="${esc(c.label)}">${esc(c.label)} (${c.count})</option>`)].join('');if(sel.innerHTML!==options){sel.innerHTML=options;sel.value=current}}
document.getElementById('resultRows').addEventListener('click',async e=>{const b=e.target.closest('.delete-response');if(!b)return;if(!confirm(`Reactie van ${b.dataset.name} verwijderen? Er wordt eerst automatisch een back-up gemaakt.`))return;b.disabled=true;const r=await fetch(`/api/admin/results/${encodeURIComponent(b.dataset.id)}`,{method:'DELETE'});const d=await r.json().catch(()=>({}));if(r.ok){showToast('Reactie verwijderd');lastRowsSignature='';lastStatsSignature='';await Promise.all([load(true),loadStorage(),loadBackups(true)])}else{showToast(d.error||'Verwijderen mislukt');b.disabled=false}});
document.getElementById('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{lastRowsSignature='';load(true)},180)});document.getElementById('classFilter').addEventListener('change',()=>{lastRowsSignature='';load(true)});
document.getElementById('backupNow').addEventListener('click',async()=>{const b=document.getElementById('backupNow');b.disabled=true;b.textContent='Back-up maken…';const r=await fetch('/api/admin/backup-now',{method:'POST'});const d=await r.json().catch(()=>({}));showToast(r.ok?`Back-up gemaakt: ${d.backup?.count??0} reacties`:d.error||'Back-up mislukt');b.disabled=false;b.textContent='Nieuwe back-up';await Promise.all([loadStorage(),loadBackups(true)])});
async function loadBackups(force=false){const r=await fetch(`/api/admin/backups?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)return;const d=await r.json();const list=document.getElementById('backupList');const html=(d.backups||[]).length?(d.backups||[]).map(b=>`<div class="backup-item"><div><b>${fmtDate(b.createdAt)}</b><small>${Math.max(1,Math.round((b.size||0)/1024))} KB · ${esc(b.pathname||'backup')}</small></div><a class="ghost small-btn" href="/api/admin/backups/${encodeURIComponent(b.id)}/download">Download</a></div>`).join(''):'<div class="empty">Nog geen back-ups.</div>';if(force||list.innerHTML!==html)list.innerHTML=html;document.getElementById('backupCountInline').textContent=(d.backups||[]).length}
async function importFile(file,url,type){if(!file)return;if(!confirm('Importeren? Bestaande inzendingen blijven staan; alleen nieuwe IDs worden toegevoegd.'))return;const text=await file.text();const r=await fetch(url,{method:'POST',headers:{'Content-Type':type},body:text});const d=await r.json().catch(()=>({}));showToast(r.ok?`${d.imported} inzending(en) geïmporteerd`:d.error||'Import mislukt');if(r.ok){lastRowsSignature='';lastStatsSignature='';await Promise.all([load(true),loadStorage(),loadBackups(true)])}}
document.getElementById('csvImport').addEventListener('change',async e=>{await importFile(e.target.files?.[0],'/api/admin/import.csv','text/csv;charset=utf-8');e.target.value=''});document.getElementById('jsonImport').addEventListener('change',async e=>{await importFile(e.target.files?.[0],'/api/admin/import.json','application/json');e.target.value=''});
checkAuth();


let maintenanceState=null;
async function loadMaintenance(showError=true){
  const btn=document.getElementById('maintenanceToggle');
  const status=document.getElementById('maintenanceStatus');
  if(!btn||!status)return;
  try{
    const r=await fetch(`/api/admin/maintenance?t=${Date.now()}`,{cache:'no-store'});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Status laden mislukt');
    maintenanceState=d;
    const on=Boolean(d.enabled);
    status.className=`maintenance-status ${on?'is-on':'is-off'}`;
    if(d.forced){
      status.textContent='Automatisch onderhoud: opslag is niet beschikbaar';
      btn.textContent='Onderhoud verplicht actief';
      btn.className='maintenance-toggle is-on';
      btn.disabled=true;
      document.getElementById('maintenanceHelp').textContent='De opslag kan nu niet veilig worden gelezen. Daarom blokkeert de site automatisch nieuwe inzendingen zodat er niets verloren gaat.';
    }else{
      status.textContent=on?'Onderhoud staat AAN — leerlingen zien de onderhoudspagina':'Onderhoud staat UIT — vragenlijst is open';
      btn.textContent=on?'Onderhoud uitzetten':'Onderhoud aanzetten';
      btn.className=`maintenance-toggle ${on?'is-on':'is-off'}`;
      btn.disabled=false;
      document.getElementById('maintenanceHelp').textContent='Als onderhoud aan staat, kunnen leerlingen de vragenlijst niet invullen en zien ze een duidelijke onderhoudsmelding.';
    }
  }catch(e){
    status.className='maintenance-status is-on';
    status.textContent='Status niet bereikbaar — ga voor de zekerheid uit van onderhoud';
    btn.textContent='Status niet beschikbaar';btn.disabled=true;
    if(showError)showToast(e.message);
  }
}

document.getElementById('maintenanceToggle')?.addEventListener('click',async()=>{
  if(!maintenanceState||maintenanceState.forced)return;
  const next=!maintenanceState.enabled;
  const question=next?'Onderhoud aanzetten? Leerlingen kunnen dan tijdelijk niets invullen.':'Onderhoud uitzetten? Controleer eerst of de opslag weer goed werkt.';
  if(!confirm(question))return;
  const btn=document.getElementById('maintenanceToggle');btn.disabled=true;btn.textContent='Bezig…';
  try{
    const r=await fetch('/api/admin/maintenance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:next})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Wijzigen mislukt');
    showToast(next?'Onderhoud staat aan':'Onderhoud staat uit');
    await loadMaintenance();
  }catch(e){showToast(e.message);await loadMaintenance(false)}
});

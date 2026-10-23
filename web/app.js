import { Explorer, PREVIEW_SKILLS } from './engine.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'curious-explorer:v1';
let saved = {};
let storageAvailable = true;
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
catch { storageAvailable = false; }
const explorer = new Explorer({ settings: saved.settings, memory: saved.memory });
explorer.setAllowedSkills(saved.allowedSkills || []);
let connection = null;
let bridgeAvailable = false;
let liveSession = false;
let arming = false;
let soundNotes = [];
let soundSequence = 0;
let queue = [];
let generation = 0;
let dispatching = false;
let refreshing = false;
let lastSkillKey = '';
let lastJournalKey = '';
let marker = null;
let path = [];
let lastTick = performance.now();
let toastTimer;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const duckImage = new Image();
duckImage.src = 'assets/duck-mark.svg';

function announce(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4300);
}

function persist() {
  const { settings, memory, allowedSkills } = explorer.snapshot();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, memory, allowedSkills })); }
  catch { storageAvailable = false; }
  if (!storageAvailable) $('storage-note').textContent = 'Memory lasts for this visit. Browser storage is unavailable.';
}

function displayTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'JUST NOW' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function render() {
  const state = explorer.snapshot();
  const paused = state.mode === 'paused';
  $('start-button').replaceChildren();
  const startIcon = document.createElement('span');
  startIcon.setAttribute('aria-hidden', 'true');
  startIcon.textContent = paused ? '▷' : 'Ⅱ';
  $('start-button').append(startIcon, document.createTextNode(paused ? 'Let’s explore' : 'Pause exploring'));
  $('mood-label').textContent = state.mood;
  $('mode-label').textContent = paused ? 'Ready when you are.' : state.mode === 'resting' ? 'A moment to recharge.' : liveSession ? 'Connected to your simulator.' : 'Exploring the practice field.';
  $('field-focus').textContent = state.focus.text;
  $('energy-value').textContent = `${Math.round(state.energy)}%`;
  $('energy-bar').style.width = `${state.energy}%`;
  $('energy-caption').textContent = state.mode === 'resting' ? 'Resting now. Curiosity will return in a moment.' : 'A little rest is part of exploring, too.';
  $('encounters-total').textContent = String(state.memory.encounters);
  document.querySelectorAll('[data-event]').forEach((button) => { button.disabled = paused; });
  const journal = [...state.journal.filter((event) => event.type !== 'ready'), ...soundNotes]
    .sort((a,b) => new Date(b.time) - new Date(a.time));
  const journalKey = journal.map((event) => event.id).join(',');
  $('notes-empty').hidden = journal.length > 0;
  $('journal').hidden = journal.length === 0;
  $('note-count').textContent = String(journal.length).padStart(2, '0');
  if (journalKey !== lastJournalKey) {
    const items = journal.slice(0, 12).map((event) => {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.dateTime = event.time;
      time.textContent = displayTime(event.time);
      const text = document.createElement('span');
      text.textContent = event.text;
      li.append(time, text);
      return li;
    });
    $('journal').replaceChildren(...items);
    lastJournalKey = journalKey;
  }
  const skillsKey = JSON.stringify([state.skills, state.allowedSkills, connection?.connected]);
  if (skillsKey !== lastSkillKey) {
    renderSkills(state);
    lastSkillKey = skillsKey;
  }
  const previous = path[path.length - 1];
  if (!previous || Math.hypot(previous.x - state.position.x, previous.y - state.position.y) > .005) {
    path.push({ ...state.position });
    path = path.slice(-160);
  }
  drawField(state);
}

function renderSkills(state) {
  const rows = state.skills.map((skill) => {
    const row = document.createElement('label');
    row.className = 'skill-row';
    const symbol = document.createElement('span');
    symbol.className = 'skill-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = skill.kind === 'gait' ? '↝' : '✧';
    const content = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = skill.label || skill.name;
    const description = document.createElement('small');
    description.textContent = skill.kind === 'gait' ? 'Existing walking policy · left in place' : skill.kind === 'system' ? 'Available to the robot · not used by Explorer' : 'Optional greeting · you choose';
    content.append(name, description);
    row.append(symbol, content);
    if (skill.kind === 'gait' || skill.kind === 'system') {
      const badge = document.createElement('span');
      badge.className = 'skill-badge';
      badge.textContent = 'UNCHANGED';
      row.append(badge);
    } else {
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.role = 'switch';
      toggle.setAttribute('aria-label', `Allow Explorer to use ${skill.label || skill.name}`);
      toggle.checked = state.allowedSkills.includes(skill.id);
      toggle.addEventListener('change', async () => {
        const allowed = new Set(explorer.snapshot().allowedSkills);
        toggle.checked ? allowed.add(skill.id) : allowed.delete(skill.id);
        explorer.setAllowedSkills([...allowed]);
        // Discard queued skill requests when consent changes, including requests
        // that were generated before this checkbox was turned off.
        generation += 1;
        queue = [];
        if (bridgeAvailable && connection?.connected) {
          try { await api('/api/permissions', { skills: explorer.snapshot().allowedSkills }); }
          catch (error) { await pauseExplorer('permission'); announce(error.message); }
        }
        persist(); render();
      });
      row.append(toggle);
    }
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'small';
    empty.textContent = 'No compatible extra gestures were reported. Explorer can still look around.';
    rows.push(empty);
  }
  $('skills-list').replaceChildren(...rows);
  $('skills-context').textContent = connection?.connected ? 'REPORTED BY YOUR ENDPOINT · READ ONLY' : 'EXAMPLE SKILL LIBRARY · PREVIEW ONLY';
}

function drawField(state) {
  const canvas = $('world');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = 900, height = 460;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#e9eddf'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#dce4cf';
  ctx.beginPath(); ctx.ellipse(106, 360, 170, 95, -.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(790, 96, 170, 115, -.35, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c5cfb7'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath(); ctx.ellipse(100, 350, 198 + i * 18, 125 + i * 17, -.6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(790, 96, 198 + i * 18, 140 + i * 17, -.35, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#b9c4aa';
  for (let x = 40; x < width; x += 35) for (let y = 35; y < height; y += 35) { ctx.beginPath(); ctx.arc(x, y, .8, 0, Math.PI * 2); ctx.fill(); }
  [[130,120],[710,330],[290,345],[580,120]].forEach(([x,y],index) => {
    ctx.fillStyle = index % 2 ? '#d5d4bd' : '#c5cfb2';
    ctx.beginPath(); ctx.ellipse(x,y,13 + index * 3,7 + index, -.3,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#a7b495'; ctx.beginPath();ctx.moveTo(x-5,y+1);ctx.lineTo(x+7,y-2);ctx.stroke();
  });
  const px = (x) => 70 + x * (width - 140);
  const py = (y) => 70 + y * (height - 140);
  if (path.length > 1) {
    ctx.strokeStyle = '#9baa89';ctx.lineWidth = 2;ctx.setLineDash([2,9]);ctx.lineCap = 'round';ctx.beginPath();
    path.forEach((point,index) => { index ? ctx.lineTo(px(point.x),py(point.y)) : ctx.moveTo(px(point.x),py(point.y)); });
    ctx.stroke();ctx.setLineDash([]);
  }
  if (marker && performance.now() - marker.at < 6500) {
    const x = px(marker.x), y = py(marker.y);
    ctx.strokeStyle = '#b36f4b';ctx.lineWidth=1.5;ctx.setLineDash([3,4]);ctx.beginPath();ctx.arc(x,y,30,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle = '#f6f3e9';ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();
    ctx.fillStyle = '#8c633f';ctx.textAlign='center';ctx.font='28px Georgia';ctx.fillText(marker.symbol,x,y+9);
  }
  const x = px(state.position.x), y = py(state.position.y);
  const flip = Math.cos(state.position.heading) < 0 ? -1 : 1;
  if (state.mode !== 'paused' && state.mode !== 'resting') {
    ctx.save();ctx.translate(x,y-28);ctx.scale(flip,1);ctx.fillStyle='#f6f3e944';ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(125,-38);ctx.lineTo(125,38);ctx.closePath();ctx.fill();ctx.restore();
  }
  ctx.fillStyle = '#65765526';ctx.beginPath();ctx.ellipse(x,y+46,48,12,0,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.translate(x,y);ctx.scale(flip,1);
  if(duckImage.complete && duckImage.naturalWidth) ctx.drawImage(duckImage,-62,-66,124,124);
  else {ctx.fillStyle='#4e6b50';ctx.fillRect(-27,-30,52,43);ctx.fillStyle='#e8cb47';ctx.fillRect(24,-18,24,14);}
  ctx.restore();
  if (state.mode === 'resting') {ctx.fillStyle='#6a7d5c';ctx.font='italic 20px Georgia';ctx.textAlign='center';ctx.fillText('z',x+45,y-55);}
  ctx.fillStyle='#526747';ctx.font='11px -apple-system, sans-serif';ctx.textAlign='center';ctx.fillText(state.settings.name,x,y+76);
}

async function api(route, body) {
  const response = await fetch(route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Explorer-Token': connection?.csrfToken || connection?.token || '' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(4500),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'The local companion couldn’t complete that request.'); error.status = response.status; throw error; }
  return result;
}

function paintConnection() {
  const badge = $('connection-badge');
  const dot = document.createElement('i');
  badge.replaceChildren(dot, document.createTextNode(liveSession ? 'Simulator session' : connection?.connected ? 'Endpoint · read only' : 'Browser preview'));
  $('local-connection').hidden = !bridgeAvailable;
  $('bridge-detail').textContent = bridgeAvailable ? connection.detail : 'This page works on its own. The local companion can also connect to an existing Microduck simulator.';
  $('arm-button').disabled = arming || !connection?.connected || !connection?.control_allowed || !$('exclusive-session').checked;
  $('arm-button').textContent = arming ? 'Connecting…' : liveSession ? 'End simulator session' : 'Enable simulator control';
  if (liveSession && !arming) $('arm-button').disabled = false;
}

async function refreshConnection({ initial = false } = {}) {
  if (refreshing) return;
  if (!['localhost','127.0.0.1'].includes(location.hostname)) return;
  refreshing = true;
  const epoch = generation;
  try {
    const status = await api('/api/status');
    if (epoch !== generation || arming) return;
    if (!status.csrfToken || !['preview','microduck'].includes(status.backend)) throw new Error('No local companion available.');
    const previous = connection;
    connection = status;
    bridgeAvailable = true;
    if (liveSession && (!status.connected || !status.armed)) {
      liveSession = false; generation += 1; queue = []; explorer.pause('connection');
      announce('The simulator session paused. Your installed skills are unchanged.');
    }
    const changedEndpoint = status.connected && (!previous?.connected || JSON.stringify(previous.skills) !== JSON.stringify(status.skills));
    if (changedEndpoint) {
      const skills = (status.skills || []).map((skill) => ({
        id:skill.name,name:skill.name,label:skill.name.replaceAll('_',' '),
        kind: Number.isFinite(skill.duration) && skill.duration > 0 && skill.duration <= 30 && /(^|[-_ ])bow($|[-_ ])/i.test(skill.name) ? 'skill' : 'system',
        ...(/(^|[-_ ])bow($|[-_ ])/i.test(skill.name) ? {role:'greeting'} : {}),
      }));
      explorer.setSkills(skills);
      generation += 1; queue = [];
      // Real capability consent never inherits the example preview's checkbox.
      if (!previous?.connected) explorer.setAllowedSkills([]);
      if (!initial) announce('Available skills refreshed. Nothing on your endpoint was changed.');
    } else if (!status.connected && previous?.connected) {
      explorer.setSkills(PREVIEW_SKILLS); explorer.setAllowedSkills([]);
    }
    $('bridge-status').textContent = status.connected ? `${status.target_label}. ${status.control_allowed ? 'Control begins only after you enable a session.' : 'Inspection only; commands are disabled.'}` : status.detail;
    paintConnection();render();
  } catch (error) {
    if (liveSession) { await pauseExplorer('connection'); announce('Connection lost. Explorer has paused.'); }
    if (!initial && bridgeAvailable) $('bridge-status').textContent = error.message;
  } finally { refreshing = false; }
}

async function pauseExplorer(reason='owner') {
  explorer.pause(reason); generation += 1; queue = [];
  const needsRelease = liveSession || arming;
  liveSession = false;
  if (needsRelease && bridgeAvailable) {
    try { await api('/api/pause', {}); }
    catch { $('bridge-status').textContent = 'Connection lost. The companion’s short heartbeat lease will expire.'; }
  }
  $('exclusive-session').checked = false;
  paintConnection();persist();render();
}

async function flushActions() {
  if (dispatching || !liveSession || !queue.length) return;
  dispatching = true;
  const epoch = generation;
  const entry = queue[0];
  try {
    if (performance.now() - entry.at > 7000) { queue.shift(); return; }
    await api('/api/action', entry.action);
    if (epoch === generation && queue[0] === entry) queue.shift();
  } catch (error) {
    if (epoch !== generation) return;
    if (error.status === 409 && /completing the previous action/.test(error.message)) return;
    await pauseExplorer('connection');
    announce(`Explorer paused. ${error.message}`);
  } finally { dispatching = false; }
}

$('start-button').addEventListener('click', () => {
  if (explorer.snapshot().mode !== 'paused') { void pauseExplorer(); return; }
  explorer.start();lastTick=performance.now();persist();render();
});
$('take-control').addEventListener('click', async () => { await pauseExplorer('owner_control'); announce('Your turn. Explorer will wait until you start it again.'); });
document.querySelectorAll('[data-event]').forEach((button,index) => {
  button.addEventListener('click', () => {
    generation += 1; queue = [];
    const state = explorer.snapshot();
    marker = {x:Math.min(.86,state.position.x+.2),y:Math.max(.18,state.position.y-.13),at:performance.now(),symbol:['❧','◇','☀','⌒'][index]};
    explorer.observe(button.dataset.event,{yaw:.22});
    persist();render();
  });
});
$('explorer-name').value=explorer.snapshot().settings.name;
$('curiosity').value=explorer.snapshot().settings.curiosity;
$('activity').value=explorer.snapshot().settings.energy;
$('sounds').checked=explorer.snapshot().settings.sounds;
function settingsChanged() {
  explorer.setSettings({name:$('explorer-name').value,curiosity:Number($('curiosity').value),energy:Number($('activity').value),sounds:$('sounds').checked});
  $('explorer-name').value = explorer.snapshot().settings.name;
  $('curiosity-label').textContent = Number($('curiosity').value)>75?'Wonderfully inquisitive':Number($('curiosity').value)<45?'Taking its time':'Always noticing';
  $('activity-label').textContent = Number($('activity').value)>75?'A spring in its step':Number($('activity').value)<45?'Unhurried':'Easygoing';
  if (!$('sounds').checked) queue = queue.filter((entry)=>entry.action.kind !== 'sound');
  persist();render();
}
['explorer-name','curiosity','activity','sounds'].forEach((id)=>$(id).addEventListener(id==='explorer-name'?'change':'input',settingsChanged));
$('reset-memory').addEventListener('click',()=>{$('memory-confirm').hidden=false;$('cancel-reset').focus();});
$('cancel-reset').addEventListener('click',()=>{$('memory-confirm').hidden=true;$('reset-memory').focus();});
$('confirm-reset').addEventListener('click',()=>{explorer.resetMemory();soundNotes=[];path=[];$('memory-confirm').hidden=true;lastJournalKey='';persist();render();announce('A fresh page. Your preferences and skill choices are still here.');$('reset-memory').focus();});
$('exclusive-session').addEventListener('change',paintConnection);
$('refresh-connection').addEventListener('click',()=>refreshConnection());
$('arm-button').addEventListener('click',async()=>{
  if(arming)return;
  if(liveSession){await pauseExplorer();return;}
  arming=true;
  explorer.pause();generation+=1;queue=[];
  const epoch=generation;
  paintConnection();
  try{
    await api('/api/permissions',{skills:explorer.snapshot().allowedSkills});
    if(epoch!==generation||document.hidden)return;
    await api('/api/arm',{enabled:true,exclusive:$('exclusive-session').checked});
    if(epoch!==generation||document.hidden){await api('/api/pause',{});return;}
    generation+=1;
    liveSession=true;connection.armed=true;
    $('bridge-status').textContent='Simulator control is enabled. Start Explorer when you’re ready. A running discrete skill may finish after pausing.';
    paintConnection();render();announce('Simulator connected. Start Explorer for a little rehearsal.');
  }catch(error){if(epoch===generation){announce(error.message);$('bridge-status').textContent=error.message;}}
  finally{arming=false;paintConnection();render();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden && (arming || liveSession || explorer.snapshot().mode!=='paused')) void pauseExplorer('tab-hidden');});
window.addEventListener('pagehide',()=>{
  persist();
  if((liveSession||arming)&&connection){
    fetch('/api/pause',{method:'POST',headers:{'Content-Type':'application/json','X-Explorer-Token':connection.csrfToken},body:'{}',keepalive:true}).catch(()=>{});
  }
});
duckImage.addEventListener('load',()=>render());
setInterval(()=>{
  const now=performance.now();const dt=Math.min(.6,(now-lastTick)/1000);lastTick=now;
  const actions=explorer.tick(dt);
  if(!liveSession)for(const action of actions){
    if(action.kind==='sound'){
      soundNotes.unshift({id:`sound-${++soundSequence}`,time:new Date().toISOString(),type:'sound',text:action.name==='friendly-chirp'?'A friendly chirp. (Preview sound cue.)':'An inquisitive little chirp. (Preview sound cue.)'});
      soundNotes=soundNotes.slice(0,10);
    }
  }
  if(liveSession){queue.push(...actions.map(action=>({action,at:now})));queue=queue.slice(-16);void flushActions();}
  render();
},reducedMotion?500:200);
setInterval(async()=>{
  const epoch=generation;
  if(liveSession&&!document.hidden){try{await api('/api/heartbeat',{});}catch(error){if(epoch===generation&&liveSession){await pauseExplorer('connection');announce(`Explorer paused. ${error.message}`);}}}
},1000);
setInterval(()=>{persist();if(bridgeAvailable)void refreshConnection();},4000);
settingsChanged();
void refreshConnection({initial:true});

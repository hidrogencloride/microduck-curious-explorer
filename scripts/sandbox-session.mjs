/** Optional local development controls. Attached to the pinned official sandbox. */
import { Explorer } from './engine.js';
import { SandboxAdapter, SANDBOX_MANUAL_ACTIONS } from './sandbox-adapter.js';

const panel = document.createElement('section');
panel.style.cssText = 'position:fixed;z-index:2147483647;top:70px;left:16px;width:min(290px,42vw);max-height:40vh;overflow:auto;padding:16px;border:1px solid #819480;border-radius:12px;background:#f7f4ea;color:#254332;font:13px/1.5 system-ui;box-shadow:0 5px 22px #0002';
panel.innerHTML = `<b>Curious Explorer</b><p style="margin:4px 0 12px">Small discoveries. Great company.</p><p>Simulation workshop · scripted observations</p><button data-start>Explore</button> <button data-test>Run checks</button> <button data-pause>Pause</button><p data-status role="status">Waiting for the sandbox…</p><button data-save disabled>Save results</button><details><summary>Test details</summary><pre data-report style="white-space:pre-wrap;font:11px/1.4 monospace"></pre></details>`;
for (const button of panel.querySelectorAll('button')) button.style.cssText='margin:3px 0;padding:6px 9px;border:1px solid #819480;border-radius:6px;background:#e9eee3;color:#254332;cursor:pointer';
document.body.append(panel);
const status = panel.querySelector('[data-status]');
const detail = panel.querySelector('[data-report]');
let adapter, record = null, pending = null, epoch = 0, lastTime = null, beforePolicies, beforeHead, afterStopAt = null;
let scenarioStart = 0, scenarioEpoch = 0, phase = 0, previousPosition, initialPosition, lastSample = -1, events = [];
let attachedController = null, manualSubscriptions = [];
const round = n => Math.round(n * 100000) / 100000;
const position = () => [window.rl.data.qpos[0], window.rl.data.qpos[1]];
const otherInputActive = source => source.isActive() || Object.values(source.axes || {}).some(value => typeof value === 'number' && Math.abs(value) > 0.02);
const isReady = () => window.rl && !window.rl.inputLocked && !window.rl.controller.locked && !window.rl.recovery && window.rl.mode === 'walk' && window.rl.loco === 'legs' && !window.rl.headMode && !window.rl.scriptRun && !window.rl.locoSwitching && !window.rl.customPolicy;
function render() { if (record) detail.textContent = JSON.stringify(record, null, 2); }
function pause(reason='owner') { pending=null; adapter?.pause(reason); status.textContent='At ease. Resume whenever you are ready.'; }
function ownerTookControl() {
  pending=null;
  if(record?.result==='running')complete('owner_control');
  else pause('owner_control');
}
function makeAdapter() {
  adapter?.dispose();
  const rl=window.rl;
  events=[];
  adapter=new SandboxAdapter({ engine:new Explorer({settings:{sounds:false}}), port:{
    simulation:true,controller:rl.controller,headTarget:rl.headTarget,
    readState:()=>({time:rl.data.time,epoch,locked:rl.inputLocked||rl.controller.locked||!!rl.customPolicy,recovery:rl.recovery,mode:rl.mode,variant:rl.loco,headMode:rl.headMode,scriptActive:!!rl.scriptRun,switching:rl.locoSwitching}),
  },
  // Calibrated only for the pinned browser sandbox's stock walking policy.
  // The behavior engine's requested speeds and the robot connector are unchanged.
  mapSpeed:speed=>speed>0?.25:speed,
  onEvent:event=>{events.push(event);if(events.length>128)events.shift();},
  });
}
function start(test=false) {
  if(!isReady()){status.textContent='Choose Waddle in and wait for the entrance. Use feet mode and the stock policy.';return;}
  if(record?.result==='running')complete('restarted');
  pending=null;afterStopAt=null;makeAdapter();beforePolicies={...window.rl.sessions};beforeHead=Array.from(window.rl.headTarget);
  if(!adapter.start()){status.textContent='Explorer is waiting for the controls to be free.';return;}
  scenarioStart=window.rl.data.time;scenarioEpoch=epoch;phase=0;initialPosition=position();previousPosition=initialPosition;lastSample=-1;
  record={schema:1,scenario:test?'scripted-18-second-check':'interactive',upstream:'ad9d41a763f30dc770817c33d92dcfec0205db1e',profile:'stock-legs-0.25',result:'running',observations:'scripted; no perception',robotConnectorTested:false,elapsed:0,maxDisplacementMetres:0,pathMetres:0,maxPolicyForwardCommand:0,samples:[],events:[]};
  status.textContent=test?'A short exploration, then a pause and resume.':'Explorer is looking around. Your controls take priority.';render();
}
function complete(reason) {
  adapter.pause(reason);record.result=reason;record.finalCommand=adapter.snapshot().command;
  record.policyObjectsUnchanged=Object.keys(beforePolicies).length===Object.keys(window.rl.sessions).length&&Object.entries(beforePolicies).every(([key,value])=>window.rl.sessions[key]===value);
  record.headTargetsRestored=beforeHead.every((x,i)=>x===window.rl.headTarget[i]);
  record.events=events;afterStopAt=window.rl.data.time;record.stopPosition=position();
  panel.querySelector('[data-save]').disabled=false;status.textContent=reason==='completed'?'Checks complete. Explorer is paused.':'Explorer paused. Review the test details.';render();
}
panel.querySelector('[data-start]').onclick=()=>start();
panel.querySelector('[data-test]').onclick=()=>{if(!isReady()){status.textContent='Enter the arena first, using feet mode and the stock policy.';return;}if(record?.result==='running')complete('restarted');pause();afterStopAt=null;window.rl.resetSim();epoch++;pending={settle:null};status.textContent='Making a little room. Waiting for the duck to settle…';};
panel.querySelector('[data-pause]').onclick=()=>{if(record?.result==='running')complete('paused-by-owner');else pause();};
panel.querySelector('[data-save]').onclick=()=>{const link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));link.href=url;link.download='curious-explorer-sandbox-results.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function frame(){
 const rl=window.rl;
 if(rl){
  if(attachedController!==rl.controller){
   manualSubscriptions.forEach(unsubscribe=>unsubscribe?.());attachedController=rl.controller;
   manualSubscriptions=SANDBOX_MANUAL_ACTIONS.map(action=>rl.controller.on(action,()=>{if(action==='reset')epoch++;ownerTookControl();}));
  }
  if(lastTime!==null&&rl.data.time<lastTime){epoch++;if(pending)pending.settle=null;}lastTime=rl.data.time;
  if(!adapter&&!pending)status.textContent='Ready when you are. Enter the arena, then explore or run the checks.';
  if(pending&&rl.controller.sources.some(source=>source!==adapter?.source&&otherInputActive(source)))ownerTookControl();
  if(pending&&!isReady())pending.settle=null;
  if(pending&&isReady()){pending.settle??=rl.data.time;if(rl.data.time-pending.settle>=2)start(true);}
  if(record?.result==='running'&&adapter){
   const otherInput=rl.controller.sources.some(source=>source!==adapter.source&&otherInputActive(source));
   if(!Number.isFinite(rl.data.time)||epoch!==scenarioEpoch){complete('simulator-reset');requestAnimationFrame(frame);return;}
   if(otherInput){complete('owner_control');requestAnimationFrame(frame);return;}
   if(!isReady()){complete('sandbox-unavailable');requestAnimationFrame(frame);return;}
   const elapsed=rl.data.time-scenarioStart;record.elapsed=round(elapsed);const pos=position();
   record.maxDisplacementMetres=Math.max(record.maxDisplacementMetres,Math.hypot(pos[0]-initialPosition[0],pos[1]-initialPosition[1]));
   record.pathMetres+=Math.hypot(pos[0]-previousPosition[0],pos[1]-previousPosition[1]);previousPosition=pos;
   record.maxPolicyForwardCommand=Math.max(record.maxPolicyForwardCommand,rl.cmd[0]);
   if(elapsed-lastSample>=.25){record.samples.push({t:round(elapsed),position:pos.map(round),speed:round(Math.hypot(rl.data.qvel[0],rl.data.qvel[1])),policyForward:round(rl.cmd[0])});lastSample=elapsed;}
   const scripted=record.scenario==='scripted-18-second-check';
   if(scripted&&phase===0&&elapsed>=8){adapter.observe('obstacle');record.obstacleCommandCleared=adapter.source.command.every(x=>x===0);phase=1;}
   if(scripted&&phase===1&&elapsed>=10){adapter.observe('owner_control');record.scriptedOwnerPaused=!adapter.snapshot().active;phase=2;}
   if(scripted&&phase===2&&elapsed>=12){record.resumed=adapter.resume();phase=3;}
   if(scripted&&elapsed>=18)complete('completed');
   else if(!adapter.snapshot().active&&!(scripted&&phase===2))complete(adapter.snapshot().reason||'paused');
   else {record.events=events;render();}
  }else if(record&&afterStopAt!==null){
   const age=rl.data.time-afterStopAt;
   if(age>=1){const pos=position();record.oneSecondAfterStop={policyForward:rl.cmd[0],speed:Math.hypot(rl.data.qvel[0],rl.data.qvel[1]),displacement:Math.hypot(pos[0]-record.stopPosition[0],pos[1]-record.stopPosition[1])};afterStopAt=null;render();}
  }
 }
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('blur',()=>{if(record?.result==='running')complete('window-blur');else pause('window-blur');});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(record?.result==='running')complete('tab-hidden');else pause('tab-hidden');}});
// Canvas clicks, orbit drags, and robot grabs are owner input too, including
// during the scripted pause. Preserve the browser's original pointer handlers.
document.addEventListener('pointerdown',event=>{if(event.target?.tagName==='CANVAS'&&(pending||record?.result==='running'))ownerTookControl();},true);
// Movement key taps can begin and end between render polls. Yield on keydown
// as well as source arbitration; leave the stock keyboard handler untouched.
const movementKeys = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD']);
window.addEventListener('keydown',event=>{if(movementKeys.has(event.code)&&(pending||record?.result==='running'))ownerTookControl();},true);

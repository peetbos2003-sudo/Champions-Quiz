/* Champions Pubquiz · standalone version (GitHub Pages + Supabase) */
(function(){
"use strict";
const SUPA_URL="https://lgeqzsdurewtjvqticho.supabase.co";
const SUPA_KEY="sb_publishable_vQxOpKXbaaRzGy-l8yen0g_zAB3ithw";

const SLOTS=[
  {id:"t1",c:"#e0b85c",l:"I"},{id:"t2",c:"#8fcdf2",l:"II"},{id:"t3",c:"#86d3a8",l:"III"},
  {id:"t4",c:"#e89aa8",l:"IV"},{id:"t5",c:"#c9d2e3",l:"V"}];
const LET=["A","B","C","D","E","F"];
const DEMO=[
 {id:"q1",round:"Demo · Kerst",type:"mc",nl:"In welk land is de traditie van de kerstboom ontstaan?",en:"In which country did the Christmas tree tradition begin?",options:[{nl:"Duitsland",en:"Germany"},{nl:"Engeland",en:"England"},{nl:"Zweden",en:"Sweden"},{nl:"Nederland",en:"The Netherlands"}],answer:0,points:1,seconds:30},
 {id:"q2",round:"Demo · Kerst",type:"open",nl:"Hoe heet het rendier met de rode neus?",en:"What is the name of the reindeer with the red nose?",answer:"Rudolph",accept:["Rudolf"],points:1,seconds:30},
 {id:"q3",round:"Demo · Kerst",type:"estimate",nl:"Hoeveel cadeaus krijg je in totaal in 'The Twelve Days of Christmas'?",en:"How many gifts are given in total in 'The Twelve Days of Christmas'?",answer:364,unit:"cadeaus",points:2,seconds:40},
 {id:"q4",round:"Demo · Kampioenen",type:"mc",nl:"In welk jaar werd Nederland Europees kampioen voetbal?",en:"In which year did the Netherlands win the European football championship?",options:[{nl:"1974"},{nl:"1988"},{nl:"1992"},{nl:"2000"}],answer:1,points:1,seconds:25},
 {id:"q5",round:"Demo · Kampioenen",type:"mc",nl:"Hoeveel ringen telt het Olympische symbool?",en:"How many rings are in the Olympic symbol?",options:[{nl:"4"},{nl:"5"},{nl:"6"},{nl:"7"}],answer:1,points:1,seconds:20},
 {id:"q6",round:"Demo · Kampioenen",type:"estimate",nl:"Hoe hoog is de Mount Everest in meters?",en:"How high is Mount Everest in metres?",answer:8849,unit:"m",points:2,seconds:40}];

const S={state:null,teams:{},lockins:[],offset:0,view:"",online:true,err:"",busy:false,
  pick:null,draft:{},confirmReset:false,seen:new Set(),
  pin:null,questions:[],answers:[],importText:"",me:null,lateFor:null};
const app=document.getElementById("app");
const sb=window.supabase?window.supabase.createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:false}}):null;

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const slotOf=id=>SLOTS.find(s=>s.id===id)||SLOTS[0];
const dot=id=>`<i class="dot" style="background:${slotOf(id).c}"></i>`;
const norm=s=>String(s??"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"");
const secs=ms=>(Math.max(0,ms)/1000).toFixed(1).replace(".",",")+"s";
const ord=n=>n===1?"1e":n+"e";
const nl=n=>Number(n).toLocaleString("nl-NL");
const now=()=>Date.now()+S.offset;
const ts=v=>v?new Date(v).getTime():null;
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}
function token(){const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(b=>b.toString(16).padStart(2,"0")).join("")}

/* ---------- derived ---------- */
const phase=()=>S.state?.phase||"lobby";
const curIdx=()=>S.state?.q??-1;
const cur=()=>S.state?.current||null;
const isHost=()=>!!S.pin;
function joined(){return SLOTS.map(s=>S.teams[s.id]).filter(Boolean).sort((a,b)=>ts(a.joined_at)-ts(b.joined_at))}
function lockinsFor(qid){return S.lockins.filter(l=>l.qid===qid&&S.teams[l.slot]).sort((a,b)=>a.ms-b.ms)}
function myTeam(){if(!S.me)return null;const t=S.teams[S.me.slot];return t||null}
function scoreOf(slot){return (S.state?.scores||{})[slot]||0}
function ranking(){return joined().map(t=>({...t,score:scoreOf(t.slot)})).sort((a,b)=>b.score-a.score||ts(a.joined_at)-ts(b.joined_at))}
function timeLeft(){const c=cur();if(!c||!S.state?.started_at)return 0;return ts(S.state.started_at)+(c.seconds||30)*1000-now()}

/* ---------- host-side scoring (needs the private answers) ---------- */
function hostAns(qid){return S.answers.filter(a=>a.qid===qid&&S.teams[a.slot]).sort((a,b)=>a.ms-b.ms)}
function isCorrect(q,a){
  if(!a)return false;
  if(q.type==="mc")return Number(a.value)===q.answer;
  if(q.type==="open"){if(a.mark===true)return true;if(a.mark===false)return false;
    return [q.answer,...(q.accept||[])].some(x=>norm(x)&&norm(x)===norm(a.value));}
  return false;
}
function qResult(q){
  const as=hostAns(q.id),res={},pts=q.points||1;
  as.forEach(a=>res[a.slot]={pts:0,correct:false,value:a.value,ms:a.ms});
  if(q.type==="estimate"){
    const nums=as.filter(a=>a.value!==""&&a.value!==null&&isFinite(+a.value));
    if(nums.length){const best=Math.min(...nums.map(a=>Math.abs(+a.value-q.answer)));
      nums.forEach(a=>{if(Math.abs(+a.value-q.answer)===best)res[a.slot]={...res[a.slot],pts,correct:true}});}
  }else{
    as.filter(a=>isCorrect(q,a)).forEach((a,i)=>res[a.slot]={...res[a.slot],pts:pts+(i===0?1:0),correct:true,speed:i===0});
  }
  return res;
}
function computeScores(through){
  const t={};S.questions.forEach((q,i)=>{if(i>through)return;const r=qResult(q);for(const k in r)t[k]=(t[k]||0)+r[k].pts});return t;
}
function correctText(q){
  if(q.type==="mc")return `${LET[q.answer]}. ${q.options[q.answer]?.nl??""}`;
  if(q.type==="estimate")return nl(q.answer)+(q.unit?" "+q.unit:"");
  return String(q.answer);
}
function publicQ(q,i){return {id:q.id,round:q.round||"",type:q.type,nl:q.nl,en:q.en||"",options:q.type==="mc"?q.options:undefined,seconds:q.seconds||30,points:q.points||1,unit:q.unit||"",index:i,total:S.questions.length}}
function revealFor(q){return {qid:q.id,answer:q.type==="estimate"?q.answer:q.type==="mc"?q.answer:String(q.answer),text:correctText(q),results:qResult(q)}}


/* ---------- sound (beamer only, synthesized in the browser) ---------- */
const SND={ctx:null,on:ls("champ-sound")!=="off"};
function actx(){
  if(!SND.ctx){const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;SND.ctx=new C()}
  if(SND.ctx.state==="suspended")SND.ctx.resume().then(()=>{if(S.view==="beamer")render()}).catch(()=>{});
  return SND.ctx;
}
document.addEventListener("pointerdown",()=>{if(S.view==="beamer")actx()},true);
document.addEventListener("keydown",()=>{if(S.view==="beamer")actx()},true);
const soundReady=()=>!!(SND.ctx&&SND.ctx.state==="running");
function bell(t,f,dur,vol){
  const c=SND.ctx,out=c.createGain();
  out.gain.setValueAtTime(vol,t);out.gain.exponentialRampToValueAtTime(0.0001,t+dur);out.connect(c.destination);
  [[1,1],[2.76,.5],[5.4,.25],[8.93,.12]].forEach(([r,a])=>{const o=c.createOscillator(),g=c.createGain();o.type="sine";o.frequency.value=f*r;g.gain.value=a;o.connect(g);g.connect(out);o.start(t);o.stop(t+dur)});
}
let noiseBuf;
function noise(){const c=SND.ctx;if(!noiseBuf){noiseBuf=c.createBuffer(1,c.sampleRate,c.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1}return noiseBuf}
function sleigh(t,dur,vol){
  const c=SND.ctx;
  for(let x=0;x<dur;x+=0.075){
    const s=c.createBufferSource(),hp=c.createBiquadFilter(),pk=c.createBiquadFilter(),g=c.createGain(),tt=t+x+Math.random()*.015;
    s.buffer=noise();hp.type="highpass";hp.frequency.value=7000;pk.type="peaking";pk.frequency.value=9500;pk.gain.value=8;
    g.gain.setValueAtTime(0.0001,tt);g.gain.exponentialRampToValueAtTime(vol*(.6+Math.random()*.4),tt+.005);g.gain.exponentialRampToValueAtTime(0.0001,tt+.07);
    s.connect(hp);hp.connect(pk);pk.connect(g);g.connect(c.destination);s.start(tt,Math.random()*.5);s.stop(tt+.08);
  }
}
const NOTE={C5:523.25,D5:587.33,E5:659.25,G5:783.99,C6:1046.5,E6:1318.5,G6:1568};
const SOUNDS={
  boxing(){const t=SND.ctx.currentTime+.02;[0,.32,.64].forEach(d=>bell(t+d,1180,1.6,.35))},
  ding(){const t=SND.ctx.currentTime+.02;bell(t,1180,1.4,.3);sleigh(t,.45,.15)},
  reveal(){const t=SND.ctx.currentTime+.02;[NOTE.C6,NOTE.E6,NOTE.G6].forEach((f,i)=>bell(t+i*.11,f,1.2,.18))},
  shake(){sleigh(SND.ctx.currentTime+.02,1.2,.22)},
  tick(){bell(SND.ctx.currentTime+.01,1760,.35,.12)},
  jingle(){const t=SND.ctx.currentTime+.05,b=.24;let x=0;
    [["E5",1],["E5",1],["E5",2],["E5",1],["E5",1],["E5",2],["E5",1],["G5",1],["C5",1.5],["D5",.5],["E5",4]]
      .forEach(([n,l])=>{bell(t+x*b,NOTE[n],Math.max(.6,l*b*1.6),.22);x+=l});
    sleigh(t,x*b+.4,.18)}
};
function play(name){try{if(SND.on&&S.view==="beamer"&&soundReady())SOUNDS[name]()}catch(e){}}
function testSound(name){const c=actx();if(!c)return;const go=()=>{try{SOUNDS[name]()}catch(e){}};c.state==="running"?go():c.resume().then(go).catch(()=>{})}
function soundForChange(prev,next){
  if(!prev||!next||(prev.phase===next.phase&&prev.q===next.q))return;
  const p=next.phase;
  if(p==="question"){
    if(prev.phase==="reveal"&&prev.q===next.q)return;
    const newRound=prev.phase==="lobby"||prev.phase==="scores"||(prev.current?.round||"")!==(next.current?.round||"");
    play(newRound?"boxing":"ding");
  }else if(p==="reveal"&&prev.phase==="question"&&prev.q===next.q)play("reveal");
  else if(p==="scores")play("shake");
  else if(p==="final")play("jingle");
}
function setState(st){const prev=S.state;S.state=st;soundForChange(prev,st)}

/* ---------- data ---------- */
async function rpc(fn,args){const {data,error}=await sb.rpc(fn,args);if(error)throw error;return data}
async function loadState(){const {data,error}=await sb.from("game_state").select("*").eq("id",1).maybeSingle();if(error)throw error;setState(data)}
async function loadTeams(){const {data,error}=await sb.from("teams").select("*");if(error)throw error;const t={};(data||[]).forEach(r=>t[r.slot]=r);S.teams=t}
async function loadLockins(){const {data,error}=await sb.from("lockins").select("*");if(error)throw error;S.lockins=data||[]}
async function loadHost(){if(!isHost())return;S.questions=(await rpc("host_get_questions",{p_pin:S.pin}))||[];S.answers=(await rpc("host_answers",{p_pin:S.pin}))||[]}
async function loadAnswers(){if(isHost())S.answers=(await rpc("host_answers",{p_pin:S.pin}))||[]}
async function syncClock(){try{const t0=Date.now();const st=await rpc("server_time");const t1=Date.now();S.offset=ts(st)-(t0+t1)/2}catch(e){}}
async function refresh(all){
  try{await Promise.all([loadState(),loadTeams(),loadLockins(),all?loadHost():loadAnswers()]);S.online=true}
  catch(e){S.online=false}
  render();
}
let debT;function soon(fn){clearTimeout(debT);debT=setTimeout(fn,150)}
function subscribe(){
  sb.channel("quiz")
    .on("postgres_changes",{event:"*",schema:"public",table:"game_state"},p=>{if(p.new&&p.new.id===1){setState(p.new);S.confirmReset=false;render()}})
    .on("postgres_changes",{event:"*",schema:"public",table:"teams"},()=>soon(async()=>{try{await loadTeams()}catch(e){}render()}))
    .on("postgres_changes",{event:"*",schema:"public",table:"lockins"},()=>soon(async()=>{try{await loadLockins();await loadAnswers()}catch(e){}render()}))
    .subscribe();
}

/* ---------- host transitions ---------- */
function nextStep(){
  const N=S.questions.length,p=phase(),i=curIdx();
  if(!N)return null;
  if(p==="lobby")return {phase:"question",q:0,label:"Start de quiz"};
  if(p==="question")return {phase:"reveal",q:i,label:"Toon antwoord"};
  if(p==="reveal"){
    if(i>=N-1)return {phase:"final",q:i,label:"Naar de finale"};
    if((S.questions[i+1].round||"")!==(S.questions[i].round||""))return {phase:"scores",q:i,label:"Tussenstand"};
    return {phase:"question",q:i+1,label:"Volgende vraag"};
  }
  if(p==="scores"){if(i>=N-1)return {phase:"final",q:i,label:"Naar de finale"};return {phase:"question",q:i+1,label:"Volgende ronde"}}
  return null;
}
function prevStep(){
  const p=phase(),i=curIdx();
  if(p==="question")return i>0?{phase:"reveal",q:i-1}:{phase:"lobby",q:-1};
  if(p==="reveal")return {phase:"question",q:i,keep:true};
  if(p==="scores"||p==="final")return {phase:"reveal",q:i};
  return null;
}
async function go(step){
  if(!step||S.busy||!isHost())return;S.busy=true;S.err="";render();
  try{
    const Q=S.questions,patch={phase:step.phase,q:step.q};
    if(step.phase==="lobby"){patch.current=null;patch.reveal=null}
    else if(step.phase==="question"){patch.current=publicQ(Q[step.q],step.q);patch.reveal=null;patch.scores=computeScores(step.q-1);if(!step.keep)patch.start=true}
    else{await loadAnswers();patch.current=publicQ(Q[step.q],step.q);patch.reveal=revealFor(Q[step.q]);patch.scores=computeScores(step.q)}
    await rpc("host_set_state",{p_pin:S.pin,p_state:patch});
    await loadState();
  }catch(e){S.err="Dat lukte niet: "+(e.message||e)}
  S.busy=false;render();
}
async function republishReveal(){
  const p=phase();if(!["reveal","scores","final"].includes(p))return;
  const q=S.questions[curIdx()];if(!q)return;
  await rpc("host_set_state",{p_pin:S.pin,p_state:{reveal:revealFor(q),scores:computeScores(curIdx())}});
}
async function markAnswer(qid,slot,val){
  const a=S.answers.find(x=>x.qid===qid&&x.slot===slot);if(!a)return;
  try{await rpc("host_mark",{p_pin:S.pin,p_qid:qid,p_slot:slot,p_mark:a.mark===val?null:val});await loadAnswers();await republishReveal();await loadState()}
  catch(e){S.err="Nakijken lukte niet: "+(e.message||e)}
  render();
}
async function resetGame(){
  S.busy=true;S.confirmReset=false;render();
  try{await rpc("host_reset",{p_pin:S.pin});S.seen.clear();await refresh(true)}catch(e){S.err="Reset lukte niet: "+(e.message||e)}
  S.busy=false;render();
}
async function saveQuestions(list){
  try{
    if(!Array.isArray(list)||!list.length)throw new Error("Geen vragen gevonden.");
    list.forEach((q,i)=>{if(!q.id)q.id="q"+(i+1);if(!q.nl||!q.type)throw new Error(`Vraag ${i+1} mist "nl" of "type".`);
      if(q.type==="mc"&&(!Array.isArray(q.options)||typeof q.answer!=="number"))throw new Error(`Vraag ${i+1}: meerkeuze heeft "options" en een "answer"-nummer nodig.`)});
    await rpc("host_save_questions",{p_pin:S.pin,p_list:list});S.questions=list;S.err="";S.importText="";S.notice=`${list.length} vragen opgeslagen.`;
  }catch(e){S.err="Vragen opslaan lukte niet: "+(e.message||e)}
  render();
}

/* ---------- team actions ---------- */
async function joinTeam(){
  const name=(document.getElementById("teamname")?.value||"").trim().slice(0,24);
  if(!S.pick||!name){S.err="Kies een kleur en vul een teamnaam in.";render();return}
  S.busy=true;S.err="";render();
  try{
    const tok=(S.me&&S.me.slot===S.pick)?S.me.token:token();
    const r=await rpc("join_team",{p_slot:S.pick,p_name:name,p_token:tok});
    if(r==="ok"){S.me={slot:S.pick,token:tok};ls("champ-team",JSON.stringify(S.me));await loadTeams()}
    else S.err=r==="taken"?"Deze kleur is net gekozen door een ander team. Kies een andere.":"Controleer de teamnaam en probeer opnieuw.";
  }catch(e){S.err="Aanmelden lukte niet. Controleer je internetverbinding en probeer opnieuw."}
  S.busy=false;render();
}
async function submitAnswer(value){
  const c=cur();if(!c||!S.me)return;
  S.busy=true;S.err="";render();
  try{
    const r=await rpc("submit_answer",{p_slot:S.me.slot,p_token:S.me.token,p_value:value});
    if(r==="ok"||r==="already"){S.draft["sent-"+c.id]=value;await loadLockins()}
    else S.err={late:"De tijd is om. · Time's up.",closed:"Deze vraag is al gesloten.",auth:"Je team is niet meer aangemeld. Meld je opnieuw aan.",invalid:"Dat antwoord is te lang."}[r]||"Versturen lukte niet.";
    if(r==="auth"){S.me=null;ls("champ-team",null)}
  }catch(e){S.err="Versturen lukte niet. Controleer je verbinding en tik opnieuw."}
  S.busy=false;render();
}
function mySent(qid){return S.draft["sent-"+qid]}

/* ---------- views ---------- */
function brand(sub=true){return `<div class="brand"><span class="dof">Dinner of</span><h1>CHAMPIONS</h1>${sub?`<div class="divider">✦</div><div class="eyebrow">De Kerstquiz <span class="en" style="text-transform:none;letter-spacing:0">· The Christmas Quiz</span></div>`:""}</div>`}

function viewPin(){
  return `<div class="choose">${brand()}<div class="panel" style="max-width:420px;margin-inline:auto;width:100%">
    <h2>Quizmaster</h2><p class="note">Vul de quizmaster-PIN in. Deze laptop onthoudt hem.</p>
    <label class="f" for="pin">PIN<input class="in" id="pin" type="password" autocomplete="current-password"></label>
    ${S.err?`<p class="err">${esc(S.err)}</p>`:""}<button class="btn" data-act="pin" ${S.busy?"disabled":""}>Inloggen</button></div></div>`;
}
function viewChooser(){
  return `<div class="choose">${brand()}
  <div class="choose-grid">
    <button class="choose-card" data-go="beamer"><h3>Beamer</h3><p>Het grote scherm met QR-code, vragen en scores. Bedien met spatie en pijltjes.</p><p class="en">Projector screen with built-in host controls.</p></button>
    <button class="choose-card" data-go="remote"><h3>Afstandsbediening</h3><p>Antwoorden zien, open vragen nakijken, vragen laden en doorklikken.</p><p class="en">Quiz master remote.</p></button>
    <button class="choose-card" data-go="team"><h3>Teamtelefoon</h3><p>Wat de teams zien na het scannen. Handig om zelf te testen.</p><p class="en">The team phone view.</p></button>
  </div>
  <div class="panel" style="text-align:left"><div class="eyebrow">Geluiden testen · Test the sounds</div>
    <div class="rowbtns" style="flex-wrap:wrap">
      <button class="btn ghost small" data-snd="boxing">Nieuwe ronde</button>
      <button class="btn ghost small" data-snd="ding">Volgende vraag</button>
      <button class="btn ghost small" data-snd="tick">Team zet vast</button>
      <button class="btn ghost small" data-snd="reveal">Antwoord</button>
      <button class="btn ghost small" data-snd="shake">Tussenstand</button>
      <button class="btn ghost small" data-snd="jingle">Finale</button>
    </div></div>
  <p class="note">Teams die de QR scannen zien dit scherm niet.</p><button class="btn ghost small" style="justify-self:center" data-act="logout">Uitloggen als quizmaster</button></div>`;
}

function lockRail(reveal){
  const c=cur();if(!c)return "";
  const ls_=lockinsFor(c.id),res=reveal?(S.state?.reveal?.results||{}):{};let anyNew=false;
  const cells=joined().map(t=>{
    const i=ls_.findIndex(a=>a.slot===t.slot),a=ls_[i];
    const key=c.id+t.slot,isNew=a&&!S.seen.has(key);if(a)S.seen.add(key);if(isNew&&!reveal)anyNew=true;
    let st=`<span class="ls waiting">denkt na</span>`;
    if(a)st=`<span class="ls tab">${ord(i+1)} · ${secs(a.ms)}</span>`;
    if(reveal){const r=res[t.slot];st=`<span class="pts tab ${r&&r.pts?"":"zero"}">+${r?r.pts:0}${r?.speed?' <span class="note">⚡ snelst</span>':""}</span>`}
    return `<div class="lock ${a?"in":""} ${isNew?"pop":""}"><div class="ln">${dot(t.slot)}<span>${esc(t.name)}</span></div>${st}</div>`;
  });
  if(anyNew)setTimeout(()=>play("tick"),0);
  return `<div class="lockrail">${cells.join("")||`<p class="note">Nog geen teams aangemeld.</p>`}</div>`;
}

function joinUrl(){return location.origin+location.pathname}
function beamerLobby(){
  const list=joined();
  const rows=SLOTS.map((_,i)=>{
    const t=list[i];
    if(!t)return `<li class="slot empty"><span class="rank">${ord(i+1)}</span><span class="nm waiting">wacht op een team</span><span></span></li>`;
    const key="join"+t.slot+t.joined_at,isNew=!S.seen.has(key);S.seen.add(key);
    const since=S.state?.opened_at?secs(ts(t.joined_at)-ts(S.state.opened_at)):"";
    return `<li class="slot ${i===0?"first":""} ${isNew?"pop":""}"><span class="rank">${ord(i+1)}</span><span class="nm">${dot(t.slot)}<span>${esc(t.name)}</span></span><span class="tm tab">${since?"binnen na "+since:""}</span></li>`;
  });
  return `<div class="stage">${brand()}
    <div class="lobby">
      <div class="join"><div class="qr-frame"><div id="qr" role="img" aria-label="QR-code om mee te doen"></div></div>
        <div class="big">Scan met één telefoon per team<br><span class="en">One phone per team, scan to join</span></div>
        <div class="link">${esc(joinUrl().replace(/^https?:\/\//,""))}</div></div>
      <div><ol class="slots">${rows.join("")}</ol></div>
    </div>
    <div class="count tab">${list.length} / 5 teams binnen</div></div>`;
}
function optsHtml(c,reveal){
  const r=S.state?.reveal;
  return `<div class="opts">${(c.options||[]).map((o,i)=>{
    const who=reveal&&r?Object.entries(r.results||{}).filter(([,v])=>Number(v.value)===i).map(([s])=>`<span class="chip">${dot(s)}${esc(S.teams[s]?.name)}</span>`).join(""):"";
    const cls=reveal&&r?(i===r.answer?"win":"dim"):"";
    return `<div class="opt ${cls}"><span class="let">${LET[i]}</span><div>${esc(o.nl)}${o.en?`<span class="o-en en">${esc(o.en)}</span>`:""}${who?`<div class="who">${who}</div>`:""}</div></div>`}).join("")}</div>`;
}
function beamerQuestion(reveal){
  const c=cur();
  if(!c)return `<div class="stage">${brand()}<p class="kind" style="text-align:center">Er zijn nog geen vragen geladen. Laad ze via de afstandsbediening.</p></div>`;
  const head=`<div class="qhead"><div class="eyebrow">${esc(c.round||"Ronde")} · Vraag ${c.index+1} / ${c.total}</div>${reveal?"":`<div class="timer" id="timer"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="rgba(238,242,250,.12)" stroke-width="6"/><circle id="tring" cx="50" cy="50" r="44" fill="none" stroke="#e0b85c" stroke-width="6" stroke-linecap="round" stroke-dasharray="276.46" stroke-dashoffset="0"/></svg><div class="t-txt tab" id="ttxt"></div></div>`}</div>`;
  const text=`<div class="qtext"><h2>${esc(c.nl)}</h2>${c.en?`<p class="en">${esc(c.en)}</p>`:""}</div>`;
  let body="";const r=S.state?.reveal;
  if(c.type==="mc")body=optsHtml(c,reveal);
  else if(!reveal)body=c.type==="estimate"?`<p class="kind"><b>Schatvraag</b> · wie er het dichtst bij zit, wint <span class="en">· closest wins</span></p>`:`<p class="kind"><b>Open vraag</b> · typ jullie antwoord <span class="en">· type your answer</span></p>`;
  else if(r){
    const res=Object.entries(r.results||{});
    if(c.type==="estimate"){
      res.sort((a,b)=>Math.abs(+a[1].value-r.answer)-Math.abs(+b[1].value-r.answer));
      body=`<div class="answer-big tab">${esc(r.text)}</div><div class="guesses">${res.map(([s,v])=>`<div class="guess ${v.correct?"win":""}"><span class="nm">${dot(s)} ${esc(S.teams[s]?.name)}</span><span class="gv tab">${nl(v.value)}</span><span class="gd tab">${(+v.value-r.answer>=0?"+":"")+nl(+v.value-r.answer)}</span></div>`).join("")}</div>`;
    }else{
      res.sort((a,b)=>a[1].ms-b[1].ms);
      body=`<div class="answer-big">${esc(r.text)}</div><div class="guesses">${res.map(([s,v])=>`<div class="guess ${v.correct?"win":""}"><span class="nm">${dot(s)} ${esc(S.teams[s]?.name)}</span><span class="gv">${esc(v.value)}</span><span class="${v.correct?"mark-ok":"mark-no"}">${v.correct?"✓":"✗"}</span></div>`).join("")}</div>`;
    }
  }
  const n=lockinsFor(c.id).length,tot=joined().length;
  const all=!reveal&&tot>0&&n>=tot?`<div class="allin">✦ Alle teams zijn binnen ✦</div>`:"";
  return `<div class="stage">${head}${text}${body}${all}${lockRail(reveal)}</div>`;
}
function boardHtml(){
  const r=ranking(),max=Math.max(1,...r.map(t=>t.score));
  return `<div class="board">${r.map((t,i)=>`<div class="row"><span class="rank">${ord(i+1)}</span><span class="nm">${dot(t.slot)}<span>${esc(t.name)}</span></span><span class="bar"><i style="width:${Math.max(3,t.score/max*100)}%;animation-delay:${i*.12}s"></i></span><span class="sc tab">${t.score}</span></div>`).join("")}</div>`;
}
function beamerScores(){return `<div class="stage"><div class="brand"><div class="eyebrow">Tussenstand · Standings</div><div class="divider">✦</div></div>${boardHtml()}</div>`}
function beamerFinal(){
  const r=ranking(),w=r[0];
  return `<div class="stage"><div class="champ rise"><div class="eyebrow">De kampioen van 2026 · The 2026 champion</div><div class="crown">♛</div><div class="who">${w?esc(w.name):"—"}</div>${w?`<div class="kind tab">${w.score} punten</div>`:""}</div><div class="divider">✦</div>${boardHtml()}</div>`;
}
function hostBar(){
  if(!isHost())return "";
  const n=nextStep();
  const conf=S.confirmReset?`<span class="confirm">Alles wissen en opnieuw beginnen? <button class="btn small" data-act="reset-yes">Ja, wissen</button><button class="btn ghost small" data-act="reset-no">Annuleer</button></span>`:`<button class="btn ghost small" data-act="reset">Reset</button>`;
  return `<div class="hostbar" id="hostbar"><button class="btn ghost small" data-act="prev" ${prevStep()?"":"disabled"}>◀ Terug</button>
    ${n?`<button class="btn" data-act="next" ${S.busy?"disabled":""}>${n.label} ▶</button>`:(S.questions.length?"":`<span class="note">Laad eerst vragen via de afstandsbediening</span>`)}
    ${phase()==="reveal"?`<button class="btn ghost small" data-act="scores">Tussenstand</button>`:""}
    <button class="btn ghost small" data-act="fs">Volledig scherm</button>
    <button class="btn ghost small" data-act="sound" aria-pressed="${SND.on}">${!SND.on?"Geluid uit":soundReady()?"Geluid aan":"Klik voor geluid"}</button>${conf}
    <span class="keys">Spatie = verder · ← terug · S = stand · M = geluid</span></div>`;
}
function viewBeamer(){
  const p=phase();
  const html=p==="lobby"?beamerLobby():p==="question"?beamerQuestion(false):p==="reveal"?beamerQuestion(true):p==="scores"?beamerScores():beamerFinal();
  return `<button class="switch" data-go="host">wissel scherm</button>`+html+hostBar()+(S.err?`<p class="err" style="text-align:center">${esc(S.err)}</p>`:"");
}

function viewTeam(){
  const t=myTeam(),p=phase(),c=cur();
  const rank=ranking(),myRank=t?rank.findIndex(r=>r.slot===t.slot):-1,score=t?scoreOf(t.slot):0;
  const top=t?`<div class="ph-top"><div class="team">${dot(t.slot)}<span>${esc(t.name)}</span></div><div class="score tab">${score} pt</div></div>`:"";
  const err=S.err?`<p class="err">${esc(S.err)}</p>`:"";
  let body="";
  if(!t){
    const taken=id=>S.teams[id]&&!(S.me&&S.me.slot===id);
    body=`${brand(false)}<div class="panel"><h2>Meld je team aan<br><span class="en" style="font-size:.8em;font-weight:400">Register your team</span></h2>
      <p class="note">Eén telefoon per team. Kies een kleur:</p>
      <div class="slotpick">${SLOTS.map(s=>`<button data-pick="${s.id}" aria-pressed="${S.pick===s.id}" ${taken(s.id)?"disabled":""} style="background:${s.c};color:#0b1730" aria-label="Kleur ${s.l}${taken(s.id)?" (bezet)":""}">${taken(s.id)?"✕":s.l}</button>`).join("")}</div>
      <label class="f" for="teamname">Teamnaam · <span class="en">Team name</span><input class="in" id="teamname" maxlength="24" autocomplete="off" placeholder="bijv. De Rendieren"></label>
      ${err}<button class="btn" data-act="join" ${S.busy?"disabled":""}>${S.busy?"Bezig…":"Doe mee ✦"}</button></div>`;
  }else if(p==="lobby"){
    const pos=joined().findIndex(x=>x.slot===t.slot)+1;
    body=`${top}<div class="panel lockedcard"><div class="spark">✦</div><h2>Jullie zijn binnen</h2><p>Als ${ord(pos)} team aangemeld. Kijk naar het grote scherm; de quiz begint zo.</p><p class="en">You're in. Watch the big screen.</p></div>`;
  }else if((p==="question"||p==="reveal")&&c){
    const sent=mySent(c.id),lock=lockinsFor(c.id),myLock=lock.find(l=>l.slot===t.slot);
    const head=`<div class="eyebrow">${esc(c.round||"")} · Vraag ${c.index+1}</div><h2>${esc(c.nl)}</h2>${c.en?`<p class="en">${esc(c.en)}</p>`:""}`;
    if(p==="reveal"){
      const r=S.state?.reveal?.results?.[t.slot];
      body=`${top}<div class="panel result ${r&&r.pts?"ok":"no"}"><div class="big">${r&&r.pts?"+"+r.pts+" punt"+(r.pts>1?"en":""):"Helaas"}</div>${r?.speed?`<p>⚡ Snelste goede antwoord!</p>`:""}<p class="note">Juiste antwoord · <span class="en">Answer</span></p><p><b>${esc(S.state?.reveal?.text||"")}</b></p></div>`;
    }else if(myLock||S.draft["sent-"+c.id]!==undefined){
      const pos=lock.findIndex(a=>a.slot===t.slot)+1;
      const shown=sent===undefined?"":c.type==="mc"?LET[sent]+". "+esc(c.options[sent]?.nl):esc(sent);
      body=`${top}<div class="panel lockedcard"><div class="spark">✦</div><h2>Vastgezet</h2>${shown?`<p>${shown}</p>`:""}${myLock?`<p class="note tab">Als ${ord(pos)} binnen, na ${secs(myLock.ms)}</p>`:""}<p class="en">Locked in. Eyes on the big screen.</p></div>`;
    }else{
      const late=timeLeft()<-2000;
      let input="";
      if(late)input=`<p class="err">De tijd is om. · <span class="en">Time's up.</span></p>`;
      else if(c.type==="mc")input=`<div class="abtns">${c.options.map((o,i)=>`<button class="abtn" data-sel="${i}" aria-pressed="${S.draft[c.id]===i}"><span class="let">${LET[i]}</span><span>${esc(o.nl)}${o.en?`<small>${esc(o.en)}</small>`:""}</span></button>`).join("")}</div><button class="btn" data-act="send" ${S.draft[c.id]===undefined||S.busy?"disabled":""}>${S.busy?"Bezig…":"Zet vast ✦"}</button>`;
      else input=`<label class="f" for="ans-${esc(c.id)}">${c.type==="estimate"?"Jullie schatting"+(c.unit?" ("+esc(c.unit)+")":""):"Jullie antwoord"}<input class="in" id="ans-${esc(c.id)}" ${c.type==="estimate"?'inputmode="decimal"':""} autocomplete="off"></label><button class="btn" data-act="send" ${S.busy?"disabled":""}>${S.busy?"Bezig…":"Zet vast ✦"}</button>`;
      body=`${top}<div class="tbar"><i id="ptbar"></i></div><div class="panel">${head}</div>${input}${err}`;
    }
  }else if(p==="scores"||p==="final"){
    body=`${top}<div class="panel lockedcard"><div class="spark">${p==="final"&&myRank===0?"♛":"✦"}</div><h2>${p==="final"?(myRank===0?"Kampioen!":"Eindstand"):"Tussenstand"}</h2><p class="tab" style="font-size:1.3rem">${ord(myRank+1)} plaats · ${score} punten</p><p class="en">${p==="final"?"Final standings":"Standings"}: see the big screen.</p></div>`;
  }else body=`${top}<div class="panel"><p>Wacht op de volgende vraag…</p></div>`;
  return `<div class="phone">${body}${S.online?"":`<p class="note" style="text-align:center">Geen verbinding. We proberen het opnieuw…</p>`}</div>`;
}

function viewRemote(){
  const c=cur(),p=phase(),n=nextStep(),q=S.questions[curIdx()];
  const names={lobby:"Lobby",question:"Vraag loopt",reveal:"Antwoord getoond",scores:"Tussenstand",final:"Finale"};
  let qPanel="";
  if(q&&c&&(p==="question"||p==="reveal")){
    const as=hostAns(q.id);
    qPanel=`<div class="panel"><div class="eyebrow">Vraag ${curIdx()+1} / ${S.questions.length}</div><h2>${esc(q.nl)}</h2><p>Antwoord: <span class="secret">${esc(correctText(q))}</span></p>
      <div class="mlist">${as.map(a=>{const ok=isCorrect(q,a),v=q.type==="mc"?LET[a.value]:esc(a.value);
        return `<div class="mrow"><div><div class="who">${dot(a.slot)}<span>${esc(S.teams[a.slot]?.name)}</span><span class="note tab">${secs(a.ms)}</span></div><div class="val">${v} ${q.type!=="estimate"?(ok?'<span class="mark-ok">✓</span>':'<span class="mark-no">✗</span>'):""}</div></div>
        ${q.type==="open"?`<div class="mbtns"><button class="y" data-mark="${esc(a.qid)}|${a.slot}" data-v="1" aria-pressed="${a.mark===true}">Goed</button><button class="n" data-mark="${esc(a.qid)}|${a.slot}" data-v="0" aria-pressed="${a.mark===false}">Fout</button></div>`:""}</div>`}).join("")||`<p class="note">Nog geen antwoorden.</p>`}</div>
      ${q.type==="open"?`<p class="note">Antwoorden die letterlijk kloppen staan automatisch op goed. Tik Goed of Fout om dat te overrulen.</p>`:""}</div>`;
  }
  return `<div class="remote"><button class="switch" data-go="host">wissel scherm</button>
    <div class="eyebrow">Quizmaster</div>
    <div class="panel"><dl class="kv"><dt>Status</dt><dd>${names[p]||p}</dd><dt>Teams</dt><dd>${joined().map(t=>dot(t.slot)+" "+esc(t.name)).join(" &nbsp; ")||"nog geen"}</dd><dt>Vragen</dt><dd class="tab">${S.questions.length}</dd></dl></div>
    ${qPanel}
    <div class="rowbtns"><button class="btn ghost" data-act="prev" ${prevStep()?"":"disabled"}>◀ Terug</button>${n?`<button class="btn" data-act="next" ${S.busy?"disabled":""}>${n.label} ▶</button>`:""}</div>
    ${p==="reveal"?`<button class="btn ghost" data-act="scores">Toon tussenstand</button>`:""}
    <div class="panel"><div class="eyebrow">Stand</div>${ranking().map((t,i)=>`<div class="kv"><dt class="tab">${ord(i+1)}</dt><dd>${dot(t.slot)} ${esc(t.name)} · <b class="tab">${t.score}</b></dd></div>`).join("")||`<p class="note">Nog geen teams.</p>`}</div>
    ${S.confirmReset?`<div class="panel"><p>Alle teams en antwoorden wissen en terug naar de lobby?</p><div class="rowbtns"><button class="btn" data-act="reset-yes">Ja, wissen</button><button class="btn ghost" data-act="reset-no">Annuleer</button></div></div>`:`<button class="btn ghost" data-act="reset">Reset spel</button>`}
    <div class="panel"><div class="eyebrow">Vragen</div>
      <p class="note">${S.questions.length?`${S.questions.length} vragen geladen. Plak hieronder een nieuwe lijst om ze te vervangen.`:"Nog geen vragen geladen."}</p>
      <button class="btn ghost small" data-act="demo">Laad de 6 demovragen</button>
      <label class="f" for="qimport">Vragenlijst (JSON)<textarea class="in" id="qimport" rows="6" spellcheck="false" placeholder='[{"round":"Ronde 1","type":"mc","nl":"…","en":"…","options":[{"nl":"…"},…],"answer":0,"points":1,"seconds":30}]'></textarea></label>
      <button class="btn small" data-act="import">Vragen opslaan</button>
      ${S.notice?`<p class="note">${esc(S.notice)}</p>`:""}</div>
    ${S.err?`<p class="err">${esc(S.err)}</p>`:""}</div>`;
}
function viewOffline(){return `<div class="phone">${brand()}<div class="panel"><h2>De quiz kan niet laden</h2><p>Controleer je internetverbinding en herlaad de pagina.</p><p class="en">Check your connection and reload.</p></div></div>`}

/* ---------- render & routing ---------- */
function route(){
  if(!sb)return "offline";
  const h=(location.hash||"").slice(1);
  if(["host","beamer","remote"].includes(h))return isHost()?(h==="host"?"chooser":h):"pin";
  return "team";
}
function render(){
  const ae=document.activeElement,aid=ae&&ae.id,sel=ae&&ae.selectionStart;
  const keep={};document.querySelectorAll(".in").forEach(i=>keep[i.id]=i.value);
  S.view=route();document.body.dataset.view=S.view;
  app.innerHTML={offline:viewOffline,pin:viewPin,chooser:viewChooser,beamer:viewBeamer,remote:viewRemote,team:viewTeam}[S.view]();
  for(const id in keep){const el=document.getElementById(id);if(el)el.value=keep[id]}
  if(aid){const el=document.getElementById(aid);if(el){el.focus();try{el.setSelectionRange(sel,sel)}catch(e){}}}
  const qr=document.getElementById("qr");
  if(qr&&window.QRCode)new QRCode(qr,{text:joinUrl(),width:512,height:512,colorDark:"#0b1730",colorLight:"#eef2fa",correctLevel:QRCode.CorrectLevel.M});
  tick();wakeHostbar();
}
function tick(){
  const c=cur();if(!c||phase()!=="question")return;
  const total=(c.seconds||30)*1000,left=timeLeft(),f=Math.max(0,Math.min(1,left/total));
  const ring=document.getElementById("tring"),txt=document.getElementById("ttxt"),bar=document.getElementById("ptbar");
  if(ring)ring.setAttribute("stroke-dashoffset",(276.46*(1-f)).toFixed(1));
  if(txt){txt.textContent=Math.max(0,Math.ceil(left/1000));document.getElementById("timer").classList.toggle("late",left<=5000)}
  if(bar)bar.style.transform=`scaleX(${f})`;
  if(S.view==="team"&&left<-2000&&S.lateFor!==c.id){S.lateFor=c.id;render()}
}
setInterval(tick,250);
let idleT;
function wakeHostbar(){const hb=document.getElementById("hostbar");if(!hb)return;hb.classList.remove("idle");clearTimeout(idleT);idleT=setTimeout(()=>hb.classList.add("idle"),3500)}
document.addEventListener("mousemove",wakeHostbar);

document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.go){location.hash=b.dataset.go==="team"?"":b.dataset.go;S.err="";render();return}
  if(b.dataset.snd){testSound(b.dataset.snd);return}
  if(b.dataset.pick){S.pick=b.dataset.pick;S.err="";render();return}
  if(b.dataset.sel!==undefined){S.draft[cur().id]=+b.dataset.sel;render();return}
  if(b.dataset.mark){const [qid,slot]=b.dataset.mark.split("|");markAnswer(qid,slot,b.dataset.v==="1");return}
  const a=b.dataset.act;
  if(a==="next")go(nextStep());
  else if(a==="prev")go(prevStep());
  else if(a==="scores")go({phase:"scores",q:curIdx()});
  else if(a==="reset"){S.confirmReset=true;render()}
  else if(a==="reset-no"){S.confirmReset=false;render()}
  else if(a==="reset-yes")resetGame();
  else if(a==="sound"){SND.on=!SND.on;ls("champ-sound",SND.on?"on":"off");actx();setTimeout(()=>{play("ding");render()},120)}
  else if(a==="fs"){const el=document.documentElement;(el.requestFullscreen?el.requestFullscreen():Promise.reject()).catch(()=>{})}
  else if(a==="join")joinTeam();
  else if(a==="pin")login();
  else if(a==="logout"){S.pin=null;ls("champ-pin",null);location.hash="";render()}
  else if(a==="demo")saveQuestions(JSON.parse(JSON.stringify(DEMO)));
  else if(a==="import"){try{saveQuestions(JSON.parse(document.getElementById("qimport").value))}catch(err){S.err="Dit is geen geldige vragenlijst (JSON). Controleer haakjes en aanhalingstekens.";render()}}
  else if(a==="send"){
    const c=cur();if(!c)return;
    if(c.type==="mc"){if(S.draft[c.id]!==undefined)submitAnswer(S.draft[c.id])}
    else{let v=(document.getElementById("ans-"+c.id)?.value||"").trim();
      if(c.type==="estimate"){v=v.replace(/\s|\./g,"").replace(",",".");if(v===""||!isFinite(+v)){S.err="Vul een getal in.";render();return}v=+v}
      else if(!v){S.err="Vul een antwoord in.";render();return}
      submitAnswer(v)}
  }
});
document.addEventListener("keydown",e=>{
  if(e.target.matches("input")){if(e.key==="Enter"){e.preventDefault();const b=document.querySelector('[data-act="join"],[data-act="send"],[data-act="pin"]');if(b&&!b.disabled)b.click()}return}
  if(e.target.matches("textarea"))return;
  if(S.view!=="beamer"||!isHost())return;
  if(e.key===" "||e.key==="ArrowRight"||e.key==="PageDown"){e.preventDefault();go(nextStep())}
  else if(e.key==="ArrowLeft"||e.key==="PageUp"){e.preventDefault();go(prevStep())}
  else if(e.key==="s"||e.key==="S"){if(phase()==="reveal")go({phase:"scores",q:curIdx()})}
  else if(e.key==="m"||e.key==="M"){SND.on=!SND.on;ls("champ-sound",SND.on?"on":"off");setTimeout(()=>{play("ding");render()},120)}
});
window.addEventListener("hashchange",()=>{S.err="";render()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh(isHost())});

async function login(){
  const pin=(document.getElementById("pin")?.value||"").trim();if(!pin)return;
  S.busy=true;S.err="";render();
  try{const ok=await rpc("host_check",{p_pin:pin});
    if(ok){S.pin=pin;ls("champ-pin",pin);await loadHost();if(!location.hash||location.hash==="#")location.hash="host"}
    else S.err="Die PIN klopt niet.";
  }catch(e){S.err="Inloggen lukte niet. Is de database al ingesteld?"}
  S.busy=false;render();
}

/* ---------- snow ---------- */
(function snow(){
  const c=document.getElementById("snow"),x=c.getContext("2d");
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w,h,flakes=[],stars=[];
  function size(){const d=devicePixelRatio||1;w=c.width=innerWidth*d;h=c.height=innerHeight*d;
    flakes=Array.from({length:Math.round(innerWidth/14)},()=>({x:Math.random()*w,y:Math.random()*h,r:(Math.random()*1.8+.6)*d,s:Math.random()*.5+.2,dd:Math.random()*Math.PI*2}));
    stars=Array.from({length:Math.round(innerWidth/40)},()=>({x:Math.random()*w,y:Math.random()*h*.6,p:Math.random()*6}))}
  size();addEventListener("resize",size);
  function frame(t){const d=devicePixelRatio||1;
    x.clearRect(0,0,w,h);
    stars.forEach(s=>{const a=.25+.35*Math.sin(t/900+s.p);x.fillStyle=`rgba(238,242,250,${a})`;x.fillRect(s.x,s.y,1.5*d,1.5*d)});
    x.fillStyle="rgba(238,242,250,.55)";
    flakes.forEach(f=>{f.y+=f.s*d;f.x+=Math.sin(t/1600+f.dd)*.3*d;if(f.y>h){f.y=-5;f.x=Math.random()*w}x.beginPath();x.arc(f.x,f.y,f.r,0,7);x.fill()});
    if(!reduce)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---------- boot ---------- */
async function boot(){
  try{S.me=JSON.parse(ls("champ-team")||"null")}catch(e){S.me=null}
  S.pin=ls("champ-pin");
  render();
  if(!sb)return;
  if(S.pin){try{if(!(await rpc("host_check",{p_pin:S.pin}))){S.pin=null;ls("champ-pin",null)}}catch(e){}}
  await syncClock();
  await refresh(true);
  if(S.me&&!S.teams[S.me.slot]){/* game was reset */S.me=null;ls("champ-team",null)}
  subscribe();
  setInterval(()=>refresh(false),5000);
  setInterval(syncClock,60000);
}
boot();
})();

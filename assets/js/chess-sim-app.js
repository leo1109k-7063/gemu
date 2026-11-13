import {loadTraining,saveTraining,learnFromLeague,rollbackLast} from './chess-training.js';
/* Chess HElo all-vs-all league, 45 pairs x 500 matches. Local-only IndexedDB, no Supabase mutations. */
'use strict';
const $=id=>document.getElementById(id);
const LEVELS=Array.from({length:10},(_,i)=>100+i*100);
const PAIRS=LEVELS.flatMap((lo,i)=>LEVELS.slice(i+1).map(hi=>({lo,hi,key:`${lo}-${hi}`})));
const TARGET=500, ENGINE='chess-balanced-2026-11-13';
const pairKey=(a,b)=>`${Math.min(a,b)}-${Math.max(a,b)}`;
let db,active=null,worker=null,running=false,busy=false,records=[];
let lastRenderedCount=-1;
const log=m=>{$('log').textContent=`${new Date().toLocaleTimeString()} ${m}\n`+$('log').textContent.slice(0,2000);};
const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
const iso=()=>new Date().toISOString();
const fmt=n=>Number.isFinite(n)?n.toFixed(1):'—';
function openDB(){return new Promise((ok,no)=>{const r=indexedDB.open('gemu-chess-helo-simulator',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('runs',{keyPath:'id'});const g=d.createObjectStore('games',{keyPath:'gameId'});g.createIndex('byRun','runId');};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
async function saveRun(run){await req(db.transaction('runs','readwrite').objectStore('runs').put(run));}
async function allRuns(){return req(db.transaction('runs','readonly').objectStore('runs').getAll());}
async function getRun(id){return req(db.transaction('runs','readonly').objectStore('runs').get(id));}
async function getGames(id){return req(db.transaction('games','readonly').objectStore('games').index('byRun').getAll(id));}
async function saveGame(x){await req(db.transaction('games','readwrite').objectStore('games').put(x));}
async function deleteRun(id){const old=await getGames(id),t=db.transaction(['runs','games'],'readwrite'),gs=t.objectStore('games');for(const x of old)gs.delete(x.gameId);t.objectStore('runs').delete(id);await new Promise((ok,no)=>{t.oncomplete=ok;t.onerror=()=>no(t.error);});}
function pairList(run){if(run.format===2)return PAIRS.filter(x=>run.pairs.includes(x.key));return (run.pairs||[]).filter(x=>Number.isInteger(x)).map(lo=>({lo,hi:lo+100,key:pairKey(lo,lo+100)}));}
function schedule(run){const tasks=[];for(const {lo,hi,key} of pairList(run)){for(let i=0;i<TARGET;i++){const highWhite=i%2===0;tasks.push({id:`${run.id}_${run.format===2?key:lo}_${i}`,runId:run.id,pair:key,index:i+1,white:highWhite?hi:lo,black:highWhite?lo:hi,maxPlies:run.maxPlies,tuning:{offsets:run.tuning||{},book:run.book||{}}});}}return tasks;}
function group(){const groups=new Map(pairList(active||{pairs:[],format:2}).map(x=>[x.key,{...x,n:0,valid:0,w:0,d:0,l:0,limit:0}]));for(const x of records){const k=x.high&&x.low?pairKey(x.low,x.high):Number.isInteger(x.pair)?pairKey(x.pair,x.pair+100):x.pair;const g=groups.get(k);if(!g)continue;g.n++;if(x.reason==='move_limit'){g.limit++;continue;}g.valid++;if(x.scoreHigh===1)g.w++;else if(x.scoreHigh===0)g.l++;else g.d++;}return [...groups.values()];}
const point=g=>g.valid?(g.w+g.d/2)/g.valid:null;
const gap=g=>g.valid?400*Math.log10((g.w+g.d/2+0.5)/(g.l+g.d/2+0.5)):null;
function estimateRatings(groups){
 // Bradley–Terry logistic maximum-likelihood approximation, anchored at 500.
 // Fractional scores for drawn games. Weak regularization protects against complete separation.
 const rating=Object.fromEntries(LEVELS.map(x=>[x,x]));const K=Math.log(10)/400;
 for(let epoch=0;epoch<350;epoch++){
  const grad=Object.fromEntries(LEVELS.map(x=>[x,0]));const hess=Object.fromEntries(LEVELS.map(x=>[x,0]));
  for(const g of groups){if(!g.valid)continue;const p=1/(1+10**((rating[g.lo]-rating[g.hi])/400));const actual=(g.w+0.5*g.d+0.5)/(g.valid+1);const z=(g.valid+1)*(actual-p),v=(g.valid+1)*p*(1-p)*K;grad[g.hi]+=z;grad[g.lo]-=z;hess[g.hi]+=v;hess[g.lo]+=v;}
  // Prior of 800 Elo is deliberately very weak, used only for complete-separation stability.
  for(const lv of LEVELS){grad[lv]-=(rating[lv]-lv)*K/800;hess[lv]+=K/800;}
  const next={...rating};for(const lv of LEVELS)next[lv]=Math.max(-3000,Math.min(3000,rating[lv]+0.25*grad[lv]/Math.max(0.0001,hess[lv])));
  const shift=next[500]-500;for(const lv of LEVELS)rating[lv]=next[lv]-shift;
 }
 return Object.fromEntries(LEVELS.map(lv=>[lv,Math.round(rating[lv])]));
}
function summary(){const gs=group();$('summary').innerHTML=gs.map(x=>`<tr><td>${x.lo} vs ${x.hi}</td><td>${x.n}/500</td><td>${x.w}</td><td>${x.d}</td><td>${x.l}</td><td>${x.valid?fmt(point(x)*100)+'%':'—'}</td><td>${x.valid?((gap(x)>=0?'+':'')+fmt(gap(x))):'—'}</td><td>${x.limit}</td></tr>`).join('');
 const played=gs.filter(x=>x.valid>0), ratings=estimateRatings(gs);
 $('calibrated').textContent=played.length?`유효 대국이 있는 대진 ${played.length}/${gs.length}개 · 제한 종료 ${gs.reduce((s,g)=>s+g.limit,0)}판은 추정에서 제외 · 높은 AI 기대 점수는 격차 100점일 때 약 64%, 격차가 더 크면 그보다 높아야 합니다. 500을 기준점으로 전체 대진 승무패를 동시에 적합한 상대 점수(잠정): ${LEVELS.map(l=>`${l}→${ratings[l]}`).join(' / ')}. 실제 사이트 HElo에는 자동 적용되지 않습니다.`:'아직 완료된 대국이 없습니다.';
}
function draw(){const total=active?pairList(active).length*TARGET:0,done=records.length;
 $('count').textContent=`${done.toLocaleString()} / ${total.toLocaleString()}`;$('progress').max=Math.max(1,total);$('progress').value=done;
 $('runid').textContent=active?`세트 ID: ${active.id} · 엔진: ${active.engineVersion} · 최대 ${active.maxPlies} 반수`:'세트 없음';
 $('status').textContent=!active?'준비 완료':running?(busy?'대국 계산 중':'진행 중'):(done>=total?'전체 세트 완료':'일시정지 · 이어하기 가능');
 $('start').disabled=running;$('resume').disabled=!active||running||done>=total;$('pause').disabled=!running;
 for(const id of ['json','csv','gamescsv','calibration'])$(id).disabled=!active||!done;
 $('test-after-run').hidden=!(active&&active.format===2&&done===total&&total>0);
 $('elapsed').textContent=active?`누적 ${Math.round((active.elapsedMs||0)/60000)}분`:'—';
 $('current').textContent=active?(done>=total?'완료':`${Math.floor(done/TARGET)+1}/${pairList(active).length} 대진`):'—';
 if(lastRenderedCount!==done && (done%25===0 || done===total || lastRenderedCount<0)){summary();lastRenderedCount=done;}
}
async function refreshRuns(){const runs=(await allRuns()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));$('runs').innerHTML=runs.map(r=>`<option value="${r.id}">${r.createdAt.slice(0,19).replace('T',' ')} · ${pairList(r).length}대진 · ${r.id.slice(-8)}</option>`).join('')||'<option value="">저장된 세트 없음</option>';if(active)$('runs').value=active.id;}
async function loadRun(id){if(running)throw Error('대국 실행 중에는 다른 세트를 열 수 없습니다.');const r=await getRun(id);if(!r)throw Error('선택한 세트를 찾지 못했습니다.');active=r;lastRenderedCount=-1;records=(await getGames(r.id)).sort((a,b)=>(a.high||0)-(b.high||0)||(a.low||0)-(b.low||0)||a.index-b.index);draw();await refreshRuns();log(`${records.length.toLocaleString()}판 기록 불러옴`);}
function createWorker(){worker?.terminate();worker=new Worker('assets/js/chess-sim-worker.js');worker.onmessage=async e=>{const m=e.data;if(!running||!active)return;if(m.type==='error'){running=false;busy=false;log('엔진 오류: '+m.message);draw();return;}if(m.type!=='game')return;
 try{await saveGame(m.record);records.push(m.record);active.elapsedMs=(active.elapsedMs||0)+m.record.elapsedMs;active.updatedAt=iso();await saveRun(active);busy=false;
  if(records.length%25===0||records.length===pairList(active).length*TARGET)log(`${records.length.toLocaleString()}판 저장 · ${m.record.low} vs ${m.record.high} · 높은 AI ${m.record.scoreHigh===1?'승':m.record.scoreHigh===0?'패':'무'}`);
  draw();setTimeout(next,0);
 }catch(err){running=false;busy=false;log('저장 실패 → 일시정지: '+err.message);draw();}};worker.onerror=e=>{running=false;busy=false;log('작업자 오류: '+e.message);draw();};}
let taskCache=[],taskCursor=0,completed=new Set();
function next(){if(!running||!active)return;while(taskCursor<taskCache.length&&completed.has(taskCache[taskCursor].id))taskCursor++;if(taskCursor>=taskCache.length){running=false;busy=false;worker?.terminate();worker=null;log('전체 세트 완료! 분석 결과와 JSON을 백업하세요.');completeLeagueTraining().catch(e=>log('학습 평가 오류: '+e.message));draw();return;}
 const task=taskCache[taskCursor++];busy=true;draw();worker.postMessage({type:'game',...task});}
function run(){if(!active||running)return;if(typeof Worker==='undefined')throw Error('이 브라우저는 Web Worker를 지원하지 않습니다.');taskCache=schedule(active);completed=new Set(records.map(x=>x.gameId));taskCursor=0;running=true;busy=false;createWorker();log('전체 리그 시작 · 완료된 대국은 건너뜁니다.');next();}
function pause(){if(!running)return;running=false;busy=false;worker?.terminate();worker=null;log('일시정지 · 계산 중이던 미완료 1판은 다시 실행합니다.');draw();}
const csvVal=v=>'"'+String(v??'').replaceAll('"','""')+'"';
function csv(rows){return '\ufeff'+rows.map(r=>r.map(csvVal).join(',')).join('\r\n');}
function download(filename,mime,data){const url=URL.createObjectURL(new Blob([data],{type:mime})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function calibration(){const gs=group(),ratings=estimateRatings(gs);return {schema:'gemu.chess.helo.league.v2',runId:active.id,generatedAt:iso(),gamesPerPair:TARGET,pairs:pairList(active).length,totalGames:records.length,engineVersion:active.engineVersion,maxPlies:active.maxPlies,reference:'HElo 500 기준 고정. 모든 대진의 실제 점수율을 한꺼번에 적합한 상대 Elo. 공인 Elo 아님. 일부 대국이면 잠정 추정치.',ratings,results:gs.map(g=>({lower:g.lo,upper:g.hi,games:g.n,validGames:g.valid,winsUpper:g.w,draws:g.d,lossesUpper:g.l,upperScoreRate:point(g),pairEloDifference:gap(g),maxPlyDraws:g.limit})),applyToLiveGame:false};}
function exportFile(kind){if(!active||!records.length)return;const base='chess-helo-'+active.id;
 if(kind==='json')download(base+'-games.json','application/json;charset=utf-8',JSON.stringify({schema:'gemu.chess.helo.games.v2',run:active,games:records}));
 if(kind==='csv')download(base+'-summary.csv','text/csv;charset=utf-8',csv([['낮은_HElo','높은_HElo','대국','높은AI_승','무','패','점수율','대진_Elo_차이','반수제한'],...group().map(g=>[g.lo,g.hi,g.n,g.w,g.d,g.l,point(g),gap(g),g.limit])]));
 if(kind==='gamescsv')download(base+'-games.csv','text/csv;charset=utf-8',csv([['gameId','index','white','black','scoreHigh','winner(0_white_1_black_-1_draw)','reason','plies','elapsedMs','UCI_moves'],...records.map(x=>[x.gameId,x.index,x.white,x.black,x.scoreHigh,x.winner,x.reason,x.plies,x.elapsedMs,x.uci.join(' ')])]));
 if(kind==='calibration')download(base+'-calibration.json','application/json;charset=utf-8',JSON.stringify(calibration(),null,2));log('파일 내보내기: '+kind);}
function trainingStatus(){
 const x=loadTraining();$('learn-enabled').checked=!!x.enabled;$('publish-enabled').checked=!!x.published;
 $('training-summary').textContent=`기보 선호도 ${Object.values(x.book||{}).reduce((n,b)=>n+Object.keys(b).length,0)}개 · 조절 ${x.enabled?'ON':'OFF'} · 게임 적용 ${x.published?'ON':'OFF'} · 개정 ${x.revision} · 단계별 보정 ${LEVELS.map(l=>l+':'+(x.offsets[l]||0)).join(' / ')}`;
 $('training-history').textContent=(x.history||[]).slice(-6).reverse().map(h=>`${h.at?.slice(0,19)||''} · ${h.type} ${h.runId||''} · ${h.level||''} ${h.decision||''}`).join('\n')||'아직 기록 없음';
}
async function completeLeagueTraining(){
 if(!active || records.length < pairList(active).length*TARGET)return;
 if(active.format!==2){log('구형 세트는 자동 학습에서 제외');return;}
 const result=learnFromLeague(group(),active.id,records);
 log(result.applied?'전체 리그 분석으로 AI 보정 1회 적용(최대 ±1씩). 개발자 시험 대국에서 AI를 검증하세요.':'학습 보류: '+result.reason);
 trainingStatus();
}
async function boot(){try{db=await openDB();trainingStatus();
 $('learn-enabled').onchange=e=>{const x=loadTraining();x.enabled=e.target.checked;saveTraining(x);trainingStatus();};
 $('publish-enabled').onchange=e=>{const x=loadTraining();x.published=e.target.checked;saveTraining(x);trainingStatus();};
 $('rollback-training').onclick=()=>{try{rollbackLast();trainingStatus();log('최근 조절 되돌림');}catch(e){log(e.message);}};
 $('backup-training').onclick=()=>download('chess-training-settings.json','application/json',JSON.stringify(loadTraining(),null,2));
 $('export-public').onclick=()=>{const t=loadTraining();download('chess-helo-tuning.json','application/json',JSON.stringify({schema:1,offsets:t.offsets,book:t.book||{},revision:t.revision},null,2));};
 $('import-training').onchange=async e=>{try{const file=e.target.files?.[0];if(!file)return;
   const x=JSON.parse(await file.text());
   if(x.schema!==1||!x.offsets||typeof x.offsets!=='object'||!LEVELS.every(l=>Number.isInteger(x.offsets[l])&&Math.abs(x.offsets[l])<=4))throw Error('올바른 학습 설정 백업이 아닙니다.');
   if(!confirm('현재 학습 설정과 조절 기록을 가져온 JSON으로 바꿀까요?'))return;
   const original=loadTraining();
   saveTraining({schema:1,enabled:!!x.enabled,published:!!x.published,revision:Number.isInteger(x.revision)?x.revision:0,offsets:Object.fromEntries(LEVELS.map(l=>[l,x.offsets[l]])),book:x.book&&typeof x.book==='object'?x.book:{},history:Array.isArray(x.history)?x.history:[],feedback:Array.isArray(x.feedback)?x.feedback:[]});
   trainingStatus();log('학습 설정 JSON을 가져왔습니다.');
  }catch(err){log('설정 가져오기 실패: '+err.message);}finally{e.target.value='';}};
 $('test-chess').onclick=()=>window.open('chess-training-test.html','_blank','noopener');for(const kind of ['json','csv','gamescsv','calibration'])$(kind).onclick=()=>exportFile(kind);
 $('start').onclick=async()=>{try{if(running)return;active={id:'league-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),format:2,createdAt:iso(),updatedAt:iso(),engineVersion:ENGINE,pairs:PAIRS.map(p=>p.key),maxPlies:+$('limit').value,elapsedMs:0,tuning:{...loadTraining().offsets},book:JSON.parse(JSON.stringify(loadTraining().book||{})),trainingRevision:loadTraining().revision};records=[];lastRenderedCount=-1;await saveRun(active);await refreshRuns();draw();run();}catch(e){log('시작 실패: '+e.message);}};
 $('resume').onclick=()=>{try{run();}catch(e){log(e.message);}};$('pause').onclick=pause;
 $('import').onchange=async e=>{try{if(running)throw Error('일시정지한 뒤 가져오세요.');const f=e.target.files?.[0];if(!f)return;const data=JSON.parse(await f.text());if(!['gemu.chess.helo.games.v1','gemu.chess.helo.games.v2'].includes(data.schema)||!data.run?.id||!Array.isArray(data.games))throw Error('시뮬레이터 백업 파일이 아닙니다.');
  const r=data.run;if(!Array.isArray(r.pairs)||!Number.isInteger(r.maxPlies)||r.maxPlies<40||r.maxPlies>1000||!r.pairs.every(x=>r.format===2?PAIRS.some(p=>p.key===x):Number.isInteger(x)&&x>=100&&x<=900))throw Error('대국 설정이 올바르지 않습니다.');
  const allowed=new Set(schedule(r).map(x=>x.id));if(data.games.some(x=>!allowed.has(x.gameId)||x.runId!==r.id||!Array.isArray(x.uci)||x.uci.length>r.maxPlies||![0,.5,1].includes(x.scoreHigh)))throw Error('대국 기록이 올바르지 않습니다.');
  // Imports replace matching run entries; protect existing run from stale/partial backups.
  const old=await getGames(r.id);if(old.length&&!confirm('같은 ID의 저장 기록이 이미 있습니다. 백업으로 덮어쓸까요?'))return;
  const t=db.transaction(['runs','games'],'readwrite');const gs=t.objectStore('games');for(const x of old)gs.delete(x.gameId);t.objectStore('runs').put(r);for(const x of data.games)gs.put(x);await new Promise((ok,no)=>{t.oncomplete=ok;t.onerror=()=>no(t.error);});await loadRun(r.id);log(`백업 ${data.games.length}판 가져오기 완료`);
 }catch(err){log('가져오기 실패: '+err.message);}finally{e.target.value='';}};
 $('openrun').onclick=async()=>{try{await loadRun($('runs').value);}catch(e){log(e.message);}};
 $('deleterun').onclick=async()=>{if(running)return;const id=$('runs').value;if(!id||!confirm('선택 세트와 그 안의 모든 대국 기록을 삭제할까요?'))return;await deleteRun(id);if(active?.id===id){active=null;records=[];lastRenderedCount=-1;}await refreshRuns();draw();log('세트 삭제됨');};
 await refreshRuns();const runs=await allRuns();if(runs.length)await loadRun(runs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0].id);else draw();
 }catch(e){$('status').textContent='저장소 열기 실패';log('IndexedDB 오류: '+e.message);}}
boot();

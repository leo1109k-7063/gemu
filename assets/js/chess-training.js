/* Local, reviewable bounded HElo training. One device + origin only. */
export const KEY='gemu-chess-ai-training-v1';
export const LEVELS=[100,200,300,400,500,600,700,800,900,1000];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function loadTraining(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x?.schema===1)return x;}catch{}return {schema:1,enabled:false,published:false,revision:0,offsets:Object.fromEntries(LEVELS.map(l=>[l,0])),book:{},history:[],feedback:[]};}
export function saveTraining(x){localStorage.setItem(KEY,JSON.stringify(x));return x;}
export function addFeedback(level,decision,metadata={}){
 if(!LEVELS.includes(Number(level)) || ![-1,0,1].includes(decision))throw Error('평가값 오류');
 const x=loadTraining(),before={...x.offsets};
 // Human verdicts are explicit, bounded and reversible. 0 = hold, not overwrite AI learning.
 if(decision)x.offsets[level]=clamp((x.offsets[level]||0)+decision,-4,4);
 x.revision++;x.feedback.push({at:new Date().toISOString(),level,decision,metadata,before:before[level],after:x.offsets[level]});
 x.history.push({at:new Date().toISOString(),type:'developer-test',level,decision,before,after:{...x.offsets}});
 return saveTraining(x);
}
export function deriveOpeningPreferences(records){
 // At most first 6 half-moves. Learn only observed opening book continuations.
 // Raw game results are opponent-strength adjusted so a level is not simply rewarded for playing weaker bots.
 const statistics={};
 for(const game of records){
  if(game.reason==='move_limit'||!Array.isArray(game.uci))continue;
  const white=game.white,black=game.black;
  const winner=game.winner;
  for(let ply=0;ply<Math.min(6,game.uci.length);ply++){
   const level=ply%2===0?white:black;
   const opponent=ply%2===0?black:white;
   const expected=1/(1+10**((opponent-level)/400));
   const observed=winner===-1?.5:(winner===(ply%2)?1:0);
   const prefix=game.uci.slice(0,ply).join(' ');
   const move=game.uci[ply];
   const bucket=((statistics[level]??={})[prefix]??={});
   const row=(bucket[move]??={n:0,sum:0});row.n++;row.sum+=observed-expected;
  }
 }
 const output={};
 for(const [level,prefixes] of Object.entries(statistics)){
  output[level]={};
  for(const [prefix,moves] of Object.entries(prefixes)){
   const eligible=Object.entries(moves).filter(([_,r])=>r.n>=25);
   if(eligible.length<2)continue;
   output[level][prefix]=Object.fromEntries(eligible.map(([move,r])=>[move,Number((1+Math.max(-.3,Math.min(.3,r.sum/r.n))).toFixed(3))]));
  }
 }
 return output;
}
export function learnFromLeague(groups,runId,records=[]){
 const x=loadTraining();if(!x.enabled)return {applied:false,reason:'학습 조절 OFF'};
 if(x.history.some(h=>h.type==='league'&&h.runId===runId))return {applied:false,reason:'이미 학습한 세트'};
 if(groups.length!==45 || groups.some(g=>g.valid<300))return {applied:false,reason:'45대진 각각 최소 300개 정상 종료 대국 필요'};
 const before={...x.offsets};const error=Object.fromEntries(LEVELS.map(l=>[l,0]));const weight=Object.fromEntries(LEVELS.map(l=>[l,0]));
 for(const g of groups){
   const real=(g.w+g.d*.5)/g.valid;
   const expected=1/(1+10**((g.lo-g.hi)/400));
   const residual=clamp(real-expected,-.5,.5);
   // Higher AI overperforms -> reduce high or strengthen low; below expectations -> vice versa.
   error[g.hi]-=residual*g.valid;
   error[g.lo]+=residual*g.valid;
   weight[g.hi]+=g.valid;weight[g.lo]+=g.valid;
 }
 // 500 HElo is stable anchor; level step never exceeds 1 after one complete set.
 const proposed={...before};const decisions={};
 for(const l of LEVELS){
  const e=weight[l]?error[l]/weight[l]:0;
  const delta=l===500?0:(e>=.045?1:e<=-.045?-1:0);
  proposed[l]=clamp((before[l]||0)+delta,-4,4);
  decisions[l]={scoreError:e,delta};
 }
 x.offsets=proposed;
 const priorBook=x.book||{};
 const book=deriveOpeningPreferences(records);
 // No blind overwrite on incomplete samples: keep previous successfully measured lines.
 x.book={...priorBook};for(const level of Object.keys(book))x.book[level]={...(priorBook[level]||{}),...book[level]};
 x.revision++;
 x.history.push({type:'league',runId,at:new Date().toISOString(),before,after:{...proposed},decisions,groupCount:groups.length,openingLines:Object.values(book).reduce((n,b)=>n+Object.keys(b).length,0),previousBook:priorBook});
 saveTraining(x);
 return {applied:true,before,after:proposed,decisions};
}
export function rollbackLast(){const x=loadTraining(),last=[...x.history].reverse().find(h=>h.type!=='rollback'&&!h.undone);if(!last)throw Error('되돌릴 이력이 없습니다.');x.offsets={...last.before};if(last.type==='league')x.book=last.previousBook||{};last.undone=true;x.history.push({type:'rollback',at:new Date().toISOString(),before:{...last.after},after:{...last.before},source:last.type});x.revision++;saveTraining(x);return x;}

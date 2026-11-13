/* 게임놀이터 체스 AI와 동일한 엔진. 서비스 계정/보상과 완전히 분리. */
importScripts('./chess-sim-engine.js');
let busy=false;
self.onmessage = function(evt) {
 const a=evt.data;
 if(a.type!=='game'||busy) return;
 busy=true;
 try {
  ChessEngine.setTuning(a.tuning||{});
  const pos=new ChessEngine.Position(); pos.setFen(ChessEngine.START_FEN);
  const moves=[], details=[]; let result=null;
  const started=Date.now();
  const maxPlies=Number(a.maxPlies)||200;
  while(moves.length<maxPlies) {
   const outcome=pos.outcome();
   if(outcome){result={winner:outcome.winner,reason:outcome.reason};break;}
   const level=pos.turn===0?a.white:a.black;
   const r=ChessEngine.chooseMove(pos.getFen(),moves,level);
   const m=r.uci&&pos.moveFromUci(r.uci);
   if(!m) throw new Error('엔진이 유효한 수를 반환하지 않았습니다. ply='+moves.length+' uci='+r.uci);
   moves.push(r.uci);
   details.push({uci:r.uci,level,depth:r.depth??null,loss:Number.isFinite(r.qualityLoss)?r.qualityLoss:null});
   pos.make(m);
  }
  if(!result){const o=pos.outcome(); result=o?{winner:o.winner,reason:o.reason}:{winner:-1,reason:'move_limit'};}
  const white=a.white,black=a.black, high=Math.max(white,black),low=Math.min(white,black);
  const scoreHigh=result.winner===-1?0.5:result.winner===(white===high?0:1)?1:0;
  const stats={};
  for(const level of [low,high]){const x=details.filter(z=>z.level===level&&z.loss!==null);stats[level]={moves:x.length,avgLoss:x.length?Math.round(x.reduce((s,z)=>s+z.loss,0)/x.length):null,blunders:x.filter(z=>z.loss>=250).length};}
  self.postMessage({type:'game',id:a.id,record:{runId:a.runId,gameId:a.id,pair:a.pair,index:a.index,white,black,high,low,scoreHigh,reason:result.reason,winner:result.winner,plies:moves.length,startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,uci:moves,quality:stats,details:a.keepDetails?details:undefined}});
 }catch(error){self.postMessage({type:'error',id:a.id,message:String(error&&error.stack||error)});}
 finally{busy=false;}
};

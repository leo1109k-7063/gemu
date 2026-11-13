import {getSession} from './game-api.js';
import {loadTraining,addFeedback,LEVELS} from './chess-training.js';
const $=id=>document.getElementById(id);
const profile=getSession();
if(!profile||profile.authVersion!==2||profile.is_developer!==true){$('access').textContent='개발자 계정으로 로그인해야 시험 대국을 이용할 수 있습니다.';}
else{
 $('access').hidden=true;$('root').hidden=false;
 const tag=document.createElement('script');tag.src='./assets/js/chess-sim-engine.js';document.head.appendChild(tag);
 tag.onload=boot;
}
function boot(){
 const E=window.ChessEngine;
 if(!E){$('status').textContent='체스 엔진 로딩 오류';return;}
 const glyph={P:'♙',N:'♘',B:'♗',R:'♖',Q:'♕',K:'♔',p:'♟︎',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'};
 const letters=' PNBRQK';
 let pos,history=[],uciList=[],sel=-1,pending=[],busy=false,token=0,finished=false;
 const board=$('board');
 $('level').innerHTML=LEVELS.map(n=>`<option value="${n}" ${n===500?'selected':''}>${n} HElo</option>`).join('');
 function sqName(i){return 'abcdefgh'[i&7]+(1+(i>>4));}
 function glyphAt(i){const p=pos.b[i];if(!p)return '';const code=letters[p&7];return glyph[p>>3?code.toLowerCase():code]||'';}
 function render(){
  const whiteAtBottom=$('color').value==='w';
  board.replaceChildren();
  for(let rank=0;rank<8;rank++)for(let file=0;file<8;file++){
   const x=whiteAtBottom?file:7-file,y=whiteAtBottom?7-rank:rank,i=y*16+x;
   const b=document.createElement('button');b.type='button';b.className=((x+y)%2?'light':'dark')+(sel===i?' sel':'')+(sel>=0&&pos.legalMoves().some(m=>(m&127)===sel&&((m>>7)&127)===i)?' target':'');
   b.setAttribute('aria-label',sqName(i)+' '+(glyphAt(i)||'빈 칸'));b.textContent=glyphAt(i);b.onclick=()=>click(i);board.appendChild(b);
  }
  const end=pos.outcome();finished=!!end;
  $('status').textContent=end?`대국 종료 · ${end.winner===-1?'무승부':end.winner===($('color').value==='w'?0:1)?'개발자 승리':'AI 승리'} (${end.reason})`:(busy?'AI가 생각 중…':pos.turn===($('color').value==='w'?0:1)?'개발자 차례':'AI 차례');
  $('moves').textContent=uciList.map((u,i)=>`${i%2===0?`${1+i/2}. `:''}${u} `).join('');
 }
 function addMove(m){const u=E.moveUci(m);pos.make(m);history.push({uci:u,turn:pos.turn^1});uciList.push(u);sel=-1;pending=[];$('promotion').hidden=true;render();return true;}
 function click(i){if(busy||finished||pos.turn!==($('color').value==='w'?0:1))return;
  const moves=pos.legalMoves();const options=sel<0?[]:moves.filter(m=>(m&127)===sel&&((m>>7)&127)===i);
  if(options.length>1){pending=options;$('promotion').hidden=false;$('promotion').replaceChildren();for(const m of options){const b=document.createElement('button');b.textContent='승격: '+E.moveUci(m).slice(-1).toUpperCase();b.onclick=()=>{addMove(m);aiMove();};$('promotion').append(b);}return;}
  if(options.length===1){addMove(options[0]);aiMove();return;}
  if(pos.b[i]&&((pos.b[i]>>3)===pos.turn)){sel=i;render();}else{sel=-1;render();}
 }
 async function aiMove(){if(finished||pos.turn===($('color').value==='w'?0:1))return;
  busy=true;render();const current=++token;
  // Worker isolates the engine's potentially expensive search from the board UI.
  const w=new Worker('./assets/js/chess-training-test-worker.js');let done=false;
  const finish=()=>{if(done)return;done=true;w.terminate();};
  w.onmessage=e=>{finish();if(token!==current)return;busy=false;if(e.data.error){$('feedback').textContent=e.data.error;render();return;}
    const m=pos.moveFromUci(e.data.result?.uci);if(!m){$('feedback').textContent='AI가 유효한 수를 반환하지 않았습니다.';render();return;}addMove(m);render();};
  w.onerror=e=>{finish();if(token!==current)return;busy=false;$('feedback').textContent=e.message;render();};
  w.postMessage({fen:pos.getFen(),moves:uciList.slice(),level:+$('level').value,tuning:{offsets:{...loadTraining().offsets},book:loadTraining().book||{}}});
 }
 function restart(){token++;pos=new E.Position();pos.setFen(E.START_FEN);history=[];uciList=[];sel=-1;pending=[];busy=false;finished=false;$('promotion').hidden=true;$('feedback').textContent='';render();aiMove();}
 $('restart').onclick=restart;
 for(const [id,decision] of [['stronger',1],['keep',0],['weaker',-1]])$(id).onclick=()=>{try{const lv=+$('level').value;const x=addFeedback(lv,decision,{plies:uciList.length,uci:uciList.slice(),finished,playerColor:$('color').value,comment:'개발자 시험 대국'});$('feedback').textContent=`평가 저장: ${lv} HElo · ${decision===1?'강화':decision===-1?'약화':'유지'} · 현재 보정 ${x.offsets[lv]||0} / ±4. 다음 대국에 반영됩니다.`;}catch(e){$('feedback').textContent=e.message;}};
 restart();
}

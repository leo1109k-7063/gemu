importScripts('./chess-sim-engine.js');
onmessage=e=>{
 try{
  ChessEngine.setTuning(e.data.tuning||{});
  postMessage({result:ChessEngine.chooseMove(e.data.fen,e.data.moves,e.data.level)});
 }catch(error){postMessage({error:String(error&&error.stack||error)});}
};

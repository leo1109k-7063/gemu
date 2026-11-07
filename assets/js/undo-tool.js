/* 공용 무르기 도구: 체스 · 고누 · 오목 솔리테어 */
(function(){
  'use strict';
  const URL = 'https://idzbckhztsdnzablelaf.supabase.co';
  const KEY = 'sb_publishable_PHyvEyFmkYgaAHdHOh1RCw_kwB7FLRo';
  const profile = () => {
    try { const p=JSON.parse(localStorage.getItem('arcade-profile')||'null');
      return p?.authVersion===2 && p?.id ? p : null; } catch { return null; }
  };
  async function rpc(name, data){
    const r=await fetch(URL+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    const v=await r.json().catch(()=>null);
    if(!r.ok || !v?.ok) throw Error(v?.message||v?.error||'서버 요청 실패');
    return v;
  }
  let busy=false;
  async function balance(){
    const p=profile(); if(!p) throw Error('로그인 후 이용할 수 있어요.');
    return (await rpc('get_undo_tools',{p_profile_id:p.id})).quantity;
  }
  async function use(game){
    if(busy) throw Error('처리 중이에요.');
    const p=profile(); if(!p) throw Error('로그인 후 이용할 수 있어요.');
    busy=true;
    try {return await rpc('use_undo_tool',{
      p_profile_id:p.id,p_game:game,
      p_request_id:(crypto.randomUUID?.()||String(Date.now())+'-'+Math.random())
    });} finally {busy=false;}
  }
  async function buy(){
    if(busy) throw Error('처리 중이에요.');
    const p=profile(); if(!p) throw Error('로그인 후 구매할 수 있어요.');
    busy=true;
    try {
      const v=await rpc('buy_undo_tools',{p_profile_id:p.id});
      p.coins=Number(v.coins);localStorage.setItem('arcade-profile',JSON.stringify(p));
      return v;
    } finally {busy=false;}
  }
  window.UndoTool={balance,use,buy};
})();

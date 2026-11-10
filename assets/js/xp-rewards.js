// XP 개편 공통 호출: 코인 지급 RPC와 독립적으로 동작합니다.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { getSession, saveSession } from './game-api.js';
export const newXpMatchId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);
function notice(message, fail = false) {
  let e = document.getElementById('gemu-xp-toast');
  if (!e) { e = document.createElement('div'); e.id='gemu-xp-toast'; e.setAttribute('role','status');
    e.style.cssText='position:fixed;right:12px;top:12px;z-index:2147483647;max-width:330px;padding:12px 16px;border-radius:10px;color:white;background:#182339;font:600 14px/1.5 sans-serif;box-shadow:0 4px 20px #0005'; document.body.append(e); }
  e.style.border=fail?'2px solid #f87171':'2px solid #4ade80'; e.textContent=message;
  clearTimeout(e._timer);e._timer=setTimeout(()=>e.remove(),5500);
}
export async function claimGameXP(game,mode,outcome,matchId,milestone=0) {
  const profile = getSession();
  if (!profile?.nickname) { notice('XP 지급은 게임놀이터 로그인 후 이용할 수 있어요.',true); return null; }
  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/claim_game_xp_20261108`, {
      method:'POST',headers:{apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({p_nickname:profile.nickname,p_game:game,p_mode:mode,p_outcome:outcome,p_match_id:matchId,p_milestone:milestone})
    });
    const result=await response.json().catch(()=>null);
    if (!response.ok || result?.ok!==true) throw Error(result?.message||result?.details||result?.hint||`HTTP ${response.status}: ${JSON.stringify(result ?? {}).slice(0,180)}`);
    // 이전 RPC와 동시 실행 시 로컬 캐시의 XP를 덮어쓰지 않도록 현재 저장값도 고려합니다.
    const current=getSession();
    if(current?.nickname===profile.nickname){current.xp=Math.max(Number(current.xp)||0,Number(result.xp)||0);saveSession(current);window.dispatchEvent(new CustomEvent('gemu-xp-updated',{detail:result}));}
    if(!result.duplicate && Number(result.granted_xp)>0) notice(`⭐ ${result.granted_xp} XP 획득!`);
    return result;
  } catch(e){console.error('[XP 지급 실패]',{game,mode,outcome,matchId,milestone},e);notice(`XP 지급 실패: ${e.message}`,true);return null;}
}
// 순수 HTML 게임에서 사용할 전역 함수. module 로드가 완료되면 등록됩니다.
if (typeof window !== 'undefined') { window.gameXpClaim=claimGameXP; window.gameXpMatchId=newXpMatchId; }

// XP 보상 호출기를 게임 화면에서 즉시 사용할 수 있게 등록합니다.
// 실제 지급 함수를 필요할 때 로드하며 불러오기 오류도 화면에 표시합니다.
(function () {
  let loading;
  function notify(message) {
    let el = document.getElementById('gemu-xp-loader-error');
    if (!el) {
      el = document.createElement('div'); el.id = 'gemu-xp-loader-error';
      el.setAttribute('role', 'alert');
      el.style.cssText='position:fixed;z-index:2147483647;top:12px;right:12px;max-width:340px;padding:12px 16px;border:2px solid #fb7185;border-radius:10px;background:#222;color:#fff;font:600 14px/1.5 sans-serif';
      document.body.append(el);
    }
    el.textContent = message;
  }
  window.gameXpClaim = function (...args) {
    loading ||= import('./xp-rewards.js').catch(e => {loading=null;throw e;});
    return loading.then(m => m.claimGameXP(...args)).catch(e => {
      console.error('[게임놀이터 XP 모듈 연결 실패]', e);
      notify('XP 기능 연결 실패: ' + (e?.message || '모듈 오류'));
      return null;
    });
  };
})();

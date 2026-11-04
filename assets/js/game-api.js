/**
 * game-api.js
 * Supabase RPC 통신 및 닉네임 기반 세션, 게임 보상 관리 API
 */

import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from './config.js';

const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/`;

async function rpc(name, body = {}) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_URL.includes('YOUR_')
  ) {
    throw new Error(
      'assets/js/config.js의 Supabase 설정을 확인해 주세요.'
    );
  }

  let response;

  try {
    response = await fetch(base + name, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('서버에 연결하지 못했어요.');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      '요청에 실패했어요.'
    );
  }

  if (data?.ok === false) {
    throw new Error(data.message || '요청에 실패했어요.');
  }

  return data;
}

/* =========================================================
   1. 간소화된 닉네임 로그인 및 계정 관련 API
   ========================================================= */

/**
 * 일회용 닉네임 등록/로그인 (필요시 백엔드 RPC 연동)
 */
export const loginAccount = (nickname) =>
  rpc('login_game_account', {
    p_nickname: nickname
  });

/**
 * 전역 설정을 가져옵니다 (게임 허용 여부 등)
 */
export const getSettings = () =>
  rpc('get_game_settings');

/**
 * 공지사항 가져오기
 */
export const getAnnouncement = () =>
  rpc('get_game_announcement');


/* =========================================================
   2. 교사 전용 관리 API (코드: 131109)
   ========================================================= */

/**
 * 교사: 게임 허용/차단 설정 변경
 */
export const teacherSaveSettings = (
  code,
  omok,
  rummikub
) =>
  rpc('teacher_update_settings', {
    p_code: code,
    p_omok: omok,
    p_rummikub: rummikub
  });

/**
 * 교사: 특정 학생에게 코인 수동 지급
 */
export const teacherGrantCoins = (
  code,
  nickname,
  amount,
  reason
) =>
  rpc('teacher_grant_coins', {
    p_code: code,
    p_nickname: nickname,
    p_amount: amount,
    p_reason: reason
  });

/**
 * 교사: 전체 계정 목록 조회
 */
export const teacherGetAccounts = code =>
  rpc('teacher_get_accounts', {
    p_code: code
  });


/* =========================================================
   3. 로컬 세션 관리 (localStorage 기반)
   ========================================================= */

export function getSession() {
  try {
    return JSON.parse(
      localStorage.getItem('arcade-profile') || 'null'
    );
  } catch {
    return null;
  }
}

export function saveSession(profile) {
  localStorage.setItem(
    'arcade-profile',
    JSON.stringify(profile)
  );
}

export function clearSession() {
  localStorage.removeItem('arcade-profile');
}

export function requireNickname(nickname) {
  return nickname.trim().length >= 1 && nickname.trim().length <= 16;
}


/* =========================================================
   4. 미니게임 승리 보상 API (오목 / 루미큐브)
   ========================================================= */

/**
 * 오목 / 루미큐브 승리 보상 요청
 * 서버에서 코인과 XP를 지급하도록 요청합니다.
 */
export async function awardGameWin(gameName, matchId) {
  if (!['omok', 'rummikub'].includes(gameName)) {
    throw new Error('지원하지 않는 게임입니다.');
  }

  if (!matchId) {
    throw new Error('게임 판 ID가 없습니다.');
  }

  const profile = getSession();

  if (!profile?.nickname) {
    throw new Error('먼저 게임 계정에 로그인해 주세요.');
  }

  const result = await rpc('award_game_win', {
    p_nickname: profile.nickname,
    p_game_name: gameName,
    p_match_id: matchId
  });

  // 서버가 성공을 반환했을 때만 세션에 최신 잔액을 반영합니다.
  if (result.ok) {
    saveSession({
      ...profile,
      coins: result.coins,
      xp: result.xp
    });
  }

  return result;
}

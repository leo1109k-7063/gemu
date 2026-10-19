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

export const registerAccount = (nickname, password) =>
  rpc('register_game_account', {
    p_nickname: nickname,
    p_password: password
  });

export const loginAccount = (nickname, password) =>
  rpc('login_game_account', {
    p_nickname: nickname,
    p_password: password
  });

export const getSettings = () =>
  rpc('get_game_settings');

// 공지사항 조회
export const getAnnouncement = () =>
  rpc('get_game_announcement');

// 교사 공지사항 저장
export const teacherSaveAnnouncement = (code, enabled, message) =>
  rpc('teacher_update_announcement', {
    p_code: code,
    p_enabled: enabled,
    p_message: message
  });

export const teacherGetAccounts = code =>
  rpc('teacher_get_accounts', {
    p_code: code
  });

export const teacherGrantCoins = (code, nickname, amount, reason) =>
  rpc('teacher_grant_coins', {
    p_code: code,
    p_nickname: nickname,
    p_amount: amount,
    p_reason: reason
  });

export const teacherSaveSettings = (code, omok, rummikub) =>
  rpc('teacher_update_settings', {
    p_code: code,
    p_omok: omok,
    p_rummikub: rummikub
  });

export const teacherSetShortcut = (code, enabled) =>
  rpc('teacher_set_shortcut', {
    p_code: code,
    p_enabled: enabled
  });

export const teacherSetAccountRole = (code, nickname, enabled) =>
  rpc('teacher_set_account_role', {
    p_code: code,
    p_nickname: nickname,
    p_enabled: enabled
  });

export const developerSetAccount = (
  developerCode,
  nickname,
  enabled
) =>
  rpc('developer_set_account', {
    p_developer_code: developerCode,
    p_nickname: nickname,
    p_enabled: enabled
  });

export const teacherFlagNickname = (code, nickname) =>
  rpc('teacher_flag_nickname', {
    p_code: code,
    p_nickname: nickname
  });

export const teacherCreateDeleteChallenge = (code, nickname) =>
  rpc('teacher_create_delete_challenge', {
    p_code: code,
    p_nickname: nickname
  });

export const teacherDeleteAccount = (
  code,
  developerCode,
  nickname,
  challenge
) =>
  rpc('teacher_delete_account', {
    p_code: code,
    p_developer_code: developerCode,
    p_nickname: nickname,
    p_challenge: challenge
  });

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

export function requirePassword(password) {
  return /^[A-Za-z0-9]{4,8}$/.test(password);
}

export function requireNickname(nickname) {
  return nickname.length >= 1 && nickname.length <= 16;
}

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

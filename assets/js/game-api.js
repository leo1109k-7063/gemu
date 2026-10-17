import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
      '요청에 실패했어요.'
    );
  }

  if (data?.ok === false) {
    throw new Error(
      data.message || '요청에 실패했어요.'
    );
  }

  return data;
}

/* ========================================
   계정 생성 및 로그인
======================================== */

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

/* ========================================
   게임 설정
======================================== */

export const getSettings = () =>
  rpc('get_game_settings');

/* ========================================
   교사용 계정 관리
======================================== */

export const teacherGetAccounts = code =>
  rpc('teacher_get_accounts', {
    p_code: code
  });

export const teacherGrantCoins = (
  code,
  nickname,
  amount
) =>
  rpc('teacher_grant_coins', {
    p_code: code,
    p_nickname: nickname,
    p_amount: amount
  });

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

export const teacherSetShortcut = (
  code,
  enabled
) =>
  rpc('teacher_set_shortcut', {
    p_code: code,
    p_enabled: enabled
  });

export const teacherFlagNickname = (
  code,
  nickname
) =>
  rpc('teacher_flag_nickname', {
    p_code: code,
    p_nickname: nickname
  });

export const teacherCreateDeleteChallenge = (
  code,
  nickname
) =>
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

/* ========================================
   개발자 기능
======================================== */

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

/* ========================================
   로그인 세션 관리
======================================== */

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

/* ========================================
   입력값 검증

   일반 비밀번호:
   영문 대소문자 + 숫자, 4~8글자

   계정 생성용 개발자 형식:
   일반비밀번호/개발자코드

   전체 길이: 최대 19글자
======================================== */

export function requirePassword(
  password,
  allowDeveloperCode = false
) {
  if (typeof password !== 'string') {
    return false;
  }

  // 전체 입력 길이 제한
  if (password.length > 19) {
    return false;
  }

  // 개발자 코드가 포함된 계정 생성 형식
  if (
    allowDeveloperCode &&
    password.includes('/')
  ) {
    const parts = password.split('/');

    // 슬래시는 정확히 하나만 허용
    if (parts.length !== 2) {
      return false;
    }

    const [normalPassword, developerCode] = parts;

    // 일반 비밀번호: 영문과 숫자만, 4~8글자
    if (!/^[A-Za-z0-9]{4,8}$/.test(normalPassword)) {
      return false;
    }

    // 개발자 코드: 1~14글자
    if (
      developerCode.length < 1 ||
      developerCode.length > 14
    ) {
      return false;
    }

    return true;
  }

  // 슬래시가 없는 일반 비밀번호
  return /^[A-Za-z0-9]{4,8}$/.test(password);
}

/* ========================================
   닉네임 검증
======================================== */

export function requireNickname(nickname) {
  return (
    typeof nickname === 'string' &&
    nickname.length >= 1 &&
    nickname.length <= 16
  );
}

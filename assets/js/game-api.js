import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/`;

async function rpc(name, body = {}) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_URL.includes('YOUR_')
  ) {
    throw new Error('assets/js/config.js의 Supabase URL과 공개 키를 확인해 주세요.');
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
    throw new Error('서버에 연결하지 못했어요. 인터넷 연결과 Supabase 설정을 확인해 주세요.');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      '요청을 처리하지 못했어요.'
    );
  }

  if (data?.ok === false) {
    throw new Error(data.message || '요청을 처리하지 못했어요.');
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

export const teacherGetAccounts = (code) =>
  rpc('teacher_get_accounts', { p_code: code });

export const teacherGrantCoins = (code, nickname, amount) =>
  rpc('teacher_grant_coins', {
    p_code: code,
    p_nickname: nickname,
    p_amount: amount
  });

export const teacherSaveSettings = (code, omok, rummikub) =>
  rpc('teacher_update_settings', {
    p_code: code,
    p_omok: omok,
    p_rummikub: rummikub
  });

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem('arcade-profile') || 'null');
  } catch {
    return null;
  }
}

export function saveSession(profile) {
  localStorage.setItem('arcade-profile', JSON.stringify(profile));
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

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/`;

async function rpc(name, body = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase 설정을 확인해 주세요.');
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
    throw new Error('서버에 연결할 수 없습니다.');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || data?.details || '요청에 실패했습니다.');
  }

  if (data?.ok === false) {
    throw new Error(data.message || '요청에 실패했습니다.');
  }

  return data;
}

function getDeviceId() {
  const key = 'arcade-device-id';
  let id = localStorage.getItem(key);

  if (!id) {
    id = globalThis.crypto?.randomUUID?.();

    if (!id) {
      id = 'device-' + Date.now().toString(36) +
        '-' + Math.random().toString(36).slice(2, 18);
    }

    localStorage.setItem(key, id);
  }

  return id;
}

export function registerAccount(nickname, password, ownerCode = '') {
  return rpc('register_game_account', {
    p_nickname: nickname,
    p_password: password,
    p_owner_code: ownerCode,
    p_device_id: getDeviceId()
  });
}

export const loginAccount = (nickname, password) =>
  rpc('login_game_account', {
    p_nickname: nickname,
    p_password: password
  });

export const getSettings = () =>
  rpc('get_game_settings');

export const teacherGetAccounts = code =>
  rpc('teacher_get_accounts', { p_code: code });

export const teacherGrantCoins = (code, nickname, amount) =>
  rpc('teacher_grant_coins', {
    p_code: code,
    p_nickname: nickname,
    p_amount: amount
  });

export const teacherSaveSettings = (
  code, omok, rummikub, teacherNickname
) =>
  rpc('teacher_update_settings', {
    p_code: code,
    p_omok: omok,
    p_rummikub: rummikub,
    p_teacher_nickname: teacherNickname || null
  });

export const ownerGetTools = code =>
  rpc('owner_get_tools', { p_code: code });

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

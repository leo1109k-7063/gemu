import {
  registerAccount,
  loginAccount,
  getSettings,
  getSession,
  saveSession,
  clearSession,
  requirePassword,
  requireNickname
} from '../game-api.js';

const $ = id => document.getElementById(id);
let busy = false;

function message(text, error = false) {
  $('auth-status').textContent = text;
  $('auth-status').classList.toggle('error-text', error);
}

function showBusy(value) {
  busy = value;
  $('create-account').disabled = value;
  $('login-account').disabled = value;
}

async function render() {
  let profile = getSession();

  if (profile && profile.authVersion !== 2) {
    clearSession();
    profile = null;
  }

  $('login').classList.toggle('hidden', !!profile);
  $('home').classList.toggle('hidden', !profile);
  $('logout').classList.toggle('hidden', !profile);

  if (!profile) return;

  $('hello').textContent = profile.nickname;
  $('coins').textContent = Number(profile.coins || 0);

  try {
    const settings = await getSettings();

    $('omok-link').classList.toggle(
      'disabled-game',
      !settings.omok_enabled
    );

    $('rummikub-link').classList.toggle(
      'disabled-game',
      !settings.rummikub_enabled
    );

    $('teacherShortcut').classList.toggle(
      'hidden',
      !settings.teacher_shortcut_enabled
    );
  } catch (error) {
    message(error.message, true);
  }
}

async function authenticate(kind) {
  if (busy) return;

  const nickname = $('nickname').value.trim();
  const password = $('password').value;

  if (!requireNickname(nickname)) {
    return message('닉네임은 1~16글자로 입력해 주세요.', true);
  }

  if (!requirePassword(password)) {
    return message('비밀번호는 영어와 숫자만 사용해 4~8글자로 입력해 주세요.', true);
  }

  showBusy(true);
  message(kind === 'register' ? '계정을 만들고 있어요…' : '로그인 중이에요…');

  try {
    const result = kind === 'register'
      ? await registerAccount(nickname, password)
      : await loginAccount(nickname, password);

    saveSession({
      authVersion: 2,
      id: result.profile.id,
      nickname: result.profile.nickname,
      coins: result.profile.coins,
      is_developer: result.profile.is_developer
    });

    $('password').value = '';

    message(
      result.message ||
      (kind === 'register' ? '계정이 만들어졌어요!' : '로그인했어요!')
    );

    await render();
  } catch (error) {
    message(error.message || '처리 중 문제가 생겼어요.', true);
  } finally {
    showBusy(false);
  }
}

$('create-account').addEventListener(
  'click',
  () => authenticate('register')
);

$('login-account').addEventListener(
  'click',
  () => authenticate('login')
);

$('logout').addEventListener('click', () => {
  clearSession();
  render();
});

render();

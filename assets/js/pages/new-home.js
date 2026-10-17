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

function parseRegistrationInput(value) {
  const slash = value.indexOf('/');

  if (slash === -1) {
    return { password: value, ownerCode: '' };
  }

  if (slash !== value.lastIndexOf('/')) {
    throw new Error('소유자 예외 코드 형식을 확인해 주세요.');
  }

  const password = value.slice(0, slash);
  const ownerCode = value.slice(slash + 1);

  if (!/^[A-Za-z0-9]{10}$/.test(ownerCode)) {
    throw new Error('슬래시 뒤에는 소유자 코드 10자리를 입력해 주세요.');
  }

  return { password, ownerCode };
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
      'disabled-game', !settings.omok_enabled
    );
    $('rummikub-link').classList.toggle(
      'disabled-game', !settings.rummikub_enabled
    );

    const selected = settings.teacher_shortcut_nickname || '';
    $('teacher-shortcut').classList.toggle(
      'hidden',
      !selected ||
      selected.toLowerCase() !== profile.nickname.toLowerCase()
    );
  } catch (error) {
    message(error.message, true);
  }
}

async function authenticate(kind) {
  if (busy) return;

  const nickname = $('nickname').value.trim();
  const input = $('password').value;

  if (!requireNickname(nickname)) {
    message('닉네임은 1~16글자로 입력해 주세요.', true);
    return;
  }

  let password = input;
  let ownerCode = '';

  if (kind === 'register') {
    try {
      ({ password, ownerCode } = parseRegistrationInput(input));
    } catch (error) {
      message(error.message, true);
      return;
    }
  } else if (input.includes('/')) {
    message('로그인할 때는 슬래시 없이 비밀번호만 입력해 주세요.', true);
    return;
  }

  if (!requirePassword(password)) {
    message('비밀번호는 영어와 숫자만 사용해 4~8글자로 입력해 주세요.', true);
    return;
  }

  showBusy(true);
  message(kind === 'register' ? '계정을 만들고 있어요…' : '로그인 중이에요…');

  try {
    const result = kind === 'register'
      ? await registerAccount(nickname, password, ownerCode)
      : await loginAccount(nickname, password);

    saveSession({
      authVersion: 2,
      id: result.profile.id,
      nickname: result.profile.nickname,
      coins: result.profile.coins
    });

    $('password').value = '';
    message(kind === 'register' ? '계정이 생성됐어요!' : '로그인했어요!');
    await render();
  } catch (error) {
    message(error.message || '처리 중 문제가 생겼어요.', true);
  } finally {
    showBusy(false);
  }
}

$('create-account').addEventListener('click', () => authenticate('register'));
$('login-account').addEventListener('click', () => authenticate('login'));

$('logout').addEventListener('click', () => {
  clearSession();
  $('password').value = '';
  message('');
  render();
});

render();

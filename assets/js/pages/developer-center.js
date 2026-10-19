import {
  getSession,
  clearSession
} from '../game-api.js';

const denied = document.getElementById('denied');
const content = document.getElementById('content');
const logoutButton = document.getElementById('devLogout');

const showCpuHandSetting =
  document.getElementById('showCpuHandSetting');

const devSettingsStatus =
  document.getElementById('devSettingsStatus');

const CPU_HAND_SETTING_PREFIX = 'rummikub-show-cpu-hand:';

/**
 * 계정별 설정 키를 만듭니다.
 *
 * 계정 ID가 있으면 ID를 사용하고,
 * 없으면 닉네임을 사용합니다.
 */
function accountSettingKey(profile) {
  const accountId = profile?.id ?? profile?.nickname ?? '';

  return CPU_HAND_SETTING_PREFIX + String(accountId);
}

/**
 * 개발자 권한을 확인합니다.
 */
function checkDeveloperPermission() {
  const profile = getSession();

  const allowed = Boolean(
    profile &&
    profile.authVersion === 2 &&
    profile.is_developer === true
  );

  denied.hidden = allowed;
  content.hidden = !allowed;
  logoutButton.hidden = !allowed;

  if (allowed && showCpuHandSetting) {
    showCpuHandSetting.checked =
      localStorage.getItem(accountSettingKey(profile)) === 'true';
  }

  return allowed;
}

/**
 * 컴퓨터 손패 공개 설정을 저장합니다.
 */
if (showCpuHandSetting) {
  showCpuHandSetting.addEventListener('change', () => {
    const profile = getSession();

    const allowed = Boolean(
      profile &&
      profile.authVersion === 2 &&
      profile.is_developer === true
    );

    if (!allowed) {
      showCpuHandSetting.checked = false;

      devSettingsStatus.textContent =
        '개발자 계정에서만 설정할 수 있습니다.';

      return;
    }

    localStorage.setItem(
      accountSettingKey(profile),
      showCpuHandSetting.checked ? 'true' : 'false'
    );

    devSettingsStatus.textContent =
      showCpuHandSetting.checked
        ? '설정 저장됨: 이 계정으로 루미큐브를 열면 컴퓨터 손패가 표시됩니다.'
        : '설정 저장됨: 컴퓨터 손패를 숨깁니다.';
  });
}

/**
 * 로그아웃
 */
logoutButton.addEventListener('click', () => {
  clearSession();

  location.replace('../index.html');
});

/**
 * 페이지 초기화
 */
checkDeveloperPermission();

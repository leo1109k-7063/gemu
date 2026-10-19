import {
  getSession,
  clearSession
} from '../game-api.js';

const denied = document.getElementById('denied');
const content = document.getElementById('content');
const logoutButton = document.getElementById('devLogout');
const showCpuHandSetting = document.getElementById('showCpuHandSetting');
const devSettingsStatus = document.getElementById('devSettingsStatus');

const CPU_HAND_SETTING_PREFIX = 'rummikub-show-cpu-hand:';

function getAccountSettingKeys(profile) {
  if (!profile) return [];

  const identifiers = [profile.id, profile.nickname]
    .filter(value =>
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ''
    )
    .map(value => String(value));

  return [...new Set(identifiers)].map(
    identifier => CPU_HAND_SETTING_PREFIX + identifier
  );
}

function isDeveloper(profile = getSession()) {
  return Boolean(
    profile &&
    profile.authVersion === 2 &&
    profile.is_developer === true
  );
}

function loadCpuHandSetting(profile) {
  try {
    return getAccountSettingKeys(profile).some(
      key => localStorage.getItem(key) === 'true'
    );
  } catch (error) {
    console.error(
      '루미큐브 손패 공개 설정을 읽지 못했습니다:',
      error
    );

    return false;
  }
}

function saveCpuHandSetting(profile, enabled) {
  const keys = getAccountSettingKeys(profile);

  if (!keys.length) {
    throw new Error(
      '계정 정보를 확인할 수 없어 설정을 저장하지 못했습니다.'
    );
  }

  const value = enabled ? 'true' : 'false';

  keys.forEach(key => {
    localStorage.setItem(key, value);
  });
}

function initialize() {
  const profile = getSession();
  const allowed = isDeveloper(profile);

  if (denied) {
    denied.hidden = allowed;
  }

  if (content) {
    content.hidden = !allowed;
  }

  if (logoutButton) {
    logoutButton.hidden = !allowed;
  }

  if (allowed && showCpuHandSetting) {
    showCpuHandSetting.checked =
      loadCpuHandSetting(profile);
  }
}

if (showCpuHandSetting) {
  showCpuHandSetting.addEventListener('change', () => {
    const profile = getSession();

    if (!isDeveloper(profile)) {
      showCpuHandSetting.checked = false;

      if (devSettingsStatus) {
        devSettingsStatus.textContent =
          '개발자 계정에서만 설정할 수 있습니다.';
      }

      return;
    }

    try {
      const enabled = showCpuHandSetting.checked;

      saveCpuHandSetting(profile, enabled);

      if (devSettingsStatus) {
        devSettingsStatus.textContent = enabled
          ? '설정 저장 완료! 루미큐브 페이지를 새로 열면 컴퓨터 손패가 표시됩니다.'
          : '설정 저장 완료! 컴퓨터 손패를 숨겼습니다.';
      }
    } catch (error) {
      console.error(
        '루미큐브 손패 공개 설정 저장 오류:',
        error
      );

      if (devSettingsStatus) {
        devSettingsStatus.textContent =
          error.message || '설정을 저장하지 못했습니다.';
      }
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    clearSession();
    location.replace('../index.html');
  });
}

initialize();

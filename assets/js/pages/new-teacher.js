import {
  teacherGetAccounts,
  teacherGrantCoins,
  teacherSaveSettings,
  getSettings
} from '../game-api.js';

const $ = id => document.getElementById(id);
let teacherCode = '';

function show(id, text, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle('error-text', error);
}

async function loadAccounts() {
  show('accountStatus', '계정 목록을 불러오는 중…');

  try {
    const result = await teacherGetAccounts(teacherCode);
    const accounts = result.accounts || [];

    $('accountCount').textContent = `(${accounts.length})`;

    const list = $('accountList');
    list.replaceChildren();

    if (!accounts.length) {
      const empty = document.createElement('p');
      empty.textContent = '아직 생성된 계정이 없습니다.';
      list.append(empty);
    }

    accounts.forEach(account => {
      const row = document.createElement('div');
      row.className = 'account-row';

      const name = document.createElement('div');
      name.textContent = account.nickname;

      const created = document.createElement('small');
      created.textContent = account.created_at
        ? `${new Date(account.created_at).toLocaleDateString('ko-KR')} 생성`
        : '';

      name.append(created);

      const coins = document.createElement('strong');
      coins.textContent = `🪙 ${Number(account.coins || 0)}`;

      row.append(name, coins);
      list.append(row);
    });

    show('accountStatus', '목록을 업데이트했어요.');
  } catch (error) {
    show('accountStatus', error.message, true);
  }
}

$('gateform').addEventListener('submit', async event => {
  event.preventDefault();

  const code = $('code').value.trim();
  show('gateStatus', '확인 중…');

  try {
    await teacherGetAccounts(code);

    teacherCode = code;
    $('gate').classList.add('hidden');
    $('panel').classList.remove('hidden');

    const settings = await getSettings();

    $('omokToggle').checked = !!settings.omok_enabled;
    $('rkToggle').checked = !!settings.rummikub_enabled;

    await loadAccounts();
  } catch (error) {
    show('gateStatus', error.message || '교사 코드를 확인하지 못했어요.', true);
  }
});

$('refreshAccounts').addEventListener('click', loadAccounts);

$('grantform').addEventListener('submit', async event => {
  event.preventDefault();

  const nickname = $('target').value.trim();
  const amount = Number($('amount').value);

  if (
    !nickname ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 100000
  ) {
    show('grantstatus', '닉네임과 코인 수를 확인해 주세요.', true);
    return;
  }

  try {
    const result = await teacherGrantCoins(
      teacherCode,
      nickname,
      amount
    );

    show(
      'grantstatus',
      `${result.nickname} 계정에 ${amount}코인을 지급했어요. 현재 코인: ${result.coins}`
    );

    await loadAccounts();
  } catch (error) {
    show('grantstatus', error.message, true);
  }
});

$('saveSettings').addEventListener('click', async () => {
  try {
    await teacherSaveSettings(
      teacherCode,
      $('omokToggle').checked,
      $('rkToggle').checked
    );

    show('settingsStatus', '설정을 저장했어요.');
  } catch (error) {
    show('settingsStatus', error.message, true);
  }
});

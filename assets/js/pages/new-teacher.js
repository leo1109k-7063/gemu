import {
  teacherGetAccounts,
  teacherGrantCoins,
  teacherSaveSettings,
  getSettings,
  developerSetAccount,
  teacherSetAccountRole,
  teacherFlagNickname,
  teacherCreateDeleteChallenge,
  teacherDeleteAccount
} from '../game-api.js';

const $ = id => document.getElementById(id);

let teacherCode = '';
let selectedGrantAccount = null;

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
    list.innerHTML = '';

    if (!accounts.length) {
      list.textContent = '아직 생성된 계정이 없습니다.';
    }

    accounts.forEach(account => {
      const row = document.createElement('div');
      row.className = 'account-row';

      const info = document.createElement('div');
      const nameButton = document.createElement('button');

      nameButton.type = 'button';
      nameButton.className = 'account-name';
      nameButton.textContent = account.nickname;
      nameButton.onclick = () => openAccountDetail(account);

      info.append(nameButton);

      if (account.is_developer) {
        const role = document.createElement('small');
        role.textContent = '개발자';
        info.append(role);
      }

      if (account.is_teacher) {
        const role = document.createElement('small');
        role.textContent = '교사';
        info.append(role);
      }

      const small = document.createElement('small');
      small.textContent =
        `계정 순번 ${String(account.account_number || 0).padStart(3, '0')} · 🪙 ${Number(account.coins || 0)}`;

      info.append(small);

      const actions = document.createElement('div');
      actions.className = 'teacher-actions';

      // 코인 지급 버튼
      const grant = document.createElement('button');
      grant.type = 'button';
      grant.className = 'btn btn-primary';
      grant.textContent = '코인 지급';
      grant.onclick = () => openCoinGrant(account);

      // 부적절한 이름 처리 버튼
      const flag = document.createElement('button');
      flag.type = 'button';
      flag.className = 'btn btn-line';
      flag.textContent = '부적절한 이름 처리';

      flag.onclick = async () => {
        if (!confirm(
          `${account.nickname}의 닉네임을 변경하도록 설정할까요?`
        )) return;

        if (!confirm('정말 진행할까요?')) return;
        if (!confirm('마지막 확인입니다. 계속할까요?')) return;

        try {
          const result = await teacherFlagNickname(
            teacherCode,
            account.nickname
          );

          alert(
            `다음 로그인 시 ${result.nickname}으로 변경됩니다.`
          );

          await loadAccounts();
        } catch (error) {
          alert(error.message || '닉네임 처리에 실패했습니다.');
        }
      };

      // 계정 삭제 버튼
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-line';
      del.textContent = '계정 삭제';

      del.onclick = async () => {
        try {
          if (!confirm(
            `${account.nickname} 계정을 삭제할까요? (1/3)`
          )) return;

          if (!confirm(
            '계정이 영구 삭제됩니다. 계속할까요? (2/3)'
          )) return;

          if (!confirm(
            '마지막 확인입니다. 계속할까요? (3/3)'
          )) return;

          const reTeacher = prompt(
            '교사 코드를 다시 입력하세요.'
          );
          if (reTeacher === null) return;

          const developerCode = prompt(
            '개발자 코드를 입력하세요.'
          );
          if (developerCode === null) return;

          const challenge = await teacherCreateDeleteChallenge(
            reTeacher,
            account.nickname
          );

          if (!challenge.confirmation_code) {
            throw new Error(
              challenge.message ||
              '확인 코드를 만들지 못했습니다.'
            );
          }

          const entered = prompt(
            `마지막 확인 코드(5분 이내 입력):\n\n${challenge.confirmation_code}`
          );

          if (entered === null) return;

          const done = await teacherDeleteAccount(
            reTeacher,
            developerCode,
            account.nickname,
            entered.trim()
          );

          alert(done.message || '계정을 삭제했습니다.');
          await loadAccounts();
        } catch (error) {
          alert(
            error.message || '계정 삭제에 실패했습니다.'
          );
        }
      };

      // 순서: 코인 지급 → 부적절한 이름 처리 → 계정 삭제
      actions.append(grant, flag, del);
      row.append(info, actions);
      list.append(row);
    });

    show('accountStatus', '목록을 업데이트했어요.');
  } catch (error) {
    show('accountStatus', error.message, true);
  }
}

function openCoinGrant(account) {
  selectedGrantAccount = account;

  $('coinTargetNickname').textContent = account.nickname;
  $('coinGrantAmount').value = '';
  $('coinGrantReason').value = '';
  show('coinGrantStatus', '');

  $('coinDialogBackdrop').hidden = false;
  $('coinGrantAmount').focus();
}

function closeCoinGrant() {
  $('coinDialogBackdrop').hidden = true;
  selectedGrantAccount = null;
}

$('cancelCoinGrant').addEventListener('click', closeCoinGrant);

$('coinDialogBackdrop').addEventListener('click', event => {
  if (event.target === $('coinDialogBackdrop')) {
    closeCoinGrant();
  }
});

document.addEventListener('keydown', event => {
  if (
    event.key === 'Escape' &&
    !$('coinDialogBackdrop').hidden
  ) {
    closeCoinGrant();
  }
});

// 코인 지급 폼 제출
$('coinGrantForm').addEventListener('submit', async event => {
  event.preventDefault();

  if (!selectedGrantAccount) {
    show('coinGrantStatus', '지급할 계정을 선택해 주세요.', true);
    return;
  }

  const amountText = $('coinGrantAmount').value.trim();
  const amount = Number(amountText);
  const reason = $('coinGrantReason').value.trim();

  if (
    !amountText ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 100000
  ) {
    show(
      'coinGrantStatus',
      '코인 수는 1~100000 사이의 정수로 입력해 주세요.',
      true
    );
    return;
  }

  if (!reason || reason.length > 200) {
    show(
      'coinGrantStatus',
      '지급 코멘트를 입력해 주세요. (최대 200자)',
      true
    );
    return;
  }

  const submitButton = $('submitCoinGrant');
  submitButton.disabled = true;
  show('coinGrantStatus', '코인을 지급하는 중…');

  try {
    const result = await teacherGrantCoins(
      teacherCode,
      selectedGrantAccount.nickname,
      amount,
      reason
    );

    alert(
      `${result.nickname} 계정에 ${amount}코인을 지급했어요.\n현재 코인: ${result.coins}`
    );

    closeCoinGrant();
    await loadAccounts();
  } catch (error) {
    show(
      'coinGrantStatus',
      error.message || '코인 지급에 실패했어요.',
      true
    );
  } finally {
    submitButton.disabled = false;
  }
});

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
    show(
      'gateStatus',
      error.message || '교사 코드를 확인하지 못했어요.',
      true
    );
  }
});

$('refreshAccounts').addEventListener('click', loadAccounts);

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

function openAccountDetail(account) {
  window.selectedAccount = account;

  $('accountDetail').hidden = false;
  $('detailNickname').textContent = account.nickname;
  $('detailCoins').textContent = Number(account.coins || 0);

  $('detailRoles').textContent = [
    account.is_developer ? '개발자' : '',
    account.is_teacher ? '교사' : ''
  ].filter(Boolean).join(' · ') || '일반 계정';

  $('roleDeveloperCode').value = '';
  $('roleTeacherCode').value = '';
  show('roleStatus', '');
}

$('closeAccountDetail').addEventListener('click', () => {
  $('accountDetail').hidden = true;
});

$('assignDeveloper').addEventListener('click', async () => {
  const account = window.selectedAccount;
  if (!account) return;

  const code = $('roleDeveloperCode').value.trim();

  if (!code) {
    return show(
      'roleStatus',
      '개발자 코드를 입력해 주세요.',
      true
    );
  }

  try {
    const result = await developerSetAccount(
      code,
      account.nickname,
      true
    );

    show(
      'roleStatus',
      result.message || '개발자로 지정했습니다.'
    );

    await loadAccounts();
  } catch (error) {
    show('roleStatus', error.message, true);
  }
});

$('assignTeacher').addEventListener('click', async () => {
  const account = window.selectedAccount;
  if (!account) return;

  const code = $('roleTeacherCode').value.trim();

  if (!code) {
    return show(
      'roleStatus',
      '교사 코드를 입력해 주세요.',
      true
    );
  }

  try {
    const result = await teacherSetAccountRole(
      code,
      account.nickname,
      true
    );

    show(
      'roleStatus',
      result.message || '교사로 지정했습니다.'
    );

    await loadAccounts();
  } catch (error) {
    show('roleStatus', error.message, true);
  }
});

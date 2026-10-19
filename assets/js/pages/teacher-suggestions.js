import {
  teacherGetSuggestions,
  teacherSetSuggestionResolved
} from '../game-api.js';

const $ = id => document.getElementById(id);

let teacherCode = '';
let allSuggestions = [];
let currentFilter = 'all';

function show(id, text, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle('error-text', error);
}

async function loadSuggestions() {
  show('listStatus', '건의사항을 불러오는 중…');
  $('refreshSuggestions').disabled = true;

  try {
    const result = await teacherGetSuggestions(teacherCode);

    allSuggestions = Array.isArray(result.suggestions)
      ? result.suggestions
      : [];

    $('suggestionCount').textContent =
      `(${allSuggestions.length})`;

    renderSuggestions();

    show(
      'listStatus',
      allSuggestions.length
        ? '건의사항 목록을 불러왔어요.'
        : '아직 접수된 건의사항이 없습니다.'
    );
  } catch (error) {
    show(
      'listStatus',
      error.message || '목록을 불러오지 못했어요.',
      true
    );
  } finally {
    $('refreshSuggestions').disabled = false;
  }
}

function renderSuggestions() {
  const list = $('suggestionList');

  list.replaceChildren();

  const filtered = allSuggestions.filter(item => {
    if (currentFilter === 'open') {
      return !item.resolved;
    }

    if (currentFilter === 'resolved') {
      return !!item.resolved;
    }

    return true;
  });

  if (!filtered.length) {
    const empty = document.createElement('p');

    empty.textContent =
      '이 조건에 해당하는 건의사항이 없습니다.';

    list.append(empty);
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('article');

    card.className =
      `suggestion-card${item.resolved ? ' resolved' : ''}`;

    const top = document.createElement('div');
    top.className = 'suggestion-top';

    const left = document.createElement('div');

    const category = document.createElement('span');
    category.className = 'suggestion-category';
    category.textContent = item.category;

    const title = document.createElement('strong');
    title.style.display = 'block';
    title.style.marginTop = '8px';
    title.textContent = item.nickname || '알 수 없는 사용자';

    left.append(category, title);

    const status = document.createElement('strong');

    status.textContent = item.resolved
      ? '✅ 해결됨'
      : '🕒 미해결';

    top.append(left, status);

    const message = document.createElement('p');

    message.className = 'suggestion-message';
    message.textContent = item.message;

    const meta = document.createElement('p');

    meta.className = 'suggestion-meta';

    const date = item.created_at
      ? new Date(item.created_at)
      : null;

    meta.textContent =
      `접수: ${
        date && !Number.isNaN(date.getTime())
          ? date.toLocaleString('ko-KR')
          : '시간 정보 없음'
      }`;

    const actions = document.createElement('div');

    actions.className = 'suggestion-actions';

    const toggle = document.createElement('button');

    toggle.type = 'button';

    toggle.className = item.resolved
      ? 'btn btn-line'
      : 'btn btn-primary';

    toggle.textContent = item.resolved
      ? '미해결로 되돌리기'
      : '해결됨으로 표시';

    toggle.addEventListener('click', async () => {
      toggle.disabled = true;

      try {
        await teacherSetSuggestionResolved(
          teacherCode,
          item.id,
          !item.resolved
        );

        await loadSuggestions();
      } catch (error) {
        show(
          'listStatus',
          error.message || '상태를 변경하지 못했어요.',
          true
        );

        toggle.disabled = false;
      }
    });

    actions.append(toggle);

    card.append(
      top,
      message,
      meta,
      actions
    );

    list.append(card);
  });
}

/* 교사 코드 확인 */

$('gateForm').addEventListener('submit', async event => {
  event.preventDefault();

  const code = $('teacherCode').value.trim();

  show('gateStatus', '교사 코드를 확인하는 중…');

  try {
    // 서버에서 교사 코드를 검증합니다.
    await teacherGetSuggestions(code);

    teacherCode = code;

    $('gate').classList.add('hidden');
    $('panel').classList.remove('hidden');

    await loadSuggestions();
  } catch (error) {
    show(
      'gateStatus',
      error.message || '교사 코드를 확인하지 못했어요.',
      true
    );
  }
});

/* 목록 새로고침 */

$('refreshSuggestions').addEventListener(
  'click',
  loadSuggestions
);

/* 전체 보기 */

$('filterAll').addEventListener('click', () => {
  currentFilter = 'all';
  renderSuggestions();
});

/* 미해결만 보기 */

$('filterOpen').addEventListener('click', () => {
  currentFilter = 'open';
  renderSuggestions();
});

/* 해결된 항목만 보기 */

$('filterResolved').addEventListener('click', () => {
  currentFilter = 'resolved';
  renderSuggestions();
});

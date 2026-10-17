import { ownerGetTools } from '../game-api.js';

const $ = id => document.getElementById(id);

$('ownerForm').addEventListener('submit', async event => {
  event.preventDefault();

  const code = $('ownerCode').value.trim();
  $('ownerStatus').textContent = '소유자 인증 중…';

  try {
    const result = await ownerGetTools(code);

    const list = $('featureList');
    list.replaceChildren();

    for (const feature of result.features || []) {
      const item = document.createElement('li');
      item.textContent = feature;
      list.append(item);
    }

    $('ownerContent').classList.remove('hidden');
    $('ownerStatus').textContent = '인증됐어요.';
    $('ownerCode').value = '';
  } catch (error) {
    $('ownerContent').classList.add('hidden');
    $('ownerStatus').textContent = error.message || '인증에 실패했어요.';
  }
});

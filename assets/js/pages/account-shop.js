import { getSession } from '../game-api.js';
import { avatarSVG, mountAvatar, normalize } from '../avatar.js';
import { PARTS, SLOTS, SLOT_NAMES } from '../avatar-parts.js';

const $ = id => document.getElementById(id);
const profile = getSession();

if (!profile || profile.authVersion !== 2 || !profile.id) {
  location.replace('index.html');
  throw new Error('로그인이 필요합니다.');
}

const SUPABASE_URL = 'https://idzbckhztsdnzablelaf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PHyvEyFmkYgaAHdHOh1RCw_kwB7FLRo';

let shop = null;
let wearing = null;
let selected = null;
let slot = 'hair';
let busy = false;

function say(message, error = false) {
  $('status').textContent = message;
  $('status').style.color = error ? '#b42318' : '';
}

async function rpc(name, body) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/${name}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.details ||
      data?.hint ||
      '서버 요청에 실패했어요.'
    );
  }

  return data;
}

const level = () => Number(shop?.level || 1);

const owned = id =>
  (shop?.wardrobe || []).some(x => x.id === id);

const validItems = () =>
  (shop?.items || []).filter(x => PARTS[x.slot]?.[x.id]);

function drawPreview() {
  const look = selected
    ? { ...wearing, [selected.slot]: selected.id }
    : wearing;

  mountAvatar(
    $('preview'),
    look,
    160,
    { label: '내 캐릭터', live: true }
  );

  $('selected-name').textContent = selected
    ? `${selected.name} · ${selected.price}코인`
    : '아이템을 골라 보세요.';

  const b = $('action');
  b.disabled = !selected || busy;

  if (!selected) {
    b.textContent = '아이템 선택';
  } else if (wearing[selected.slot] === selected.id) {
    b.textContent = '착용 중';
  } else if (owned(selected.id)) {
    b.textContent = '착용하기';
  } else if (selected.min_level > level()) {
    b.textContent = `레벨 ${selected.min_level}부터`;
    b.disabled = true;
  } else if (shop.coins < selected.price) {
    b.textContent = '코인 부족';
    b.disabled = true;
  } else {
    b.textContent = `${selected.price}코인으로 구매`;
  }
}

function drawTabs() {
  $('tabs').innerHTML = SLOTS
    .filter(s => validItems().some(i => i.slot === s))
    .map(s =>
      `<button class="btn btn-line"
        role="tab"
        aria-selected="${s === slot}"
        data-slot="${s}"
        type="button">${SLOT_NAMES[s]}</button>`
    ).join('');
}

function drawItems() {
  const list = validItems().filter(i => i.slot === slot);

  $('items').innerHTML = list.map(i => {
    const worn = wearing[i.slot] === i.id;
    const has = owned(i.id);
    const locked = !has && i.min_level > level();

    const foot = worn
      ? '착용 중'
      : has
        ? '보유 중'
        : locked
          ? `레벨 ${i.min_level}부터`
          : `${i.price} 코인`;

    return `<button
      type="button"
      class="shop-item"
      data-id="${i.id}"
      aria-pressed="${selected?.id === i.id}">
      ${avatarSVG(
        { ...wearing, [i.slot]: i.id },
        90,
        { label: i.name }
      )}
      <strong>${i.name}</strong>
      <small>${foot}</small>
    </button>`;
  }).join('') || '<p>이 칸에 표시할 아이템이 없어요.</p>';
}

function render() {
  $('shop').classList.remove('hidden');

  $('hello').textContent =
    `${shop.nickname || profile.nickname}님의 캐릭터`;

  $('coins').textContent = shop.coins;
  $('level').textContent = level();

  drawTabs();
  drawItems();
  drawPreview();
}

async function load() {
  try {
    const result = await rpc(
      'get_game_shop',
      { p_profile_id: profile.id }
    );

    if (!result?.ok) {
      throw new Error(
        result?.message || '상점을 불러오지 못했어요.'
      );
    }

    shop = result;
    wearing = normalize(result.avatar);
    render();
  } catch (e) {
    say(
      `${e.message} · Supabase SQL 쿼리를 실행했는지 확인해 주세요.`,
      true
    );
  }
}

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]');
  if (!b) return;

  slot = b.dataset.slot;
  selected = null;

  drawTabs();
  drawItems();
  drawPreview();
});

$('items').addEventListener('click', e => {
  const b = e.target.closest('[data-id]');
  if (!b) return;

  selected =
    validItems().find(i => i.id === b.dataset.id) || null;

  drawItems();
  drawPreview();
});

$('cancel').addEventListener('click', () => {
  selected = null;

  drawItems();
  drawPreview();

  say('미리보기를 취소했어요.');
});

$('action').addEventListener('click', async () => {
  if (
    !selected ||
    busy ||
    wearing[selected.slot] === selected.id
  ) return;

  const it = selected;
  busy = true;
  drawPreview();

  try {
    if (!owned(it.id)) {
      const bought = await rpc(
        'buy_game_avatar_item',
        {
          p_profile_id: profile.id,
          p_item_id: it.id
        }
      );

      if (!bought?.ok) {
        throw new Error(
          bought?.message || '구매하지 못했어요.'
        );
      }

      shop.coins = Number(bought.coins);

      shop.wardrobe = [
        ...(shop.wardrobe || []),
        { id: it.id, slot: it.slot }
      ];

      it.owned = true;
    }

    const saved = await rpc(
      'save_game_avatar',
      {
        p_profile_id: profile.id,
        p_avatar: {
          ...wearing,
          [it.slot]: it.id
        }
      }
    );

    if (!saved?.ok) {
      throw new Error(
        saved?.message || '캐릭터를 저장하지 못했어요.'
      );
    }

    wearing = normalize(saved.avatar);
    selected = null;

    profile.coins = shop.coins;

    localStorage.setItem(
      'arcade-profile',
      JSON.stringify(profile)
    );

    say(`${it.name} 저장 완료!`);
    render();

  } catch (e) {
    say(e.message, true);
    await refreshShop();
  } finally {
    busy = false;
    drawPreview();
  }
});

async function refreshShop() {
  try {
    shop = await rpc(
      'get_game_shop',
      { p_profile_id: profile.id }
    );

    wearing = normalize(shop.avatar);
    render();
  } catch (e) {
    say(e.message, true);
  }
}

load();

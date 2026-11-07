import { getSession } from '../game-api.js';
import {
  avatarSVG,
  mountAvatar,
  normalize
} from '../avatar.js';
import {
  PARTS,
  SLOTS,
  SLOT_NAMES
} from '../avatar-parts.js';

const $ = id => document.getElementById(id);
const profile = getSession();

if (
  !profile ||
  profile.authVersion !== 2 ||
  !profile.id
) {
  location.replace('index.html');
  throw new Error('로그인이 필요합니다.');
}

const SUPABASE_URL =
  'https://idzbckhztsdnzablelaf.supabase.co';

const SUPABASE_KEY =
  'sb_publishable_PHyvEyFmkYgaAHdHOh1RCw_kwB7FLRo';

let shop = null;
let wearing = null;
let selected = null;
let slot = 'hair';
let busy = false;

function say(message, error = false) {
  $('status').textContent = message;
  $('status').style.color =
    error ? '#b42318' : '';
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

const level = () =>
  Number(shop?.level || 1);

const owned = id =>
  (shop?.wardrobe || []).some(x => x.id === id);

const validItems = () =>
  (shop?.items || []).filter(
    item => PARTS[item.slot]?.[item.id]
  );

function drawPreview() {
  const look = selected
    ? {
        ...wearing,
        [selected.slot]: selected.id
      }
    : wearing;

  mountAvatar(
    $('preview'),
    look,
    160,
    {
      label: '내 캐릭터',
      live: true
    }
  );

  $('selected-name').textContent = selected
    ? `${selected.name} · ${selected.price}코인`
    : '아이템을 골라 보세요.';

  const button = $('action');
  button.disabled = !selected || busy;

  if (!selected) {
    button.textContent = '아이템 선택';
  } else if (
    wearing[selected.slot] === selected.id
  ) {
    button.textContent = '착용 중';
  } else if (owned(selected.id)) {
    button.textContent = '착용하기';
  } else if (selected.min_level > level()) {
    button.textContent =
      `레벨 ${selected.min_level}부터`;
    button.disabled = true;
  } else if (shop.coins < selected.price) {
    button.textContent = '코인 부족';
    button.disabled = true;
  } else {
    button.textContent =
      `${selected.price}코인으로 구매`;
  }
}

function drawTabs() {
  $('tabs').innerHTML = SLOTS
    .filter(slotName =>
      validItems().some(
        item => item.slot === slotName
      )
    )
    .map(slotName => `
      <button
        class="btn btn-line"
        role="tab"
        aria-selected="${slotName === slot}"
        data-slot="${slotName}"
        type="button">
        ${SLOT_NAMES[slotName]}
      </button>
    `)
    .join('');
}

function drawItems() {
  const list = validItems().filter(
    item => item.slot === slot
  );

  $('items').innerHTML = list.map(item => {
    const worn =
      wearing[item.slot] === item.id;

    const has = owned(item.id);

    const locked =
      !has && item.min_level > level();

    const foot = worn
      ? '착용 중'
      : has
        ? '보유 중'
        : locked
          ? `레벨 ${item.min_level}부터`
          : `${item.price} 코인`;

    return `
      <button
        type="button"
        class="shop-item"
        data-id="${item.id}"
        aria-pressed="${selected?.id === item.id}">
        ${avatarSVG(
          {
            ...wearing,
            [item.slot]: item.id
          },
          90,
          { label: item.name }
        )}
        <strong>${item.name}</strong>
        <small>${foot}</small>
      </button>
    `;
  }).join('') ||
    '<p>이 칸에 표시할 아이템이 없어요.</p>';
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
      {
        p_profile_id: profile.id
      }
    );

    if (!result?.ok) {
      throw new Error(
        result?.message ||
        '상점을 불러오지 못했어요.'
      );
    }

    shop = result;
    wearing = normalize(result.avatar);

    render();
  } catch (error) {
    say(
      `${error.message} · Supabase SQL 쿼리를 실행했는지 확인해 주세요.`,
      true
    );
  }
}

$('tabs').addEventListener('click', event => {
  const button =
    event.target.closest('[data-slot]');

  if (!button) return;

  slot = button.dataset.slot;
  selected = null;

  drawTabs();
  drawItems();
  drawPreview();
});

$('items').addEventListener('click', event => {
  const button =
    event.target.closest('[data-id]');

  if (!button) return;

  selected = validItems().find(
    item => item.id === button.dataset.id
  ) || null;

  drawItems();
  drawPreview();
});

$('cancel').addEventListener('click', () => {
  selected = null;

  drawItems();
  drawPreview();

  say('미리보기를 취소했어요.');
});

$('action').addEventListener(
  'click',
  async () => {
    if (
      !selected ||
      busy ||
      wearing[selected.slot] === selected.id
    ) {
      return;
    }

    const item = selected;

    busy = true;
    drawPreview();

    try {
      // 보유하지 않은 아이템만 구매
      if (!owned(item.id)) {
        const bought = await rpc(
          'buy_game_avatar_item',
          {
            p_profile_id: profile.id,
            p_item_id: item.id
          }
        );

        if (!bought?.ok) {
          throw new Error(
            bought?.message ||
            '구매하지 못했어요.'
          );
        }

        shop.coins = Number(bought.coins);

        shop.wardrobe = [
          ...(shop.wardrobe || []),
          {
            id: item.id,
            slot: item.slot
          }
        ];

        item.owned = true;
      }

      // 서버에 캐릭터 외형 저장
      const saved = await rpc(
        'save_game_avatar',
        {
          p_profile_id: profile.id,
          p_avatar: {
            ...wearing,
            [item.slot]: item.id
          }
        }
      );

      if (!saved?.ok) {
        throw new Error(
          saved?.message ||
          '캐릭터를 저장하지 못했어요.'
        );
      }

      wearing = normalize(saved.avatar);
      selected = null;

      // 화면에 표시되는 코인 값 동기화
      profile.coins = shop.coins;

      localStorage.setItem(
        'arcade-profile',
        JSON.stringify(profile)
      );

      say(`${item.name} 저장 완료!`);

      render();

    } catch (error) {
      say(error.message, true);
      await refreshShop();

    } finally {
      busy = false;
      drawPreview();
    }
  }
);

async function refreshShop() {
  try {
    shop = await rpc(
      'get_game_shop',
      {
        p_profile_id: profile.id
      }
    );

    wearing = normalize(shop.avatar);
    render();

  } catch (error) {
    say(error.message, true);
  }
}

load();


/* 게임 아이템: 원래 꾸미기 상점 기능과 분리 */
let chessShopData = null;
let chessSelectedId = null;
let chessShopBusy = false;
const GAME_SKIN_VISUALS = {
  glass: {light:'#EEF3FB',dark:'#8EA7D6'},
  wood: {light:'#F0D9B5',dark:'#B58863'},
  green: {light:'#EEEED2',dark:'#769656'},
  ink: {light:'#F6F6F4',dark:'#C9C9C4'},
  neon: {light:'#2B3350',dark:'#1A2038'}
};
function miniChessBoard(id) {
  const c = GAME_SKIN_VISUALS[id] || GAME_SKIN_VISUALS.ink;
  const figures = ['♜','','♞','','','♙','','♕','','','♟','','♖','','','♔'];
  return `<span class="chess-skin-mini" aria-hidden="true">${figures.map((figure, i) =>
    `<span style="background:${(Math.floor(i/4)+i%4)%2 ? c.dark : c.light};color:${i<8?'#202020':'#fff'};text-shadow:0 1px 2px #444">${figure}</span>`
  ).join('')}</span>`;
}
async function loadChessShop() {
  try {
    const data = await rpc('get_chess_skins',{p_profile_id:profile.id});
    if (!data?.ok) throw Error(data?.message || '체스 스킨을 불러오지 못했어요.');
    chessShopData = data;
    renderChessShop();
  } catch(error) {
    $('chess-shop-status').textContent = `스킨 목록 조회 실패: ${error.message} · 신규 스킨 SQL 적용 여부를 확인해 주세요.`;
  }
}
function renderChessShop() {
  if (!chessShopData) return;
  $('chess-shop-coins').textContent = chessShopData.coins;
  $('chess-shop-items').innerHTML = chessShopData.skins.map(s => {
    const defaultSkin = s.id === 'ink';
    const ownedSkin = defaultSkin || s.owned;
    return `<button type="button" class="shop-item chess-skin-card" data-chess-skin="${s.id}"
      aria-pressed="${chessSelectedId===s.id}" ${chessShopBusy?'disabled':''}>
      ${miniChessBoard(s.id)}<strong>${s.name}</strong>
      <small>${defaultSkin?'기본 지급':ownedSkin?'구매 완료':`${s.price}코인`}</small>
    </button>`;
  }).join('');
}
$('category-decoration').addEventListener('click', () => showCategory('decoration'));
$('category-game').addEventListener('click', () => showCategory('game'));
function showCategory(category) {
  const isGame = category === 'game';
  $('decoration-section').hidden = isGame;
  $('game-section').hidden = !isGame;
  $('category-decoration').setAttribute('aria-selected', String(!isGame));
  $('category-game').setAttribute('aria-selected', String(isGame));
  if (isGame) loadChessShop();
}
$('game-tab-skins').addEventListener('click', () => showGameTab('skins'));
$('game-tab-tools').addEventListener('click', () => showGameTab('tools'));
function showGameTab(type) {
  const isTools = type === 'tools';
  $('chess-shop-view').hidden = isTools;
  $('game-tools-view').hidden = !isTools;
  $('game-tab-skins').setAttribute('aria-selected', String(!isTools));
  $('game-tab-tools').setAttribute('aria-selected', String(isTools));
}
$('chess-shop-items').addEventListener('click', async event => {
  const button = event.target.closest('[data-chess-skin]');
  if (!button || chessShopBusy || !chessShopData) return;
  const item = chessShopData.skins.find(s => s.id === button.dataset.chessSkin);
  if (!item) return;
  chessSelectedId = item.id;
  renderChessShop();
  if (item.owned || item.id === 'ink') {
    $('chess-shop-status').textContent = `${item.name}은(는) 이미 보유 중이에요. 체스 게임에서 선택할 수 있어요.`;
    return;
  }
  if (Number(chessShopData.coins) < item.price) {
    $('chess-shop-status').textContent = '코인이 부족해요.'; return;
  }
  if (!confirm(`${item.name} 스킨을 ${item.price}코인으로 구매할까요?`)) return;
  chessShopBusy = true;
  renderChessShop();
  try {
    const bought = await rpc('buy_chess_skin',{p_profile_id:profile.id,p_skin_id:item.id});
    if (!bought?.ok) throw Error(bought?.message || '구매할 수 없어요.');
    item.owned = true;
    chessShopData.coins = Number(bought.coins);
    shop.coins = Number(bought.coins);
    $('coins').textContent = shop.coins;
    profile.coins = shop.coins;
    localStorage.setItem('arcade-profile', JSON.stringify(profile));
    $('chess-shop-status').textContent = `${item.name} 구매 완료! 체스 게임에서 선택해 보세요.`;
  } catch (error) {
    $('chess-shop-status').textContent = `구매 실패: ${error.message}`;
    await loadChessShop();
  } finally {
    chessShopBusy = false;
    renderChessShop();
  }
});

// 공용 무르기 도구: 게임 아이템 > 게임 도구
const showUndoQty=async()=>{
  try{$('undo-shop-quantity').textContent=await window.UndoTool.balance();}
  catch(e){$('undo-shop-status').textContent=e.message;}
};
$('game-tab-tools').addEventListener('click',showUndoQty);
$('undo-shop-buy').addEventListener('click',async()=>{
  const b=$('undo-shop-buy'); if(b.disabled)return;
  if(!confirm('20코인으로 공용 무르기 도구 5개를 구매할까요?'))return;
  b.disabled=true;
  try{
    const v=await window.UndoTool.buy();
    $('undo-shop-quantity').textContent=v.quantity;
    $('undo-shop-status').textContent='구매 완료! 공용 무르기 도구 5개를 받았어요.';
    if(shop){shop.coins=v.coins;$('coins').textContent=v.coins;}
    if(chessShopData){chessShopData.coins=v.coins;renderChessShop();}
  }catch(e){$('undo-shop-status').textContent='구매 실패: '+e.message;}
  finally{b.disabled=false;}
});

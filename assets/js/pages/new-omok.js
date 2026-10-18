
import { N, emptyBoard, aiMove, isWin, isFull } from '../omok.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { getSession } from '../game-api.js';

const $ = id => document.getElementById(id);
const RPC = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/`;

let board, turn, over;
let winsB = 0, winsW = 0;
let seed = Date.now() % 2147483647;
let moves = 0;

let onlineGameId = null;
let onlineColor = null;
let onlineOpponent = '';
let onlineTimer = null;
let onlineBusy = false;
let waiting = false;

async function rpc(name, body = {}) {
  const response = await fetch(RPC + name, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || data?.details || '서버 요청에 실패했어요.');
  }

  return data;
}

function nickname() {
  return getSession()?.nickname || '';
}

function mode() {
  return $('mode').value;
}

function stopPolling() {
  if (onlineTimer) clearInterval(onlineTimer);
  onlineTimer = null;
}

function start() {
  stopPolling();

  board = emptyBoard();
  turn = 'black';
  over = false;
  moves = 0;

  onlineGameId = null;
  onlineColor = null;
  onlineOpponent = '';
  onlineBusy = false;
  waiting = false;

  render();
  $('status').textContent = '흑 차례';

  if (mode() === 'online') {
    $('status').textContent = '온라인 대국을 시작하려면 상대 찾기를 눌러 주세요.';
  }
}

function render() {
  const el = $('board');
  el.innerHTML = '';

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'new-cell ' + (board[r][c] || '');
      b.dataset.r = r;
      b.dataset.c = c;
      b.innerHTML = '<i></i>';

      if (mode() === 'online') {
        const myTurn =
          onlineColor === turn &&
          !over &&
          onlineGameId &&
          !onlineBusy;

        b.disabled = !myTurn || !!board[r][c];
      } else {
        b.disabled =
          over ||
          !!board[r][c] ||
          (turn === 'white' && mode() === 'ai');
      }

      el.append(b);
    }
  }

  $('winsB').textContent = winsB;
  $('winsW').textContent = winsW;

  if (mode() === 'ai') {
    $('opponent').textContent = '컴퓨터';
  } else if (mode() === 'pvp') {
    $('opponent').textContent = '플레이어 2';
  } else {
    $('opponent').textContent = onlineOpponent || '상대 찾는 중';
  }

  $('online-controls').hidden = mode() !== 'online';
}

function localPlace(r, c) {
  if (over || board[r][c]) return;

  board[r][c] = turn;
  moves++;

  if (isWin(board, r, c, turn)) {
    over = true;

    if (turn === 'black') winsB++;
    else winsW++;

    render();
    $('status').textContent = (turn === 'black' ? '흑' : '백') + ' 승리!';
    return;
  }

  if (isFull(board)) {
    over = true;
    render();
    $('status').textContent = '무승부';
    return;
  }

  turn = turn === 'black' ? 'white' : 'black';

  render();
  $('status').textContent = (turn === 'black' ? '흑' : '백') + ' 차례';

  if (turn === 'white' && mode() === 'ai') {
    setTimeout(() => {
      if (over || mode() !== 'ai') return;
      const m = aiMove(board, seed++, Math.floor(moves / 2));
      if (m) localPlace(m[0], m[1]);
    }, 250);
  }
}

async function findOpponent() {
  const nick = nickname();

  if (!nick) {
    $('status').textContent = '먼저 게임 계정에 로그인해 주세요.';
    return;
  }

  stopPolling();
  onlineGameId = null;
  onlineColor = null;
  onlineOpponent = '';
  waiting = true;
  over = false;
  board = emptyBoard();
  turn = 'black';
  render();
  $('status').textContent = '상대를 찾는 중…';

  try {
    await checkQueue();
    if (waiting && !onlineGameId) {
      onlineTimer = setInterval(checkQueue, 2000);
    }
  } catch (error) {
    waiting = false;
    $('status').textContent = error.message;
  }
}

async function checkQueue() {
  if (!waiting || onlineBusy) return;

  try {
    const result = await rpc('omok_online_join', {
      p_nickname: nickname()
    });

    if (!result.ok) {
      throw new Error(result.message || '매칭에 실패했어요.');
    }

    if (result.status === 'waiting') {
      $('status').textContent = result.message || '상대를 기다리는 중…';
      return;
    }

    if (result.status === 'matched') {
      waiting = false;
      stopPolling();

      onlineGameId = result.game_id;
      onlineColor = result.color;
      onlineOpponent = result.opponent || '상대';
      board = emptyBoard();
      turn = 'black';
      over = false;

      render();

      $('status').textContent =
        `매칭 완료! ${onlineColor === 'black' ? '흑' : '백'}으로 대국합니다.`;

      onlineTimer = setInterval(refreshOnlineGame, 1000);
    }
  } catch (error) {
    waiting = false;
    stopPolling();
    $('status').textContent = error.message;
  }
}

async function refreshOnlineGame() {
  if (!onlineGameId || onlineBusy) return;

  try {
    const result = await rpc('omok_online_state', {
      p_nickname: nickname(),
      p_game_id: onlineGameId
    });

    if (!result.ok) {
      throw new Error(result.message || '대국 상태를 불러오지 못했어요.');
    }

    board = emptyBoard();

    const flat = result.board;
    for (let i = 0; i < 225; i++) {
      const value = Number(flat[i]);
      if (value === 1) board[Math.floor(i / 15)][i % 15] = 'black';
      if (value === 2) board[Math.floor(i / 15)][i % 15] = 'white';
    }

    turn = Number(result.turn) === 1 ? 'black' : 'white';

    if (result.status === 'finished') {
      over = true;
      stopPolling();

      const iWon =
        result.winner_nickname?.toLowerCase() === nickname().toLowerCase();

      $('status').textContent = iWon
        ? '승리! 코인 5개와 XP 1이 지급되었어요.'
        : `대국 종료 — ${result.winner_nickname} 승리`;
    } else if (result.status === 'draw') {
      over = true;
      stopPolling();
      $('status').textContent = '무승부!';
    } else {
      over = false;
      $('status').textContent =
        turn === onlineColor
          ? '내 차례입니다.'
          : '상대방 차례입니다.';
    }

    render();
  } catch (error) {
    $('status').textContent = error.message;
  }
}

async function onlinePlace(r, c) {
  if (
    !onlineGameId ||
    onlineBusy ||
    over ||
    onlineColor !== turn ||
    board[r][c]
  ) return;

  onlineBusy = true;
  render();

  try {
    const result = await rpc('omok_online_move', {
      p_nickname: nickname(),
      p_game_id: onlineGameId,
      p_row: r,
      p_col: c
    });

    if (!result.ok) {
      throw new Error(result.message || '돌을 놓지 못했어요.');
    }

    await refreshOnlineGame();
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    onlineBusy = false;
    render();
  }
}

async function cancelSearch() {
  waiting = false;
  stopPolling();

  try {
    await rpc('omok_online_leave_queue', {
      p_nickname: nickname()
    });
  } catch (error) {
    console.error('대기 취소 오류:', error);
  }

  onlineGameId = null;
  onlineColor = null;
  onlineOpponent = '';
  over = false;

  board = emptyBoard();
  turn = 'black';
  render();
  $('status').textContent = '온라인 대기열에서 나왔어요.';
}

$('board').addEventListener('click', e => {
  const b = e.target.closest('button[data-r]');
  if (!b) return;

  const r = Number(b.dataset.r);
  const c = Number(b.dataset.c);

  if (mode() === 'online') {
    onlinePlace(r, c);
  } else {
    localPlace(r, c);
  }
});

$('reset').onclick = () => {
  if (mode() === 'online' && (waiting || onlineGameId)) {
    cancelSearch();
    return;
  }

  start();
};

$('mode').onchange = start;
$('find-online').onclick = findOpponent;
$('cancel-online').onclick = cancelSearch;

start();

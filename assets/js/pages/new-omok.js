import {
  N,
  emptyBoard,
  aiMove,
  isWin,
  isFull
} from '../omok.js';

import { awardGameWin } from '../game-api.js';

const $ = id => document.getElementById(id);

let board, turn, over;
let winsB = 0, winsW = 0;
let seed = Date.now() % 2147483647;
let moves = 0;
let matchId = '';
let rewardSent = false;

function start() {
  board = emptyBoard();
  turn = 'black';
  over = false;
  moves = 0;
  rewardSent = false;
  matchId = crypto.randomUUID();

  render();
  $('status').textContent = '흑 차례';
}

function render() {
  const el = $('board');
  el.innerHTML = '';

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const b = document.createElement('button');

      b.className = 'new-cell ' + (board[r][c] || '');
      b.dataset.r = r;
      b.dataset.c = c;
      b.innerHTML = '<i></i>';
      b.disabled = over || !!board[r][c] ||
        (turn === 'white' && $('mode').value === 'ai');

      el.append(b);
    }
  }

  $('winsB').textContent = winsB;
  $('winsW').textContent = winsW;
  $('opponent').textContent =
    $('mode').value === 'ai' ? '컴퓨터' : '플레이어 2';
}

async function giveWinReward() {
  if (rewardSent) return;
  rewardSent = true;

  try {
    const result = await awardGameWin('omok', matchId);

    $('status').textContent +=
      ` 코인 +${result.coins_awarded}, XP +${result.xp_awarded}`;

  } catch (error) {
    console.error('오목 승리 보상 오류:', error);
    $('status').textContent +=
      ' 보상 저장에 실패했어요. 홈으로 돌아가 다시 로그인한 뒤 확인해 주세요.';
  }
}

function place(r, c) {
  if (over || board[r][c]) return;

  board[r][c] = turn;
  moves++;

  if (isWin(board, r, c, turn)) {
    over = true;

    if (turn === 'black') winsB++;
    else winsW++;

    render();

    const humanWon =
      $('mode').value === 'pvp' || turn === 'black';

    $('status').textContent =
      (turn === 'black' ? '흑' : '백') + ' 승리!';

    if (humanWon) {
      giveWinReward();
    }

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
  $('status').textContent =
    (turn === 'black' ? '흑' : '백') + ' 차례';

  if (turn === 'white' && $('mode').value === 'ai') {
    setTimeout(() => {
      if (over) return;

      const m = aiMove(
        board,
        seed++,
        Math.floor(moves / 2)
      );

      if (m) place(m[0], m[1]);
    }, 250);
  }
}

$('board').addEventListener('click', e => {
  const b = e.target.closest('button[data-r]');
  if (b) place(+b.dataset.r, +b.dataset.c);
});

$('reset').onclick = start;
$('mode').onchange = start;

start();

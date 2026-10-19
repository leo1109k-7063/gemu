
import {
  N,
  emptyBoard,
  aiMove,
  isWin,
  isFull
} from '../omok.js';

const $ = (id) => document.getElementById(id);

let board;
let turn;
let over;
let winsB = 0;
let winsW = 0;
let seed = Date.now() % 2147483647;
let moves = 0;

const mode =
  document.body.dataset.omokMode ||
  new URLSearchParams(location.search).get('mode') ||
  'ai';

function start() {
  board = emptyBoard();
  turn = 'black';
  over = false;
  moves = 0;

  render();
  $('status').textContent = '흑 차례';
}

function render() {
  const el = $('board');
  el.innerHTML = '';

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = document.createElement('button');

      cell.className = 'new-cell ' + (board[r][c] || '');
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.innerHTML = '<i></i>';

      cell.disabled =
        over ||
        !!board[r][c] ||
        (turn === 'white' && mode === 'ai');

      el.append(cell);
    }
  }

  $('winsB').textContent = winsB;
  $('winsW').textContent = winsW;
  $('opponent').textContent =
    mode === 'ai' ? '컴퓨터' : '플레이어 2';
}

function place(r, c) {
  if (over || board[r][c]) return;

  board[r][c] = turn;
  moves++;

  if (isWin(board, r, c, turn)) {
    over = true;

    if (turn === 'black') {
      winsB++;
    } else {
      winsW++;
    }

    render();
    $('status').textContent =
      (turn === 'black' ? '흑' : '백') + ' 승리!';

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

  if (turn === 'white' && mode === 'ai') {
    setTimeout(() => {
      if (over) return;

      const move = aiMove(
        board,
        seed++,
        Math.floor(moves / 2)
      );

      if (move) {
        place(move[0], move[1]);
      }
    }, 250);
  }
}

$('board').addEventListener('click', (event) => {
  const cell = event.target.closest('button[data-r]');

  if (cell) {
    place(Number(cell.dataset.r), Number(cell.dataset.c));
  }
});

$('reset').addEventListener('click', start);

start();

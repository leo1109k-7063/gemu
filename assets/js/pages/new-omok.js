
import {
  N,
  emptyBoard,
  aiMove,
  isWin,
  isFull
} from '../omok.js';

import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} from '../config.js';

import { getSession } from '../game-api.js';

const $ = (id) => document.getElementById(id);

const mode =
  document.querySelector('[data-omok-mode]')?.dataset.omokMode ||
  document.body.dataset.omokMode ||
  new URLSearchParams(location.search).get('mode') ||
  'ai';

let board;
let turn;
let over;
let winsB = 0;
let winsW = 0;
let seed = Date.now() % 2147483647;
let moves = 0;

// 온라인 대전 상태
let onlineGameId = null;
let onlinePlayerColor = null;
let onlineOpponent = null;
let onlinePolling = false;
let onlineRequesting = false;
let onlineLastMoveCount = 0;
let onlineTimer = null;
let onlineBusy = false;

const isOnline = mode === 'online';
const isAI = mode === 'ai';
const isLocal = mode === 'pvp' || mode === 'local';

function setStatus(message) {
  const status = $('status');
  if (status) status.textContent = message;
}

function setOpponent(message) {
  const opponent = $('opponent');
  if (opponent) opponent.textContent = message;
}

function setButton(id, visible, disabled = false) {
  const button = $(id);
  if (!button) return;

  button.hidden = !visible;
  button.disabled = disabled;
}

function updateScore() {
  if ($('winsB')) $('winsB').textContent = winsB;
  if ($('winsW')) $('winsW').textContent = winsW;
}

function start() {
  if (isOnline && onlineGameId) {
    setStatus('온라인 대전 중에는 새 게임 버튼을 사용할 수 없습니다. 먼저 대전을 종료해 주세요.');
    return;
  }

  board = emptyBoard();
  turn = 'black';
  over = false;
  moves = 0;

  render();
  setStatus(isAI ? '흑 차례 — 컴퓨터와 대결합니다.' : '흑 차례');

  if (isAI) {
    setOpponent('상대: 컴퓨터');
  } else if (isLocal) {
    setOpponent('상대: 플레이어 2');
  }

  if (isOnline) {
    setOpponent('온라인 상대를 찾아 주세요.');
  }
}

function render() {
  const el = $('board');
  if (!el) return;

  el.innerHTML = '';

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = document.createElement('button');

      cell.type = 'button';
      cell.className = 'new-cell ' + (board[r][c] || '');
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.setAttribute('aria-label', `${r + 1}행 ${c + 1}열`);
      cell.innerHTML = '<i></i>';

      const occupied = Boolean(board[r][c]);
      const aiTurn = isAI && turn === 'white';
      const notMyOnlineTurn =
        isOnline && onlinePlayerColor !== turn;

      cell.disabled =
        over ||
        occupied ||
        aiTurn ||
        (isOnline && (!onlineGameId || notMyOnlineTurn || onlineBusy));

      el.append(cell);
    }
  }

  updateScore();
}

function finishGame(winner) {
  over = true;

  if (winner === 'black') {
    winsB++;
  } else if (winner === 'white') {
    winsW++;
  }

  render();

  if (winner) {
    setStatus(`${winner === 'black' ? '흑' : '백'} 승리!`);
  } else {
    setStatus('무승부!');
  }
}

function place(r, c) {
  if (isOnline) {
    onlinePlace(r, c);
    return;
  }

  if (over || !board || board[r][c]) return;
  if (isAI && turn === 'white') return;

  board[r][c] = turn;
  moves++;

  if (isWin(board, r, c, turn)) {
    finishGame(turn);
    return;
  }

  if (isFull(board)) {
    finishGame(null);
    return;
  }

  turn = turn === 'black' ? 'white' : 'black';

  render();
  setStatus(`${turn === 'black' ? '흑' : '백'} 차례`);

  if (isAI && turn === 'white') {
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

function getAccessToken() {
  const session = getSession?.();

  return (
    session?.access_token ||
    session?.accessToken ||
    session?.session?.access_token ||
    null
  );
}

function getNickname() {
  const session = getSession?.();
  return session?.nickname || session?.user?.nickname || '플레이어';
}

async function rpc(name, args = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase 설정을 확인해 주세요.');
  }

  const token = getAccessToken();

  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(args)
    }
  );

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      (typeof data === 'string' ? data : null) ||
      `온라인 요청 실패 (${response.status})`;

    throw new Error(message);
  }

  return data;
}

function normalizeResult(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function readGameId(data) {
  return (
    data?.game_id ??
    data?.gameId ??
    data?.match_id ??
    data?.matchId ??
    data?.id ??
    null
  );
}

function readPlayerColor(data) {
  const value =
    data?.player_color ??
    data?.playerColor ??
    data?.color ??
    data?.stone ??
    null;

  if (value === 'black' || value === 'white') return value;
  return null;
}

function readBoard(data) {
  const value = data?.board ?? data?.game_board ?? null;

  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 지원되지 않는 보드 형식은 호출부에서 처리합니다.
    }
  }

  return null;
}

function readTurn(data) {
  const value =
    data?.turn ??
    data?.current_turn ??
    data?.currentTurn ??
    null;

  if (value === 'black' || value === 'white') return value;
  return null;
}

function readMoveCount(data) {
  const value =
    data?.move_count ??
    data?.moveCount ??
    data?.moves_count ??
    null;

  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function readWinner(data) {
  const value = data?.winner ?? data?.result ?? null;

  if (value === 'black' || value === 'white') return value;
  if (value === 'draw' || value === 'tie') return 'draw';

  return null;
}

function readOpponentName(data) {
  return (
    data?.opponent_nickname ??
    data?.opponentNickname ??
    data?.opponent_name ??
    data?.opponentName ??
    data?.opponent?.nickname ??
    data?.opponent?.name ??
    null
  );
}

function setOnlineControls(state) {
  if (state === 'idle') {
    setButton('find-online', true, false);
    setButton('cancel-online', false);
  } else if (state === 'searching') {
    setButton('find-online', false);
    setButton('cancel-online', true, false);
  } else if (state === 'playing') {
    setButton('find-online', false);
    setButton('cancel-online', false);
  }
}

async function findOpponent() {
  if (!isOnline || onlineRequesting || onlineGameId) return;

  onlineRequesting = true;
  setOnlineControls('searching');
  setStatus('상대를 찾는 중입니다...');
  setOpponent('');

  try {
    const data = normalizeResult(
      await rpc('omok_online_join', {
        p_nickname: getNickname()
      })
    );

    if (!data) {
      setStatus('매칭 서버에서 응답이 없습니다.');
      setOnlineControls('idle');
      return;
    }

    const gameId = readGameId(data);
    const color = readPlayerColor(data);

    if (gameId) {
      onlineGameId = gameId;
      onlinePlayerColor = color;
      onlineOpponent = readOpponentName(data);

      if (!onlinePlayerColor) {
        // 서버가 색상을 반환하지 않으면 상태 조회 결과에서 가져옵니다.
        await refreshOnlineState();
      } else {
        setOnlineControls('playing');
        setStatus(`대전 시작! ${onlinePlayerColor === 'black' ? '흑돌' : '백돌'}입니다.`);
        setOpponent(onlineOpponent ? `상대: ${onlineOpponent}` : '온라인 상대와 대전 중');
        startPolling();
      }

      return;
    }

    // 서버가 매칭 대기 상태를 반환한 경우
    if (
      data.status === 'waiting' ||
      data.status === 'queued' ||
      data.waiting === true
    ) {
      setStatus('상대를 찾는 중입니다. 잠시 기다려 주세요.');
      return;
    }

    setStatus(data.message || '매칭 응답을 확인할 수 없습니다.');
    setOnlineControls('idle');
  } catch (error) {
    setStatus(`매칭 오류: ${error.message}`);
    setOnlineControls('idle');
  } finally {
    onlineRequesting = false;
  }
}

async function cancelOnlineSearch() {
  if (!isOnline) return;

  stopPolling();

  try {
    await rpc('omok_online_leave_queue', {
      p_nickname: getNickname()
    });
  } catch (error) {
    console.error('매칭 취소 오류:', error);
  }

  onlineGameId = null;
  onlinePlayerColor = null;
  onlineOpponent = null;
  onlineBusy = false;

  setOnlineControls('idle');
  setOpponent('');
  setStatus('매칭을 취소했습니다.');
  render();
}

function startPolling() {
  stopPolling();

  onlinePolling = true;

  onlineTimer = setInterval(async () => {
    if (!onlinePolling || !onlineGameId || onlineBusy) return;

    try {
      await refreshOnlineState();
    } catch (error) {
      console.error('온라인 상태 조회 오류:', error);
      setStatus(`상태 조회 오류: ${error.message}`);
    }
  }, 1200);
}

function stopPolling() {
  onlinePolling = false;

  if (onlineTimer !== null) {
    clearInterval(onlineTimer);
    onlineTimer = null;
  }
}

async function refreshOnlineState() {
  if (!onlineGameId) return;

  const data = normalizeResult(
    await rpc('omok_online_state', {
      p_game_id: onlineGameId
    })
  );

  if (!data) return;

  const returnedId = readGameId(data);
  if (returnedId && String(returnedId) !== String(onlineGameId)) {
    return;
  }

  const serverBoard = readBoard(data);

  if (serverBoard && serverBoard.length === N) {
    board = serverBoard;
  }

  const serverTurn = readTurn(data);
  if (serverTurn) turn = serverTurn;

  const serverColor = readPlayerColor(data);
  if (serverColor) onlinePlayerColor = serverColor;

  const opponentName = readOpponentName(data);
  if (opponentName) onlineOpponent = opponentName;

  const count = readMoveCount(data);
  if (count !== null) onlineLastMoveCount = count;

  const winner = readWinner(data);
  const status = data.status;

  render();

  setOpponent(
    onlineOpponent
      ? `상대: ${onlineOpponent}`
      : '온라인 상대와 대전 중'
  );

  if (winner === 'black' || winner === 'white') {
    over = true;
    stopPolling();
    setOnlineControls('idle');
    setStatus(`${winner === 'black' ? '흑' : '백'} 승리!`);
    render();
    return;
  }

  if (winner === 'draw') {
    over = true;
    stopPolling();
    setOnlineControls('idle');
    setStatus('무승부!');
    render();
    return;
  }

  if (status === 'finished' || status === 'completed') {
    over = true;
    stopPolling();
    setOnlineControls('idle');
    setStatus('대전이 종료되었습니다.');
    render();
    return;
  }

  if (status === 'cancelled' || status === 'abandoned') {
    stopPolling();
    onlineGameId = null;
    onlinePlayerColor = null;
    setOnlineControls('idle');
    setStatus('상대가 대전을 종료했습니다.');
    render();
    return;
  }

  if (onlineGameId) {
    setOnlineControls('playing');
    setStatus(
      turn === onlinePlayerColor
        ? '내 차례입니다.'
        : '상대의 차례입니다.'
    );
  }
}

async function onlinePlace(r, c) {
  if (
    !onlineGameId ||
    over ||
    onlineBusy ||
    !board ||
    board[r]?.[c] ||
    turn !== onlinePlayerColor
  ) {
    return;
  }

  onlineBusy = true;
  render();

  try {
    await rpc('omok_online_move', {
      p_game_id: onlineGameId,
      p_row: r,
      p_col: c,
      p_color: onlinePlayerColor
    });

    await refreshOnlineState();
  } catch (error) {
    setStatus(`돌 놓기 실패: ${error.message}`);

    try {
      await refreshOnlineState();
    } catch (refreshError) {
      console.error('상태 복구 오류:', refreshError);
    }
  } finally {
    onlineBusy = false;
    render();
  }
}

function bindEvents() {
  const boardElement = $('board');

  if (boardElement) {
    boardElement.addEventListener('click', (event) => {
      const cell = event.target.closest('button[data-r]');
      if (!cell) return;

      place(
        Number(cell.dataset.r),
        Number(cell.dataset.c)
      );
    });
  }

  $('reset')?.addEventListener('click', () => {
    if (isOnline) {
      setStatus('온라인 대전은 서버에서 관리됩니다. 대전을 종료하거나 매칭을 취소한 뒤 새로 시작해 주세요.');
      return;
    }

    start();
  });

  $('find-online')?.addEventListener('click', findOpponent);
  $('cancel-online')?.addEventListener('click', cancelOnlineSearch);
}

function initialize() {
  bindEvents();

  if (isOnline) {
    setOnlineControls('idle');
    setOpponent('');
    setStatus('상대 찾기를 눌러 온라인 대전을 시작하세요.');
  }

  start();
}

initialize();

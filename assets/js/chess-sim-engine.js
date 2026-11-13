var ChessEngine = (function () {
'use strict';
/* ===== 체스 엔진 (규칙 + AI 탐색). 메인 스레드와 Web Worker가 같은 코드를 씁니다. ===== */
var EMPTY = 0, P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
var KN_D = [-33, -31, -18, -14, 14, 18, 31, 33];
var KI_D = [-17, -16, -15, -1, 1, 15, 16, 17];
var BI_D = [-17, -15, 15, 17];
var RO_D = [-16, -1, 1, 16];
var PIECE_CH = ' PNBRQK';
var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
var CR_MASK = new Int8Array(128).fill(15);
CR_MASK[0] = 13; CR_MASK[7] = 14; CR_MASK[4] = 12;
CR_MASK[112] = 7; CR_MASK[119] = 11; CR_MASK[116] = 3;

/* ---- zobrist ---- */
var zlo = new Int32Array(16 * 128), zhi = new Int32Array(16 * 128);
var zcLo = new Int32Array(16), zcHi = new Int32Array(16);
var zepLo = new Int32Array(8), zepHi = new Int32Array(8);
var zTurnLo, zTurnHi;
(function () {
  var s = 0x9E3779B9 | 0;
  function rnd() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; }
  for (var i = 0; i < zlo.length; i++) { zlo[i] = rnd(); zhi[i] = rnd(); }
  for (i = 0; i < 16; i++) { zcLo[i] = rnd(); zcHi[i] = rnd(); }
  for (i = 0; i < 8; i++) { zepLo[i] = rnd(); zepHi[i] = rnd(); }
  zTurnLo = rnd(); zTurnHi = rnd();
})();

function sqName(s) { return 'abcdefgh'[s & 7] + ((s >> 4) + 1); }
function nameSq(n) { return (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 16; }

function Position() {
  this.b = new Int8Array(128);
  this.turn = 0; this.castle = 0; this.ep = -1; this.half = 0; this.full = 1;
  this.king = [0, 0];
  this.hlo = 0; this.hhi = 0;
  this.sp = 0;
  this.stM = new Int32Array(4096); this.stCap = new Int8Array(4096);
  this.stCastle = new Int8Array(4096); this.stEp = new Int16Array(4096);
  this.stHalf = new Int16Array(4096);
  this.stLo = new Int32Array(4096); this.stHi = new Int32Array(4096);
}

Position.prototype.computeHash = function () {
  var lo = 0, hi = 0, b = this.b;
  for (var s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    if (b[s]) { lo ^= zlo[b[s] * 128 + s]; hi ^= zhi[b[s] * 128 + s]; }
  }
  lo ^= zcLo[this.castle]; hi ^= zcHi[this.castle];
  if (this.ep >= 0) { lo ^= zepLo[this.ep & 7]; hi ^= zepHi[this.ep & 7]; }
  if (this.turn) { lo ^= zTurnLo; hi ^= zTurnHi; }
  this.hlo = lo; this.hhi = hi;
};

Position.prototype.setFen = function (fen) {
  var parts = fen.trim().split(/\s+/);
  this.b.fill(0); this.sp = 0;
  var rows = parts[0].split('/'), map = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
  for (var r = 0; r < 8; r++) {
    var f = 0, row = rows[7 - r];
    for (var i = 0; i < row.length; i++) {
      var ch = row[i];
      if (ch >= '1' && ch <= '8') { f += +ch; continue; }
      var lower = ch.toLowerCase(), isBlack = ch !== ch.toUpperCase();
      var piece = map[lower] + (isBlack ? 8 : 0), sq = r * 16 + f;
      this.b[sq] = piece;
      if (map[lower] === K) this.king[isBlack ? 1 : 0] = sq;
      f++;
    }
  }
  this.turn = parts[1] === 'b' ? 1 : 0;
  this.castle = 0;
  var c = parts[2] || '-';
  if (c.indexOf('K') >= 0) this.castle |= 1;
  if (c.indexOf('Q') >= 0) this.castle |= 2;
  if (c.indexOf('k') >= 0) this.castle |= 4;
  if (c.indexOf('q') >= 0) this.castle |= 8;
  this.ep = (parts[3] && parts[3] !== '-') ? nameSq(parts[3]) : -1;
  this.half = parseInt(parts[4] || '0', 10) || 0;
  this.full = parseInt(parts[5] || '1', 10) || 1;
  this.computeHash();
};

Position.prototype.getFen = function () {
  var out = [];
  for (var r = 7; r >= 0; r--) {
    var row = '', empty = 0;
    for (var f = 0; f < 8; f++) {
      var p = this.b[r * 16 + f];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      var ch = PIECE_CH[p & 7].trim();
      row += (p >> 3) ? ch.toLowerCase() : ch;
    }
    if (empty) row += empty;
    out.push(row);
  }
  var cs = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
  return out.join('/') + ' ' + (this.turn ? 'b' : 'w') + ' ' + (cs || '-') + ' ' + (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
};

Position.prototype.attacked = function (sq, by) {
  var b = this.b, c = by << 3, s, i, d, p;
  if (by === 0) {
    s = sq - 15; if (!(s & 0x88) && b[s] === P) return true;
    s = sq - 17; if (!(s & 0x88) && b[s] === P) return true;
  } else {
    s = sq + 15; if (!(s & 0x88) && b[s] === P + 8) return true;
    s = sq + 17; if (!(s & 0x88) && b[s] === P + 8) return true;
  }
  for (i = 0; i < 8; i++) { s = sq + KN_D[i]; if (!(s & 0x88) && b[s] === N + c) return true; }
  for (i = 0; i < 8; i++) { s = sq + KI_D[i]; if (!(s & 0x88) && b[s] === K + c) return true; }
  for (i = 0; i < 4; i++) {
    d = BI_D[i]; s = sq + d;
    while (!(s & 0x88)) { p = b[s]; if (p) { if (p === B + c || p === Q + c) return true; break; } s += d; }
    d = RO_D[i]; s = sq + d;
    while (!(s & 0x88)) { p = b[s]; if (p) { if (p === R + c || p === Q + c) return true; break; } s += d; }
  }
  return false;
};

Position.prototype.inCheck = function () { return this.attacked(this.king[this.turn], this.turn ^ 1); };

function mv(from, to, flag, promo) { return from | (to << 7) | (flag << 14) | (promo << 18); }

/* 가상 합법 수 생성(의사 합법). capsOnly면 잡는 수와 퀸 승급만 */
Position.prototype.gen = function (capsOnly) {
  var moves = [], b = this.b, us = this.turn, them = us ^ 1, i, d, s, q, to;
  for (var sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    var p = b[sq];
    if (!p || (p >> 3) !== us) continue;
    var t = p & 7;
    if (t === P) {
      var dir = us === 0 ? 16 : -16, startRank = us === 0 ? 1 : 6, promoRank = us === 0 ? 6 : 1, r = sq >> 4;
      to = sq + dir;
      if (!(to & 0x88) && !b[to]) {
        if (r === promoRank) {
          moves.push(mv(sq, to, 5, Q));
          if (!capsOnly) { moves.push(mv(sq, to, 5, R)); moves.push(mv(sq, to, 5, B)); moves.push(mv(sq, to, 5, N)); }
        } else if (!capsOnly) {
          moves.push(mv(sq, to, 0, 0));
          if (r === startRank && !b[to + dir]) moves.push(mv(sq, to + dir, 1, 0));
        }
      }
      for (i = 0; i < 2; i++) {
        to = sq + dir + (i ? 1 : -1);
        if (to & 0x88) continue;
        q = b[to];
        if (q && (q >> 3) === them) {
          if (r === promoRank) {
            moves.push(mv(sq, to, 5, Q));
            if (!capsOnly) { moves.push(mv(sq, to, 5, R)); moves.push(mv(sq, to, 5, B)); moves.push(mv(sq, to, 5, N)); }
          } else moves.push(mv(sq, to, 0, 0));
        } else if (to === this.ep) moves.push(mv(sq, to, 2, 0));
      }
    } else if (t === N || t === K) {
      var dl = t === N ? KN_D : KI_D;
      for (i = 0; i < 8; i++) {
        to = sq + dl[i];
        if (to & 0x88) continue;
        q = b[to];
        if (!q) { if (!capsOnly) moves.push(mv(sq, to, 0, 0)); }
        else if ((q >> 3) === them) moves.push(mv(sq, to, 0, 0));
      }
      if (t === K && !capsOnly) {
        var base = us === 0 ? 0 : 112, kside = us === 0 ? 1 : 4, qside = us === 0 ? 2 : 8;
        if (sq === base + 4 && !this.attacked(sq, them)) {
          if ((this.castle & kside) && !b[base + 5] && !b[base + 6] && b[base + 7] === R + (us << 3) &&
              !this.attacked(base + 5, them) && !this.attacked(base + 6, them)) moves.push(mv(sq, base + 6, 3, 0));
          if ((this.castle & qside) && !b[base + 3] && !b[base + 2] && !b[base + 1] && b[base] === R + (us << 3) &&
              !this.attacked(base + 3, them) && !this.attacked(base + 2, them)) moves.push(mv(sq, base + 2, 4, 0));
        }
      }
    } else {
      var diag = t === B || t === Q, orth = t === R || t === Q;
      for (i = 0; i < 4; i++) {
        for (var k = 0; k < 2; k++) {
          if (k === 0 && !diag) continue;
          if (k === 1 && !orth) continue;
          d = k === 0 ? BI_D[i] : RO_D[i];
          s = sq + d;
          while (!(s & 0x88)) {
            q = b[s];
            if (!q) { if (!capsOnly) moves.push(mv(sq, s, 0, 0)); }
            else { if ((q >> 3) === them) moves.push(mv(sq, s, 0, 0)); break; }
            s += d;
          }
        }
      }
    }
  }
  return moves;
};

Position.prototype.make = function (m) {
  var b = this.b, from = m & 127, to = (m >> 7) & 127, flag = (m >> 14) & 15, promo = (m >> 18) & 7;
  var us = this.turn, p = b[from], cap = b[to], i = this.sp++;
  this.stM[i] = m; this.stCastle[i] = this.castle; this.stEp[i] = this.ep; this.stHalf[i] = this.half;
  this.stLo[i] = this.hlo; this.stHi[i] = this.hhi;
  var lo = this.hlo, hi = this.hhi;
  if (this.ep >= 0) { lo ^= zepLo[this.ep & 7]; hi ^= zepHi[this.ep & 7]; }
  this.ep = -1;
  lo ^= zlo[p * 128 + from]; hi ^= zhi[p * 128 + from];
  if (cap) { lo ^= zlo[cap * 128 + to]; hi ^= zhi[cap * 128 + to]; }
  b[from] = 0;
  var placed = p;
  if (flag === 5) placed = promo + (us << 3);
  b[to] = placed;
  lo ^= zlo[placed * 128 + to]; hi ^= zhi[placed * 128 + to];
  if (flag === 1) {
    this.ep = (from + to) >> 1;
    lo ^= zepLo[this.ep & 7]; hi ^= zepHi[this.ep & 7];
  } else if (flag === 2) {
    var cs = to + (us === 0 ? -16 : 16);
    cap = b[cs]; b[cs] = 0;
    lo ^= zlo[cap * 128 + cs]; hi ^= zhi[cap * 128 + cs];
  } else if (flag === 3 || flag === 4) {
    var base = us === 0 ? 0 : 112, rf = flag === 3 ? base + 7 : base, rt = flag === 3 ? base + 5 : base + 3, rk = R + (us << 3);
    b[rf] = 0; b[rt] = rk;
    lo ^= zlo[rk * 128 + rf] ^ zlo[rk * 128 + rt]; hi ^= zhi[rk * 128 + rf] ^ zhi[rk * 128 + rt];
  }
  this.stCap[i] = cap;
  if ((p & 7) === K) this.king[us] = to;
  var oc = this.castle;
  this.castle = oc & CR_MASK[from] & CR_MASK[to];
  if (oc !== this.castle) { lo ^= zcLo[oc] ^ zcLo[this.castle]; hi ^= zcHi[oc] ^ zcHi[this.castle]; }
  if ((p & 7) === P || cap) this.half = 0; else this.half++;
  if (us === 1) this.full++;
  this.turn = us ^ 1;
  lo ^= zTurnLo; hi ^= zTurnHi;
  this.hlo = lo; this.hhi = hi;
};

Position.prototype.unmake = function () {
  var i = --this.sp, m = this.stM[i], b = this.b;
  var from = m & 127, to = (m >> 7) & 127, flag = (m >> 14) & 15;
  var us = this.turn ^ 1, cap = this.stCap[i];
  this.turn = us;
  if (us === 1) this.full--;
  var p = b[to];
  if (flag === 5) p = P + (us << 3);
  b[from] = p; b[to] = 0;
  if (flag === 2) { b[to + (us === 0 ? -16 : 16)] = cap; }
  else {
    if (cap) b[to] = cap;
    if (flag === 3 || flag === 4) {
      var base = us === 0 ? 0 : 112, rf = flag === 3 ? base + 7 : base, rt = flag === 3 ? base + 5 : base + 3;
      b[rf] = b[rt]; b[rt] = 0;
    }
  }
  if ((p & 7) === K) this.king[us] = from;
  this.castle = this.stCastle[i]; this.ep = this.stEp[i]; this.half = this.stHalf[i];
  this.hlo = this.stLo[i]; this.hhi = this.stHi[i];
};

Position.prototype.makeNull = function () {
  var i = this.sp++;
  this.stM[i] = 0; this.stCastle[i] = this.castle; this.stEp[i] = this.ep; this.stHalf[i] = this.half;
  this.stLo[i] = this.hlo; this.stHi[i] = this.hhi; this.stCap[i] = 0;
  if (this.ep >= 0) { this.hlo ^= zepLo[this.ep & 7]; this.hhi ^= zepHi[this.ep & 7]; }
  this.ep = -1; this.turn ^= 1; this.hlo ^= zTurnLo; this.hhi ^= zTurnHi; this.half++;
};
Position.prototype.unmakeNull = function () {
  var i = --this.sp;
  this.turn ^= 1; this.castle = this.stCastle[i]; this.ep = this.stEp[i]; this.half = this.stHalf[i];
  this.hlo = this.stLo[i]; this.hhi = this.stHi[i];
};

/* 합법 수만 만들어 보고 되돌린다 */
Position.prototype.legalMoves = function () {
  var ps = this.gen(false), out = [], us = this.turn;
  for (var i = 0; i < ps.length; i++) {
    this.make(ps[i]);
    if (!this.attacked(this.king[us], us ^ 1)) out.push(ps[i]);
    this.unmake();
  }
  return out;
};

Position.prototype.moveFromUci = function (uci) {
  var from = nameSq(uci.substr(0, 2)), to = nameSq(uci.substr(2, 2)), pc = uci.length > 4 ? 'nbrq'.indexOf(uci[4]) + 2 : 0;
  var ms = this.legalMoves();
  for (var i = 0; i < ms.length; i++) {
    var m = ms[i];
    if ((m & 127) === from && ((m >> 7) & 127) === to && (((m >> 14) & 15) !== 5 || ((m >> 18) & 7) === pc)) return m;
  }
  return 0;
};

function moveUci(m) {
  var s = sqName(m & 127) + sqName((m >> 7) & 127);
  if (((m >> 14) & 15) === 5) s += 'nbrq'[((m >> 18) & 7) - 2];
  return s;
}

/* 표준 대수 표기(SAN). 둔 뒤 상태가 아니라 두기 '전'에 호출한다 */
Position.prototype.san = function (m) {
  var from = m & 127, to = (m >> 7) & 127, flag = (m >> 14) & 15, promo = (m >> 18) & 7;
  var p = this.b[from], t = p & 7, s = '';
  if (flag === 3) s = 'O-O';
  else if (flag === 4) s = 'O-O-O';
  else {
    var capture = this.b[to] || flag === 2;
    if (t === P) {
      if (capture) s += 'abcdefgh'[from & 7] + 'x';
      s += sqName(to);
      if (flag === 5) s += '=' + PIECE_CH[promo];
    } else {
      s += PIECE_CH[t];
      var ms = this.legalMoves(), sameFile = false, sameRank = false, ambiguous = false;
      for (var i = 0; i < ms.length; i++) {
        var o = ms[i], of = o & 127;
        if (of === from || ((o >> 7) & 127) !== to || (this.b[of] & 7) !== t) continue;
        ambiguous = true;
        if ((of & 7) === (from & 7)) sameFile = true;
        if ((of >> 4) === (from >> 4)) sameRank = true;
      }
      if (ambiguous) {
        if (!sameFile) s += 'abcdefgh'[from & 7];
        else if (!sameRank) s += (from >> 4) + 1;
        else s += sqName(from);
      }
      if (capture) s += 'x';
      s += sqName(to);
    }
  }
  this.make(m);
  var us = this.turn;
  if (this.attacked(this.king[us], us ^ 1)) s += this.legalMoves().length ? '+' : '#';
  this.unmake();
  return s;
};

/* ---- 게임 종료 판정 ---- */
Position.prototype.repetitions = function () {
  var n = 1;
  for (var k = 2; k <= this.half && k <= this.sp; k += 2) {
    var i = this.sp - k;
    if (this.stLo[i] === this.hlo && this.stHi[i] === this.hhi) n++;
  }
  return n;
};

Position.prototype.insufficient = function () {
  var minors = 0, bishops = [], b = this.b;
  for (var s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    var t = b[s] & 7;
    if (!t || t === K) continue;
    if (t === P || t === R || t === Q) return false;
    minors++;
    if (t === B) bishops.push(((s >> 4) + (s & 7)) & 1);
  }
  if (minors <= 1) return true;
  if (minors === 2 && bishops.length === 2 && bishops[0] === bishops[1]) {
    var colors = 0;
    for (s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if ((b[s] & 7) === B) colors |= 1 << (b[s] >> 3); }
    return colors === 3;
  }
  return false;
};

/* 결과: null(진행중) | {over:true, result:'1-0'|'0-1'|'1/2-1/2', reason} */
Position.prototype.outcome = function () {
  var ms = this.legalMoves();
  if (!ms.length) {
    if (this.inCheck()) return { over: true, winner: this.turn ^ 1, reason: 'checkmate' };
    return { over: true, winner: -1, reason: 'stalemate' };
  }
  if (this.insufficient()) return { over: true, winner: -1, reason: 'insufficient' };
  if (this.repetitions() >= 3) return { over: true, winner: -1, reason: 'repetition' };
  if (this.half >= 100) return { over: true, winner: -1, reason: 'fifty' };
  return null;
};

/* ================= 평가 함수 ================= */
var VAL = [0, 100, 320, 330, 500, 900, 0];
var PST_SRC = {
  1: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  2: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  3: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  4: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  5: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  6: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
};
var KING_END = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];
/* PST[color][type][sq0x88] */
var PST = [[], []], PST_KE = [[], []];
(function () {
  for (var t = 1; t <= 6; t++) { PST[0][t] = new Int16Array(128); PST[1][t] = new Int16Array(128); }
  PST_KE[0] = new Int16Array(128); PST_KE[1] = new Int16Array(128);
  for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
    var sq = r * 16 + f;
    for (t = 1; t <= 6; t++) { PST[0][t][sq] = PST_SRC[t][(7 - r) * 8 + f]; PST[1][t][sq] = PST_SRC[t][r * 8 + f]; }
    PST_KE[0][sq] = KING_END[(7 - r) * 8 + f]; PST_KE[1][sq] = KING_END[r * 8 + f];
  }
})();
var PASSED = [0, 5, 10, 20, 40, 70, 110, 0];

Position.prototype.evaluate = function () {
  var b = this.b, score = [0, 0], phase = 0, bishops = [0, 0], kmid = [0, 0], kend = [0, 0];
  var wMin = [8, 8, 8, 8, 8, 8, 8, 8], bMax = [-1, -1, -1, -1, -1, -1, -1, -1];
  var pawns = [], s, p, t, c;
  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    p = b[s]; if (!p) continue;
    t = p & 7; c = p >> 3;
    if (t === K) { kmid[c] = PST[c][6][s]; kend[c] = PST_KE[c][s]; continue; }
    score[c] += VAL[t] + PST[c][t][s];
    if (t === P) {
      pawns.push(s);
      var f = s & 7, rk = s >> 4;
      if (c === 0) { if (rk < wMin[f]) wMin[f] = rk; } else { if (rk > bMax[f]) bMax[f] = rk; }
    } else {
      if (t === B) bishops[c]++;
      phase += t === Q ? 4 : t === R ? 2 : 1;
    }
  }
  for (var i = 0; i < pawns.length; i++) {
    s = pawns[i]; c = b[s] >> 3;
    var pf = s & 7, pr = s >> 4, passed = true, ff;
    for (ff = pf - 1; ff <= pf + 1; ff++) {
      if (ff < 0 || ff > 7) continue;
      if (c === 0) { if (bMax[ff] > pr) { passed = false; break; } }
      else { if (wMin[ff] < pr) { passed = false; break; } }
    }
    if (passed) score[c] += PASSED[c === 0 ? pr : 7 - pr];
  }
  if (bishops[0] >= 2) score[0] += 30;
  if (bishops[1] >= 2) score[1] += 30;
  if (phase > 24) phase = 24;
  score[0] += ((kmid[0] * phase + kend[0] * (24 - phase)) / 24) | 0;
  score[1] += ((kmid[1] * phase + kend[1] * (24 - phase)) / 24) | 0;
  var v = score[0] - score[1];
  return this.turn === 0 ? v : -v;
};

/* ================= 탐색 ================= */
var MATE = 30000, INF = 32000;
var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
var ttLo = new Int32Array(TT_SIZE), ttHi = new Int32Array(TT_SIZE), ttDepth = new Int8Array(TT_SIZE),
    ttFlag = new Int8Array(TT_SIZE), ttScore = new Int16Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE);
var killers = [], history = new Int32Array(16 * 128);
var nodes = 0, stopAt = 0, stopped = false, rootPos = null;

function resetSearch() {
  ttLo.fill(0); ttHi.fill(0); ttDepth.fill(0); ttFlag.fill(0); ttScore.fill(0); ttMove.fill(0);
  history.fill(0);
  killers = []; for (var i = 0; i < 128; i++) killers.push([0, 0]);
}

function orderMoves(pos, moves, ttm, ply) {
  var b = pos.b, scores = new Array(moves.length), k = killers[ply] || [0, 0];
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i], from = m & 127, to = (m >> 7) & 127, flag = (m >> 14) & 15, sc = 0;
    if (m === ttm) sc = 1000000;
    else {
      var vict = b[to] ? (b[to] & 7) : (flag === 2 ? 1 : 0);
      if (vict) sc = 100000 + vict * 100 - (b[from] & 7);
      else if (flag === 5) sc = 90000;
      else if (m === k[0]) sc = 80000;
      else if (m === k[1]) sc = 70000;
      else sc = history[b[from] * 128 + to];
      if (flag === 5 && vict) sc += 5000;
    }
    scores[i] = sc;
  }
  return scores;
}
function pick(moves, scores, start) {
  var best = start;
  for (var j = start + 1; j < moves.length; j++) if (scores[j] > scores[best]) best = j;
  if (best !== start) {
    var tm = moves[start]; moves[start] = moves[best]; moves[best] = tm;
    var ts = scores[start]; scores[start] = scores[best]; scores[best] = ts;
  }
}

function qsearch(pos, alpha, beta, ply) {
  nodes++;
  if ((nodes & 2047) === 0 && Date.now() > stopAt) stopped = true;
  if (stopped) return 0;
  var stand = pos.evaluate();
  if (ply > 60) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  var moves = pos.gen(true), scores = orderMoves(pos, moves, 0, ply), us = pos.turn;
  for (var i = 0; i < moves.length; i++) {
    pick(moves, scores, i);
    var m = moves[i];
    pos.make(m);
    if (pos.attacked(pos.king[us], us ^ 1)) { pos.unmake(); continue; }
    var sc = -qsearch(pos, -beta, -alpha, ply + 1);
    pos.unmake();
    if (stopped) return 0;
    if (sc >= beta) return sc;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function negamax(pos, depth, alpha, beta, ply, allowNull) {
  nodes++;
  if ((nodes & 2047) === 0 && Date.now() > stopAt) stopped = true;
  if (stopped) return 0;
  var us = pos.turn, inChk = pos.attacked(pos.king[us], us ^ 1);
  if (ply > 0) {
    if (pos.half >= 100 || pos.repetitions() >= 2) return 0;
  }
  if (inChk && ply < 60) depth++;
  if (depth <= 0) return qsearch(pos, alpha, beta, ply);
  var isPV = beta - alpha > 1, origAlpha = alpha;
  var idx = pos.hlo & TT_MASK, ttm = 0;
  if (ttLo[idx] === pos.hlo && ttHi[idx] === pos.hhi && ttFlag[idx]) {
    ttm = ttMove[idx];
    if (ttDepth[idx] >= depth && !isPV && ply > 0) {
      var ts = ttScore[idx];
      if (ts > MATE - 200) ts -= ply; else if (ts < -MATE + 200) ts += ply;
      var fl = ttFlag[idx];
      if (fl === 1) return ts;
      if (fl === 2 && ts >= beta) return ts;
      if (fl === 3 && ts <= alpha) return ts;
    }
  }
  /* 널 무브 가지치기 */
  if (allowNull && !isPV && !inChk && depth >= 3 && pos.evaluate() >= beta) {
    var hasPieces = false, bb = pos.b, c8 = us << 3;
    for (var s0 = 0; s0 < 128; s0++) {
      if (s0 & 0x88) { s0 += 7; continue; }
      var pp = bb[s0];
      if (pp && (pp & 8) === c8 && (pp & 7) > P && (pp & 7) < K) { hasPieces = true; break; }
    }
    if (hasPieces) {
      pos.makeNull();
      var ns = -negamax(pos, depth - 3, -beta, -beta + 1, ply + 1, false);
      pos.unmakeNull();
      if (stopped) return 0;
      if (ns >= beta) return ns >= MATE - 200 ? beta : ns;
    }
  }
  var moves = pos.gen(false), scores = orderMoves(pos, moves, ttm, ply);
  var best = -INF, bestMove = 0, legal = 0, b = pos.b;
  for (var i = 0; i < moves.length; i++) {
    pick(moves, scores, i);
    var m = moves[i], to = (m >> 7) & 127, from = m & 127;
    var quiet = !b[to] && ((m >> 14) & 15) !== 5 && ((m >> 14) & 15) !== 2;
    var piece = b[from];
    pos.make(m);
    if (pos.attacked(pos.king[us], us ^ 1)) { pos.unmake(); continue; }
    legal++;
    var sc, givesCheck = false;
    if (depth >= 3 && legal > 4 && quiet && !inChk && !isPV) {
      sc = -negamax(pos, depth - 2, -alpha - 1, -alpha, ply + 1, true);
      if (sc > alpha) sc = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
    } else if (legal > 1) {
      sc = -negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
      if (sc > alpha && sc < beta) sc = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      sc = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
    }
    pos.unmake();
    if (stopped) return 0;
    if (sc > best) { best = sc; bestMove = m; }
    if (sc > alpha) {
      alpha = sc;
      if (alpha >= beta) {
        if (quiet) {
          var kk = killers[ply];
          if (kk[0] !== m) { kk[1] = kk[0]; kk[0] = m; }
          history[piece * 128 + to] += depth * depth;
        }
        break;
      }
    }
  }
  if (!legal) return inChk ? -MATE + ply : 0;
  var flag = best <= origAlpha ? 3 : best >= beta ? 2 : 1;
  var store = best;
  if (store > MATE - 200) store += ply; else if (store < -MATE + 200) store -= ply;
  if (ttDepth[idx] <= depth || ttLo[idx] !== pos.hlo) {
    ttLo[idx] = pos.hlo; ttHi[idx] = pos.hhi; ttDepth[idx] = depth; ttFlag[idx] = flag;
    ttScore[idx] = store; ttMove[idx] = bestMove;
  }
  return best;
}

/* 루트 수 전체를 같은 깊이로 점수 매긴다(약한 레벨용: 점수 분포에서 고른다) */
function scoreRoot(pos, depth, ms) {
  var out = [], us = pos.turn;
  for (var i = 0; i < ms.length; i++) {
    pos.make(ms[i]);
    var sc = -negamax(pos, depth - 1, -INF, INF, 1, true);
    pos.unmake();
    if (stopped) break;
    out.push({ m: ms[i], s: sc });
  }
  return out;
}

/* HElo 단계 1~10: 표시 점수는 실제 Elo가 아닌 게임 내부 난이도 지표 */
/* 무제한 랜덤 착수를 없애고 모든 단계가 적어도 합리적인 수를 둡니다.
   단계 간 차이는 탐색 깊이, 선택 온도, 허용 평가손실로 서서히 변화합니다.
   이 수치는 게임 내부 HElo이며 공인 Elo가 아닙니다. */
var LEVELS = {
  100:  {depth:1,time:350,rand:0,temp:150,maxLoss:240,book:.25},
  200:  {depth:1,time:400,rand:0,temp:135,maxLoss:215,book:.30},
  300:  {depth:1,time:450,rand:0,temp:120,maxLoss:190,book:.35},
  400:  {depth:2,time:500,rand:0,temp:105,maxLoss:170,book:.40},
  500:  {depth:2,time:600,rand:0,temp:90,maxLoss:150,book:.45},
  600:  {depth:2,time:700,rand:0,temp:75,maxLoss:130,book:.55},
  700:  {depth:3,time:900,rand:0,temp:60,maxLoss:110,book:.65},
  800:  {depth:3,time:1100,rand:0,temp:45,maxLoss:85,book:.75},
  900:  {depth:4,time:1500,rand:0,temp:22,maxLoss:50,book:.85},
  1000: {depth:5,time:2200,rand:0,temp:0,maxLoss:0,book:1}
};

/* Developer-approved HElo training: bounded strength offsets, not a neural model. */
var TRAIN_OFFSETS = {};
var TRAIN_BOOK = {};
function setTuning(tuning) {
 var offsets=tuning && tuning.offsets ? tuning.offsets : tuning;
 TRAIN_BOOK=tuning && tuning.book && typeof tuning.book === "object" ? tuning.book : {};
 TRAIN_OFFSETS = {};
 if (offsets && typeof offsets === 'object') for(var key in LEVELS) {
  var n = Number(offsets[key]);
  TRAIN_OFFSETS[key] = Number.isFinite(n) ? Math.max(-4,Math.min(4,Math.round(n))) : 0;
 }
}
function tunedConfig(level) {
 var base=LEVELS[level] || LEVELS[500];
 var bias=TRAIN_OFFSETS[level]||0;
 if(!bias) return base;
 var cfg=Object.assign({},base);
 // Each step changes selection quality and search conservatively. No arbitrary illegal moves.
 cfg.temp=Math.max(0,Math.min(240,base.temp-bias*19));
 cfg.maxLoss=Math.max(0,Math.min(340,base.maxLoss-bias*24));
 cfg.book=Math.max(0,Math.min(1,base.book+bias*.055));
 cfg.time=Math.max(180,Math.min(3500,Math.round(base.time*(1+bias*.13))));
 // Increasing search depth is permitted only after +3 steps, limited to 5.
 cfg.depth=Math.max(1,Math.min(5,base.depth+(bias>=3?1:0)-(bias<=-3?1:0)));
 return cfg;
}

var BOOK = {
  '': ['e2e4', 'd2d4', 'g1f3', 'c2c4'],
  'e2e4': ['e7e5', 'c7c5', 'e7e6', 'c7c6'],
  'd2d4': ['d7d5', 'g8f6', 'e7e6'],
  'g1f3': ['d7d5', 'g8f6', 'c7c5'],
  'c2c4': ['e7e5', 'g8f6', 'c7c5'],
  'e2e4 e7e5': ['g1f3', 'b1c3', 'f1c4'],
  'e2e4 c7c5': ['g1f3', 'b1c3', 'c2c3'],
  'e2e4 e7e6': ['d2d4', 'd2d3'],
  'e2e4 c7c6': ['d2d4', 'b1c3'],
  'd2d4 d7d5': ['c2c4', 'g1f3', 'c1f4'],
  'd2d4 g8f6': ['c2c4', 'g1f3'],
  'e2e4 e7e5 g1f3': ['b8c6', 'g8f6'],
  'e2e4 e7e5 g1f3 b8c6': ['f1b5', 'f1c4', 'd2d4'],
  'e2e4 c7c5 g1f3': ['d7d6', 'b8c6', 'e7e6'],
  'd2d4 d7d5 c2c4': ['e7e6', 'c7c6', 'd5c4']
};

/* 최선의 수 찾기. fen: 현재 국면, hist: 시작부터의 UCI 수 목록 */
function chooseMove(fen, hist, level) {
  var cfg = tunedConfig(level);
  var pos = new Position(); pos.setFen(fen);
  var ms = pos.legalMoves();
  if (!ms.length) return { uci: null };
  if (ms.length === 1) return { uci: moveUci(ms[0]), score: 0, depth: 0 };

  /* 실시간 HElo용: AI가 고른 수의 1수 앞 정적 평가 손실을 근사한다.
     전술/장기 전략을 완전히 평가하지 못하므로 공식 레이팅이 아니다. */
  function withQuality(result) {
    if (!result.uci || ms.length < 2) return Object.assign(result, {qualityLoss:null, choices:ms.length});
    var best=-INF, chosen=-INF;
    for (var j=0; j<ms.length; j++) {
      var move=ms[j];
      pos.make(move);
      var score=-pos.evaluate();
      pos.unmake();
      if (score>best) best=score;
      if (moveUci(move)===result.uci) chosen=score;
    }
    result.qualityLoss = chosen===-INF ? null : Math.max(0,Math.min(700,Math.round(best-chosen)));
    result.choices=ms.length;
    return result;
  }

  /* 오프닝북(표준 시작 국면에서만) */
  if (hist && hist.length <= 6 && Math.random() < cfg.book) {
    var key = hist.join(' '), line = BOOK[key];
    if (line) {
      var cands = [];
      for (var i = 0; i < line.length; i++) { var bm = pos.moveFromUci(line[i]); if (bm) cands.push(line[i]); }
      if (cands.length) {
        var votes=TRAIN_BOOK[level] && TRAIN_BOOK[level][key];
        var total=0, weights=[];
        for(var v=0;v<cands.length;v++) {var w=votes && Number(votes[cands[v]]) || 1;w=Math.max(.7,Math.min(1.3,w));weights.push(w);total+=w;}
        var roll=Math.random()*total, selected=cands[0];
        for(var v=0;v<cands.length;v++){roll-=weights[v];if(roll<=0){selected=cands[v];break;}}
        return withQuality({uci:selected,score:0,depth:0,book:true});
      }
    }
  }
  resetSearch();
  nodes = 0; stopped = false; stopAt = Date.now() + cfg.time;
  var bestUci = moveUci(ms[0]), bestScore = 0, doneDepth = 0;

  if (cfg.temp >= 30) {
    /* 약한 레벨: 모든 수를 같은 깊이로 평가한 뒤 점수에 소프트맥스로 흔들어서 고른다 */
    stopAt = Date.now() + 4000;
    var scored = scoreRoot(pos, cfg.depth, ms);
    if (!scored.length) return withQuality({ uci: bestUci, score: 0, depth: 0 });
    var top = -INF, j;
    for (j = 0; j < scored.length; j++) if (scored[j].s > top) top = scored[j].s;
    // 심각한 실수는 하위 단계에서도 제외: 허용 손실 안에서만 가중 추첨.
    // 강제 메이트가 보이면 초보 AI도 그것을 놓치지 않습니다.
    var safe = scored.filter(function(x) {
      return top - x.s <= cfg.maxLoss && (top < MATE - 100 || x.s >= MATE - 100);
    });
    if (!safe.length) safe = scored.filter(function(x) { return x.s === top; });
    var total = 0, weights = [];
    for (j = 0; j < safe.length; j++) {
      var w = Math.exp((safe[j].s - top) / cfg.temp);
      weights.push(w); total += w;
    }
    var r = Math.random() * total, chosen = safe[0];
    for (j = 0; j < safe.length; j++) { r -= weights[j]; if (r <= 0) { chosen = safe[j]; break; } }
    return withQuality({ uci: moveUci(chosen.m), score: chosen.s, depth: cfg.depth, nodes: nodes });
  }

  /* 강한 레벨: 반복 심화 알파-베타 */
  var rootMoves = ms.slice();
  var rootScores = [];
  for (var d = 1; d <= cfg.depth; d++) {
    var alpha = -INF, beta = INF, curBest = 0, curScore = -INF, ordered = rootMoves;
    var results = [];
    for (var k = 0; k < ordered.length; k++) {
      var m = ordered[k];
      pos.make(m);
      var sc;
      if (k === 0) sc = -negamax(pos, d - 1, -beta, -alpha, 1, true);
      else {
        sc = -negamax(pos, d - 1, -alpha - 1, -alpha, 1, true);
        if (sc > alpha && !stopped) sc = -negamax(pos, d - 1, -beta, -alpha, 1, true);
      }
      pos.unmake();
      if (stopped) break;
      results.push({ m: m, s: sc });
      if (sc > curScore) { curScore = sc; curBest = m; }
      if (sc > alpha) alpha = sc;
    }
    if (stopped) { if (curBest && results.length > 0 && d > 1) { bestUci = moveUci(curBest); bestScore = curScore; } break; }
    bestUci = moveUci(curBest); bestScore = curScore; doneDepth = d;
    /* 다음 깊이는 이번 최선수를 맨 앞으로 */
    ordered = [curBest].concat(ordered.filter(function (x) { return x !== curBest; }));
    rootMoves = ordered;
    if (Math.abs(curScore) > MATE - 100) break;
    if (Date.now() > stopAt) break;
  }
  /* 고난이도: 반복 심화 결과를 사용 */
  return withQuality({ uci: bestUci, score: bestScore, depth: doneDepth, nodes: nodes });
}

/* 한 대국의 착수를 동일한 깊이(2 ply)로 사후 재평가한다.
   평가 수치는 엔진 자체 기준이며 Stockfish 정확도나 공인 기력이 아니다. */
function analyzeGame(ucis) {
  var pos = new Position(); pos.setFen(START_FEN);
  var sides = [{n:0,sum:0,near:0,miss:0,bad:0,top:[]},{n:0,sum:0,near:0,miss:0,bad:0,top:[]}];
  var total = Math.min(ucis.length, 240);
  for (var i=0;i<total;i++) {
    var m = pos.moveFromUci(ucis[i]);
    if (!m) break;
    var side = pos.turn, stat=sides[side], legal = pos.legalMoves();
    var scores = [], best = -30000, chosen = -30000, bestUci='';
    resetSearch(); nodes=0; stopped=false; stopAt=Date.now()+400;
    /* 깊이 2 탐색. 오래 걸리는 국면에서는 정적 평가로 전 수를 비교한다. */
    var measured = scoreRoot(pos,2,legal);
    if (stopped || measured.length !== legal.length) {
      measured = [];
      for (var j=0;j<legal.length;j++) {
        pos.make(legal[j]);
        measured.push({m:legal[j],s:-pos.evaluate()});
        pos.unmake();
      }
    }
    for (var j=0;j<measured.length;j++) {
      var x=measured[j], val=Math.max(-2000,Math.min(2000,x.s));
      if (val>best) {best=val;bestUci=moveUci(x.m);}
      if (x.m===m) chosen=val;
    }
    if (chosen===-30000) {
      pos.make(m); chosen=-pos.evaluate(); pos.unmake();
    }
    var loss=Math.max(0,Math.min(700,best-chosen));
    stat.n++; stat.sum+=loss;
    if(loss<=35)stat.near++;
    if(loss>=100 && bestUci!==ucis[i])stat.miss++;
    if(loss>=250)stat.bad++;
    if(loss>=100 && stat.top.length<5)stat.top.push({turn:Math.floor(i/2)+1,played:ucis[i],better:bestUci,loss:Math.round(loss)});
    pos.make(m);
  }
  return sides.map(function(st){
    var avg=st.n?st.sum/st.n:0;
    return {moves:st.n,accuracy:st.n?Math.round(100*Math.exp(-avg/180)):null,
      near:st.near,miss:st.miss,blunders:st.bad,avgLoss:Math.round(avg),examples:st.top};
  });
}

return { Position: Position, moveUci: moveUci, START_FEN: START_FEN, sqName: sqName, chooseMove: chooseMove, LEVELS: LEVELS, setTuning: setTuning, analyzeGame: analyzeGame };
})();

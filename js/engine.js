/*!
 * 中国象棋规则引擎（含「兵种强化系统」）
 * ---------------------------------------------------------------
 * 棋盘坐标：board 为长度 90 的一维数组，index = row * 9 + col
 *   - col(列/x): 0 -> 8 ，从「红方视角」的左侧到右侧
 *   - row(行/y): 0 -> 9 ，row 0 是黑方底线（屏幕上方），row 9 是红方底线（屏幕下方）
 *   - 红方(r)向上走（row 减小），黑方(b)向下走（row 增大）
 *   - 大写字母 = 红方，小写字母 = 黑方
 *     K/k 帅将  A/a 仕士  B/b 相象  N/n 马  R/r 车  C/c 炮  P/p 兵卒
 *
 * 强化系统（每方每局 3 次，激活后仅维持「一回合」= 自己这一步 + 对方下一步）：
 *   P 兵卒：未过河也可左右横走、可后退一格
 *   R 车  ：可沿斜线滑行
 *   B 相象：田字格内皆可走（含斜一格，斜二格仍受象眼限制，且不可过河）
 *   N 马  ：日字格内皆可走（不再别马腿，且可走身旁一格）
 *   C 炮  ：横竖方向上「最近一个棋子」之后的任意一个敌方棋子都可吃
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xiangqi = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLS = 9;
  var ROWS = 10;
  var RED = 'r';
  var BLACK = 'b';

  var START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';

  var PIECE_NAMES = {
    r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
    b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' }
  };

  var TYPE_NAMES = { K: '将帅', A: '士仕', B: '象相', N: '马', R: '车', C: '炮', P: '兵卒' };

  /** 强化说明文案（UI 与规则面板共用）；short 用于技能按钮，desc 用于规则面板 */
  var SKILL_INFO = {
    P: {
      name: '兵/卒',
      icon: '兵',
      desc: '过河前也能左右横走，还可后退一格',
      short: '未过河也能左右走、可后退'
    },
    A: {
      name: '士/仕',
      icon: '士',
      desc: '可「出现」在任一己方棋子周围相邻一格的范围内：全盘可达、可离开九宫、也可吃子',
      short: '跳到任一己方棋子旁一格'
    },
    B: {
      name: '相/象',
      icon: '象',
      desc: '田字格内任意一步皆可走（含斜一格，不过河）',
      short: '田字格内皆可走'
    },
    N: {
      name: '马',
      icon: '马',
      desc: '日字格内皆可走：不再别马腿，还能走身旁一格',
      short: '不别马腿，可走身旁'
    },
    R: {
      name: '车',
      icon: '车',
      desc: '可沿斜线方向直线滑行（斜车）',
      short: '可沿斜线滑行'
    },
    C: {
      name: '炮',
      icon: '炮',
      desc: '可吃横竖方向上「最近一个棋子」之后的任意敌方棋子（不能越子擒王）',
      short: '可吃最近一子后任意子'
    },
    K: {
      name: '帅/将',
      icon: '帅',
      desc: '招降周围一格（含斜向）内的全部敌方棋子，立即生效、不消耗走子',
      short: '招降周围一格的敌子'
    }
  };

  var SKILL_ORDER = ['P', 'A', 'B', 'N', 'R', 'C', 'K'];

  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ORTHO = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  var KING_DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  /** 八方向（含斜向）——「周围一格」的定义 */
  var RING8 = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  // 马：dc, dr, 马腿 dc, 马腿 dr
  var HORSE_MOVES = [
    [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
    [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]
  ];

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function idx(c, r) { return r * COLS + c; }
  function colOf(i) { return i % COLS; }
  function rowOf(i) { return (i / COLS) | 0; }
  function inBoard(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }
  function colorOf(p) { return p ? (p === p.toUpperCase() ? RED : BLACK) : null; }
  function typeOf(p) { return p ? p.toUpperCase() : null; }
  function opponent(color) { return color === RED ? BLACK : RED; }
  function isRed(p) { return !!p && p === p.toUpperCase(); }

  function inPalace(color, c, r) {
    if (c < 3 || c > 5) return false;
    return color === RED ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  }

  function onOwnSide(color, r) {
    return color === RED ? r >= 5 : r <= 4;
  }

  function oppositeSide(color, r) {
    return !onOwnSide(color, r);
  }

  function pieceAt(state, c, r) {
    return inBoard(c, r) ? state.board[idx(c, r)] : null;
  }

  function findKing(state, color) {
    var target = color === RED ? 'K' : 'k';
    for (var i = 0; i < 90; i++) if (state.board[i] === target) return { c: colOf(i), r: rowOf(i), i: i };
    return null;
  }

  /* ------------------------------------------------------------------ *
   * FEN 解析（测试与摆棋很方便）
   * 例：'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b'
   * ------------------------------------------------------------------ */

  function fromFen(fen, options) {
    options = options || {};
    var parts = String(fen).trim().split(/\s+/);
    var rows = parts[0].split('/');
    var board = new Array(90).fill(null);
    for (var r = 0; r < ROWS; r++) {
      var line = rows[r] || '';
      var c = 0;
      for (var k = 0; k < line.length; k++) {
        var ch = line[k];
        if (ch >= '1' && ch <= '9') { c += Number(ch); }
        else { if (c < COLS) board[idx(c, r)] = ch; c++; }
      }
    }
    return {
      board: board,
      turn: parts[1] === 'b' ? BLACK : RED,
      plyCount: 0,
      uses: { r: options.uses == null ? 3 : options.uses, b: options.uses == null ? 3 : options.uses },
      enhance: { r: {}, b: {} },
      activatedThisTurn: false,
      lastMove: null,
      history: [],
      status: 'playing', // playing | over
      winner: null,
      reason: null,
      noCapturePly: 0,
      capturedBy: { r: [], b: [] }, // 被 r/b 方吃掉的棋子
      log: []
    };
  }

  function toFen(state) {
    var out = [];
    for (var r = 0; r < ROWS; r++) {
      var line = '';
      var empty = 0;
      for (var c = 0; c < COLS; c++) {
        var p = state.board[idx(c, r)];
        if (p) {
          if (empty) { line += empty; empty = 0; }
          line += p;
        } else empty++;
      }
      if (empty) line += empty;
      out.push(line);
    }
    return out.join('/') + ' ' + state.turn;
  }

  function createInitialState(options) {
    return fromFen(START_FEN, options);
  }

  /* ------------------------------------------------------------------ *
   * 强化状态
   * ------------------------------------------------------------------ */

  /** 该方该兵种当前是否处于强化状态 */
  function isEnhanced(state, color, type) {
    var until = state.enhance[color][type];
    return typeof until === 'number' && until > state.plyCount;
  }

  function activeEnhancements(state, color) {
    return SKILL_ORDER.filter(function (t) { return isEnhanced(state, color, t); });
  }

  function countPieces(state, color, type) {
    var n = 0;
    for (var i = 0; i < 90; i++) {
      var p = state.board[i];
      if (p && colorOf(p) === color && typeOf(p) === type) n++;
    }
    return n;
  }

  function canActivateSkill(state, color, type) {
    // 统一走 skillBlockReason，避免两处判断逻辑不一致
    return skillBlockReason(state, color, type) === '';
  }

  function skillBlockReason(state, color, type) {
    if (state.status !== 'playing') return '棋局已结束';
    if (state.turn !== color) return '还没轮到你';
    if (state.uses[color] <= 0) return '强化次数已用完';
    if (state.activatedThisTurn) return '本回合已经强化过了';
    if (!SKILL_INFO[type]) return '未知兵种';
    if (countPieces(state, color, type) <= 0) return '棋盘上已没有该兵种';
    if (type === 'K' && !hasConvertTargets(state, color)) return '将/帅周围一格内没有敌方棋子可招降';
    return '';
  }

  /**
   * 激活强化：消耗 1 次机会
   *  - 帅/将（K）：立即招降周围一格内的敌方棋子（即时生效，不需要走子，也不会维持一回合）
   *  - 其余兵种：走法强化，维持「一回合」= 自己本次行动 + 对手下一步
   */
  function activateSkill(state, color, type) {
    if (!canActivateSkill(state, color, type)) return { ok: false, reason: skillBlockReason(state, color, type) };
    pushHistory(state);
    state.uses[color] -= 1;
    state.activatedThisTurn = true;

    if (type === 'K') {
      var converted = convertAdjacent(state, color);
      var sideText = color === RED ? '红方' : '黑方';
      var names = converted.map(function (x) { return PIECE_NAMES[colorOf(x.from)][typeOf(x.from)]; }).join('、');
      state.log.push({
        side: color,
        kind: 'convert',
        type: 'K',
        converted: converted,
        text: sideText + ' ' + PIECE_NAMES[color].K + '招降 ' + names + '，临阵倒戈！'
      });
      return { ok: true, type: 'K', instant: true, converted: converted, remaining: state.uses[color] };
    }

    state.enhance[color][type] = state.plyCount + 2; // 到期时机
    state.log.push({ side: color, kind: 'skill', type: type, text: (color === RED ? '红方' : '黑方') + ' 发动【' + SKILL_INFO[type].name + '】强化！' });
    return { ok: true, type: type, remaining: state.uses[color] };
  }

  /* ------------------------------------------------------------------ *
   * 走法生成（伪合法 -> 合法）
   * ------------------------------------------------------------------ */

  function pushMove(out, seen, board, color, c, r, tc, tr, flag) {
    if (!inBoard(tc, tr)) return false;
    var key = tr * COLS + tc;
    var target = board[key];
    if (target && colorOf(target) === color) return false; // 自己的子，不能吃
    if (!seen[key]) {
      seen[key] = true;
      out.push({
        from: [c, r],
        to: [tc, tr],
        fromIdx: idx(c, r),
        toIdx: key,
        capture: target || null,
        flag: flag || 'normal'
      });
    }
    return !target; // 空格 -> 可继续滑行
  }

  /** (c,r) 周围一格内是否存在「己方棋子」（可排除某个坐标，例如士自己） */
  function hasFriendlyNeighbor(state, color, c, r, excludeC, excludeR) {
    for (var k = 0; k < RING8.length; k++) {
      var d = RING8[k];
      var tc = c + d[0], tr = r + d[1];
      if (!inBoard(tc, tr)) continue;
      if (tc === excludeC && tr === excludeR) continue;
      var p = state.board[idx(tc, tr)];
      if (p && colorOf(p) === color) return true;
    }
    return false;
  }

  /** 将/帅周围一格内是否有可招降的敌方棋子 */
  function hasConvertTargets(state, color) {
    var king = findKing(state, color);
    if (!king) return false;
    for (var k = 0; k < RING8.length; k++) {
      var d = RING8[k];
      var tc = king.c + d[0], tr = king.r + d[1];
      if (!inBoard(tc, tr)) continue;
      var p = state.board[idx(tc, tr)];
      if (p && colorOf(p) !== color && typeOf(p) !== 'K') return true;
    }
    return false;
  }

  /**
   * 招降：把将/帅周围一格（八方向）内的敌方棋子全部变为己方棋子
   * 只改颜色、不移动位置，因此不会让己方将帅陷入危险（只会减少受到的攻击）
   * @returns {Array} 被招降的棋子列表
   */
  function convertAdjacent(state, color) {
    var king = findKing(state, color);
    if (!king) return [];
    var converted = [];
    for (var k = 0; k < RING8.length; k++) {
      var d = RING8[k];
      var tc = king.c + d[0], tr = king.r + d[1];
      if (!inBoard(tc, tr)) continue;
      var i = idx(tc, tr);
      var p = state.board[i];
      if (!p) continue;
      if (colorOf(p) === color) continue;
      if (typeOf(p) === 'K') continue; // 双方将帅不可能相邻，防御性处理
      state.board[i] = color === RED ? p.toUpperCase() : p.toLowerCase();
      converted.push({ from: p, to: state.board[i], c: tc, r: tr, idx: i, type: typeOf(p) });
    }
    return converted;
  }

  /** 单个棋子的伪合法走法 */
  function genPieceMoves(state, c, r) {
    var board = state.board;
    var p = board[idx(c, r)];
    var out = [];
    if (!p) return out;
    var seen = Object.create(null);
    var color = colorOf(p);
    var type = typeOf(p);
    var enh = isEnhanced(state, color, type);
    var k, dir, tc, tr;

    var add = function (x, y, flag) { return pushMove(out, seen, board, color, c, r, x, y, flag); };

    switch (type) {
      case 'K': {
        for (k = 0; k < KING_DIRS.length; k++) {
          dir = KING_DIRS[k];
          tc = c + dir[0]; tr = r + dir[1];
          if (!inPalace(color, tc, tr)) continue;
          add(tc, tr, 'normal');
        }
        // 飞将（白脸将）：同列且中间无子，可直接吃对方将/帅
        var ek = findKing(state, opponent(color));
        if (ek && ek.c === c) {
          var step = ek.r > r ? 1 : -1;
          var blocked = false;
          for (var rr = r + step; rr !== ek.r; rr += step) if (board[idx(c, rr)]) { blocked = true; break; }
          if (!blocked) add(ek.c, ek.r, 'flying');
        }
        break;
      }
      case 'A': {
        for (k = 0; k < DIAG.length; k++) {
          dir = DIAG[k];
          tc = c + dir[0]; tr = r + dir[1];
          if (!inPalace(color, tc, tr)) continue;
          add(tc, tr, 'normal');
        }
        if (enh) {
          // 强化：可「出现」在任一己方棋子周围相邻一格的范围内（八方向，全盘可达，可离开九宫）
          // 注意：锚点不包含士自己，否则就退化成单纯的走一步
          for (var ai = 0; ai < 90; ai++) {
            if (ai === idx(c, r)) continue; // 不能原地不动
            var ac = colOf(ai), ar = rowOf(ai);
            if (!hasFriendlyNeighbor(state, color, ac, ar, c, r)) continue;
            add(ac, ar, 'enhanced');
          }
        }
        break;
      }
      case 'B': {
        for (k = 0; k < DIAG.length; k++) {
          dir = DIAG[k];
          tc = c + 2 * dir[0]; tr = r + 2 * dir[1];
          if (!inBoard(tc, tr) || !onOwnSide(color, tr)) continue;
          if (board[idx(c + dir[0], r + dir[1])]) continue; // 塞象眼
          add(tc, tr, 'normal');
        }
        if (enh) {
          // 田字格内任意一点：斜一格（无视象眼），斜二格仍然塞象眼
          for (k = 0; k < DIAG.length; k++) {
            dir = DIAG[k];
            tc = c + dir[0]; tr = r + dir[1];
            if (!inBoard(tc, tr) || !onOwnSide(color, tr)) continue;
            add(tc, tr, 'enhanced');
          }
        }
        break;
      }
      case 'N': {
        for (k = 0; k < HORSE_MOVES.length; k++) {
          var hm = HORSE_MOVES[k];
          tc = c + hm[0]; tr = r + hm[1];
          if (!inBoard(tc, tr)) continue;
          if (!enh && board[idx(c + hm[2], r + hm[3])]) continue; // 别马腿
          add(tc, tr, enh ? 'enhanced' : 'normal');
        }
        if (enh) {
          // 日字格内还包含身旁一格
          for (k = 0; k < DIAG.length; k++) {
            dir = DIAG[k];
            add(c + dir[0], r + dir[1], 'enhanced');
          }
          for (k = 0; k < KING_DIRS.length; k++) {
            dir = KING_DIRS[k];
            add(c + dir[0], r + dir[1], 'enhanced');
          }
        }
        break;
      }
      case 'R': {
        var rookDirs = enh ? ORTHO.concat(DIAG) : ORTHO; // 强化：可走斜线
        for (k = 0; k < rookDirs.length; k++) {
          dir = rookDirs[k];
          tc = c + dir[0]; tr = r + dir[1];
          while (inBoard(tc, tr)) {
            if (!add(tc, tr, enh && k >= ORTHO.length ? 'enhanced' : 'normal')) break;
            tc += dir[0]; tr += dir[1];
          }
        }
        break;
      }
      case 'C': {
        for (k = 0; k < ORTHO.length; k++) {
          dir = ORTHO[k];
          tc = c + dir[0]; tr = r + dir[1];
          // 1) 不吃子：沿直线走到第一个障碍前
          while (inBoard(tc, tr) && !board[idx(tc, tr)]) {
            add(tc, tr, 'normal');
            tc += dir[0]; tr += dir[1];
          }
          if (!inBoard(tc, tr)) continue;
          // 此时 (tc,tr) 就是该方向上「最近的一个棋子」，即炮架
          var sc = tc + dir[0], sr = tr + dir[1];
          // 2) 普通炮：越过炮架后第一个棋子，若是敌方可吃
          var xc = sc, xr = sr;
          while (inBoard(xc, xr)) {
            var t2 = board[idx(xc, xr)];
            if (t2) {
              if (colorOf(t2) !== color) add(xc, xr, 'jump');
              break;
            }
            xc += dir[0]; xr += dir[1];
          }
          // 3) 强化炮：炮架之后「任意一个」敌方棋子都能吃
          //    平衡性限制：不能越子擒王（否则开局一步即可隔子吃将，游戏失去意义）
          if (enh) {
            var yc = sc, yr = sr;
            while (inBoard(yc, yr)) {
              var t3 = board[idx(yc, yr)];
              if (t3 && colorOf(t3) !== color && typeOf(t3) !== 'K') add(yc, yr, 'super');
              yc += dir[0]; yr += dir[1];
            }
          }
        }
        break;
      }
      case 'P': {
        var fwd = color === RED ? -1 : 1;
        add(c, r + fwd, 'normal'); // 向前
        var crossed = oppositeSide(color, r); // 已过河
        if (crossed || enh) {
          add(c - 1, r, enh && !crossed ? 'enhanced' : 'normal');
          add(c + 1, r, enh && !crossed ? 'enhanced' : 'normal');
        }
        if (enh) add(c, r - fwd, 'enhanced'); // 强化后可后退一格
        break;
      }
      default:
        break;
    }
    return out;
  }

  function genPseudoMoves(state, color) {
    var out = [];
    for (var i = 0; i < 90; i++) {
      var p = state.board[i];
      if (p && colorOf(p) === color) {
        var ms = genPieceMoves(state, colOf(i), rowOf(i));
        for (var k = 0; k < ms.length; k++) out.push(ms[k]);
      }
    }
    return out;
  }

  /** 在临时棋盘上执行一步并回调（用于合法性判定） */
  function withMoveApplied(state, mv, fn) {
    var b = state.board;
    var from = mv.fromIdx != null ? mv.fromIdx : idx(mv.from[0], mv.from[1]);
    var to = mv.toIdx != null ? mv.toIdx : idx(mv.to[0], mv.to[1]);
    var moving = b[from];
    var target = b[to];
    b[to] = moving;
    b[from] = null;
    var res = fn();
    b[from] = moving;
    b[to] = target;
    return res;
  }

  /** 某一方的将/帅是否正被攻击 */
  function isKingAttacked(state, color) {
    var king = findKing(state, color);
    if (!king) return true;
    var enemy = opponent(color);
    var moves = genPseudoMoves(state, enemy);
    for (var i = 0; i < moves.length; i++) {
      if (!moves[i].capture) continue; // 只有能吃的走法才算攻击
      if (moves[i].toIdx === king.i) return true;
    }
    return false;
  }

  function isInCheck(state, color) { return isKingAttacked(state, color); }

  /** 该方所有合法走法 */
  function legalMoves(state, color) {
    var res = [];
    var pseudo = genPseudoMoves(state, color);
    for (var i = 0; i < pseudo.length; i++) {
      var mv = pseudo[i];
      if (withMoveApplied(state, mv, function () { return !isKingAttacked(state, color); })) res.push(mv);
    }
    return res;
  }

  function legalMovesFrom(state, c, r) {
    var p = pieceAt(state, c, r);
    if (!p) return [];
    var color = colorOf(p);
    if (color !== state.turn) return [];
    return genPieceMoves(state, c, r).filter(function (mv) {
      return withMoveApplied(state, mv, function () { return !isKingAttacked(state, color); });
    });
  }


  /* ------------------------------------------------------------------ *
   * 走子 / 悔棋
   * ------------------------------------------------------------------ */

  function snapshot(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      plyCount: state.plyCount,
      uses: { r: state.uses.r, b: state.uses.b },
      enhance: { r: Object.assign({}, state.enhance.r), b: Object.assign({}, state.enhance.b) },
      activatedThisTurn: state.activatedThisTurn,
      lastMove: state.lastMove,
      status: state.status,
      winner: state.winner,
      reason: state.reason,
      noCapturePly: state.noCapturePly,
      capturedBy: { r: state.capturedBy.r.slice(), b: state.capturedBy.b.slice() },
      log: state.log.slice()
    };
  }

  function pushHistory(state) { state.history.push(snapshot(state)); }

  function undo(state) {
    if (!state.history.length) return false;
    var s = state.history.pop();
    Object.assign(state, s);
    return true;
  }

  function canUndo(state) { return state.history.length > 0; }

  /**
   * 走一步棋
   * @returns {object} { ok, move, captured, check, checkmate, stalemate, winner, reason }
   */
  function makeMove(state, from, to) {
    if (state.status !== 'playing') return { ok: false, reason: '棋局已结束' };
    var color = state.turn;
    var fr = typeof from === 'object' ? from : { c: colOf(from), r: rowOf(from) };
    var toIdx = typeof to === 'object' ? idx(to.c, to.r) : to;
    var fromIdx = typeof from === 'object' ? idx(from.c, from.r) : from;
    var piece = state.board[fromIdx];
    if (!piece) return { ok: false, reason: '起点没有棋子' };
    if (colorOf(piece) !== color) return { ok: false, reason: '不能走对方的棋子' };

    var moves = legalMovesFrom(state, colOf(fromIdx), rowOf(fromIdx));
    var mv = null;
    for (var i = 0; i < moves.length; i++) if (moves[i].toIdx === toIdx) { mv = moves[i]; break; }
    if (!mv) return { ok: false, reason: '不合法的一步' };

    pushHistory(state);

    var captured = state.board[toIdx];
    var capturedColor = captured ? colorOf(captured) : null;
    var capturedType = captured ? typeOf(captured) : null;

    // 注意：着法描述必须在落子「之前」生成，否则「前/后」等同列判断会错
    var entry = {
      side: color,
      kind: 'move',
      from: [colOf(fromIdx), rowOf(fromIdx)],
      to: [colOf(toIdx), rowOf(toIdx)],
      piece: piece,
      captured: captured || null,
      flag: mv.flag,
      enhanced: !!isEnhanced(state, color, typeOf(piece)),
      text: ''
    };
    entry.text = describeMove(state, entry);

    state.board[toIdx] = piece;
    state.board[fromIdx] = null;

    if (captured) {
      state.capturedBy[color].push(captured);
      state.noCapturePly = 0;
    } else {
      state.noCapturePly += 1;
    }

    state.log.push(entry);

    state.lastMove = {
      from: [colOf(fromIdx), rowOf(fromIdx)],
      to: [colOf(toIdx), rowOf(toIdx)],
      piece: piece,
      captured: captured || null,
      side: color,
      flag: mv.flag
    };

    state.plyCount += 1;
    state.turn = opponent(color);
    state.activatedThisTurn = false;

    var result = {
      ok: true,
      move: state.lastMove,
      captured: captured || null,
      capturedType: capturedType,
      capturedColor: capturedColor,
      enhanced: entry.enhanced,
      check: false,
      checkmate: false,
      stalemate: false,
      winner: null,
      reason: null
    };

    // 吃掉对方将/帅（含飞将）
    if (capturedType === 'K') {
      state.status = 'over';
      state.winner = color;
      state.reason = 'capture-king';
      result.checkmate = true;
      result.winner = color;
      result.reason = 'capture-king';
      state.log.push({ side: color, kind: 'system', text: (color === RED ? '红方' : '黑方') + '获胜！' });
      return result;
    }

    var next = state.turn;
    var inCheck = isKingAttacked(state, next);
    result.check = inCheck;

    if (!legalMoves(state, next).length) {
      state.status = 'over';
      state.winner = color;
      state.reason = inCheck ? 'checkmate' : 'stalemate';
      result.checkmate = inCheck;
      result.stalemate = !inCheck;
      result.winner = color;
      result.reason = state.reason;
      state.log.push({ side: color, kind: 'system', text: inCheck ? '绝杀！' + (color === RED ? '红方' : '黑方') + '获胜' : '困毙！' + (color === RED ? '红方' : '黑方') + '获胜' });
      return result;
    }

    // 自然限着：60 回合（120 步）无吃子判和
    if (state.noCapturePly >= 120) {
      state.status = 'over';
      state.winner = null;
      state.reason = 'draw-60';
      result.reason = 'draw-60';
      state.log.push({ side: null, kind: 'system', text: '60 回合无吃子，判和棋' });
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * 中文着法描述
   * ------------------------------------------------------------------ */

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var CN_FULL = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];

  /** 记谱数字：红方用汉字，黑方用全角数字（与棋谱惯例一致） */
  function numText(color, n) { return (color === RED ? CN_NUM : CN_FULL)[n - 1]; }

  function fileNumber(color, c) { return color === RED ? 9 - c : c + 1; }

  function describeMove(state, entry) {
    var piece = entry.piece;
    var color = colorOf(piece);
    var type = typeOf(piece);
    var name = PIECE_NAMES[color][type];
    var fc = entry.from[0], fr = entry.from[1];
    var tc = entry.to[0], tr = entry.to[1];

    // 前/后 区分（同列同兵种）
    var prefix = '';
    var sameFile = [];
    for (var i = 0; i < 90; i++) {
      var p = state.board[i];
      if (p && colorOf(p) === color && typeOf(p) === type && colOf(i) === fc) sameFile.push(rowOf(i));
    }
    if (sameFile.length === 2) {
      sameFile.sort(function (a, b) { return a - b; });
      var isFront = color === RED ? fr === sameFile[0] : fr === sameFile[sameFile.length - 1];
      prefix = isFront ? '前' : '后';
    } else if (sameFile.length >= 3) {
      var sorted = sameFile.slice().sort(function (a, b) { return color === RED ? a - b : b - a; });
      var pos = sorted.indexOf(fr);
      prefix = pos === 0 ? '前' : (pos === sorted.length - 1 ? '后' : '中');
    }

    var fromFile = numText(color, fileNumber(color, fc));
    var body;
    if (type === 'A' && entry.flag === 'enhanced') {
      // 强化士是「跳到某处」，用「移」记谱更清楚
      body = prefix + name + fromFile + '移' + numText(color, fileNumber(color, tc));
    } else {
      var forward = color === RED ? (tr < fr) : (tr > fr);
      var action, target;
      if (tr === fr) {
        action = '平';
        target = numText(color, fileNumber(color, tc));
      } else {
        action = forward ? '进' : '退';
        if (type === 'N' || type === 'B' || type === 'A') target = numText(color, fileNumber(color, tc));
        else target = numText(color, Math.abs(tr - fr));
      }
      // 有「前/后」时按惯例省略原始纵线
      body = prefix
        ? prefix + name + action + target
        : name + fromFile + action + target;
    }

    var text = body;
    if (entry.flag === 'enhanced' || entry.flag === 'super') text += '（强化）';
    return text;
  }

  /* ------------------------------------------------------------------ *
   * 便捷查询（给 UI 用）
   * ------------------------------------------------------------------ */

  function gameState(state) {
    return {
      status: state.status,
      turn: state.turn,
      plyCount: state.plyCount,
      winner: state.winner,
      reason: state.reason,
      uses: { r: state.uses.r, b: state.uses.b },
      enhanced: { r: activeEnhancements(state, RED), b: activeEnhancements(state, BLACK) },
      checks: { r: isKingAttacked(state, RED), b: isKingAttacked(state, BLACK) },
      inCheck: state.status === 'playing' ? isKingAttacked(state, state.turn) : false
    };
  }

  return {
    COLS: COLS,
    ROWS: ROWS,
    RED: RED,
    BLACK: BLACK,
    START_FEN: START_FEN,
    PIECE_NAMES: PIECE_NAMES,
    TYPE_NAMES: TYPE_NAMES,
    SKILL_INFO: SKILL_INFO,
    SKILL_ORDER: SKILL_ORDER,
    idx: idx,
    colOf: colOf,
    rowOf: rowOf,
    inBoard: inBoard,
    colorOf: colorOf,
    typeOf: typeOf,
    opponent: opponent,
    inPalace: inPalace,
    onOwnSide: onOwnSide,
    pieceAt: pieceAt,
    findKing: findKing,
    fromFen: fromFen,
    toFen: toFen,
    createInitialState: createInitialState,
    isEnhanced: isEnhanced,
    activeEnhancements: activeEnhancements,
    countPieces: countPieces,
    hasFriendlyNeighbor: hasFriendlyNeighbor,
    hasConvertTargets: hasConvertTargets,
    convertAdjacent: convertAdjacent,
    canActivateSkill: canActivateSkill,
    skillBlockReason: skillBlockReason,
    activateSkill: activateSkill,
    genPieceMoves: genPieceMoves,
    genPseudoMoves: genPseudoMoves,
    legalMoves: legalMoves,
    legalMovesFrom: legalMovesFrom,
    isKingAttacked: isKingAttacked,
    isInCheck: isInCheck,
    makeMove: makeMove,
    undo: undo,
    canUndo: canUndo,
    pushHistory: pushHistory,
    snapshot: snapshot,
    describeMove: describeMove,
    gameState: gameState
  };
});

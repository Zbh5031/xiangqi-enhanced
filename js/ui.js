/*!
 * 界面逻辑：棋盘渲染 / 走子交互 / 强化技能 / 嘲讽与语音 / 音效
 */
(function () {
  'use strict';

  var X = window.Xiangqi;
  var T = window.Taunts;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ----------------------------- 几何常量 ----------------------------- */
  var CELL = 100, PAD = 60, VB_W = 920, VB_H = 1020;
  var R_PIECE = 43;
  function xOf(c) { return PAD + c * CELL; }
  function yOf(r) { return PAD + r * CELL; }
  function idxOf(c, r) { return X.idx(c, r); }

  /* ----------------------------- DOM ----------------------------- */
  var $ = function (id) { return document.getElementById(id); };
  var boardSvg = $('board');
  var layerMarks = $('layer-marks');
  var layerPieces = $('layer-pieces');
  var turnDot = $('turn-dot');
  var turnText = $('turn-text');
  var turnSub = $('turn-sub');
  var skillBar = $('skill-bar');
  var logList = $('log-list');
  var chatList = $('chat-list');
  var toastEl = $('toast');
  var modal = $('modal');
  var modalCard = $('modal-card');

  /* ----------------------------- 状态 ----------------------------- */
  var state = X.createInitialState();
  var selected = null;      // {c,r}
  var targets = [];         // 合法着法
  var elAt = new Map();     // idx -> SVG g
  var streak = { r: 0, b: 0 };
  var soundOn = true;
  var voiceOn = false;
  var busy = false;

  /* ==================================================================
   * 1. 棋盘静态图形
   * ================================================================== */
  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function markerPath(c, r) {
    var g = 13, len = 20;
    var x = xOf(c), y = yOf(r);
    var d = '';
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      var dx = p[0], dy = p[1];
      if (c + dx < 0 || c + dx > 8) return; // 棋盘外不画
      d += 'M' + (x + dx * g) + ' ' + (y + dy * g + dy * len) +
           'L' + (x + dx * g) + ' ' + (y + dy * g) +
           'L' + (x + dx * g + dx * len) + ' ' + (y + dy * g);
    });
    return d;
  }

  function buildBoard() {
    var staticLayer = $('layer-board');
    // 底板
    el('rect', { x: 0, y: 0, width: VB_W, height: VB_H, fill: 'url(#boardBg)', rx: 10 }, staticLayer);

    // 横线 10 条
    for (var r = 0; r < 10; r++) {
      el('line', { x1: xOf(0), y1: yOf(r), x2: xOf(8), y2: yOf(r), class: 'grid-line' }, staticLayer);
    }
    // 竖线：边线贯通，其余在楚河汉界处断开
    [0, 8].forEach(function (c) {
      el('line', { x1: xOf(c), y1: yOf(0), x2: xOf(c), y2: yOf(9), class: 'grid-line' }, staticLayer);
    });
    for (var c2 = 1; c2 <= 7; c2++) {
      el('line', { x1: xOf(c2), y1: yOf(0), x2: xOf(c2), y2: yOf(4), class: 'grid-line' }, staticLayer);
      el('line', { x1: xOf(c2), y1: yOf(5), x2: xOf(c2), y2: yOf(9), class: 'grid-line' }, staticLayer);
    }
    // 九宫斜线
    el('line', { x1: xOf(3), y1: yOf(0), x2: xOf(5), y2: yOf(2), class: 'grid-line' }, staticLayer);
    el('line', { x1: xOf(5), y1: yOf(0), x2: xOf(3), y2: yOf(2), class: 'grid-line' }, staticLayer);
    el('line', { x1: xOf(3), y1: yOf(7), x2: xOf(5), y2: yOf(9), class: 'grid-line' }, staticLayer);
    el('line', { x1: xOf(5), y1: yOf(7), x2: xOf(3), y2: yOf(9), class: 'grid-line' }, staticLayer);

    // 楚河汉界
    el('text', { x: (xOf(1) + xOf(3)) / 2, y: yOf(4) + 62, class: 'river-text' }, staticLayer).textContent = '楚 河';
    el('text', { x: (xOf(5) + xOf(7)) / 2, y: yOf(4) + 62, class: 'river-text' }, staticLayer).textContent = '漢 界';

    // 兵炮位标记
    [[1, 2], [7, 2], [1, 7], [7, 7]].forEach(function (p) {
      el('path', { d: markerPath(p[0], p[1]), class: 'marker' }, staticLayer);
    });
    [0, 2, 4, 6, 8].forEach(function (c3) {
      el('path', { d: markerPath(c3, 3), class: 'marker' }, staticLayer);
      el('path', { d: markerPath(c3, 6), class: 'marker' }, staticLayer);
    });

    // 坐标：红方（下方）九八七…一，黑方（上方）１２３…９
    var RED_FILE = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
    var BLACK_FILE = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];
    for (var i = 0; i < 9; i++) {
      el('text', { x: xOf(i), y: VB_H - 14, class: 'coord' }, staticLayer).textContent = RED_FILE[i];
      el('text', { x: xOf(i), y: 34, class: 'coord' }, staticLayer).textContent = BLACK_FILE[i];
    }
  }

  /* ==================================================================
   * 2. 棋子渲染
   * ================================================================== */
  function pieceGroup(piece, c, r) {
    var color = X.colorOf(piece);
    var g = el('g', { class: 'piece ' + (color === 'r' ? 'red' : 'black'), transform: 'translate(' + xOf(c) + ',' + yOf(r) + ')' });
    el('circle', { r: R_PIECE, class: 'disc' }, g);
    el('circle', { r: R_PIECE - 6, class: 'disc-inner' }, g);
    el('circle', { r: R_PIECE + 5, class: 'enh-ring' }, g);
    var t = el('text', { class: 'glyph', 'text-anchor': 'middle', dy: '0.36em' }, g);
    t.textContent = X.PIECE_NAMES[color][X.typeOf(piece)];
    g.dataset.piece = piece;
    return g;
  }

  function rebuildPieces() {
    layerPieces.textContent = '';
    elAt = new Map();
    for (var i = 0; i < 90; i++) {
      var p = state.board[i];
      if (!p) continue;
      var g = pieceGroup(p, X.colOf(i), X.rowOf(i));
      g.dataset.idx = String(i);
      layerPieces.appendChild(g);
      elAt.set(i, g);
    }
    markEnhanced();
  }

  function markEnhanced() {
    for (var i = 0; i < 90; i++) {
      var p = state.board[i];
      var g = elAt.get(i);
      if (!g) continue;
      var enh = p && X.isEnhanced(state, X.colorOf(p), X.typeOf(p));
      g.classList.toggle('enhanced', !!enh);
    }
  }

  function movePieceOnBoard(fromIdx, toIdx) {
    var g = elAt.get(fromIdx);
    var capEl = elAt.get(toIdx);
    if (capEl) {
      capEl.classList.add('captured');
      setTimeout(function () { if (capEl.parentNode) capEl.parentNode.removeChild(capEl); }, 340);
      elAt.delete(toIdx);
    }
    if (!g) { rebuildPieces(); return; }
    var to = { c: X.colOf(toIdx), r: X.rowOf(toIdx) };
    g.setAttribute('transform', 'translate(' + xOf(to.c) + ',' + yOf(to.r) + ')');
    g.classList.add('moved');
    setTimeout(function () { g.classList.remove('moved'); }, 300);
    elAt.delete(fromIdx);
    elAt.set(toIdx, g);
    g.dataset.idx = String(toIdx);
  }

  /* ==================================================================
   * 3. 高亮标记
   * ================================================================== */
  function addMarkerCircle(c, r, cls) {
    return el('circle', { cx: xOf(c), cy: yOf(r), r: cls === 'target-dot' ? 13 : R_PIECE + 4, class: cls }, layerMarks);
  }

  function renderMarks() {
    layerMarks.textContent = '';
    var last = state.lastMove;
    if (last) {
      [[last.from, 'last-from'], [last.to, 'last-to']].forEach(function (item) {
        var p = item[0];
        el('rect', {
          x: xOf(p[0]) - R_PIECE - 6, y: yOf(p[1]) - R_PIECE - 6,
          width: (R_PIECE + 6) * 2, height: (R_PIECE + 6) * 2, rx: 12,
          class: 'mark ' + item[1]
        }, layerMarks);
      });
    }
    // 将军
    var gs = X.gameState(state);
    ['r', 'b'].forEach(function (side) {
      if (!gs.checks[side]) return;
      var k = X.findKing(state, side);
      if (k) addMarkerCircle(k.c, k.r, 'mark check-mark');
    });
    if (selected) addMarkerCircle(selected.c, selected.r, 'mark selected-mark');
    targets.forEach(function (mv) {
      addMarkerCircle(mv.to[0], mv.to[1], mv.capture ? 'mark capture-mark' : 'target-dot');
    });
  }

  /* ==================================================================
   * 4. 侧栏 / 技能栏 / 记录
   * ================================================================== */
  function sideName(s) { return s === 'r' ? '红方' : '黑方'; }

  function renderPlayers() {
    ['r', 'b'].forEach(function (side) {
      var usesEl = $('uses-' + side);
      usesEl.textContent = '';
      var remain = state.uses[side];
      for (var i = 0; i < 3; i++) {
        var d = document.createElement('i');
        d.className = 'dot' + (i < remain ? '' : ' used');
        usesEl.appendChild(d);
      }
      var label = document.createElement('span');
      label.className = 'uses-text';
      label.textContent = '剩余 ' + remain + ' 次';
      usesEl.appendChild(label);

      var enhEl = $('enh-' + side);
      enhEl.textContent = '';
      var act = X.activeEnhancements(state, side);
      if (!act.length) {
        enhEl.innerHTML = '<span class="muted">暂无强化</span>';
      } else {
        act.forEach(function (t) {
          var b = document.createElement('span');
          b.className = 'enh-badge';
          b.textContent = X.SKILL_INFO[t].icon + ' 强化中（本回合）';
          enhEl.appendChild(b);
        });
      }
      var capEl = $('cap-' + side);
      capEl.textContent = '';
      var list = state.capturedBy[side];
      if (!list.length) {
        capEl.innerHTML = '<span class="muted">尚未吃子</span>';
      } else {
        list.forEach(function (p) {
          var s = document.createElement('span');
          s.className = 'cap-piece ' + (X.colorOf(p) === 'r' ? 'red' : 'black');
          s.textContent = X.PIECE_NAMES[X.colorOf(p)][X.typeOf(p)];
          capEl.appendChild(s);
        });
      }
    });
    ['r', 'b'].forEach(function (side) {
      var active = state.turn === side && state.status === 'playing';
      $('card-' + side).classList.toggle('active', active);
      $('tag-' + side).textContent = state.status !== 'playing'
        ? (state.winner === side ? '获胜' : (state.winner ? '落败' : '和棋'))
        : (active ? '行棋中' : '等待');
    });
  }

  function renderTurn() {
    var gs = X.gameState(state);
    var side = state.turn;
    turnDot.className = 'turn-dot ' + (side === 'r' ? 'red' : 'black');
    if (state.status !== 'playing') {
      turnText.textContent = state.winner ? sideName(state.winner) + '获胜' : '和棋';
      turnSub.textContent = state.reason === 'checkmate' ? '绝杀！' :
        state.reason === 'stalemate' ? '困毙！' :
        state.reason === 'capture-king' ? '擒王！' : '60 回合无吃子';
      return;
    }
    turnText.textContent = sideName(side) + '行棋';
    if (gs.checks[side]) turnSub.textContent = '被将军！必须应将';
    else if (state.activatedThisTurn) turnSub.textContent = '本回合已发动强化，请走子';
    else turnSub.textContent = '点击棋子选择，再点目标落子';
  }

  function renderSkills() {
    skillBar.textContent = '';
    var side = state.turn;
    X.SKILL_ORDER.forEach(function (type) {
      var info = X.SKILL_INFO[type];
      var btn = document.createElement('button');
      btn.className = 'skill-btn';
      var enh = X.isEnhanced(state, side, type);
      if (enh) btn.classList.add('active');
      var blocked = !X.canActivateSkill(state, side, type);
      if (blocked && !enh) btn.classList.add('disabled');
      btn.innerHTML =
        '<span class="sk-icon ' + (side === 'r' ? 'red' : 'black') + '">' + X.PIECE_NAMES[side][type] + '</span>' +
        '<span class="sk-body"><b>' + info.name + '</b><small>' + (info.short || info.desc) + '</small></span>' +
        '<span class="sk-count">' + state.uses[side] + '次</span>';
      btn.title = blocked ? X.skillBlockReason(state, side, type) : ('发动【' + info.name + '】强化：' + info.desc);
      btn.disabled = blocked;
      btn.addEventListener('click', function () { activate(type); });
      skillBar.appendChild(btn);
    });
    var tip = document.createElement('div');
    tip.className = 'skill-tip';
    tip.textContent = '每方 3 次；招降即时生效，其余维持一回合';
    skillBar.appendChild(tip);
  }

  function renderLog() {
    logList.textContent = '';
    var moveNo = 0;
    state.log.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'log-row' + (item.kind === 'skill' ? ' skill-log' : '') + (item.kind === 'system' ? ' sys-log' : '');
      var num = document.createElement('span');
      num.className = 'log-no';
      var txt = document.createElement('span');
      txt.className = 'log-text ' + (item.side === 'r' ? 'red' : item.side === 'b' ? 'black' : '');
      if (item.kind === 'move') {
        moveNo += 1;
        num.textContent = String(moveNo);
        var cap = item.captured ? ' 吃' + X.PIECE_NAMES[X.colorOf(item.captured)][X.typeOf(item.captured)] : '';
        txt.textContent = (item.side === 'r' ? '红 ' : '黑 ') + item.text + cap;
      } else {
        num.textContent = '·';
        txt.textContent = item.text;
      }
      row.appendChild(num);
      row.appendChild(txt);
      logList.appendChild(row);
    });
    logList.scrollTop = logList.scrollHeight;
  }

  var messages = [];
  function pushMessage(side, text, tone) {
    messages.push({ side: side, text: text, tone: tone || '' });
    renderChat();
  }

  function renderChat() {
    chatList.textContent = '';
    if (!messages.length) {
      chatList.innerHTML = '<div class="muted chat-empty">吃掉对方棋子时会自动发送一句嘲讽～</div>';
      return;
    }
    messages.slice(-40).forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'bubble-row ' + (m.side === 'r' ? 'left' : 'right');
      var b = document.createElement('div');
      b.className = 'bubble ' + (m.side === 'r' ? 'red' : 'black') + ' tone-' + m.tone;
      b.textContent = m.text;
      var who = document.createElement('div');
      who.className = 'bubble-who';
      who.textContent = sideName(m.side);
      row.appendChild(who);
      row.appendChild(b);
      chatList.appendChild(row);
    });
    chatList.scrollTop = chatList.scrollHeight;
  }

  function render() {
    renderMarks();
    markEnhanced();
    renderPlayers();
    renderTurn();
    renderSkills();
    renderLog();
  }

  /* ==================================================================
   * 5. 交互：点击落子
   * ================================================================== */
  function clickToSquare(evt) {
    var rc = boardSvg.getBoundingClientRect();
    var vb = (boardSvg.viewBox && boardSvg.viewBox.baseVal) || { width: VB_W, height: VB_H };
    // preserveAspectRatio="xMidYMid meet"：先算实际缩放与居中偏移，保证点击落点精确
    var s = Math.min(rc.width / vb.width, rc.height / vb.height);
    var ox = (rc.width - vb.width * s) / 2;
    var oy = (rc.height - vb.height * s) / 2;
    var bx = (evt.clientX - rc.left - ox) / s;
    var by = (evt.clientY - rc.top - oy) / s;
    var c = Math.round((bx - PAD) / CELL);
    var r = Math.round((by - PAD) / CELL);
    if (c < 0 || c > 8 || r < 0 || r > 9) return null;
    return { c: c, r: r };
  }

  function onBoardClick(evt) {
    if (busy || state.status !== 'playing') return;
    var sq = clickToSquare(evt);
    if (!sq) { clearSelection(); return; }
    var piece = X.pieceAt(state, sq.c, sq.r);
    var mv = targets.filter(function (m) { return m.to[0] === sq.c && m.to[1] === sq.r; })[0];

    if (mv) { doMove(selected, sq, mv); return; }
    if (piece && X.colorOf(piece) === state.turn) {
      if (selected && selected.c === sq.c && selected.r === sq.r) { clearSelection(); return; }
      select(sq.c, sq.r);
      return;
    }
    if (piece) toast('轮到' + sideName(state.turn) + '走棋哦');
    clearSelection();
  }

  function select(c, r) {
    selected = { c: c, r: r };
    targets = X.legalMovesFrom(state, c, r);
    renderMarks();
  }

  function clearSelection() {
    selected = null;
    targets = [];
    renderMarks();
  }

  /* ==================================================================
   * 6. 落子 / 悔棋 / 新局
   * ================================================================== */
  function doMove(from, to, mv) {
    var fromIdx = idxOf(from.c, from.r);
    var toIdx = idxOf(to.c, to.r);
    var side = state.turn;
    var res = X.makeMove(state, fromIdx, toIdx);
    if (!res.ok) { toast(res.reason || '不能这样走'); return; }

    clearSelection();
    movePieceOnBoard(fromIdx, toIdx);
    render();
    sound(res.captured ? 'capture' : 'move');
    if (res.check) setTimeout(function () { sound('check'); }, 260);

    // 连吃统计：吃子方 +1，被吃方清零
    if (res.captured) {
      streak[side] += 1;
      streak[X.opponent(side)] = 0;
    }

    var taunt = T.build({
      capturedType: res.capturedType,
      capturerSide: side,
      isCheck: res.check,
      isMate: res.checkmate,
      isStalemate: res.stalemate,
      streak: streak[side],
      enhanced: res.enhanced
    });
    if (taunt) {
      pushMessage(side, taunt.text, taunt.tone);
      showTaunt(side, taunt.text, taunt.tone);
      if (voiceOn) T.speak(taunt.text.replace(/（.*?）/g, ''), { pitch: side === 'r' ? 1.15 : 0.85 });
      if (taunt.tone === 'mate') sound('win');
    }

    if (state.status !== 'playing') setTimeout(showResult, 700);
  }

  function showTaunt(side, text, tone) {
    var t = document.createElement('div');
    t.className = 'taunt-float tone-' + tone + ' ' + (side === 'r' ? 'from-red' : 'from-black');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 1500);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
  }

  function activate(type) {
    if (busy || state.status !== 'playing') return;
    var side = state.turn;
    var res = X.activateSkill(state, side, type);
    if (!res.ok) { toast(res.reason); return; }
    sound('skill');
    var info = X.SKILL_INFO[type];

    // 帅/将：招降为即时效果——棋子改旗易帜，需要重建棋子
    if (res.instant) {
      rebuildPieces();
      res.converted.forEach(function (x, i) {
        setTimeout(function () {
          var g = elAt.get(x.idx);
          if (g) {
            g.classList.add('converted');
            setTimeout(function () { g.classList.remove('converted'); }, 900);
          }
          burstAt(x.c, x.r);
        }, 70 * i);
      });
      render();
      setTimeout(function () { sound('convert'); }, 80);
      var names = res.converted.map(function (x) {
        return X.PIECE_NAMES[X.colorOf(x.from)][X.typeOf(x.from)];
      }).join('、');
      toast(sideName(side) + '【' + info.name + '】招降成功：' + names + ' 临阵倒戈！', 2800);
      var taunt = T.build({ isConvert: true, count: res.converted.length });
      if (taunt) {
        pushMessage(side, taunt.text, taunt.tone);
        showTaunt(side, taunt.text, taunt.tone);
        if (voiceOn) T.speak(taunt.text.replace(/（.*?）/g, ''), { pitch: side === 'r' ? 1.15 : 0.85 });
      }
      return;
    }

    markEnhanced();
    render();
    toast(sideName(side) + ' 发动【' + info.name + '】强化：' + info.desc + '（仅本回合）', 2600);
    var msg = '【强化】' + info.name + '：' + info.desc;
    pushMessage(side, msg, 'skill');
    if (voiceOn) T.speak(sideName(side) + '发动' + info.name + '强化', { pitch: side === 'r' ? 1.15 : 0.85 });
  }

  /** 招降时的金色扩散特效 */
  function burstAt(c, r) {
    var circle = el('circle', { cx: xOf(c), cy: yOf(r), r: 10, class: 'convert-burst' }, layerMarks);
    setTimeout(function () { if (circle.parentNode) circle.parentNode.removeChild(circle); }, 800);
  }

  function undoOne() {
    if (busy) return;
    if (!X.undo(state)) { toast('没有可以悔棋的步骤'); return; }
    clearSelection();
    rebuildPieces();
    render();
    sound('undo');
  }

  function newGame() {
    state = X.createInitialState();
    selected = null;
    targets = [];
    streak = { r: 0, b: 0 };
    messages = [];
    layerMarks.textContent = '';
    rebuildPieces();
    render();
    renderChat();
    closeModal();
    toast('新对局开始，红先行！');
  }

  /* ==================================================================
   * 7. 弹窗 / 提示 / 音效
   * ================================================================== */
  function showResult() {
    var win = state.winner;
    var title = win ? sideName(win) + '获胜！' : '和棋';
    var sub = state.reason === 'checkmate' ? '绝杀：对方已无路可走' :
      state.reason === 'stalemate' ? '困毙：对方虽未被将军，但已无子可动' :
      state.reason === 'capture-king' ? '擒王：直接吃掉了对方的将/帅' : '60 回合内无吃子，判和';
    modalCard.innerHTML =
      '<h2 class="' + (win === 'r' ? 'win-red' : win === 'b' ? 'win-black' : '') + '">' + title + '</h2>' +
      '<p>' + sub + '</p>' +
      '<div class="modal-actions">' +
      '<button class="btn primary" data-act="new">再来一局</button>' +
      '<button class="btn" data-act="undo">悔棋一步</button>' +
      '<button class="btn ghost" data-act="close">看看棋盘</button>' +
      '</div>';
    modal.classList.add('show');
  }

  function showRules() {
    var rows = X.SKILL_ORDER.map(function (t) {
      var i = X.SKILL_INFO[t];
      return '<li><b>' + X.PIECE_NAMES.r[t] + ' / ' + X.PIECE_NAMES.b[t] + '</b><span>' + i.desc + '</span></li>';
    }).join('');
    modalCard.innerHTML =
      '<h2>强化规则</h2>' +
      '<ul class="rules">' + rows + '</ul>' +
      '<div class="rule-note">' +
      '<p><b>次数与时效：</b>每位玩家每局共有 <b>3 次</b>强化机会，可自由分配给任意兵种；发动后该兵种的所有棋子获得强化，但<b>只维持一回合</b>（本方这一步 + 对方下一步），到本方下次行动时自动失效。</p>' +
      '<p><b>帅/将 招降：</b>属于<b>即时效果</b>，发动瞬间结算，不占用走子、也不维持回合。招降只改变棋子的归属（颜色），不会移动位置，因此一定能解掉贴身的将军。</p>' +
      '<p><b>关于九宫：</b>士/仕强化后可离开九宫，只要落点紧邻任一己方棋子即可（锚点不含士自己）。</p>' +
      '<p><b>一回合一次：</b>同一回合内只能发动一次强化，且只能在自己行棋时发动（发动不算走子）。</p>' +
      '<p><b>嘲讽：</b>每次吃掉对方棋子（以及招降成功）都会自动向对手发送一句嘲讽，可开启语音朗读。</p>' +
      '<p><b>胜利条件：</b>绝杀、困毙，或直接吃掉对方的将/帅。</p>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn primary" data-act="close">知道了</button></div>';
    modal.classList.add('show');
  }

  function closeModal() { modal.classList.remove('show'); }

  function confirmNewGame() {
    modalCard.innerHTML =
      '<h2>开始新对局？</h2>' +
      '<p>当前棋局进度将会丢失。</p>' +
      '<div class="modal-actions">' +
      '<button class="btn primary" data-act="new-ok">确定，重新开局</button>' +
      '<button class="btn ghost" data-act="close">取消</button>' +
      '</div>';
    modal.classList.add('show');
  }

  var toastTimer = null;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 1800);
  }

  /* 用 WebAudio 合成音效，免外部资源 */
  var actx = null;
  function beep(freq, dur, type, gain, delay) {
    if (!actx) return;
    var t0 = actx.currentTime + (delay || 0);
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.15, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function sound(kind) {
    if (!soundOn) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { return; }
    if (kind === 'move') beep(520, 0.07, 'triangle', 0.12);
    else if (kind === 'capture') { beep(320, 0.09, 'square', 0.13); beep(180, 0.14, 'square', 0.12, 0.06); }
    else if (kind === 'skill') { [660, 880, 1180].forEach(function (f, i) { beep(f, 0.12, 'sine', 0.1, i * 0.07); }); }
    else if (kind === 'convert') { [1180, 880, 660, 990].forEach(function (f, i) { beep(f, 0.16, 'triangle', 0.11, i * 0.1); }); }
    else if (kind === 'undo') beep(300, 0.08, 'sine', 0.1);
    else if (kind === 'win') { [523, 659, 784, 1046].forEach(function (f, i) { beep(f, 0.18, 'triangle', 0.12, i * 0.12); }); }
    else if (kind === 'check') beep(880, 0.12, 'sawtooth', 0.09);
  }

  /* ==================================================================
   * 8. 事件绑定 & 启动
   * ================================================================== */
  function bind() {
    boardSvg.addEventListener('click', onBoardClick);
    $('btn-new').addEventListener('click', function () {
      if (state.log.length && state.status === 'playing') { confirmNewGame(); return; }
      newGame();
    });
    $('btn-undo').addEventListener('click', undoOne);
    $('btn-rules').addEventListener('click', showRules);
    $('btn-sound').addEventListener('click', function () {
      soundOn = !soundOn;
      this.classList.toggle('off', !soundOn);
      this.textContent = soundOn ? '🔊 音效' : '🔇 静音';
      if (soundOn) sound('move');
    });
    $('btn-voice').addEventListener('click', function () {
      voiceOn = !voiceOn;
      this.classList.toggle('off', !voiceOn);
      this.textContent = voiceOn ? '🗣 语音朗读' : '🤐 语音关';
      if (voiceOn) T.speak('语音已开启，准备接受嘲讽吧', { rate: 1.1 });
    });
    modal.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act && e.target === modal) { closeModal(); return; }
      if (act === 'new') newGame();
      else if (act === 'new-ok') newGame();
      else if (act === 'undo') { closeModal(); undoOne(); }
      else if (act === 'close') closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { clearSelection(); closeModal(); }
      if (e.key === 'u' || e.key === 'U') undoOne();
      if (e.key === 'n' || e.key === 'N') newGame();
    });
  }

  buildBoard();
  bind();
  rebuildPieces();
  renderChat();
  render();
  toast('红先行！点击棋子查看可走位置');
})();

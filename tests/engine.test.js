/*!
 * 引擎单元测试（node tests/engine.test.js）
 * 基础规则的部分结论已与中国象棋官方棋库（chessdb.cn 开局 44 着）核对一致
 */
var X = require('../js/engine.js');

var pass = 0, fail = 0;
var failures = [];

function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.log('  \u2717 ' + label); }
}
function eq(actual, expected, label) {
  var good = JSON.stringify(actual) === JSON.stringify(expected);
  if (good) pass++;
  else {
    fail++; failures.push(label);
    console.log('  \u2717 ' + label + '\n      期望: ' + JSON.stringify(expected) + '\n      实际: ' + JSON.stringify(actual));
  }
}
function section(t) { console.log('\n> ' + t); }

function movesFrom(state, c, r) { return X.legalMovesFrom(state, c, r); }
function dst(moves) { return moves.map(function (m) { return m.to[0] + ',' + m.to[1]; }).sort(); }
function has(moves, c, r) { return moves.some(function (m) { return m.to[0] === c && m.to[1] === r; }); }
function cap(moves, c, r) {
  var m = moves.filter(function (x) { return x.to[0] === c && x.to[1] === r; })[0];
  return m ? m.capture : undefined;
}
function forceSkill(state, color, type) {
  state.uses[color] = state.uses[color] || 3;
  state.enhance[color][type] = state.plyCount + 2;
}

/* ------------------------------------------------------------------ */
section('1. 基础：初始局面');
/* ------------------------------------------------------------------ */
var s = X.createInitialState();
eq(s.board.filter(function (p) { return p; }).length, 32, '初始 32 个棋子');
eq(s.turn, 'r', '红先行');
eq(X.toFen(s), X.START_FEN + ' r', '起始 FEN 往返一致');
eq(X.legalMoves(s, 'r').length, 44, '红方开局合法着法数 = 44（与官方棋库一致）');
eq(dst(movesFrom(s, 1, 9)), ['0,7', '2,7'].sort(), '开局马有两个着法');
eq(dst(movesFrom(s, 1, 7)).length, 12, '开局单只炮有 12 个着法');
eq(cap(movesFrom(s, 1, 7), 1, 0), 'n', '炮以黑炮(1,2)为架，越子吃黑马(1,0)（炮八进七）');
eq(cap(movesFrom(s, 1, 7), 4, 0), undefined, '炮不能越过两个子吃将');
ok(X.isInCheck(s, 'r') === false, '开局红方不被将军');
ok(X.isInCheck(s, 'b') === false, '开局黑方不被将军');

/* ------------------------------------------------------------------ */
section('2. 兵/卒');
/* ------------------------------------------------------------------ */
// 未过河（黑将放在(3,0)，避免双将照面干扰）
var sp = X.fromFen('3k5/9/9/9/9/9/4P4/9/9/4K4 r');
eq(dst(movesFrom(sp, 4, 6)), ['4,5'], '未过河的兵只能向前一步');
// 过河后
var sp2 = X.fromFen('3k5/9/9/9/4P4/9/9/9/9/4K4 r');
eq(dst(movesFrom(sp2, 4, 4)), ['3,4', '4,3', '5,4'].sort(), '过河的兵可向前和左右');
// 强化：未过河也能左右 + 后退
forceSkill(sp, 'r', 'P');
eq(dst(movesFrom(sp, 4, 6)), ['3,6', '4,5', '4,7', '5,6'].sort(), '强化兵未过河可左右、可后退');
ok(!has(movesFrom(sp, 4, 6), 4, 8), '强化兵不能连退两步');
ok(!has(movesFrom(sp, 4, 6), 3, 5), '强化兵不能斜走');
// 强化按兵种生效：另一只兵同样获得强化
var sp4 = X.fromFen('3k5/9/9/9/9/9/P1P1P1P1P/9/9/4K4 r');
forceSkill(sp4, 'r', 'P');
eq(dst(movesFrom(sp4, 0, 6)).length, 3, '强化后左翼兵也能左右走');
eq(dst(movesFrom(sp4, 8, 6)).length, 3, '强化后右翼兵也能左右走');
ok(!X.canActivateSkill(sp4, 'b', 'P') && X.canActivateSkill(sp4, 'r', 'P'), '强化按兵种/按方生效');
// 己方棋子占位不能走
var sp5 = X.fromFen('3k5/9/9/9/9/9/4P4/4P4/9/4K4 r');
forceSkill(sp5, 'r', 'P');
ok(!has(movesFrom(sp5, 4, 6), 4, 7), '强化兵不能后退吃己方棋子');

/* ------------------------------------------------------------------ */
section('3. 车');
/* ------------------------------------------------------------------ */
var sr = X.fromFen('3k5/9/9/9/9/9/4R4/9/9/4K4 r');
eq(dst(movesFrom(sr, 4, 6)).length, 16, '普通车 16 个着法（四方向直线）');
ok(!has(movesFrom(sr, 4, 6), 5, 5), '普通车不能斜走');
forceSkill(sr, 'r', 'R');
var rMoves = movesFrom(sr, 4, 6);
ok(has(rMoves, 5, 5) && has(rMoves, 3, 7) && has(rMoves, 5, 7) && has(rMoves, 3, 5), '强化车可斜走四个方向');
eq(rMoves.filter(function (m) { return m.flag === 'enhanced'; }).length, 14, '强化车新增 14 个斜线着法');
// 斜线吃子
var sr2 = X.fromFen('3k5/9/9/9/2p6/9/4R4/9/9/4K4 r');
ok(!has(movesFrom(sr2, 4, 6), 2, 4), '普通车不能斜线吃子');
forceSkill(sr2, 'r', 'R');
eq(cap(movesFrom(sr2, 4, 6), 2, 4), 'p', '强化车可斜线吃子');
// 斜线会被挡住（(3,5) 是斜线第一个子，(2,4) 被挡住）
var sr3 = X.fromFen('3k5/9/9/9/2p6/3p5/4R4/9/9/4K4 r');
forceSkill(sr3, 'r', 'R');
eq(cap(movesFrom(sr3, 4, 6), 2, 4), undefined, '斜线被第一个子挡住时不能吃后面的子');
eq(cap(movesFrom(sr3, 4, 6), 3, 5), 'p', '强化车可吃斜线上第一个子');

/* ------------------------------------------------------------------ */
section('4. 相/象');
/* ------------------------------------------------------------------ */
var sb = X.fromFen('3k5/9/9/9/9/9/9/9/9/2B1K4 r');
eq(dst(movesFrom(sb, 2, 9)), ['0,7', '4,7'].sort(), '普通相走两个田字');
forceSkill(sb, 'r', 'B');
eq(dst(movesFrom(sb, 2, 9)), ['0,7', '1,8', '3,8', '4,7'].sort(), '强化相在田字格内可走斜一格');
// 象眼被塞：斜二格不能走，但斜一格可以吃
var sb2 = X.fromFen('3k5/9/9/9/9/9/9/9/3p5/2B1K4 r');
forceSkill(sb2, 'r', 'B');
var bMoves = movesFrom(sb2, 2, 9);
ok(!has(bMoves, 4, 7), '象眼被塞时不能走斜二格');
ok(has(bMoves, 3, 8), '强化相可斜一格吃子（不看象眼）');
eq(cap(bMoves, 3, 8), 'p', '强化相斜一格吃到卒');
// 不可过河
var sb3 = X.fromFen('3k5/9/9/9/9/2B6/9/9/9/4K4 r');
forceSkill(sb3, 'r', 'B');
var b3 = movesFrom(sb3, 2, 5);
ok(!has(b3, 1, 4) && !has(b3, 3, 4), '强化相也不能过河');
ok(has(b3, 1, 6) && has(b3, 3, 6), '强化相在己方河界内可斜一格');

/* ------------------------------------------------------------------ */
section('5. 马');
/* ------------------------------------------------------------------ */
var sn = X.fromFen('3k5/9/9/9/9/9/4N4/9/9/4K4 r');
eq(dst(movesFrom(sn, 4, 6)).length, 8, '空旷处普通马有 8 个着法');
var sn2 = X.fromFen('3k5/9/9/9/9/4p4/4N4/9/9/4K4 r');
var n2 = movesFrom(sn2, 4, 6);
ok(!has(n2, 3, 4) && !has(n2, 5, 4), '马腿被别时不能走该方向');
ok(has(n2, 2, 5) && has(n2, 6, 5), '未被别腿的方向仍可走');
forceSkill(sn2, 'r', 'N');
var n2e = movesFrom(sn2, 4, 6);
ok(has(n2e, 3, 4) && has(n2e, 5, 4), '强化马不再被别腿');
ok(has(n2e, 4, 5) && cap(n2e, 4, 5) === 'p', '强化马可走身旁一格并吃子');
ok(has(n2e, 3, 5) && has(n2e, 5, 5) && has(n2e, 4, 7), '强化马可走身旁其余格子');

/* ------------------------------------------------------------------ */
section('6. 炮');
/* ------------------------------------------------------------------ */
// 炮(4,8) 炮架=兵(4,6)，其后依次：马(4,4)、兵(4,2,己方)、车(4,1)、将(4,0)
var sc = X.fromFen('4k4/4r4/4P4/9/4n4/9/4P4/9/4C4/3K5 r');
var cBasic = movesFrom(sc, 4, 8);
eq(cap(cBasic, 4, 4), 'n', '普通炮可吃炮架后第一个棋子');
eq(cap(cBasic, 4, 1), undefined, '普通炮不能吃炮架后第二个棋子');
eq(cap(cBasic, 4, 0), undefined, '普通炮不能吃炮架后第三个棋子');
eq(cap(cBasic, 4, 2), undefined, '炮不能吃己方棋子');
ok(has(cBasic, 4, 7), '炮可正常走到炮架前空格');
ok(!has(cBasic, 4, 5), '炮不能穿过炮架走到空格');
forceSkill(sc, 'r', 'C');
var cEnh = movesFrom(sc, 4, 8);
eq(cap(cEnh, 4, 4), 'n', '强化炮仍可吃最近的马');
eq(cap(cEnh, 4, 1), 'r', '强化炮可吃炮架后任意敌方棋子（隔子吃车）');
eq(cap(cEnh, 4, 0), undefined, '强化炮不能越子擒王（否则开局一步即可吃将）');
eq(cap(cEnh, 4, 2), undefined, '强化炮也不能吃己方棋子');
ok(cap(cEnh, 4, 3) === undefined, '强化炮不会把空格当吃子目标');
// 强化炮横向同样生效
var sc2 = X.fromFen('4k4/9/9/9/9/9/9/9/C1P1r1P1P/4K4 r');
forceSkill(sc2, 'r', 'C');
var c2 = movesFrom(sc2, 0, 8);
ok(has(c2, 4, 8) && cap(c2, 4, 8) === 'r', '强化炮横向可越过炮架(2,8)吃车(4,8)');
// 强化炮也不能越子打将（将军判定不受强化炮超远吃子影响）
var sc3 = X.fromFen('4k4/9/9/9/4P4/9/4P4/9/4C4/3K5 r');
ok(X.isInCheck(sc3, 'b') === false, '普通炮无法威胁隔两子的将');
forceSkill(sc3, 'r', 'C');
ok(X.isInCheck(sc3, 'b') === false, '强化炮也不能越子打将');
// 但常规炮架（恰好一个子）仍然可以吃将 = 将军
var sc4 = X.fromFen('4k4/9/9/9/9/9/4P4/9/4C4/3K5 r');
forceSkill(sc4, 'r', 'C');
ok(X.isInCheck(sc4, 'b') === true, '强化炮仍可按常规炮架吃将（将军）');

/* ------------------------------------------------------------------ */
section('7. 强化技能次数与时效');
/* ------------------------------------------------------------------ */
var sk = X.createInitialState();
eq(sk.uses.r, 3, '红方初始 3 次强化机会');
ok(X.canActivateSkill(sk, 'r', 'P'), '红方可强化兵');
ok(!X.canActivateSkill(sk, 'b', 'P'), '非本方回合不能强化');
ok(X.activateSkill(sk, 'r', 'P').ok, '强化兵成功');
eq(sk.uses.r, 2, '强化后次数 -1');
ok(X.isEnhanced(sk, 'r', 'P'), '红兵处于强化状态');
ok(!X.isEnhanced(sk, 'b', 'P'), '黑卒不受影响');
ok(!X.canActivateSkill(sk, 'r', 'R'), '同一回合只能强化一次');
ok(X.activateSkill(sk, 'r', 'R').ok === false, '同一回合第二次强化被拒绝');
ok(X.activateSkill(sk, 'b', 'R').ok === false, '黑方不能替红方强化');

X.makeMove(sk, { c: 0, r: 6 }, { c: 0, r: 5 });
ok(X.isEnhanced(sk, 'r', 'P'), '本方走完一步后强化仍生效（对手回合）');
ok(sk.turn === 'b', '轮到黑方');
X.makeMove(sk, { c: 0, r: 3 }, { c: 0, r: 4 });
ok(sk.turn === 'r', '回到红方');
ok(!X.isEnhanced(sk, 'r', 'P'), '经过一个完整回合后强化失效');

// 三次用尽
var sk3 = X.createInitialState();
[
  ['r', 'P', { c: 0, r: 6 }, { c: 0, r: 5 }],
  ['b', null, { c: 0, r: 3 }, { c: 0, r: 4 }],
  ['r', 'R', { c: 0, r: 9 }, { c: 0, r: 8 }],
  ['b', null, { c: 2, r: 3 }, { c: 2, r: 4 }],
  ['r', 'N', { c: 1, r: 9 }, { c: 2, r: 7 }],
  ['b', null, { c: 4, r: 3 }, { c: 4, r: 4 }]
].forEach(function (step) {
  if (step[1]) ok(X.activateSkill(sk3, step[0], step[1]).ok, '连续强化 ' + step[1]);
  ok(X.makeMove(sk3, step[2], step[3]).ok, '连续走子成功 ' + step[2].c + ',' + step[2].r);
});
eq(sk3.uses.r, 0, '三次强化后红方剩余 0 次');
ok(!X.canActivateSkill(sk3, 'r', 'C'), '次数用尽后不能再强化');
ok(X.skillBlockReason(sk3, 'r', 'C').indexOf('次数') >= 0, '给出「次数用尽」的原因');

// 没有该兵种时不能强化
var sk4 = X.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 r');
ok(!X.canActivateSkill(sk4, 'r', 'R'), '棋盘上没有车时不能强化车');

/* ------------------------------------------------------------------ */
section('8. 将帅照面 / 飞将');
/* ------------------------------------------------------------------ */
var sf1 = X.fromFen('4k4/9/9/9/9/4R4/9/9/9/4K4 r');
var f1 = movesFrom(sf1, 4, 5);
ok(!has(f1, 3, 5) && !has(f1, 5, 5), '不能走开使双将照面');
ok(has(f1, 4, 4) && has(f1, 4, 3), '沿中线的着法仍然合法');
ok(has(f1, 4, 0), '可以直接吃掉对方将（照面直线吃将）');
// 有子遮挡时照面着法合法
var sf2 = X.fromFen('4k4/4p4/9/9/9/4R4/9/9/9/4K4 r');
ok(has(movesFrom(sf2, 4, 5), 3, 5), '中间有子遮挡时，车可离开中线');

/* ------------------------------------------------------------------ */
section('9. 将军 / 绝杀 / 困毙');
/* ------------------------------------------------------------------ */
// 红车平到 (0,0) 绝杀：黑将(4,0)，红车(8,0)待命? -> 用 N(3,3) 控制(4,1)
var sm = X.fromFen('4k4/R8/9/3N5/9/5R3/9/9/9/3K5 r');
ok(!X.isInCheck(sm, 'b'), '杀棋前黑方未被将军');
var res = X.makeMove(sm, { c: 0, r: 1 }, { c: 0, r: 0 });
ok(res.ok, '杀棋着法合法');
eq(res.check, true, '构成将军');
eq(res.checkmate, true, '构成绝杀');
eq(res.winner, 'r', '红方获胜');
eq(sm.status, 'over', '棋局结束');
eq(X.legalMoves(sm, 'b').length, 0, '被绝杀方无着法');
// 困毙：黑将(4,0) 无处可走且未被将军
var ss = X.fromFen('4k4/R8/9/9/9/9/3R1R3/9/9/3K5 b');
ok(!X.isInCheck(ss, 'b'), '困毙局面：黑方未被将军');
eq(X.legalMoves(ss, 'b').length, 0, '困毙局面：黑方无着法');
var ss2 = X.fromFen('4k4/9/R8/9/9/9/3R1R3/9/9/3K5 r');
var res2 = X.makeMove(ss2, { c: 0, r: 2 }, { c: 0, r: 1 });
ok(res2.ok, '走出困毙的一步合法');
eq(res2.stalemate, true, '判定为困毙（不是绝杀）');
eq(res2.check, false, '困毙时并非将军');
eq(res2.winner, 'r', '困毙判红方胜');
eq(ss2.status, 'over', '困毙后棋局结束');
// 被将军必须应将
var sc2b = X.fromFen('4k4/9/9/9/9/9/9/9/4r4/4K4 r');
ok(X.isInCheck(sc2b, 'r'), '红方被将军');
ok(!X.makeMove(sc2b, { c: 4, r: 9 }, { c: 4, r: 8 }).ok, '被将军时不能走仍被将的着法');
ok(X.makeMove(sc2b, { c: 4, r: 9 }, { c: 3, r: 9 }).ok, '被将军时应将（躲避）合法');

/* ------------------------------------------------------------------ */
section('10. 悔棋');
/* ------------------------------------------------------------------ */
var su = X.createInitialState();
X.activateSkill(su, 'r', 'P');
X.makeMove(su, { c: 0, r: 6 }, { c: 0, r: 5 });
eq(su.uses.r, 2, '悔棋前已用 1 次');
ok(X.canUndo(su), '可以悔棋');
X.undo(su);
ok(su.board[X.idx(0, 6)] === 'P' && su.board[X.idx(0, 5)] === null, '悔棋恢复棋子位置');
ok(su.turn === 'r', '悔棋恢复行棋方');
X.undo(su);
eq(su.uses.r, 3, '悔棋恢复强化次数');
ok(!X.isEnhanced(su, 'r', 'P'), '悔棋取消强化状态');
eq(X.toFen(su), X.START_FEN + ' r', '全部悔棋后回到初始局面');

/* ------------------------------------------------------------------ */
section('11. 中文着法描述');
/* ------------------------------------------------------------------ */
var sd = X.createInitialState();
X.makeMove(sd, { c: 7, r: 7 }, { c: 4, r: 7 });
eq(sd.log[sd.log.length - 1].text, '炮二平五', '红 炮二平五');
X.makeMove(sd, { c: 1, r: 2 }, { c: 4, r: 2 });
eq(sd.log[sd.log.length - 1].text, '炮２平５', '黑 炮２平５（全角数字，黑方右手侧起算）');
var sd2 = X.createInitialState();
X.makeMove(sd2, { c: 7, r: 9 }, { c: 6, r: 7 });
eq(sd2.log[sd2.log.length - 1].text, '马二进三', '红 马二进三');
var sd3 = X.createInitialState();
X.makeMove(sd3, { c: 0, r: 9 }, { c: 0, r: 8 });
eq(sd3.log[sd3.log.length - 1].text, '车九进一', '红 车九进一');
var sd4 = X.createInitialState();
X.makeMove(sd4, { c: 0, r: 6 }, { c: 0, r: 5 });
eq(sd4.log[sd4.log.length - 1].text, '兵九进一', '红 兵九进一');
// 前/后 区分
var sd5 = X.fromFen('3k5/9/9/9/9/3P5/3P5/9/9/4K4 r');
X.makeMove(sd5, { c: 3, r: 5 }, { c: 3, r: 4 });
eq(sd5.log[sd5.log.length - 1].text, '前兵进一', '同列双兵用「前/后」区分');

/* ------------------------------------------------------------------ */
section('12. 士/仕 强化：跳到任一己方棋子周围一格');
/* ------------------------------------------------------------------ */
// 士(4,8) 在九宫内只能走 (3,7)/(5,7)/(3,9)/(5,9)
var sa = X.fromFen('3k5/9/9/9/9/9/9/9/4A4/4K4 r');
eq(dst(movesFrom(sa, 4, 8)), ['3,7', '3,9', '5,7', '5,9'].sort(), '普通士只能走九宫内的四个斜格');
forceSkill(sa, 'r', 'A');
var aMoves = movesFrom(sa, 4, 8);
// 帅(4,9) 周围一格 = (3,8)(5,8)(3,9)(5,9)；(4,8) 是士自己 -> 不作锚点
eq(dst(aMoves), ['3,7', '3,8', '3,9', '5,7', '5,8', '5,9'].sort(), '强化士可跳到帅周围一格（自己不算锚点）');
ok(!has(aMoves, 4, 7), '强化士不能靠「自己」当锚点随意走一步');
// 用别的棋子当锚点 -> 可以全盘跳到己方棋子旁边（离开九宫、跨越整个棋盘）
var sa2 = X.fromFen('3k5/9/9/9/9/9/9/9/4A4/4K4 r');
sa2.board[X.idx(0, 6)] = 'R';   // 红车远在左翼
forceSkill(sa2, 'r', 'A');
var a2 = movesFrom(sa2, 4, 8);
ok(has(a2, 0, 5) && has(a2, 1, 5) && has(a2, 1, 6) && has(a2, 1, 7), '强化士可跳到远处己方车周围一格（全盘可达）');
ok(!has(a2, 0, 8), '强化士只能落在锚点八方向范围内，不能任意落点');
ok(has(a2, 8, 8) === false, '强化士落点必须紧邻己方棋子');
// 强化士可以吃子（吃锚点旁边的敌子）
var sa3 = X.fromFen('3k5/9/9/9/9/9/9/9/4A4/3pK4 r');
forceSkill(sa3, 'r', 'A');
eq(cap(movesFrom(sa3, 4, 8), 3, 9), 'p', '强化士可吃掉己方棋子旁边的敌子');
// 强化士不能吃掉己方棋子
var sa4 = X.fromFen('3k5/9/9/9/9/9/9/9/4A4/3AK4 r');
forceSkill(sa4, 'r', 'A');
eq(cap(movesFrom(sa4, 4, 8), 3, 9), undefined, '强化士不能吃己方棋子');
// 只有将帅时无远处锚点 -> 不能凭空跳到远处
var sa5 = X.fromFen('3k5/9/9/9/9/9/9/9/4A4/4K4 r');
forceSkill(sa5, 'r', 'A');
ok(!has(movesFrom(sa5, 4, 8), 0, 0), '没有己方棋子作锚点处，不能凭空跳过去');
ok(X.hasFriendlyNeighbor(sa5, 'r', 0, 0, 4, 8) === false, 'hasFriendlyNeighbor 正确识别空位');
ok(X.hasFriendlyNeighbor(sa5, 'r', 3, 8, 4, 8) === true, 'hasFriendlyNeighbor 能识别将旁边的位置');
// 记谱
sa2.log.push({ kind: 'move', side: 'r', from: [4, 8], to: [1, 6], piece: 'A', captured: null, flag: 'enhanced' });
eq(X.describeMove(sa2, sa2.log[sa2.log.length - 1]), '仕五移八（强化）', '强化士记谱用「移」');

/* ------------------------------------------------------------------ */
section('13. 帅/将 强化：招降周围一格的敌子');
/* ------------------------------------------------------------------ */
// 红帅(4,9)：周围 (3,8)(5,8)(3,9)(5,9) 放敌子，另有远处敌子不受影响
var sk5 = X.fromFen('3k5/9/9/9/9/9/9/9/3p1n3/4K4 r');
ok(!X.hasConvertTargets(sk5, 'r') === false, '存在可招降目标');
ok(X.canActivateSkill(sk5, 'r', 'K'), '红方可发动帅强化');
var rk = X.activateSkill(sk5, 'r', 'K');
ok(rk.ok && rk.instant === true, '帅强化为即时生效');
eq(rk.converted.length, 2, '招降 2 个子');
eq(sk5.board[X.idx(3, 8)], 'P', '左侧敌卒变为己方兵');
eq(sk5.board[X.idx(5, 8)], 'N', '右侧敌马变为己方马');
eq(sk5.uses.r, 2, '招降消耗 1 次强化机会');
ok(X.isEnhanced(sk5, 'r', 'K') === false, '帅强化不会留下持续状态');
ok(!X.canActivateSkill(sk5, 'r', 'K'), '本回合不能再次强化');
// 远处的敌子不受影响
var sk6 = X.fromFen('3k5/9/9/9/9/9/9/9/4p4/4K4 r');
eq(X.hasConvertTargets(sk6, 'r'), true, '正前方一格也可招降');
var rk2 = X.activateSkill(sk6, 'r', 'K');
eq(sk6.board[X.idx(4, 8)], 'P', '正前方敌卒被招降');
// 无敌子可招降时不允许发动（不浪费次数）
var sk7 = X.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 r');
ok(!X.canActivateSkill(sk7, 'r', 'K'), '周围无敌子时不能发动招降');
ok(X.skillBlockReason(sk7, 'r', 'K').indexOf('招降') >= 0, '给出「无可招降目标」的原因');
// 招降可解将：黑车贴脸将军，招降后反成己方车
var sk8 = X.fromFen('3k5/9/9/9/9/9/9/9/4r4/4K4 r');
ok(X.isInCheck(sk8, 'r'), '红方被贴身将军');
var rk3 = X.activateSkill(sk8, 'r', 'K');
eq(sk8.board[X.idx(4, 8)], 'R', '贴脸黑车被招降为红车');
ok(!X.isInCheck(sk8, 'r'), '招降即解将');
eq(rk3.converted[0].from, 'r', '记录了改旗易帜前的原棋子');
// 招降后的棋子享受本方同兵种强化（强化按「兵种+归属」生效）
var sk9 = X.fromFen('3k5/9/9/9/9/9/9/9/4r4/4K4 r');
forceSkill(sk9, 'r', 'R');
var rk4 = X.activateSkill(sk9, 'r', 'K');
eq(sk9.board[X.idx(4, 8)], 'R', '招降得到红车');
ok(rk4.converted.length === 1 && rk4.converted[0].type === 'R', '招降结果带出棋子类型');
var convertedRook = movesFrom(sk9, 4, 8);
ok(has(convertedRook, 2, 6) && has(convertedRook, 0, 4) && has(convertedRook, 6, 6), '招降来的车立刻按本方强化规则走斜线');
ok(has(convertedRook, 4, 0), '招降来的车仍可直行吃将');
ok(has(convertedRook, 4, 2), '直线路径正常（可长驱直入）');
// 悔棋可撤销招降
var sk10 = X.fromFen('3k5/9/9/9/9/9/9/9/4r4/4K4 r');
X.activateSkill(sk10, 'r', 'K');
eq(sk10.board[X.idx(4, 8)], 'R', '招降成功');
X.undo(sk10);
eq(sk10.board[X.idx(4, 8)], 'r', '悔棋还原被招降的棋子');
eq(sk10.uses.r, 3, '悔棋还原强化次数');

/* ------------------------------------------------------------------ */
section('14. 多兵种强化互不干扰');
/* ------------------------------------------------------------------ */
var smix = X.createInitialState();
forceSkill(smix, 'r', 'A');
forceSkill(smix, 'r', 'R');
eq(X.activeEnhancements(smix, 'r'), ['A', 'R'], '同时存在多个强化时按固定顺序返回');
eq(X.activeEnhancements(smix, 'b'), [], '黑方未强化');
eq(X.legalMoves(smix, 'r').length > 44, true, '强化后红方着法数多于开局 44 着');
eq(X.SKILL_ORDER.length, 7, '共 7 种强化');
eq(X.SKILL_ORDER.join(''), 'PABNRCK', '强化按兵士相马车炮将排序');

console.log('\n==============================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('\n失败项：');
  failures.forEach(function (f) { console.log(' - ' + f); });
  process.exit(1);
}
console.log('全部通过 \u2713');

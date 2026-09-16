/*!
 * 吃子嘲讽系统：吃子/将军/绝杀后向对手发送嘲讽话语（含语音朗读）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Taunts = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var POOLS = {
    // 吃小兵
    pawn: [
      '一个小兵而已，先拿你开开胃。',
      '卒子也想挡路？回炉重造吧。',
      '吃你个小兵，不痛不痒——对你来说。',
      '兵来将挡，我直接把兵吃了。',
      '谢谢你的兵，我会好好照顾它的。',
      '听说你想用这个小兵建功立业？'
    ],
    // 吃大子（车/炮/马）
    big: [
      '你的车呢？哦，在我这儿。',
      '主力和你说再见了，不送。',
      '这一子吃得我心情舒畅。',
      '不好意思，这棋子长得太诱人了。',
      '这步棋我练了三年，就为吃你这一子。',
      '损失统计一下？反正你不想听。'
    ],
    // 吃士象
    guard: [
      '护驾的人没了，你自求多福吧。',
      '拆掉你的城墙，下一步就是城门。',
      '你的防线，好像有点漏风。',
      '士象一丢，老将慌不慌？'
    ],
    // 普通吃子
    normal: [
      '这一子，我先替你收着。',
      '承让承让。',
      '手滑了——滑到你的子上了。',
      '多谢投喂！',
      '棋盘这么大，你不该站在那儿。',
      '我又不是故意的，我是有意的。',
      '别急，下一个马上就到你了。',
      '这波不亏。'
    ],
    // 连续吃子
    streak: [
      '连续作案，这局稳了。',
      '你的子怎么一个接一个往我嘴里送？',
      '拦不住了吧？早说嘛。',
      '这已经是我今天吃掉你的第 N 个了。'
    ],
    // 用强化吃子
    enhanced: [
      '强化一开，谁与争锋！',
      '这就是强化技能的实力，服不服？',
      '花一次强化机会吃你一子，值！',
      '普通规则拦不住我了，懂？'
    ],
    // 招降（帅/将强化）
    convert: [
      '你的人，现在是我的人。',
      '临阵倒戈，你说气不气？',
      '谢谢你的棋子，它决定跟我了。',
      '别怪它，它只是识时务。',
      '认得清形势的棋子，才活得久。',
      '就在你眼皮底下，我把它们都收了。',
      '这一招叫「化敌为友」，学着点。'
    ],
    // 将军
    check: [
      '将军！你的老将有点危险哦。',
      '将军——这声喊得我心情舒畅。',
      '将！军！快想想办法吧。',
      '将军了，要不要考虑一下认输？',
      '这一将，你只能被动挨打了。'
    ],
    // 绝杀 / 困毙
    mate: [
      '绝杀！这局我收下了。',
      '结束了，棋盘上见真章。',
      '承让承让，下次让你先手。',
      '无路可走了吧？要不要再来一局。',
      '困毙了吧？你的所有出路我都算过。'
    ]
  };

  var TYPE_GROUP = { P: 'pawn', A: 'guard', B: 'guard', N: 'big', R: 'big', C: 'big', K: 'mate' };
  var TYPE_LABEL = { K: '将帅', A: '士仕', B: '象相', N: '马', R: '车', C: '炮', P: '兵卒' };

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /**
   * 生成嘲讽语
   * @param {object} ctx { capturedType, capturerSide, isCheck, isMate, isStalemate, streak, enhanced }
   * @returns {{text:string, tone:string}}
   */
  function build(ctx) {
    ctx = ctx || {};
    var tone = 'normal';
    var text;

    if (ctx.isConvert) {
      tone = 'convert';
      text = pick(POOLS.convert);
      if (ctx.count > 1) text = text + '（一口气 ' + ctx.count + ' 个）';
    } else if (ctx.isMate) {
      tone = 'mate';
      text = pick(POOLS.mate);
    } else if (ctx.isStalemate) {
      tone = 'mate';
      text = pick(POOLS.mate);
    } else if (ctx.enhanced && ctx.capturedType) {
      tone = 'enhanced';
      text = pick(POOLS.enhanced);
    } else if (ctx.streak >= 2 && ctx.capturedType) {
      tone = 'streak';
      text = pick(POOLS.streak);
    } else if (ctx.isCheck && Math.random() < 0.45) {
      tone = 'check';
      text = pick(POOLS.check);
    } else if (ctx.capturedType) {
      var group = TYPE_GROUP[ctx.capturedType] || 'normal';
      tone = group;
      text = pick(POOLS[group]);
      if (ctx.isCheck) text += '（顺便将军！）';
    } else if (ctx.isCheck) {
      tone = 'check';
      text = pick(POOLS.check);
    } else {
      return null;
    }

    if (tone === 'streak') {
      text = text.replace('N', String(ctx.streak));
    }
    return { text: text, tone: tone };
  }

  /* ---------------- 语音朗读 ---------------- */

  var voiceReady = typeof window !== 'undefined' && 'speechSynthesis' in window;
  var cachedVoice = null;

  function pickVoice() {
    if (!voiceReady) return null;
    if (cachedVoice) return cachedVoice;
    var voices = window.speechSynthesis.getVoices() || [];
    var zh = voices.filter(function (v) { return /zh|chinese|中文|普通话/i.test(v.lang + ' ' + v.name); });
    cachedVoice = zh.filter(function (v) { return /xiao|hui|yao|kangkang|female|女/i.test(v.name); })[0] || zh[0] || null;
    return cachedVoice;
  }

  if (voiceReady) {
    try { window.speechSynthesis.onvoiceschanged = function () { cachedVoice = null; pickVoice(); }; } catch (e) { /* ignore */ }
  }

  function speak(text, opts) {
    if (!voiceReady || !text) return false;
    opts = opts || {};
    try {
      var u = new SpeechSynthesisUtterance(text.replace(/\s+/g, ''));
      var v = pickVoice();
      if (v) u.voice = v;
      u.lang = 'zh-CN';
      u.rate = opts.rate || 1.15;
      u.pitch = opts.pitch || 1;
      u.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  return { build: build, speak: speak, POOLS: POOLS, TYPE_LABEL: TYPE_LABEL, hasVoice: voiceReady };
});

/**
 * 微信小游戏适配器
 * 在浏览器 / 抖音环境加载本文件不会有任何副作用（wx 不存在则跳过注册）
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  var A = MG.adapter || (MG.adapter = {});
  if (typeof wx === 'undefined' || typeof wx.createCanvas !== 'function') return;
  if (typeof A.createMiniGameAdapter !== 'function') {
    console.log('[MG.adapter] minigame.js 必须在本文件之前加载');
    return;
  }
  A.wx = A.createMiniGameAdapter(wx, 'wx');
})(typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * 抖音小游戏适配器
 * 抖音的宿主对象是 tt，API 与微信基本同构，直接复用通用工厂。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  var A = MG.adapter || (MG.adapter = {});
  if (typeof tt === 'undefined' || typeof tt.createCanvas !== 'function') return;
  if (typeof A.createMiniGameAdapter !== 'function') {
    console.log('[MG.adapter] minigame.js 必须在本文件之前加载');
    return;
  }
  A.tt = A.createMiniGameAdapter(tt, 'tt');
})(typeof globalThis !== 'undefined' ? globalThis : this);

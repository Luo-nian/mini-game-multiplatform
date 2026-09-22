/**
 * 启动装配层
 * 三端共用：小游戏端由 game.js require 进来，Web 端由 index.html 脚本标签引入。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});

  function boot() {
    var ad = MG.adapter.get();
    ad.init({});

    var game = new MG.Game(ad, MG.config);
    game.mount();

    ad.onPointer(function (p) {
      game.onPointer(p);
    });

    game.loop();

    // 便于在开发者工具控制台里调试
    root.__mg = { adapter: ad, game: game };
    console.log('[MG] 启动完成 platform=' + ad.name + ' vw=' + game.vw.toFixed(0) + ' vh=' + game.vh.toFixed(0));
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

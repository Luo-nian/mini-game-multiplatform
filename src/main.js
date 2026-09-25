/**
 * 启动装配层
 * 三端共用：小游戏端由 game.js require 进来，Web 端由 index.html 脚本标签引入。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});

  function boot() {
    try {
      var ad = MG.adapter.get();
      console.log('[MG] 平台 = ' + ad.name);
      ad.init({ designWidth: (MG.config && MG.config.designWidth) || 750 });

      var info = ad.getSystemInfo();
      console.log('[MG] 画布 width=' + info.width + ' height=' + info.height + ' dpr=' + info.dpr);

      var game = new MG.Game(ad, MG.config);
      game.mount();
      console.log('[MG] 已挂载 虚拟画布 ' + game.vw + 'x' + game.vh.toFixed(0) + ' 格子=' + game.cell.toFixed(1));

      // 分享链接带 level 参数时直达该关（好友点开就能玩同一关）
      try {
        var q = ad.getLaunchQuery ? ad.getLaunchQuery() : {};
        var shareLevel = parseInt(q && q.level, 10);
        if (!isNaN(shareLevel) && shareLevel >= 1) {
          game.startLevel(shareLevel);
          game._toast('好友邀请你挑战第 ' + shareLevel + ' 关');
          console.log('[MG] 来自分享，直达第 ' + shareLevel + ' 关');
        } else if (q && q.screen === 'levels') {
          game.state = 'levels';
          game.page = 0;
          console.log('[MG] 深链直达选关页');
        }
      } catch (e) {}

      // 转发卡片内容跟随当前关卡（小游戏菜单栏转发也要带上参数）
      if (ad.setupShare) {
        ad.setupShare({
          title: '车位脱困｜拖开挡路的车，把红车开出去',
          query: 'level=' + game.level,
        });
      }

      ad.onPointer(function (p) {
        game.onPointer(p);
      });

      game.loop();

      // 便于在开发者工具控制台里调试
      root.__mg = { adapter: ad, game: game };

      // 内置自测（调试期）
      if (MG.config && MG.config.selfTest && MG.selfTest) {
        MG.selfTest(ad, game);
      }
      console.log('[MG] 启动完成，若画面仍空白请看下面是否有报错');
    } catch (e) {
      console.error('[MG] 启动失败：' + (e && e.message) + '\n' + (e && e.stack));
    }
  }

  // 只有真浏览器才需要等 DOM ready。
  // 小游戏环境若被判定成浏览器（某些基础库注入了 document 桩），会永远等不到
  // DOMContentLoaded 事件，表现就是「编译通过但屏幕全白」。
  var isBrowser =
    typeof window !== 'undefined' && typeof document !== 'undefined' && !!document.body;
  if (isBrowser && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

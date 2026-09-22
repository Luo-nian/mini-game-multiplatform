/**
 * 小游戏通用适配器工厂
 * 微信小游戏(host = wx) 与 抖音小游戏(host = tt) 的 API 高度同构，
 * 这里用同一份实现，差异点做存在性判断，避免各自维护两份代码。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  var A = MG.adapter || (MG.adapter = {});

  A.createMiniGameAdapter = function (host, name) {
    var api = { name: name, host: host };
    var canvas = null;
    var ctx = null;
    var sysInfo = null;

    function has(fn) {
      return typeof fn === 'function';
    }

    api.init = function (opts) {
      opts = opts || {};
      // 小游戏第一次 createCanvas() 返回的就是上屏 canvas
      canvas = opts.canvas || host.createCanvas();
      ctx = canvas.getContext('2d');

      sysInfo = host.getSystemInfoSync ? host.getSystemInfoSync() : {};
      var w = sysInfo.windowWidth || sysInfo.screenWidth || 375;
      var h = sysInfo.windowHeight || sysInfo.screenHeight || 667;

      // 小游戏上屏 canvas 已经是逻辑像素，dpr 固定为 1
      api._info = {
        width: w,
        height: h,
        dpr: 1,
        platform: name,
        safeTop: (sysInfo.safeArea && sysInfo.safeArea.top) || 0,
        safeBottom: h - ((sysInfo.safeArea && sysInfo.safeArea.bottom) || h),
      };
      return api;
    };

    api.getSystemInfo = function () {
      return api._info || { width: 375, height: 667, dpr: 1, platform: name, safeTop: 0, safeBottom: 0 };
    };

    api.getContext = function () {
      return ctx;
    };

    api.getCanvas = function () {
      return canvas;
    };

    /** 触摸事件统一成 { x, y, type } */
    api.onPointer = function (handler) {
      function wrap(type) {
        return function (e) {
          var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
          if (!t) return;
          handler({
            x: t.clientX != null ? t.clientX : t.x,
            y: t.clientY != null ? t.clientY : t.y,
            type: type,
          });
        };
      }
      if (has(host.onTouchStart)) host.onTouchStart(wrap('down'));
      if (has(host.onTouchMove)) host.onTouchMove(wrap('move'));
      if (has(host.onTouchEnd)) host.onTouchEnd(wrap('up'));
      return function () {};
    };

    api.storage = {
      get: function (key, def) {
        try {
          var v = host.getStorageSync(key);
          return v === '' || v === null || v === undefined ? def : v;
        } catch (e) {
          return def;
        }
      },
      set: function (key, value) {
        try {
          host.setStorageSync(key, value);
        } catch (e) {
          if (has(host.setStorage)) host.setStorage({ key: key, data: value, fail: function () {} });
        }
      },
    };

    api.share = function (opts) {
      opts = opts || {};
      try {
        if (has(host.shareAppMessage)) {
          host.shareAppMessage({ title: opts.title || '', imageUrl: opts.imageUrl || '' });
        }
        if (has(host.showShareMenu)) host.showShareMenu({ withShareTicket: false });
      } catch (e) {}
    };

    /**
     * 激励视频。返回 Promise<boolean>（是否看完拿到奖励）
     * 未配置广告位 ID 时直接放行（开发期空跑），打印日志方便排查。
     */
    api.showRewardedAd = function (adUnitId) {
      return new Promise(function (resolve) {
        if (!adUnitId || !has(host.createRewardedVideoAd)) {
          console.log('[ad] 未配置广告位, 走空跑放行. platform=' + name);
          resolve(true);
          return;
        }
        var ad = host.createRewardedVideoAd({ adUnitId: adUnitId });
        var settled = false;
        function done(ok) {
          if (settled) return;
          settled = true;
          resolve(ok);
        }
        ad.onClose(function (res) {
          // res.isEnded === undefined 视为完整播放（部分基础库行为）
          done(!res || res.isEnded === undefined || res.isEnded === true);
        });
        ad.onError(function (err) {
          console.log('[ad] 激励视频出错', err);
          done(false);
        });
        ad.load()
          .then(function () {
            return ad.show();
          })
          .catch(function (err) {
            console.log('[ad] 拉起失败, 重试一次', err);
            ad.load()
              .then(function () {
                ad.show();
              })
              .catch(function () {
                done(false);
              });
          });
      });
    };

    api.showInterstitial = function (adUnitId) {
      try {
        if (!adUnitId || !has(host.createInterstitialAd)) return false;
        var ad = host.createInterstitialAd({ adUnitId: adUnitId });
        ad.show().catch(function () {});
        return true;
      } catch (e) {
        return false;
      }
    };

    api.vibrate = function () {
      try {
        if (has(host.vibrateShort)) host.vibrateShort({ type: 'light' });
      } catch (e) {}
    };

    api.raf = function (fn) {
      return requestAnimationFrame(fn);
    };

    api.now = function () {
      return Date.now();
    };

    return api;
  };

  A.minigameFactory = A.createMiniGameAdapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);

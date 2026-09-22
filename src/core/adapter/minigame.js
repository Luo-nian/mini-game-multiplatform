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
      var designW = opts.designWidth || 750;
      // 小游戏第一次 createCanvas() 返回的就是上屏 canvas
      canvas = opts.canvas || host.createCanvas();
      ctx = canvas.getContext('2d');

      sysInfo = host.getSystemInfoSync ? host.getSystemInfoSync() : {};
      var w = sysInfo.windowWidth || sysInfo.screenWidth || 375;
      var h = sysInfo.windowHeight || sysInfo.screenHeight || 667;
      var dpr = sysInfo.pixelRatio || 1;

      // 关键：小游戏的上屏 canvas 必须显式设置物理尺寸。
      // 不设置的话宽高可能是 0 或与逻辑尺寸不一致，结果是「编译不报错但屏幕全白」。
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      api._info = {
        width: w,
        height: h,
        dpr: dpr,
        platform: name,
        safeTop: (sysInfo.safeArea && sysInfo.safeArea.top) || 0,
        safeBottom: h - ((sysInfo.safeArea && sysInfo.safeArea.bottom) || h),
      };

      // ⚠️ 原生触摸坐标是「逻辑像素」(0..w)，而游戏层一律用「设计宽 designW」的虚拟坐标。
      // 少了这步换算，界面能正常显示，但点哪都点不中 —— 按钮看着在那儿就是按不动。
      api._scale = designW / w;
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

    /** 触摸事件统一成 { x, y, type }，坐标已换算到「设计宽」虚拟坐标系 */
    api.onPointer = function (handler) {
      var k = api._scale || 1;
      // 暴露给自动化/自测用：喂「原生坐标」即可，换算在这里完成，与真实触摸完全等价
      api._handler = function (native) {
        handler({ x: native.x * k, y: native.y * k, type: native.type });
      };
      function wrap(type) {
        return function (e) {
          var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
          if (!t) return;
          var rx = t.clientX != null ? t.clientX : t.x;
          var ry = t.clientY != null ? t.clientY : t.y;
          handler({ x: rx * k, y: ry * k, type: type });
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

    // ---------- 音效：InnerAudioContext 池 ----------
    // 每个音效一个常驻 context（首次用时懒建），play 前先 stop 回到起点。
    // 不用每次新建 —— 小游戏里新建 context 带解码延迟，短音效会「点响了半秒后才出声」。
    var audioPool = {};
    api.sfx = function (name) {
      try {
        var a = audioPool[name];
        if (!a) {
          if (!has(host.createInnerAudioContext)) return;
          a = host.createInnerAudioContext();
          a.src = 'audio/' + name + '.wav';
          audioPool[name] = a;
        }
        a.stop();
        a.play();
      } catch (e) {}
    };

    api.raf = function (fn) {
      return requestAnimationFrame(fn);
    };

    /** HTTP POST（自测上报用；小游戏走 host.request，需在工具里关闭域名校验） */
    api.httpPost = function (url, data) {
      return new Promise(function (resolve) {
        if (!has(host.request)) {
          resolve({ ok: false, reason: 'no-request-api' });
          return;
        }
        host.request({
          url: url,
          method: 'POST',
          data: data,
          timeout: 5000,
          header: { 'content-type': 'application/json' },
          success: function (res) {
            resolve({ ok: true, status: res && res.statusCode });
          },
          fail: function (e) {
            resolve({ ok: false, reason: (e && e.errMsg) || 'fail' });
          },
        });
      });
    };

    api.now = function () {
      return Date.now();
    };

    return api;
  };

  A.minigameFactory = A.createMiniGameAdapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);

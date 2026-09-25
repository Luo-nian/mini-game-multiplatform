/**
 * 浏览器(Web)适配器
 * 用于本地开发预览 + 后续上架 CrazyGames / Poki 等网页游戏平台。
 * 广告用 DOM 遮罩模拟，保证开发期能完整跑通「看广告 -> 拿奖励」链路。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  var A = MG.adapter || (MG.adapter = {});
  if (typeof document === 'undefined') return;

  var api = { name: 'web' };
  var canvas = null;
  var ctx = null;

  api.init = function (opts) {
    opts = opts || {};
    api._designW = opts.designWidth || 750;
    canvas = opts.canvas || document.getElementById('game');
    if (!canvas) throw new Error('[MG.adapter.web] 找不到 canvas');
    ctx = canvas.getContext('2d');
    api._resize();
    window.addEventListener('resize', api._resize);
    return api;
  };

  api._resize = function () {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // ⚠️ 尺寸一律以「元素实际显示尺寸」为准（canvas.clientWidth），不要用 window.innerWidth：
    //   页面的 CSS 可能把画布固定成手机比例（见 index.html 的 @media），
    //   若按窗口宽布局，画面会被放大错位/裁切。
    // 这里也**不要**写 canvas.style —— CSS 是尺寸的唯一来源，内联会覆盖掉媒体查询。
    var w = canvas.clientWidth || window.innerWidth || 375;
    var h = canvas.clientHeight || window.innerHeight || 667;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    api._info = { width: w, height: h, dpr: dpr, platform: 'web', safeTop: 0, safeBottom: 0 };
  };

  api.getSystemInfo = function () {
    return api._info || { width: 375, height: 667, dpr: 1, platform: 'web', safeTop: 0, safeBottom: 0 };
  };

  api.getContext = function () {
    return ctx;
  };

  api.getCanvas = function () {
    return canvas;
  };

  api.onPointer = function (handler) {
    // 暴露给自动化测试用：喂「原生(CSS)坐标」即可，换算在这里完成
    api._handler = function (native) {
      var rect = canvas.getBoundingClientRect();
      var k = (api._designW || 750) / (rect.width || api._info.width || 375);
      handler({ x: native.x * k, y: native.y * k, type: native.type });
    };
    function send(e, type) {
      var rect = canvas.getBoundingClientRect();
      var src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      var cssX = (src.clientX != null ? src.clientX : 0) - rect.left;
      var cssY = (src.clientY != null ? src.clientY : 0) - rect.top;
      // CSS 像素 -> 设计宽虚拟坐标（与 minigame 适配器同一套约定）
      var k = (api._designW || 750) / (rect.width || api._info.width || 375);
      handler({ x: cssX * k, y: cssY * k, type: type });
    }
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      send(e, 'down');
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      send(e, 'move');
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      e.preventDefault();
      send(e, 'up');
    }, { passive: false });
    canvas.addEventListener('mousedown', function (e) {
      send(e, 'down');
    });
    canvas.addEventListener('mousemove', function (e) {
      if (e.buttons) send(e, 'move');
    });
    canvas.addEventListener('mouseup', function (e) {
      send(e, 'up');
    });
    return function () {};
  };

  api.storage = {
    get: function (key, def) {
      try {
        var v = window.localStorage.getItem(key);
        return v === null ? def : v;
      } catch (e) {
        return def;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {}
    },
  };

  api.share = function (opts) {
    opts = opts || {};
    var url = opts.url || window.location.href;
    if (opts.query) {
      var q = String(opts.query);
      url += (url.indexOf('?') >= 0 ? '&' : '?') + q;
    }
    try {
      if (navigator.share) {
        navigator.share({ title: opts.title || document.title, url: url });
        return;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url);
        api._toast('链接已复制');
      }
    } catch (e) {}
  };

  /** 浏览器版没有系统转发菜单，这里留空实现保证接口一致 */
  api.setupShare = function () {
    try {
      if (document && document.title) document.title = document.title;
    } catch (e) {}
  };

  /** 启动参数：从 URL query 里取（如 ?level=37） */
  api.getLaunchQuery = function () {
    try {
      var out = {};
      var s = window.location.search.replace(/^\?/, '');
      if (!s) return out;
      s.split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
      return out;
    } catch (e) {
      return {};
    }
  };

  function overlay(seconds, label, skippable) {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.style.cssText =
        'position:fixed;inset:0;z-index:9999;background:rgba(20,20,20,.86);' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'color:#fff;font:500 16px/1.6 system-ui,sans-serif;user-select:none';
      var tip = document.createElement('div');
      tip.style.cssText = 'opacity:.75;font-size:13px;margin-bottom:14px';
      tip.textContent = label + '（开发期模拟）';
      var num = document.createElement('div');
      num.style.cssText = 'font-size:44px;font-weight:500';
      box.appendChild(tip);
      box.appendChild(num);
      document.body.appendChild(box);

      var left = seconds;
      num.textContent = left;
      var timer = setInterval(function () {
        left -= 1;
        num.textContent = left > 0 ? left : '';
        if (left <= 0) {
          clearInterval(timer);
          if (skippable) {
            var btn = document.createElement('button');
            btn.textContent = '领取奖励';
            btn.style.cssText =
              'margin-top:18px;padding:10px 26px;border-radius:999px;border:0;' +
              'background:#1D9E75;color:#fff;font:500 15px system-ui,sans-serif;cursor:pointer';
            btn.onclick = function () {
              box.remove();
              resolve(true);
            };
            box.appendChild(btn);
          } else {
            box.remove();
            resolve(true);
          }
        }
      }, 1000);
    });
  }

  api.showRewardedAd = function () {
    return overlay(3, '激励视频 15s', true);
  };

  api.showInterstitial = function () {
    overlay(2, '插屏广告', false);
    return true;
  };

  api.vibrate = function () {
    try {
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (e) {}
  };

  // ---------- 音效：Audio 元素池（与 minigame 适配器同一约定） ----------
  var audioPool = {};
  api.sfx = function (name) {
    try {
      var a = audioPool[name];
      if (!a) {
        a = new Audio('audio/' + name + '.wav');
        a.preload = 'auto';
        audioPool[name] = a;
      }
      a.currentTime = 0;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  };

  api._toast = function (text) {
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText =
      'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:10000;' +
      'background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:8px;' +
      'font:400 13px system-ui,sans-serif';
    document.body.appendChild(t);
    setTimeout(function () {
      t.remove();
    }, 1400);
  };

  api.raf = function (fn) {
    return requestAnimationFrame(fn);
  };

  /** HTTP POST（自测上报用） */
  api.httpPost = function (url, data) {
    try {
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }).then(function (r) {
        return { ok: true, status: r.status };
      }).catch(function (e) {
        return { ok: false, reason: String(e) };
      });
    } catch (e) {
      return Promise.resolve({ ok: false, reason: String(e) });
    }
  };

  api.now = function () {
    return Date.now();
  };

  A.web = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

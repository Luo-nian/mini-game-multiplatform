/**
 * 适配层总入口
 * 用法：MG.adapter.get()  ->  拿到当前平台的统一实现
 * 游戏逻辑只依赖 MG.adapter 的接口，不直接碰 wx / tt / document
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  var A = MG.adapter || (MG.adapter = {});

  /** 探测当前运行环境 */
  A.detect = function () {
    if (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') return 'wx';
    if (typeof tt !== 'undefined' && typeof tt.createCanvas === 'function') return 'tt';
    return 'web';
  };

  var _cached = null;

  /** 取适配器实例（默认按当前环境自动选） */
  A.get = function (name) {
    var n = name || A.detect();
    if (_cached && _cached.name === n) return _cached;
    var impl = A[n];
    if (!impl) throw new Error('[MG.adapter] 适配器未加载: ' + n + '（请确认脚本加载顺序）');
    _cached = impl;
    return impl;
  };

  /** 测试用：强制指定平台 */
  A.force = function (name) {
    _cached = null;
    A._forced = name;
    return A.get(name);
  };

  /** 统一接口清单（给自己和后续扩展看的契约） */
  A.CONTRACT = [
    'init(opts)                    初始化画布与上下文',
    'getSystemInfo()               { width, height, dpr, ' + 'platform }',
    'getContext()                  CanvasRenderingContext2D',
    'onPointer(handler)            触摸/鼠标统一回调 { x, y, type }',
    'storage.get(key, def)         读存档',
    'storage.set(key, value)      写存档',
    'share(opts)                   分享 / 转发',
    'showRewardedAd()              Promise<boolean> 激励视频是否看完',
    'showInterstitial()            插屏广告（尽力而为）',
    'vibrate()                     短振动',
    'raf(fn)                       逐帧回调，返回取消函数',
    'now()                         时间戳(ms)',
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);

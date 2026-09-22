/**
 * 全局配置
 * 平台广告位 ID 在各平台后台创建后填到这里；留空时开发期自动空跑放行。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  MG.config = {
    designWidth: 750,
    roundSeconds: 30,
    rewardedContinueSeconds: 8,

    // 调试模式：把画布尺寸 / 坐标缩放 / 最近一次点击坐标直接画在屏幕上。
    // 方便在没有 Console（或真机）的情况下定位问题。上线前改为 false。
    debug: true,

    // 音效开关（assets/sfx 下的程序合成音）
    sfx: true,

    // 内置自测：启动 2.5 秒后自动注入「原生坐标」跑一遍关键链路，
    // 结果画在屏幕上并 POST 到本机（tools/report-server.mjs）。上线前改 false。
    selfTest: true,
    reportUrl: 'http://127.0.0.1:8899/report',

    // 广告位 ID：微信/抖音小游戏后台 → 流量主 → 广告位管理 里创建
    // 键名规则：<平台名>Rewarded / <平台名>Interstitial，平台名为 wx / tt / web
    adUnits: {
      wxRewarded: '',
      wxInterstitial: '',
      ttRewarded: '',
      ttInterstitial: ''
    },

    share: {
      title: '限时点靶｜30 秒你能点中几个'
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

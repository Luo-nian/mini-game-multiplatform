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

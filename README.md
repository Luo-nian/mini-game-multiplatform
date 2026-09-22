# mini-game-multiplatform

一套代码，多端小游戏。当前阶段：**技术骨架验证 + 多端构建链路打通**。

## 为什么是这套方案

| 约束 | 本方案 |
|---|---|
| 预算 ≤ 200 元 | 零依赖、零引擎、零构建工具链，成本 0 |
| 无企业资质 | 只走个人主体可用的广告变现（IAA） |
| 要覆盖多平台 | 一份 `src/` 同时装配出 Web / 微信小游戏 / 抖音小游戏 |
| 微信主包上限 4MB | 实测主包 **25.7 KB**（余量 99.4%） |

**不用游戏引擎的理由**：引擎自带运行时会让包体积上一个数量级，主包 4MB 的额度会先被引擎吃掉；而超休闲品类的玩法复杂度，用原生 Canvas 完全够。同时省掉几百 MB 的工具链与学习成本。

## 目录结构

```
src/
  config.js                  全局配置（广告位 ID 填这里）
  main.js                    启动装配（三端共用入口）
  core/
    game.js                  游戏主逻辑（禁止出现平台 API）
    adapter/
      index.js               适配层入口 + 平台探测
      minigame.js            微信/抖音通用适配器工厂
      wx.js                  微信小游戏适配器（薄壳）
      tt.js                  抖音小游戏适配器（薄壳）
      web.js                 浏览器适配器（含模拟广告，便于开发期跑通链路）
tools/
  build.mjs                  三端构建（输出 dist/ 并报告包体积）
  smoke.mjs                  冒烟测试（假 DOM 在 Node 里真跑一遍逻辑）
dist_tpl/index.html          Web 端页面模板
requirements/                需求文档（每版本一份）
design/                      美术与交互规范
```

**架构铁律**：`core/game.js` 里**不允许出现** `wx` / `tt` / `document` / `window`。
所有平台能力必须通过 `adapter` 调用 —— 这是"一套代码多平台"能成立的前提，破坏它就会退化成三份代码。

## 命令

```bash
# 构建三端（输出 dist/web、dist/wx、dist/tt，并打印各端体积）
node tools/build.mjs

# 冒烟测试（逻辑层 17 项断言）
node tools/smoke.mjs

# 本地预览 Web 端
python -m http.server 8707 --directory dist/web
# 浏览器打开 http://127.0.0.1:8707
```

## 三端发布流程

**Web / 网页游戏平台（最快见钱）**

1. `node tools/build.mjs`，取 `dist/web/`
2. 上传到 CrazyGames（开放提交、审核 1~2 天、无独占要求）
3. Poki 为精选制且要求网页独占，放到最后再谈

**微信小游戏**

1. 微信公众平台注册小游戏（主体选「个人」，一级类目「游戏」，**名称一次定死，注册后不可改**）
2. **注册完立刻提备案**（5~20 个工作日，是全流程瓶颈）
3. 微信开发者工具打开 `dist/wx/`（`project.config.json` 里的 appid 需换成自己的）
4. 累计独立访客 UV > 500 后开通流量主，再回填 `src/config.js` 的广告位 ID

**抖音小游戏**

1. 抖音开发者工具打开 `dist/tt/`
2. 资格口径有冲突（官方 FAQ 称个人仅支持「小玩法」），**以注册实测为准**

## 当前进度

- [x] 适配层设计（统一 11 个能力接口，见 `adapter/index.js` 的 CONTRACT）
- [x] 三端构建链路打通，包体积实测
- [x] 逻辑层冒烟测试全绿
- [x] 最小可玩原型：限时点靶（30 秒），含计分 / 结算 / 存档 / 激励视频位 / 分享位
- [ ] 玩法正式设计（另立需求文档）
- [ ] 微信开发者工具 + 抖音开发者工具安装（**本机尚未安装**）
- [ ] 真机验证

## 已知待办

- `dist/wx/project.config.json` 的 `appid` 是占位值 `touristappid`，接入真实账号后替换
- 广告位 ID 全为空 → 开发期走空跑放行（`adapter/minigame.js` 里有日志）
- 分享回调、插屏广告尚未在真机验证

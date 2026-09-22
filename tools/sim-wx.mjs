/**
 * 微信小游戏环境仿真测试
 *
 * 目的：在本地复现「小游戏里点不动」这类问题。
 * 做法：伪造 wx 全局对象（createCanvas / getSystemInfoSync / onTouchStart ...），
 *      不注入 document/window（小游戏环境本来就没有），然后按小游戏的方式加载真实源码，
 *      最后喂「原生触摸坐标」，验证整条链路：原生坐标 -> 适配层换算 -> 命中按钮/车辆。
 *
 * 用法：node tools/sim-wx.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 小游戏的加载顺序（与 dist/wx/game.js 一致）
const ORDER = [
  'src/core/adapter/index.js',
  'src/core/adapter/minigame.js',
  'src/core/adapter/wx.js',
  'src/core/adapter/tt.js',
  'src/core/adapter/web.js',
  'src/data/levels.js',
  'src/core/rush.js',
  'src/core/game.js',
  'src/config.js',
  'src/main.js',
];

// 模拟 iPhone 12/13 这类机型
const SCREEN = { w: 375, h: 812, dpr: 3 };

let nowMs = 1700000000000;
const rafQueue = [];
const storageMap = new Map();
let drawCalls = 0;
let touchHandlers = {};

function fakeCtx(canvas) {
  return new Proxy(
    { canvas },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 0 });
        return () => {
          drawCalls += 1;
        };
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    }
  );
}

const canvas = {
  width: 0,
  height: 0,
  getContext() {
    return ctx;
  },
};
const ctx = fakeCtx(canvas);

/** 伪造微信小游戏宿主对象 */
const wx = {
  createCanvas() {
    return canvas;
  },
  getSystemInfoSync() {
    return {
      windowWidth: SCREEN.w,
      windowHeight: SCREEN.h,
      screenWidth: SCREEN.w,
      screenHeight: SCREEN.h,
      pixelRatio: SCREEN.dpr,
      safeArea: { top: 44, bottom: SCREEN.h - 34, left: 0, right: SCREEN.w, width: SCREEN.w, height: SCREEN.h - 78 },
    };
  },
  onTouchStart(fn) {
    touchHandlers.start = fn;
  },
  onTouchMove(fn) {
    touchHandlers.move = fn;
  },
  onTouchEnd(fn) {
    touchHandlers.end = fn;
  },
  getStorageSync(k) {
    return storageMap.has(k) ? storageMap.get(k) : '';
  },
  setStorageSync(k, v) {
    storageMap.set(k, v);
  },
  vibrateShort() {},
  shareAppMessage() {},
  showShareMenu() {},
  createRewardedVideoAd() {
    return {
      load: () => Promise.resolve(),
      show: () => Promise.resolve(),
      onClose() {},
      onError() {},
    };
  },
  createInterstitialAd() {
    return { show: () => Promise.resolve() };
  },
};

const sandbox = {
  console,
  Math,
  JSON,
  parseInt,
  parseFloat,
  isNaN,
  Date: { now: () => nowMs },
  Promise,
  Error,
  Object,
  Array,
  String,
  Number,
  Uint8Array,
  requestAnimationFrame: (fn) => {
    rafQueue.push(fn);
    return rafQueue.length;
  },
  wx,
};
sandbox.globalThis = sandbox;
// 注意：故意不注入 document / window —— 小游戏环境没有它们
vm.createContext(sandbox);

const failures = [];
const errs = [];
const origErr = console.error;
console.error = (...a) => {
  errs.push(a.join(' '));
  origErr(...a);
};
function check(name, cond, extra = '') {
  if (cond) console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`);
  else {
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`);
  }
}
function pump(frames, stepMs = 16) {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue.splice(0, rafQueue.length);
    for (const fn of q) fn(nowMs);
    nowMs += stepMs;
  }
}

console.log('\n[1] 以「小游戏」方式加载模块（无 document / window）');
for (const rel of ORDER) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: rel });
  } catch (e) {
    failures.push('加载 ' + rel);
    console.log(`  FAIL  加载 ${rel}  ${e.message}`);
  }
}
const MG = sandbox.MG;
check('MG 已建立', !!MG);

console.log('\n[2] 适配层（应识别为 wx，而不是 web）');
const ad = MG && MG.adapter.get();
check('平台探测 = wx', ad && ad.name === 'wx', ad && ad.name);
check('web 适配器未被注册（小游戏环境没有 document，属预期）', !MG.adapter.web);
check('已注册触摸回调', !!touchHandlers.start, Object.keys(touchHandlers).join(','));

console.log('\n[3] 画布尺寸（这是「全白」的元凶，必须显式设置）');
check('画布物理宽 = 屏幕宽 × dpr', canvas.width === SCREEN.w * SCREEN.dpr, `${canvas.width} (期望 ${SCREEN.w * SCREEN.dpr})`);
check('画布物理高 = 屏幕高 × dpr', canvas.height === SCREEN.h * SCREEN.dpr, `${canvas.height} (期望 ${SCREEN.h * SCREEN.dpr})`);

console.log('\n[4] 启动（小游戏不该等 DOMContentLoaded）');
check('__mg 已挂载（说明启动分支走对了）', !!sandbox.__mg);
const game = sandbox.__mg && sandbox.__mg.game;
const info = ad.getSystemInfo();
check('dpr 取自 pixelRatio', info.dpr === SCREEN.dpr, `dpr=${info.dpr}`);
check('坐标缩放比 = 设计宽 / 屏幕宽', Math.abs(ad._scale - 750 / SCREEN.w) < 1e-6, `scale=${ad._scale}`);
check('虚拟画布宽 = 750', game.vw === 750, `vw=${game.vw}`);
pump(20);
check('有绘制调用', drawCalls > 200, `drawCalls=${drawCalls}`);

console.log('\n[5] 用「原生触摸坐标」点开始按钮（核心：看得见必须点得着）');
pump(2);
// 注意：ready 状态下屏幕底部还画着「重开 / 提示」两个置灰按钮，它们也注册在 btns 里
// 并会「吃掉」落在自身范围内的点击（命中即 return）。所以要按「开始」按钮的真实位置点，
// 不能拿 btns[0] 当开始按钮用。
const startBtn = game.btns.filter(function (b) { return b.y < game.vh * 0.8; }).pop();
check(
  'ready 状态存在开始按钮（中下部）',
  !!startBtn,
  startBtn ? `虚拟 ${startBtn.x.toFixed(0)},${startBtn.y.toFixed(0)} ${startBtn.w}x${startBtn.h}` : 'none'
);
check(
  '底部置灰按钮不会挡住开始按钮（两者区域不重叠）',
  !!startBtn && game.btns.every(function (b) {
    return b === startBtn || b.y + b.h <= startBtn.y || b.y >= startBtn.y + startBtn.h;
  })
);

function touch(virtualX, virtualY, phase) {
  // 反向换算：虚拟坐标 -> 原生坐标（模拟玩家的手指落在那个位置）
  const n = { clientX: (virtualX * SCREEN.w) / 750, clientY: (virtualY * SCREEN.w) / 750 };
  const fn = touchHandlers[phase];
  if (fn) fn({ touches: [{ clientX: n.clientX, clientY: n.clientY }], changedTouches: [{ clientX: n.clientX, clientY: n.clientY }] });
  return n;
}

if (startBtn) {
  const before = game.state;
  touch(startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2, 'start');
  pump(2);
  check('点开始按钮后进入 playing', game.state === 'playing', `${before} -> ${game.state}`);
} else {
  check('点开始按钮后进入 playing', false, '没有按钮可点');
}

console.log('\n[6] 拖拽车辆（原生坐标 -> 命中车辆 -> 位置变化）');
// 换成可控棋盘
game.board = {
  targetId: 0,
  cars: [
    { id: 0, x: 0, y: 2, len: 2, dir: 'h' },
    { id: 1, x: 3, y: 1, len: 2, dir: 'v' },
  ],
};
game.moves = 0;
pump(1);
const blocker = game.board.cars[1];
const rc = game._carRect(blocker);
const mx = rc.x + rc.w / 2;
const my = rc.y + rc.h / 2;
touch(mx, my, 'start');
touch(mx, my - game.cell, 'move');
touch(mx, my - game.cell, 'end');
check('拦路车上移一格', blocker.y === 0, `y=${blocker.y}`);
check('计 1 步', game.moves === 1, `moves=${game.moves}`);

console.log('\n[7] 过关与推进');
game.board.cars[0].x = 4;
game._afterMove();
check('目标车到出口后 solved', game.state === 'solved', game.state);
game.nextLevel();
pump(2);
check('下一关 playing，关卡 +1', game.state === 'playing' && game.level === 2, `level=${game.level}`);
check('进度写入小游戏 storage', storageMap.get('mg_level') === '2', `mg_level=${storageMap.get('mg_level')}`);

check('全程没有抛错', errs.length === 0, errs.slice(0, 1).join(''));

console.log('');
if (failures.length) {
  console.log(`结果：${failures.length} 项失败 -> ${failures.join(', ')}\n`);
  process.exit(1);
} else {
  console.log('结果：小游戏环境下全部通过\n');
}

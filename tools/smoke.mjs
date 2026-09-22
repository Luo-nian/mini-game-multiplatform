/**
 * 冒烟测试：用假 DOM 在 Node 里把 Web 端逻辑真跑一遍
 * 目的：证明「不是构建成功，而是逻辑真能跑」——主循环 / 输入 / 状态机 / 计时 / 存档
 *
 * 用法：node tools/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ORDER = [
  'src/core/adapter/index.js',
  'src/core/adapter/minigame.js',
  'src/core/adapter/wx.js',
  'src/core/adapter/tt.js',
  'src/core/adapter/web.js',
  'src/core/game.js',
  'src/config.js',
  'src/main.js',
];

let nowMs = 1700000000000;
const rafQueue = [];
const storageMap = new Map();
let drawCalls = 0;

function fakeCtx(canvas) {
  return new Proxy(
    { canvas },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'canvas') return canvas;
        return (...args) => {
          drawCalls += 1;
          return undefined;
        };
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    }
  );
}

function fakeEl(tag) {
  return {
    tagName: tag,
    style: { cssText: '' },
    textContent: '',
    onclick: null,
    appendChild() {},
    remove() {},
  };
}

const canvas = {
  width: 0,
  height: 0,
  clientWidth: 390,
  clientHeight: 844,
  getContext() {
    return ctx;
  },
  addEventListener() {},
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  },
};
const ctx = fakeCtx(canvas);

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
  requestAnimationFrame: (fn) => {
    rafQueue.push(fn);
    return rafQueue.length;
  },
  setTimeout: () => 0,
  setInterval: () => 0,
  clearInterval: () => {},
  navigator: {},
  window: {
    devicePixelRatio: 2,
    innerWidth: 390,
    innerHeight: 844,
    addEventListener() {},
    location: { href: 'http://localhost/' },
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
    },
  },
  document: {
    readyState: 'complete',
    title: 'smoke',
    getElementById: () => canvas,
    createElement: (tag) => fakeEl(tag),
    addEventListener() {},
    body: { appendChild() {} },
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const failures = [];
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`);
  } else {
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

console.log('\n[1] 加载模块');
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
check('MG 命名空间已建立', !!MG);

console.log('\n[2] 适配层');
const ad = MG && MG.adapter.get();
check('平台探测 = web', ad && ad.name === 'web', ad && ad.name);
check('系统信息可用', !!ad.getSystemInfo().width, `${ad.getSystemInfo().width}x${ad.getSystemInfo().height} dpr=${ad.getSystemInfo().dpr}`);
check('上下文已拿到', !!ad.getContext());

console.log('\n[3] 启动与主循环');
check('__mg 已挂载（main.js 自启动成功）', !!sandbox.__mg);
const game = sandbox.__mg.game;
check('初始状态 = ready', game.state === 'ready', game.state);
check('虚拟画布尺寸合理', game.vw === 750 && game.vh > 1000, `${game.vw}x${game.vh.toFixed(0)}`);
pump(30);
check('30 帧内产生绘制调用', drawCalls > 100, `drawCalls=${drawCalls}`);

console.log('\n[4] 输入与状态机');
game.onPointer({ x: 375, y: game.vh / 2 + 80, type: 'down' }); // 点「开始」按钮区域
pump(2);
check('点击后进入 playing', game.state === 'playing', game.state);
check('计时已开始倒数', game.timeLeft < 30, `timeLeft=${game.timeLeft.toFixed(2)}`);

console.log('\n[5] 计分');
const before = game.kills;
let hit = false;
for (let i = 0; i < 900 && !hit; i++) {
  pump(1, 16);
  if (game.blocks.length) {
    const b = game.blocks[0];
    game.onPointer({ x: b.x, y: b.y, type: 'down' });
    hit = game.kills > before;
  }
}
check('点中方块能得分', hit, `kills=${game.kills}`);

console.log('\n[6] 结算与存档');
let guard = 0;
while (game.state === 'playing' && guard < 3000) {
  pump(5, 100);
  guard += 1;
}
check('时间到自动结算', game.state === 'over', game.state);
check('最高分已写入 storage', storageMap.get('mg_best') === String(game.kills), `mg_best=${storageMap.get('mg_best')}`);

console.log('\n[7] 重开');
game.onPointer({ x: 375, y: game.vh / 2 + 92 + 52, type: 'down' }); // 点「再来一局」
pump(2);
check('重开后回到 playing', game.state === 'playing', game.state);
check('重开后分数清零', game.kills === 0, `kills=${game.kills}`);

console.log('\n[8] 抖音/微信适配器注册（同一份代码的三端实现都应在位）');
check('A.wx 未被误注册（浏览器环境）', !MG.adapter.wx, String(!!MG.adapter.wx));
check('A.tt 未被误注册（浏览器环境）', !MG.adapter.tt, String(!!MG.adapter.tt));
check('A.web 已注册', !!MG.adapter.web);

console.log('');
if (failures.length) {
  console.log(`结果：${failures.length} 项失败 -> ${failures.join(', ')}\n`);
  process.exit(1);
} else {
  console.log('结果：全部通过，逻辑层可用\n');
}

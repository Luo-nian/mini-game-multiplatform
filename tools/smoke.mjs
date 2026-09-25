/**
 * 冒烟测试：用假 DOM 在 Node 里把逻辑真跑一遍
 * 覆盖两层：
 *   1) 玩法引擎（车位脱困）—— 关卡生成必有解、滑动规则、BFS 最短步数正确
 *   2) 游戏层 —— 主循环 / 拖拽输入 / 过关判定 / 关卡推进 / 存档
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
  'src/data/levels.js',
  'src/core/rush.js',
  'src/core/game.js',
  'src/config.js',
  'src/main.js',
];

let nowMs = 1700000000000;
const rafQueue = [];
const storageMap = new Map();
let drawCalls = 0;

const listeners = {};
const canvas = {
  width: 0,
  height: 0,
  clientWidth: 390,
  clientHeight: 844,
  getContext() {
    return ctx;
  },
  addEventListener(type, fn) {
    (listeners[type] || (listeners[type] = [])).push(fn);
  },
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 390, height: 844 };
  },
};
const ctx = new Proxy(
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

function fakeEl(tag) {
  return { tagName: tag, style: { cssText: '' }, textContent: '', onclick: null, appendChild() {}, remove() {} };
}

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
check('rush 引擎已挂载', !!MG.rush);

console.log('\n[2] 玩法引擎 · 求解器');
const R = MG.rush;
// 人工构造：目标车(0,2,len2,h) 被垂直车(3,1)-(3,2) 挡住
// 正解 = 先把拦路车上移 1 格，再把目标车右移 4 格 => 5 步
const crafted = {
  targetId: 0,
  cars: [
    { id: 0, x: 0, y: 2, len: 2, dir: 'h' },
    { id: 1, x: 3, y: 1, len: 2, dir: 'v' },
  ],
};
const craftedSolve = R.solve(crafted);
check('构造关卡判定为有解', craftedSolve.solvable === true);
// ⚠️ 步数语义：一辆车一次拖「任意格」= 1 步。此局真实最少 2 步
//（挪开拦路车 1 步 + 红车一次拖到出口 1 步）。
// 旧版 BFS 每次只走 1 格、把「格数」当步数（记 5），导致星级判定与难度曲线全失真，已修。
check('最短步数 = 2（真实步数语义：1 步让路 + 1 步出车）', craftedSolve.minSteps === 2, `minSteps=${craftedSolve.minSteps}`);
const fm = craftedSolve.firstMove;
const legalFirst = !!fm && ((fm.carId === 1 && fm.delta === -1) || (fm.carId === 0 && fm.delta === 1));
check('首选走法是合法走法（让路 或 目标车先右移）', legalFirst, fm ? `car=${fm.carId} delta=${fm.delta}` : 'null');

console.log('\n[3] 玩法引擎 · 滑动规则');
const slipBoard = {
  targetId: 0,
  cars: [
    { id: 0, x: 1, y: 2, len: 2, dir: 'h' },
    { id: 1, x: 4, y: 2, len: 2, dir: 'h' },
  ],
};
check('相邻阻挡：目标车最多右移 1 格', R.maxSlide(slipBoard, 0, 1) === 1, `max=${R.maxSlide(slipBoard, 0, 1)}`);
check('左侧边界：最多左移 1 格', R.maxSlide(slipBoard, 0, -1) === 1, `max=${R.maxSlide(slipBoard, 0, -1)}`);
const edgeBoard = { targetId: 0, cars: [{ id: 0, x: 0, y: 2, len: 2, dir: 'h' }] };
check('贴左边界时不能再左移', R.maxSlide(edgeBoard, 0, -1) === 0);
check('无阻挡时能一路到出口', R.maxSlide(edgeBoard, 0, 1) === 4, `max=${R.maxSlide(edgeBoard, 0, 1)}`);
const movedOk = R.move(edgeBoard, 0, 4);
check('move(4) 一路移到出口', movedOk === 4 && edgeBoard.cars[0].x === 4, `moved=${movedOk} x=${edgeBoard.cars[0].x}`);
const blockedBoard = {
  targetId: 0,
  cars: [
    { id: 0, x: 0, y: 2, len: 2, dir: 'h' },
    { id: 1, x: 3, y: 2, len: 2, dir: 'h' },
  ],
};
const blockedMoved = R.move(blockedBoard, 0, 4);
check('被挡住时只走到能走的格数（不会穿车）', blockedMoved === 1, `moved=${blockedMoved}`);
check('到达出口即判定过关', R.isSolved(edgeBoard) === true);

console.log('\n[4] 玩法引擎 · 关卡生成器（关键：绝不能给玩家无解关卡）');
const t0 = Date.now();
let bad = 0;
let tooEasy = 0;
const SAMPLE = 12;
for (let lv = 1; lv <= SAMPLE; lv++) {
  const g = R.generate(lv);
  if (!R.solve(g.board, 80000).solvable) bad += 1;
  if (g.minSteps < 1) tooEasy += 1;
}
const genMs = Date.now() - t0;
check(`抽样生成 ${SAMPLE} 关全部有解`, bad === 0, `坏关卡=${bad}`);
check('最短步数均 >= 1', tooEasy === 0);
const tHigh = Date.now();
R.generate(150);
const highMs = Date.now() - tHigh;
console.log(
  `        生成器速度：低关卡 ${(genMs / SAMPLE).toFixed(0)}ms/关，高关卡 ${highMs}ms/关 —— 所以运行时改读离线关卡表`
);
// 难度递增由「关卡表曲线」保证（见 tools/genlevels.mjs），不再由运行时 generate 保证 ——
// generate 现在只做关卡表之外的兜底（固定 11 车 / 目标 11 步）。
const lv1 = R.getLevel(1);
const lv30 = R.getLevel(30);
const lvLate = R.getLevel(Math.min(200, MG.levels.length));
check('第 1 关车辆数少（新手友好）', lv1.board.cars.length <= 4, `车=${lv1.board.cars.length}`);
check('第 30 关车辆数更多（递增）', lv30.board.cars.length > lv1.board.cars.length, `${lv1.board.cars.length} -> ${lv30.board.cars.length}`);
check(
  '后期关卡最少步数显著高于前期（曲线确实递增）',
  lvLate.minSteps > lv30.minSteps + 3,
  `第30关 ${lv30.minSteps} 步 -> 第${Math.min(200, MG.levels.length)}关 ${lvLate.minSteps} 步`
);
check(
  '表外关卡走兜底生成器且保证有解',
  (() => {
    const g = R.generate(9999);
    return R.solve(g.board, 120000).solvable;
  })(),
  'generate(9999)'
);
check('关卡表每关都标记了最少步数', MG.levels.every((x) => x.m >= 1), `共 ${MG.levels.length} 关`);

console.log('\n[4b] 关卡表（离线预生成，运行时零计算）');
check('关卡表已加载', Array.isArray(MG.levels) && MG.levels.length > 0, `${MG.levels ? MG.levels.length : 0} 关`);
if (Array.isArray(MG.levels) && MG.levels.length) {
  const tGet = Date.now();
  let getBad = 0;
  for (let lv = 1; lv <= MG.levels.length; lv++) {
    const g = MG.rush.getLevel(lv);
    if (!g.board || g.board.cars.length < 2) getBad += 1;
  }
  const getMs = Date.now() - tGet;
  check('表内全部关卡可取出', getBad === 0);
  check(`取全部 ${MG.levels.length} 关 < 60ms（相对生成器快 2000 倍以上）`, getMs < 60, `${getMs}ms`);
  const first = MG.rush.getLevel(1);
  check('第 1 关为简单关（车辆少）', first.board.cars.length <= 6, `车=${first.board.cars.length}`);
  check('关卡表带最少步数', typeof first.minSteps === 'number' && first.minSteps >= 1, `minSteps=${first.minSteps}`);
}

console.log('\n[5] 游戏层 · 启动与主循环');
const ad = MG.adapter.get();
check('平台探测 = web', ad.name === 'web');
check('__mg 已挂载（main.js 自启动成功）', !!sandbox.__mg);
const game = sandbox.__mg.game;
check('初始状态 = ready', game.state === 'ready', game.state);
pump(20);
check('产生绘制调用', drawCalls > 200, `drawCalls=${drawCalls}`);

console.log('\n[6] 游戏层 · 输入链路（原生坐标 -> 虚拟坐标）');
// 关键：必须经过适配层喂「原生坐标」，才能覆盖坐标换算。
// 直接调 game.onPointer 喂虚拟坐标等于绕过换算，测了也白测。
const NATIVE_W = 390;
const toNative = (vx, vy) => ({ x: (vx * NATIVE_W) / 750, y: (vy * NATIVE_W) / 750 });
const EVENT_MAP = { down: 'mousedown', move: 'mousemove', up: 'mouseup' };

function dispatch(type, nativeX, nativeY) {
  const fns = listeners[EVENT_MAP[type]] || [];
  for (const fn of fns) fn({ clientX: nativeX, clientY: nativeY, buttons: 1 });
}
/** 按「虚拟坐标」描述意图，实际派发的是原生坐标，由适配层负责换算 */
function touchV(vx, vy, type) {
  const n = toNative(vx, vy);
  dispatch(type, n.x, n.y);
}

game.startLevel(1);
pump(2);
check('已进入 playing', game.state === 'playing', game.state);

// 换成可控棋盘：垂直拦路车挡住目标车
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

touchV(mx, my, 'down');
touchV(mx, my - game.cell, 'move');
touchV(mx, my - game.cell, 'up');
check('经适配层拖拽：拦路车上移一格', blocker.y === 0, `y=${blocker.y}`);
check('一次拖拽计 1 步', game.moves === 1, `moves=${game.moves}`);

// 对照实验：故意把虚拟坐标当原生坐标喂（复现「忘记换算」的 bug）→ 应当点不中
blocker.y = 1;
game.moves = 0;
dispatch('down', mx, my);
dispatch('up', mx, my);
check(
  '对照：不换算坐标时点不中车辆（证明本测试确实覆盖了换算）',
  blocker.y === 1 && game.moves === 0,
  `y=${blocker.y} moves=${game.moves}`
);

console.log('\n[7] 游戏层 · 过关与推进');
game.board.cars[0].x = 4; // 直接把目标车放到出口
game._afterMove();
check('目标车到出口后进入 solved', game.state === 'solved', game.state);
game.nextLevel();
pump(2);
check('下一关回到 playing', game.state === 'playing', game.state);
check('关卡号 +1', game.level === 2, `level=${game.level}`);
check('步数清零', game.moves === 0, `moves=${game.moves}`);
check('进度已写入 storage', storageMap.get('mg_level') === '2', `mg_level=${storageMap.get('mg_level')}`);

console.log('\n[7b] 游戏层 · 提示走法');
const hint = MG.rush.hint(game.board);
check('提示能返回一步走法', !!hint && typeof hint.carId === 'number', hint ? `car=${hint.carId} delta=${hint.delta}` : 'null');

console.log('\n[8] 适配层隔离性（同一份代码的三端实现）');
check('浏览器环境未误注册 wx', !MG.adapter.wx);
check('浏览器环境未误注册 tt', !MG.adapter.tt);
check('web 已注册', !!MG.adapter.web);

console.log('\n[9] 逻辑层纯净性（架构铁律）');
const gameSrc = fs.readFileSync(path.join(ROOT, 'src/core/game.js'), 'utf8');
const rushSrc = fs.readFileSync(path.join(ROOT, 'src/core/rush.js'), 'utf8');
// 只看代码，不看注释（注释里提到平台 API 名是为了说明约束，不算违规）
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const banned = [/\bdocument\b/, /\bwindow\b/, /\bwx\./, /\btt\./];
const dirty = [];
const cleanGame = stripComments(gameSrc);
const cleanRush = stripComments(rushSrc);
for (const re of banned) {
  if (re.test(cleanGame)) dirty.push('game.js ' + re);
  if (re.test(cleanRush)) dirty.push('rush.js ' + re);
}
check('core 逻辑层未出现任何平台 API', dirty.length === 0, dirty.join(', '));

console.log('');
if (failures.length) {
  console.log(`结果：${failures.length} 项失败 -> ${failures.join(', ')}\n`);
  process.exit(1);
} else {
  console.log('结果：全部通过\n');
}

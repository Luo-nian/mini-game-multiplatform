/**
 * 微信开发者工具 · 自动化调试（小游戏）
 *
 * 通过官方 CLI(`D:\Weixin_DevTools\cli.bat`) + miniprogram-automator 驱动 IDE：
 *   启动项目 → 读游戏内部状态 → 注入「原生坐标」模拟真实手指 → 截图
 *
 * 为什么注入原生坐标：适配层负责把原生坐标换算成虚拟坐标，只有这样走一遍，
 * 才能真正复现「看得见点不着」这类问题（直接喂虚拟坐标等于绕过换算）。
 *
 * 用法：node tools/auto-debug.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const AUTOMATOR_PATH =
  'C:/Users/Hasee/.workbuddy/binaries/node/workspace/node_modules/miniprogram-automator';
const automator = require(AUTOMATOR_PATH);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(ROOT, '.tmp');
const CLI = 'D:/Weixin_DevTools/cli.bat';
const PROJECT = path.join(ROOT, 'dist', 'wx');

fs.mkdirSync(SHOT_DIR, { recursive: true });

const failures = [];
function check(name, cond, extra = '') {
  if (cond) console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`);
  else {
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const AUTO_PORT = 9421;
const WIN_CLI = CLI.replace(/\//g, '\\');
const WIN_PROJECT = PROJECT.replace(/\//g, '\\');

/** 端口是否已在监听 */
function isPortOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.setTimeout(1200);
    s.on('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.on('timeout', () => {
      s.destroy();
      resolve(false);
    });
  });
}

/**
 * 确保自动化服务在跑。
 * 注意：不能直接用 miniprogram-automator 的 launch() —— 它在 Windows 上用 child_process.spawn
 * 直接执行 .bat，会失败（官方客户端的已知问题）。这里用 cmd /c 拉起来，然后自己 connect。
 */
async function ensureService() {
  if (await isPortOpen(AUTO_PORT)) {
    console.log('  自动化服务已在 ws://127.0.0.1:' + AUTO_PORT);
    return;
  }
  console.log('  拉起 CLI 自动化服务…');
  spawn('cmd.exe', ['/c', WIN_CLI, 'auto', '--project', WIN_PROJECT, '--auto-port', String(AUTO_PORT)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 40; i++) {
    await wait(1500);
    if (await isPortOpen(AUTO_PORT)) {
      console.log('  服务就绪 ws://127.0.0.1:' + AUTO_PORT);
      return;
    }
  }
  throw new Error('自动化端口 ' + AUTO_PORT + ' 未就绪（IDE 可能没打开项目或服务端口被关）');
}

/** 读取游戏内部状态（在游戏环境里执行） */
function readState(mp) {
  return mp.evaluate(function () {
    var m = globalThis.__mg;
    if (!m || !m.game) return { ok: false };
    var g = m.game;
    var a = m.adapter;
    var cv = a.getCanvas ? a.getCanvas() : null;
    return {
      ok: true,
      adapter: a.name,
      scale: a._scale,
      canvas: cv ? cv.width + 'x' + cv.height : '?',
      state: g.state,
      level: g.level,
      moves: g.moves,
      cars: g.board ? g.board.cars.length : 0,
      vw: g.vw,
      vh: Math.round(g.vh),
      btns: g.btns.map(function (b) {
        return [Math.round(b.x), Math.round(b.y), b.w, b.h];
      }),
      last: g.lastPointer,
      result: g._result,
    };
  });
}

/** 注入原生坐标（适配层自己换算，等价于真实触摸路径） */
function touchNative(mp, nx, ny, type) {
  return mp.evaluate(
    function (x, y, t) {
      var a = globalThis.__mg.adapter;
      if (!a._handler) return false;
      a._handler({ x: x, y: y, type: t });
      return true;
    },
    nx,
    ny,
    type
  );
}

async function shot(mp, name) {
  const p = path.join(SHOT_DIR, name + '.png');
  await mp.screenshot({ path: p });
  console.log('        截图 -> ' + p);
  return p;
}

async function main() {
  console.log('\n[1] 连接开发者工具');
  await ensureService();
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + AUTO_PORT });
  console.log('  已连接（自动化会话）');

  console.log('\n[2] 读取初始状态');
  let s = await readState(mp);
  console.log('  ' + JSON.stringify(s));
  check('连上游戏（__mg 可用）', s.ok === true);
  check('平台识别 = wx', s.adapter === 'wx', String(s.adapter));
  check('画布物理尺寸已设置（非 0）', /^[1-9]\d*x[1-9]\d*$/.test(String(s.canvas)), String(s.canvas));
  check('坐标缩放比合理（>1）', s.scale > 1 && s.scale < 5, 'scale=' + s.scale);
  check('虚拟画布宽 = 750', s.vw === 750, String(s.vw));
  await shot(mp, '01-初始');

  console.log('\n[3] 注入原生坐标点「开始」');
  const startBtn = await mp.evaluate(function () {
    var g = globalThis.__mg.game;
    var list = g.btns.filter(function (b) {
      return b.y < g.vh * 0.8;
    });
    var b = list[list.length - 1];
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  });
  console.log('  开始按钮（虚拟坐标）', JSON.stringify(startBtn));
  check('找到开始按钮', !!startBtn);

  if (startBtn) {
    const sc = s.scale;
    const vx = startBtn.x + startBtn.w / 2;
    const vy = startBtn.y + startBtn.h / 2;
    // 反推手指在屏幕上的位置（原生坐标），再注入 —— 与真实点击同一条路径
    await touchNative(mp, vx / sc, vy / sc, 'down');
    await wait(500);
    s = await readState(mp);
    check('点「开始」后进入 playing', s.state === 'playing', 'state=' + s.state + ' result=' + s.result);
    console.log('        最近输入 -> ' + JSON.stringify(s.last));
    await shot(mp, '02-开局');
  }

  console.log('\n[4] 注入原生坐标拖一辆车');
  const target = await mp.evaluate(function () {
    var g = globalThis.__mg.game;
    if (!g.board) return null;
    for (var i = 0; i < g.board.cars.length; i++) {
      var c = g.board.cars[i];
      if (c.id === g.board.targetId) continue;
      var up = MG.rush.maxSlide(g.board, c.id, -1);
      var down = MG.rush.maxSlide(g.board, c.id, 1);
      if (up > 0 || down > 0) {
        var r = g._carRect(c);
        return {
          id: c.id,
          delta: up > 0 ? -1 : 1,
          moves: up > 0 ? up : down,
          cx: r.x + r.w / 2,
          cy: r.y + r.h / 2,
          cell: g.cell,
        };
      }
    }
    return null;
  });
  console.log('  目标车', JSON.stringify(target));
  check('找到可移动的车', !!target);

  if (target) {
    const before = await mp.evaluate(function (id) {
      var g = globalThis.__mg.game;
      var c = MG.rush.carById(g.board, id);
      return { x: c.x, y: c.y, moves: g.moves };
    }, target.id);
    const sc = s.scale;
    const nx = target.cx / sc;
    const ny = target.cy / sc;
    const ny2 = (target.cy + target.delta * target.cell) / sc;
    await touchNative(mp, nx, ny, 'down');
    await touchNative(mp, nx, ny2, 'move');
    await touchNative(mp, nx, ny2, 'up');
    await wait(500);
    const after = await mp.evaluate(function (id) {
      var g = globalThis.__mg.game;
      var c = MG.rush.carById(g.board, id);
      return { x: c.x, y: c.y, moves: g.moves };
    }, target.id);
    check('车辆确实移动了', before.x !== after.x || before.y !== after.y, JSON.stringify(before) + ' -> ' + JSON.stringify(after));
    check('步数 +1', after.moves === before.moves + 1, 'moves=' + after.moves);
    await shot(mp, '03-拖拽后');
  }

  console.log('\n[5] 收尾');
  s = await readState(mp);
  console.log('  ' + JSON.stringify({ state: s.state, moves: s.moves, cars: s.cars }));
  await mp.close();
  console.log('  自动化连接已关闭');

  console.log('');
  if (failures.length) {
    console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(', ') + '\n');
    process.exit(1);
  } else {
    console.log('结果：开发者工具内全部通过（真实小游戏环境）\n');
  }
}

main().catch((e) => {
  console.error('自动化失败：' + (e && e.message));
  if (e && e.stack) console.error(e.stack);
  process.exit(2);
});

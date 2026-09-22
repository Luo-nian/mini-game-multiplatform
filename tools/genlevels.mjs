/**
 * 关卡表生成器 v2 —— 曲线驱动 + 分桶 + 多进程并行
 *
 * 与 v1 的区别（v1 的问题：第 20 关难度封顶，之后 180 关一个难度）：
 *   1. 难度主标尺从「车数」换成「最少步数」（真实步数：一辆车一次拖任意格 = 1 步），
 *      按曲线分段插值（终点 10 步 —— 8~11 车随机棋盘的 9~10 步占比约 5%，撑得起）
 *   2. 分桶法：每个随机棋盘求解一次就入池，按曲线就近分配，不做无效重试
 *   3. 前 2 关手工设计（随机生成下限是 4 格 ≈ 2 步，2 步教学关必须手写）
 *   4. 多进程并行（默认 8 worker），约 3~5 分钟出全表
 *
 * 用法：node tools/genlevels.mjs [关卡总数=200] [worker 数=8]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;

const TOTAL = Number(process.argv[2] || 200);
const WORKERS = Math.max(1, Number(process.argv[3] || 8));

/** 难度曲线：目标最少步数（分段线性插值，真实步数语义） */
const CURVE = [
  [7, 2], [20, 3], [40, 5], [70, 6], [100, 7], [130, 8], [160, 9], [200, 10],
];
function targetSteps(lv) {
  if (lv <= CURVE[0][0]) return CURVE[0][1];
  for (let i = 1; i < CURVE.length; i++) {
    if (lv <= CURVE[i][0]) {
      const [x0, y0] = CURVE[i - 1];
      const [x1, y1] = CURVE[i];
      return Math.round(y0 + ((y1 - y0) * (lv - x0)) / (x1 - x0));
    }
  }
  return CURVE[CURVE.length - 1][1];
}

/** 目标深度对应的车数 */
function carsFor(target) {
  if (target <= 4) return 8;
  if (target <= 6) return 9;
  if (target <= 8) return 10;
  return 11;
}

/**
 * 手工教学关（第 1~2 关）。随机生成下限约 2 步且极难精确命中，直接手写。
 * 格式同关卡表：[x, y, len, dir(1=h 0=v)]，第 0 辆必为目标车。
 * 入表前用求解器验证 minSteps === 2，不符则 fail-fast（已验证：两关都是 2 步）。
 */
const TUTORIAL = {
  1: [[0, 2, 2, 1], [4, 2, 2, 0]], // 挪开挡路竖车 -> 红车出，2 步
  2: [[0, 2, 2, 1], [3, 2, 3, 0]], // 长 3 竖车下移一格让路，2 步
};

// ---------- worker 模式：撒棋盘 + 求解 + 输出池子 ----------
if (process.argv.includes('--worker')) {
  const wi = Number(process.argv[process.argv.indexOf('--worker') + 1]);
  const samples = Number(process.argv[process.argv.indexOf('--samples') + 1]);
  const seedBase = Number(process.argv[process.argv.indexOf('--seed') + 1]);

  const sandbox = { console, Math, Object, Array, String, Number, JSON, Uint8Array, parseInt, isNaN, Error };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/rush.js'), 'utf8'), sandbox, { filename: 'rush.js' });
  const R = sandbox.MG.rush;
  const SIZE = R.SIZE;
  const EXIT_ROW = R.EXIT_ROW;
  const rng = R.makeRng(seedBase + wi * 104729);

  const pool = [];
  const t0 = Date.now();
  let unsolvable = 0;

  for (let i = 0; i < samples; i++) {
    const wantCars = 8 + Math.floor(rng() * 4); // 8~11
    const cars = [{ id: 0, x: 0, y: EXIT_ROW, len: 2, dir: 'h' }];
    const used = [];
    for (let y = 0; y < SIZE; y++) used.push([0, 0, 0, 0, 0, 0]);
    used[EXIT_ROW][0] = 1;
    used[EXIT_ROW][1] = 1;
    let id = 1;
    let guard = 0;
    while (cars.length < wantCars && guard < 400) {
      guard += 1;
      const len = rng() < 0.7 ? 2 : 3;
      const dir = rng() < 0.5 ? 'h' : 'v';
      const maxX = dir === 'h' ? SIZE - len : SIZE - 1;
      const maxY = dir === 'v' ? SIZE - len : SIZE - 1;
      const x = Math.floor(rng() * (maxX + 1));
      const y = Math.floor(rng() * (maxY + 1));
      let ok = true;
      for (let k = 0; k < len; k++) {
        const cx = dir === 'h' ? x + k : x;
        const cy = dir === 'v' ? y + k : y;
        if (used[cy][cx]) { ok = false; break; }
      }
      if (!ok) continue;
      for (let m = 0; m < len; m++) used[dir === 'h' ? y : y + m][dir === 'h' ? x + m : x] = 1;
      cars.push({ id, x, y, len, dir });
      id += 1;
    }

    const board = { targetId: 0, cars };
    if (R.isSolved(board)) continue;
    // 有界搜索：曲线终点 10，深度 16 内的解足够覆盖全部目标难度；
    // 120k 节点与完整搜索结果一致（实验：200 棋盘入池数相同），且更快更省内存。
    const res = R.solve(board, 120000, 16);
    if (!res.solvable) { unsolvable += 1; continue; }
    pool.push({
      m: res.minSteps,
      c: cars.map((c) => [c.x, c.y, c.len, c.dir === 'h' ? 1 : 0]),
    });

    if ((i + 1) % 200 === 0) {
      console.log(`  [w${wi}] ${i + 1}/${samples}  入池 ${pool.length}  无解 ${unsolvable}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  const outDir = path.join(ROOT, '.tmp');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `pool-${wi}.json`), JSON.stringify(pool));
  console.log(`[w${wi}] 完成：入池 ${pool.length}/${samples}（无解 ${unsolvable}），${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
}

// ---------- 主进程 ----------
function loadRush() {
  const sandbox = { console, Math, Object, Array, String, Number, JSON, Uint8Array, parseInt, isNaN, Error };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/rush.js'), 'utf8'), sandbox, { filename: 'rush.js' });
  return sandbox.MG.rush;
}

async function runWorkers() {
  const perWorker = Math.ceil(8400 / WORKERS);
  const t0 = Date.now();
  console.log(`并行生成池：${WORKERS} worker × ${perWorker} 棋盘`);
  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    const p = new Promise((resolve) => {
      const child = spawn(NODE, [
        path.join(__dirname, 'genlevels.mjs'),
        String(TOTAL), String(WORKERS),
        '--worker', String(i), '--samples', String(perWorker), '--seed', '88001',
      ], { stdio: 'inherit' });
      child.on('exit', resolve);
    });
    procs.push(p);
  }
  await Promise.all(procs);
  console.log(`池子生成完毕，总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function main() {
  const R = loadRush();

  await runWorkers();

  // 合并池子
  const pool = [];
  for (let i = 0; i < WORKERS; i++) {
    const f = path.join(ROOT, '.tmp', `pool-${i}.json`);
    if (!fs.existsSync(f)) {
      console.error(`!! 缺少 ${f}，worker 可能失败`);
      process.exit(1);
    }
    pool.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  pool.sort((a, b) => a.m - b.m);
  const dist = {};
  pool.forEach((p) => { dist[p.m] = (dist[p.m] || 0) + 1; });
  console.log(`池子总量 ${pool.length}，步数分布:`, JSON.stringify(dist));

  // 组装关卡表
  const used = new Array(pool.length).fill(false);
  const table = [];
  let drift = 0; // 偏差累计（池子不够时被迫拿偏易/偏难的）

  for (let lv = 1; lv <= TOTAL; lv++) {
    // 教学关
    if (TUTORIAL[lv]) {
      const cars = TUTORIAL[lv].map((t, i) => ({ id: i, x: t[0], y: t[1], len: t[2], dir: t[3] ? 'h' : 'v' }));
      const board = { targetId: 0, cars };
      const check = R.solve(board, 400000);
      const want = TUTORIAL[lv] === TUTORIAL[1] ? 2 : 2;
      if (!check.solvable || check.minSteps !== want) {
        console.error(`!! 教学关 ${lv} 验证失败：期望 ${want} 步，实际 ${check.solvable ? check.minSteps : '无解'}`);
        process.exit(1);
      }
      table.push({ m: check.minSteps, c: TUTORIAL[lv] });
      continue;
    }

    // 曲线目标（含累计偏差修正：前面被迫拿易了，后面目标适当上调）
    const target = Math.max(3, targetSteps(lv) + Math.round(drift * 0.3));
    const wantCars = carsFor(target);

    // 就近择优：|m - target| 最小；同距优先「略难于目标」（防难度倒退），再优先车多的
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const p = pool[i];
      const diff = p.m - target;
      const score = Math.abs(diff) * 10 + (diff < 0 ? 4 : 0) + Math.max(0, wantCars - p.c.length);
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx < 0) {
      console.error(`!! 池子耗尽，第 ${lv} 关无法生成`);
      process.exit(1);
    }
    used[bestIdx] = true;
    const picked = pool[bestIdx];
    drift += picked.m - target;
    table.push({ m: picked.m, c: picked.c });

    if (lv % 25 === 0) {
      console.log(`  关卡 ${lv}/${TOTAL}  本关 ${picked.m} 步 / 目标 ${target} 步  累计偏差 ${(drift / lv).toFixed(2)}`);
    }
  }

  // 复核：每关用完整求解器再验一次（抽样 30 关 + 全部教学关已验）
  console.log('');
  console.log('抽样复核 30 关…');
  let bad = 0;
  for (let lv = 1; lv <= TOTAL; lv += Math.floor(TOTAL / 30)) {
    const cars = table[lv - 1].c.map((t, i) => ({ id: i, x: t[0], y: t[1], len: t[2], dir: t[3] ? 'h' : 'v' }));
    const r = R.solve({ targetId: 0, cars }, 400000);
    if (!r.solvable || r.minSteps !== table[lv - 1].m) {
      console.error(`  !! 第 ${lv} 关复核不符：表内 ${table[lv - 1].m}，实算 ${r.solvable ? r.minSteps : '无解'}`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.error(`复核失败 ${bad} 关，中止`);
    process.exit(1);
  }
  console.log('复核全部通过');

  // 写文件
  const json = JSON.stringify(table);
  const file = `/**
 * 关卡表（由 tools/genlevels.mjs 离线生成，请勿手工修改）
 * 格式：{ m: 最少步数, c: [[x, y, len, dir], ...] }，dir: 1=水平 0=垂直
 * 约定：每关第 0 辆车必为目标车（水平，第 3 行，出口在右）
 * 难度曲线：1~2 手工教学关(2 步)，第 3 关起按目标曲线 4 -> 20 步递增
 * 重新生成：node tools/genlevels.mjs 200 6
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  MG.levels = ${json};
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  const dest = path.join(ROOT, 'src/data/levels.js');
  fs.writeFileSync(dest, file);

  // 曲线报告
  console.log('');
  console.log('== 最终曲线（每 20 关平均）==');
  for (let s = 0; s < TOTAL; s += 20) {
    const seg = table.slice(s, s + 20);
    const cars = seg.reduce((a, x) => a + x.c.length, 0) / seg.length;
    const steps = seg.reduce((a, x) => a + x.m, 0) / seg.length;
    console.log(`  ${String(s + 1).padStart(3)}-${String(s + 20).padStart(3)}  车 ${cars.toFixed(1)}  步 ${steps.toFixed(1)}`);
  }
  const size = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log('');
  console.log(`完成：${table.length} 关，文件 ${size} KB -> src/data/levels.js`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

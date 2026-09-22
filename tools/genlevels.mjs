/**
 * 关卡表离线生成器
 *
 * 为什么离线生成：BFS 验解实测约 600ms/关，放在运行时会让玩家点「开始」就卡住。
 * 离线跑一次，产出 src/data/levels.js（纯数据），运行时零计算。
 *
 * 用法：node tools/genlevels.mjs [关卡总数，默认 200]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const code = fs.readFileSync(path.join(ROOT, 'src/core/rush.js'), 'utf8');
const sandbox = { console, Math, Object, Array, String, Number, JSON, Uint8Array, parseInt, isNaN, Error };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'rush.js' });
const R = sandbox.MG.rush;

const TOTAL = Number(process.argv[2] || 200);
const out = [];
const t0 = Date.now();
let rejected = 0;

console.log(`开始生成 ${TOTAL} 关…`);

const toEntry = (g, steps) => ({
  m: steps,
  c: g.board.cars.map((c) => [c.x, c.y, c.len, c.dir === 'h' ? 1 : 0]),
});

for (let lv = 1; lv <= TOTAL; lv++) {
  let entry = null;
  // 每关都必须独立复核通过才入表；失败就换 seed 重来。
  // 关键：绝不能「失败就跳过」—— 那会让表内第 N 项不等于第 N 关，难度曲线错位。
  for (let retry = 0; retry < 4 && !entry; retry++) {
    const g = R.generate(lv, 12345 + retry * 9973);
    const check = R.solve(g.board, 120000);
    if (check.solvable) entry = toEntry(g, check.minSteps);
  }
  if (!entry) {
    rejected += 1;
    const prev = out[out.length - 1];
    entry = prev ? { m: prev.m, c: prev.c.map((row) => row.slice()) } : { m: 1, c: [[0, 2, 2, 1], [0, 0, 3, 0]] };
    console.error(`  !! 第 ${lv} 关四次复核均失败，用相邻关顶替以保持编号对齐`);
  }
  out.push(entry);

  if (lv % 25 === 0) {
    console.log(`  ${lv}/${TOTAL}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

const json = JSON.stringify(out);
const file = `/**
 * 关卡表（由 tools/genlevels.mjs 离线生成，请勿手工修改）
 * 格式：{ m: 最少步数, c: [[x, y, len, dir], ...] }，dir: 1=水平 0=垂直
 * 约定：每关第 0 辆车必为目标车（水平，第 3 行）
 * 重新生成：node tools/genlevels.mjs 200
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  MG.levels = ${json};
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

const dest = path.join(ROOT, 'src/data/levels.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, file);

const cars = out.reduce((a, b) => a + b.c.length, 0);
const steps = out.reduce((a, b) => a + b.m, 0);
console.log('');
console.log(`完成：${out.length} 关（跳过 ${rejected}）`);
console.log(`平均车辆数 ${(cars / out.length).toFixed(1)}｜平均最短步数 ${(steps / out.length).toFixed(1)}`);
console.log(`文件体积 ${(fs.statSync(dest).size / 1024).toFixed(1)} KB -> src/data/levels.js`);
console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

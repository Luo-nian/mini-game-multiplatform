/**
 * 多端构建脚本（零依赖，只用 node 内置模块）
 *
 * 作用：把同一份 src/ 装配成三端产物
 *   dist/web  浏览器 / 网页游戏平台（CrazyGames、Poki 等）
 *   dist/wx   微信小游戏（用微信开发者工具打开此目录）
 *   dist/tt   抖音小游戏（用抖音开发者工具打开此目录）
 *
 * 用法：node tools/build.mjs           （开发构建：保留屏幕调试层与内置自测）
 *      node tools/build.mjs --release （发布构建：自动剥离调试层与自测上报）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const TPL = path.join(ROOT, 'dist_tpl');

/** 发布构建：关掉屏幕调试层与自测上报（改的是产物，不动 src） */
const RELEASE = process.argv.includes('--release');

function configSource() {
  let s = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
  if (RELEASE) {
    s = s.replace(/debug:\s*true/, 'debug: false').replace(/selfTest:\s*true/, 'selfTest: false');
  }
  return s;
}

// 加载顺序有依赖：adapter 入口 -> 通用工厂 -> 各端实现 -> 游戏逻辑 -> 配置 -> 启动
const ENTRY_ORDER = [
  'src/core/adapter/index.js',
  'src/core/adapter/minigame.js',
  'src/core/adapter/wx.js',
  'src/core/adapter/tt.js',
  'src/core/adapter/web.js',
  'src/data/levels.js',
  'src/core/rush.js',
  'src/core/game.js',
  'src/config.js',
  'src/core/selftest.js',
  'src/main.js',
];

const GAME_JSON = {
  deviceOrientation: 'portrait',
  showStatusBar: false,
  networkTimeout: { request: 10000 },
};

const projectConfig = (name) => ({
  appid: 'touristappid',
  projectname: name,
  compileType: 'game',
  libVersion: '3.5.7',
  setting: { es6: true, minified: false, urlCheck: false, postcss: false },
});

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return;
  } catch (e) {
    // 常见原因：微信开发者工具正打开着 dist/wx，目录句柄被占用
    console.warn(`[warn] 无法整体删除 ${path.relative(ROOT, p)}（多半被开发者工具占用），改为逐项清理`);
  }
  for (const name of fs.readdirSync(p)) {
    const child = path.join(p, name);
    try {
      fs.rmSync(child, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[warn] 跳过被占用的 ${path.relative(ROOT, child)}（构建继续，可能残留旧文件）`);
    }
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function sizeOf(dir) {
  let total = 0;
  let count = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = sizeOf(p);
      total += r.bytes;
      count += r.files;
    } else {
      total += fs.statSync(p).size;
      count += 1;
    }
  }
  return { bytes: total, files: count };
}

function miniGameEntry() {
  const lines = [
    '// 由 tools/build.mjs 自动生成，请勿手工修改',
    '// 小游戏入口：按顺序加载各模块（每个模块自挂到 globalThis.MG）',
    '',
  ];
  for (const rel of ENTRY_ORDER) lines.push(`require('./${rel}');`);
  lines.push('', '');
  return lines.join('\n');
}

function build() {
  rmrf(DIST);

  const sfxDir = path.join(ROOT, 'assets', 'sfx');
  const hasSfx = fs.existsSync(sfxDir);

  // ---- Web ----
  const web = path.join(DIST, 'web');
  copyDir(SRC, path.join(web, 'src'));
  if (hasSfx) copyDir(sfxDir, path.join(web, 'audio'));
  fs.writeFileSync(path.join(web, 'src', 'config.js'), configSource());
  fs.copyFileSync(path.join(TPL, 'index.html'), path.join(web, 'index.html'));

  // ---- 微信小游戏 ----
  const wx = path.join(DIST, 'wx');
  copyDir(SRC, path.join(wx, 'src'));
  if (hasSfx) copyDir(sfxDir, path.join(wx, 'audio'));
  fs.writeFileSync(path.join(wx, 'src', 'config.js'), configSource());
  fs.writeFileSync(path.join(wx, 'game.js'), miniGameEntry());
  fs.writeFileSync(path.join(wx, 'game.json'), JSON.stringify(GAME_JSON, null, 2) + '\n');
  fs.writeFileSync(path.join(wx, 'project.config.json'), JSON.stringify(projectConfig('mini-game-multiplatform-wx'), null, 2) + '\n');

  // ---- 抖音小游戏 ----
  const tt = path.join(DIST, 'tt');
  copyDir(SRC, path.join(tt, 'src'));
  if (hasSfx) copyDir(sfxDir, path.join(tt, 'audio'));
  fs.writeFileSync(path.join(tt, 'src', 'config.js'), configSource());
  fs.writeFileSync(path.join(tt, 'game.js'), miniGameEntry());
  fs.writeFileSync(path.join(tt, 'game.json'), JSON.stringify(GAME_JSON, null, 2) + '\n');

  // ---- 报告 ----
  console.log(`\n构建完成（${RELEASE ? '发布模式：调试层已剥离' : '开发模式：含屏幕调试层'}）\n`);
  const rows = [];
  for (const name of ['web', 'wx', 'tt']) {
    const r = sizeOf(path.join(DIST, name));
    rows.push({ 端: name, 文件数: r.files, 体积: (r.bytes / 1024).toFixed(1) + ' KB' });
  }
  console.table(rows);

  const wxSize = sizeOf(wx).bytes / 1024;
  const limit = 4096; // 微信小游戏主包上限 4MB
  console.log(`微信小游戏主包占用 ${wxSize.toFixed(1)} KB / 上限 ${limit} KB（余量 ${((1 - wxSize / limit) * 100).toFixed(1)}%）`);
  console.log('目录：dist/web  dist/wx  dist/tt\n');
}

build();

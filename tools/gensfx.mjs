/**
 * 音效生成器 —— 程序合成 WAV，零素材成本、零版权风险
 *
 * 为什么不用现成音效包：下载的音效有版权风险且要挑挑拣拣；
 * 超休闲游戏的音效就是短促的提示音，正弦+衰减包络足够，还能精确控制体积。
 *
 * 产出（22050Hz 16bit 单声道 PCM）：
 *   tap   拿起车        ~2.6KB
 *   slide 放下/滑动结束  ~3.5KB
 *   btn   按钮点击      ~2.2KB
 *   pass  过关琶音      ~11KB
 *   star  三星额外音     ~6KB
 * 合计 ~25KB，对 4MB 主包毫无压力。
 *
 * 用法：node tools/gensfx.mjs   （幂等，可重复跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'assets', 'sfx');
const SR = 22050;

/** 写 16bit 单声道 WAV */
function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  const p = path.join(OUT, name + '.wav');
  fs.writeFileSync(p, buf);
  return { name, bytes: buf.length, dur: (n / SR).toFixed(2) };
}

const SIN = Math.sin;
const TWO_PI = Math.PI * 2;

/** 衰减包络（指数） */
function env(i, n, k) {
  return Math.exp(-k * (i / n));
}

// 1) tap：拿起车。短促「嗒」，频率 950→620Hz 快滑 + 指数衰减
function tap() {
  const n = Math.floor(SR * 0.06);
  const s = new Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = 950 - 330 * t;
    phase += (TWO_PI * f) / SR;
    s[i] = 0.5 * SIN(phase) * env(i, n, 7);
  }
  return s;
}

// 2) slide：放下吸附。「咔」带一点木质感：低频正弦 + 噪声瞬态
function slide() {
  const n = Math.floor(SR * 0.08);
  const s = new Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = 320 + 180 * Math.sin(t * Math.PI);
    phase += (TWO_PI * f) / SR;
    const noise = (Math.random() * 2 - 1) * Math.exp(-30 * t) * 0.25;
    s[i] = (0.45 * SIN(phase) * env(i, n, 5) + noise) * 0.8;
  }
  return s;
}

// 3) btn：按钮。清脆「嘀」，1250Hz
function btn() {
  const n = Math.floor(SR * 0.05);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    s[i] = 0.4 * SIN(TWO_PI * 1250 * t) * env(i, n, 9);
  }
  return s;
}

// 4) pass：过关。C5-E5-G5-C6 上行琶音，每音 0.11s，尾音余 0.2s
function pass() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const noteLen = 0.11;
  const tail = 0.25;
  const n = Math.floor(SR * (notes.length * noteLen + tail));
  const s = new Array(n).fill(0);
  notes.forEach((f, ni) => {
    const start = Math.floor(ni * noteLen * SR);
    const len = Math.floor((ni === notes.length - 1 ? noteLen + tail : noteLen * 1.2) * SR);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SR;
      const e = Math.exp(-4 * (i / len));
      s[start + i] += 0.32 * SIN(TWO_PI * f * t) * e + 0.08 * SIN(TWO_PI * f * 2 * t) * e;
    }
  });
  return s;
}

// 5) star：三星时刻。G5-B5-D6 快速三连音
function star() {
  const notes = [783.99, 987.77, 1174.66];
  const noteLen = 0.07;
  const n = Math.floor(SR * (notes.length * noteLen + 0.15));
  const s = new Array(n).fill(0);
  notes.forEach((f, ni) => {
    const start = Math.floor(ni * noteLen * SR);
    const len = Math.floor(noteLen * 1.6 * SR);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SR;
      const e = Math.exp(-5 * (i / len));
      s[start + i] += 0.3 * SIN(TWO_PI * f * t) * e;
    }
  });
  return s;
}

fs.mkdirSync(OUT, { recursive: true });
const results = [
  writeWav('tap', tap()),
  writeWav('slide', slide()),
  writeWav('btn', btn()),
  writeWav('pass', pass()),
  writeWav('star', star()),
];
let total = 0;
results.forEach((r) => {
  total += r.bytes;
  console.log(`  ${r.name.padEnd(6)} ${String(r.bytes).padStart(6)} B  ${r.dur}s`);
});
console.log(`合计 ${(total / 1024).toFixed(1)} KB -> assets/sfx/`);

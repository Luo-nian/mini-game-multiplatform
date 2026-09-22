/**
 * 自测结果接收服务
 *
 * 启动：node tools/report-server.mjs
 * 游戏侧会 POST 到 http://127.0.0.1:8899/report
 * 结果同时打印到控制台并落盘 .tmp/selftest-report.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.tmp', 'selftest-report.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const reports = [];

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.indexOf('/report') === 0) {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      let data = null;
      try {
        data = JSON.parse(body);
      } catch (e) {
        data = { raw: body };
      }
      reports.push({ at: new Date().toISOString(), data });
      fs.writeFileSync(OUT, JSON.stringify(reports, null, 2));
      console.log('\n=== 收到上报 #' + reports.length + ' ===');
      console.log(JSON.stringify(data, null, 2));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end('{"ok":true}');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('report server ok, reports=' + reports.length + '\n');
});

server.listen(8899, '127.0.0.1', () => {
  console.log('自测上报服务已启动: http://127.0.0.1:8899/report');
  console.log('落盘位置: ' + OUT);
});

/**
 * 游戏主逻辑（纯逻辑层）
 * 硬约束：本文件不允许出现 wx / tt / document / window 等平台字样，
 *        一切平台能力通过传入的 adapter 使用 —— 这是「一套代码多平台」的前提。
 *
 * 玩法：车位脱困。6x6 停车场，拖拽车辆腾出通道，把红车从右侧出口开走。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  var DESIGN_W = 750;

  var C = {
    bg: '#F6F4EE',
    gridLine: '#E4E1D8',
    gridBg: '#FFFFFF',
    ink: '#26215C',
    inkSoft: '#5F5E5A',
    inkHint: '#888780',
    target: '#E24B4A',
    btn: '#1D9E75',
    btnText: '#FFFFFF',
    btnGhost: '#FFFFFF',
    btnGhostText: '#0F6E56',
    accent: '#FAC775',
    carColors: ['#85B7EB', '#5DCAA5', '#EF9F27', '#AFA9EC', '#97C459', '#F0997B', '#B4B2A9', '#7F77DD'],
  };

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function Game(adapter, config) {
    this.ad = adapter;
    this.cfg = config || {};
    this.ctx = null;
    this.k = 1;
    this.vw = DESIGN_W;
    this.vh = 1334;

    this.state = 'ready';
    this.level = 1;
    this.best = 0;
    this.board = null;
    this.minSteps = 0;
    this.moves = 0;
    this.drag = null;
    this.hint = null;
    this.hintT = 0;
    this.toast = null;
    this.btns = [];
    this.solvedT = 0;
    this.lastTs = 0;
    this.sinceAd = 0;

    // 棋盘几何
    this.margin = 40;
    this.boardX = 40;
    this.boardY = 300;
    this.boardW = 670;
    this.cell = 670 / 6;
  }

  Game.prototype.mount = function () {
    this.ctx = this.ad.getContext();
    this.resize();
  };

  Game.prototype.resize = function () {
    var info = this.ad.getSystemInfo();
    this.k = info.dpr * (info.width / DESIGN_W);
    this.vh = info.height / (info.width / DESIGN_W);

    this.margin = 40;
    this.boardW = this.vw - this.margin * 2;
    this.cell = this.boardW / MG.rush.SIZE;
    this.boardX = this.margin;
    this.boardY = Math.max(280, this.vh * 0.26);

    var lv = parseInt(this.ad.storage.get('mg_level', '1'), 10);
    this.level = isNaN(lv) || lv < 1 ? 1 : lv;
    var bt = parseInt(this.ad.storage.get('mg_best_level', '0'), 10);
    this.best = isNaN(bt) ? 0 : bt;
  };

  Game.prototype._applyTransform = function () {
    this.ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
  };

  // ---------- 关卡 ----------

  Game.prototype.startLevel = function (level) {
    var g = MG.rush.getLevel(level);
    this.level = level;
    this.board = g.board;
    this.minSteps = g.minSteps;
    this.moves = 0;
    this.drag = null;
    this.hint = null;
    this.hintT = 0;
    this.state = 'playing';
    this.solvedT = 0;
    this.ad.storage.set('mg_level', String(level));
    if (level > this.best) {
      this.best = level;
      this.ad.storage.set('mg_best_level', String(level));
    }
  };

  Game.prototype.nextLevel = function () {
    this.startLevel(this.level + 1);
  };

  // ---------- 坐标换算 ----------

  Game.prototype._carRect = function (car) {
    var cs = this.cell;
    var pad = cs * 0.09;
    var x = this.boardX + car.x * cs + pad;
    var y = this.boardY + car.y * cs + pad;
    var w = (car.dir === 'h' ? car.len * cs : cs) - pad * 2;
    var h = (car.dir === 'v' ? car.len * cs : cs) - pad * 2;
    return { x: x, y: y, w: w, h: h };
  };

  Game.prototype._pickCar = function (px, py) {
    if (!this.board) return null;
    var cs = this.cell;
    var gx = Math.floor((px - this.boardX) / cs);
    var gy = Math.floor((py - this.boardY) / cs);
    if (gx < 0 || gx >= MG.rush.SIZE || gy < 0 || gy >= MG.rush.SIZE) return null;
    for (var i = 0; i < this.board.cars.length; i++) {
      var c = this.board.cars[i];
      var hit = false;
      for (var k = 0; k < c.len; k++) {
        var cx = c.dir === 'h' ? c.x + k : c.x;
        var cy = c.dir === 'v' ? c.y + k : c.y;
        if (cx === gx && cy === gy) hit = true;
      }
      if (hit) return c;
    }
    return null;
  };

  // ---------- 输入 ----------

  Game.prototype.onPointer = function (p) {
    var i;
    // 按钮优先
    if (p.type === 'up' || p.type === 'down') {
      for (i = 0; i < this.btns.length; i++) {
        var b = this.btns[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          if (p.type === 'down' && b.enabled !== false) b.action();
          return;
        }
      }
    }

    if (this.state === 'ready') {
      if (p.type === 'down') this.startLevel(this.level);
      return;
    }

    if (this.state === 'solved') return;
    if (this.state !== 'playing') return;

    if (p.type === 'down') {
      var car = this._pickCar(p.x, p.y);
      if (!car) return;
      this.drag = {
        carId: car.id,
        sx: p.x,
        sy: p.y,
        // 上限在按下时按「起点位置」算一次：拖拽过程中车辆位置会变，
        // 若每帧重算会得到相对新位置的上限，导致拖过头又弹回来。
        maxUp: MG.rush.maxSlide(this.board, car.id, -1),
        maxDown: MG.rush.maxSlide(this.board, car.id, 1),
        applied: 0,
        dir: car.dir,
      };
      this.hint = null;
      this.hintT = 0;
      return;
    }

    if (p.type === 'move' && this.drag) {
      var d = this.drag;
      var raw = d.dir === 'h' ? (p.x - d.sx) / this.cell : (p.y - d.sy) / this.cell;
      var want = Math.round(raw);
      if (want > d.maxDown) want = d.maxDown;
      if (want < -d.maxUp) want = -d.maxUp;

      var diff = want - d.applied;
      if (diff !== 0) {
        var stepDir = diff > 0 ? 1 : -1;
        var moved = MG.rush.move(this.board, d.carId, diff);
        d.applied += moved * stepDir;
        if (moved > 0) {
          this.ad.vibrate();
          this._afterMove();
        }
      }
      return;
    }

    if (p.type === 'up' && this.drag) {
      if (this.drag.applied !== 0) this.moves += 1;
      this.drag = null;
      this._afterMove();
    }
  };

  Game.prototype._afterMove = function () {
    if (this.state === 'playing' && MG.rush.isSolved(this.board)) {
      this.state = 'solved';
      this.solvedT = 0;
      this.sinceAd += 1;
      if (this.sinceAd >= 3) {
        this.sinceAd = 0;
        var id = this.cfg.adUnits && this.cfg.adUnits[this.ad.name + 'Interstitial'];
        this.ad.showInterstitial(id);
      }
    }
  };

  // ---------- 提示（激励视频位）----------

  Game.prototype.askHint = function () {
    var self = this;
    if (this.state !== 'playing') return;
    var id = this.cfg.adUnits && this.cfg.adUnits[this.ad.name + 'Rewarded'];
    this.ad.showRewardedAd(id).then(function (ok) {
      if (!ok) {
        self._toast('未看完广告，没有提示');
        return;
      }
      var h = MG.rush.hint(self.board);
      if (!h) {
        self._toast('这局无解，已重置');
        self.startLevel(self.level);
        return;
      }
      self.hint = h;
      self.hintT = 4;
      self._toast('照着箭头拖一下');
    });
  };

  // ---------- 循环 ----------

  Game.prototype.update = function (dt) {
    if (this.hintT > 0) this.hintT = Math.max(0, this.hintT - dt);
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) this.toast = null;
    }
    if (this.state === 'solved') this.solvedT += dt;
  };

  // ---------- 渲染 ----------

  Game.prototype.render = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    this._applyTransform();
    this.btns = [];
    var w = this.vw;
    var h = this.vh;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    this._renderHud(w);
    this._renderBoard();
    this._renderFooter(w, h);

    if (this.state === 'ready') this._renderReady(w, h);
    if (this.state === 'solved') this._renderSolved(w, h);

    if (this.toast) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(38,33,92,.88)';
      roundRect(ctx, w / 2 - 220, h - 250, 440, 74, 37);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '400 28px sans-serif';
      ctx.fillText(this.toast.text, w / 2, h - 213);
    }
  };

  Game.prototype._renderHud = function (w) {
    var ctx = this.ctx;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    ctx.fillStyle = C.inkHint;
    ctx.font = '400 24px sans-serif';
    ctx.fillText('第 ' + this.level + ' 关', 40, 110);

    ctx.fillStyle = C.ink;
    ctx.font = '500 52px sans-serif';
    ctx.fillText(String(this.moves), 40, 168);
    ctx.fillStyle = C.inkHint;
    ctx.font = '400 24px sans-serif';
    ctx.fillText('步', 40 + ctx.measureText(String(this.moves)).width + 62, 174);

    ctx.textAlign = 'right';
    ctx.fillStyle = C.inkHint;
    ctx.font = '400 24px sans-serif';
    ctx.fillText('最少 ' + this.minSteps + ' 步', w - 40, 110);
    ctx.fillText('最高到第 ' + this.best + ' 关', w - 40, 168);
    ctx.textAlign = 'left';
  };

  Game.prototype._renderBoard = function () {
    var ctx = this.ctx;
    var cs = this.cell;
    var n = MG.rush.SIZE;

    // 底板
    ctx.fillStyle = C.gridBg;
    roundRect(ctx, this.boardX, this.boardY, this.boardW, this.boardW, 22);
    ctx.fill();
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 网格线
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    for (var i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(this.boardX + i * cs, this.boardY + 8);
      ctx.lineTo(this.boardX + i * cs, this.boardY + this.boardW - 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(this.boardX + 8, this.boardY + i * cs);
      ctx.lineTo(this.boardX + this.boardW - 8, this.boardY + i * cs);
      ctx.stroke();
    }

    // 出口（右侧第 3 行）
    var ey = this.boardY + MG.rush.EXIT_ROW * cs + cs / 2;
    ctx.fillStyle = C.accent;
    ctx.beginPath();
    ctx.moveTo(this.boardX + this.boardW + 6, ey - 34);
    ctx.lineTo(this.boardX + this.boardW + 46, ey);
    ctx.lineTo(this.boardX + this.boardW + 6, ey + 34);
    ctx.closePath();
    ctx.fill();

    if (!this.board) return;

    // 车辆
    for (var ci = 0; ci < this.board.cars.length; ci++) {
      var car = this.board.cars[ci];
      var r = this._carRect(car);
      var isTarget = car.id === this.board.targetId;
      var isHint = this.hint && this.hint.carId === car.id && this.hintT > 0;

      ctx.fillStyle = isTarget ? C.target : C.carColors[car.id % C.carColors.length];
      roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.28);
      ctx.fill();

      if (isTarget) {
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      if (isHint) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 6;
        ctx.stroke();
        // 提示箭头
        var ax = this.hint.delta > 0 ? r.x + r.w + 10 : r.x - 34;
        var ay = r.y + r.h / 2;
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        if (car.dir === 'h') {
          ctx.moveTo(ax + (this.hint.delta > 0 ? 0 : 24), ay - 18);
          ctx.lineTo(ax + 24, ay);
          ctx.lineTo(ax + (this.hint.delta > 0 ? 0 : 24), ay + 18);
        } else {
          var ayT = this.hint.delta > 0 ? r.y + r.h + 26 : r.y - 2;
          ctx.moveTo(r.x + r.w / 2 - 18, ayT - (this.hint.delta > 0 ? 0 : 24));
          ctx.lineTo(r.x + r.w / 2, ayT);
          ctx.lineTo(r.x + r.w / 2 + 18, ayT - (this.hint.delta > 0 ? 0 : 24));
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  Game.prototype._renderFooter = function (w, h) {
    var ctx = this.ctx;
    var by = this.boardY + this.boardW + 70;
    var bw = (w - 120) / 2;

    this._button('重开', 40, by, bw, 104, C.btnGhost, C.btnGhostText, this._restart.bind(this), this.state === 'playing');
    this._button('提示（看广告）', 80 + bw, by, bw, 104, C.btn, C.btnText, this.askHint.bind(this), this.state === 'playing');
  };

  Game.prototype._renderReady = function (w, h) {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(246,244,238,.94)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ink;
    ctx.font = '500 64px sans-serif';
    ctx.fillText('车位脱困', w / 2, h / 2 - 200);
    ctx.fillStyle = C.inkSoft;
    ctx.font = '400 30px sans-serif';
    ctx.fillText('拖动车辆腾出通道', w / 2, h / 2 - 122);
    ctx.fillText('把红车从右侧出口开走', w / 2, h / 2 - 74);
    ctx.fillStyle = C.inkHint;
    ctx.font = '400 26px sans-serif';
    ctx.fillText('继续第 ' + this.level + ' 关', w / 2, h / 2 - 10);
    this._button('开始', w / 2 - 170, h / 2 + 50, 340, 108, C.btn, C.btnText, this.startLevel.bind(this, this.level));
  };

  Game.prototype._renderSolved = function (w, h) {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(246,244,238,.94)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ink;
    ctx.font = '500 60px sans-serif';
    ctx.fillText('过关', w / 2, h / 2 - 190);
    ctx.fillStyle = C.inkSoft;
    ctx.font = '400 30px sans-serif';
    ctx.fillText('用了 ' + this.moves + ' 步　最少 ' + this.minSteps + ' 步', w / 2, h / 2 - 118);
    this._button('下一关', w / 2 - 170, h / 2 - 20, 340, 108, C.btn, C.btnText, this.nextLevel.bind(this));
    this._button('重玩本关', w / 2 - 170, h / 2 + 116, 340, 96, C.btnGhost, C.btnGhostText, this._restart.bind(this));
  };

  Game.prototype._restart = function () {
    this.startLevel(this.level);
  };

  Game.prototype._button = function (text, x, y, w, h, bg, fg, action, enabled) {
    var ctx = this.ctx;
    var on = enabled !== false;
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, 26);
    ctx.fill();
    if (on) {
      ctx.strokeStyle = 'rgba(0,0,0,.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = on ? fg : 'rgba(95,94,90,.45)';
    ctx.font = '500 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    this.btns.push({ x: x, y: y, w: w, h: h, action: action, enabled: on });
  };

  Game.prototype._toast = function (text) {
    this.toast = { text: text, t: 1.8 };
  };

  Game.prototype.tick = function () {
    var now = this.ad.now();
    if (!this.lastTs) this.lastTs = now;
    var dt = Math.min((now - this.lastTs) / 1000, 0.05);
    this.lastTs = now;
    this.update(dt);
    this.render();
  };

  Game.prototype.loop = function () {
    var self = this;
    function step() {
      self.tick();
      self.ad.raf(step);
    }
    step();
  };

  MG.Game = Game;
  MG.DESIGN_W = DESIGN_W;
})(typeof globalThis !== 'undefined' ? globalThis : this);

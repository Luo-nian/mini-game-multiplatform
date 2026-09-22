/**
 * 游戏主逻辑（纯逻辑层）
 * 硬约束：本文件不允许出现 wx / tt / document / window 等平台字样，
 *        一切平台能力通过传入的 adapter 使用 —— 这是「一套代码多平台」的前提。
 *
 * 本版玩法为「限时点靶」最小原型，目的不是好玩，而是把下列链路全部跑通：
 * 渲染循环 / 触摸输入 / 计时 / 状态机 / 本地存档 / 激励视频 / 分享
 */
(function (root) {
  var MG = root.MG || (root.MG = {});

  var DESIGN_W = 750;

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
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
    this.blocks = [];
    this.kills = 0;
    this.misses = 0;
    this.timeLeft = 0;
    this.spawnTimer = 0;
    this.spawnGap = 0.75;
    this.lastTs = 0;
    this.flash = 0;
    this.toast = null;
    this.btns = [];
    this.paused = false;
  }

  Game.prototype.mount = function () {
    this.ctx = this.ad.getContext();
    this.resize();
  };

  Game.prototype.resize = function () {
    var info = this.ad.getSystemInfo();
    this.k = info.dpr * (info.width / DESIGN_W);
    this.vh = info.height / (info.width / DESIGN_W);
    // 存档读取
    var best = parseInt(this.ad.storage.get('mg_best', '0'), 10);
    this.best = isNaN(best) ? 0 : best;
  };

  Game.prototype._applyTransform = function () {
    this.ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
  };

  Game.prototype.start = function () {
    this.state = 'playing';
    this.blocks = [];
    this.kills = 0;
    this.misses = 0;
    this.timeLeft = this.cfg.roundSeconds || 30;
    this.spawnTimer = 0;
    this.spawnGap = 0.75;
    this.toast = null;
    this.btns = [];
  };

  Game.prototype.gameOver = function () {
    this.state = 'over';
    this.blocks = [];
    if (this.kills > this.best) {
      this.best = this.kills;
      this.ad.storage.set('mg_best', String(this.best));
    }
  };

  Game.prototype._spawn = function () {
    var r = 46 + (1 - this.timeLeft / 30) * 26;
    var pad = 60 + r;
    this.blocks.push({
      x: pad + Math.random() * (this.vw - pad * 2),
      y: 260 + Math.random() * (this.vh - 460),
      r: r,
      t: 0,
      life: Math.max(0.62, 1.35 - (30 - this.timeLeft) * 0.018),
      gone: false,
    });
  };

  Game.prototype.update = function (dt) {
    if (this.paused) return;
    var i;
    if (this.state === 'playing') {
      this.timeLeft -= dt;
      this.spawnGap = Math.max(0.34, 0.75 - (30 - this.timeLeft) * 0.012);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnGap;
        this._spawn();
      }
      for (i = 0; i < this.blocks.length; i++) {
        var b = this.blocks[i];
        b.t += dt;
        if (b.t >= b.life) {
          b.gone = true;
          this.flash = 0.12;
        }
      }
      this.blocks = this.blocks.filter(function (b) {
        return !b.gone;
      });
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.gameOver();
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) this.toast = null;
    }
  };

  Game.prototype.onPointer = function (p) {
    if (p.type !== 'down') return;
    var i;
    // 按钮优先
    for (i = 0; i < this.btns.length; i++) {
      var btn = this.btns[i];
      if (p.x >= btn.x && p.x <= btn.x + btn.w && p.y >= btn.y && p.y <= btn.y + btn.h) {
        btn.action();
        return;
      }
    }
    if (this.state === 'ready') {
      this.start();
      return;
    }
    if (this.state === 'over') return;

    // 命中判定（从后往前，先判最新的方块）
    for (i = this.blocks.length - 1; i >= 0; i--) {
      var b = this.blocks[i];
      var dx = p.x - b.x;
      var dy = p.y - b.y;
      if (dx * dx + dy * dy <= (b.r + 12) * (b.r + 12)) {
        b.gone = true;
        this.kills += 1;
        this.blocks.splice(i, 1);
        this.ad.vibrate();
        return;
      }
    }
    this.misses += 1;
  };

  Game.prototype.render = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    this._applyTransform();
    var w = this.vw;
    var h = this.vh;

    ctx.fillStyle = '#F6F4EE';
    ctx.fillRect(0, 0, w, h);

    // 顶部信息条
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 40, 70, w - 80, 128, 24);
    ctx.fill();
    ctx.fillStyle = '#5F5E5A';
    ctx.font = '400 26px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('得分', 76, 108);
    ctx.fillText('剩余', 400, 108);
    ctx.fillStyle = '#26215C';
    ctx.font = '500 56px sans-serif';
    ctx.fillText(String(this.kills), 76, 158);
    ctx.fillStyle = this.timeLeft < 6 ? '#E24B4A' : '#26215C';
    ctx.fillText(this.timeLeft.toFixed(1), 400, 158);

    ctx.fillStyle = '#888780';
    ctx.font = '400 24px sans-serif';
    ctx.fillText('最高 ' + this.best, 76, 218);

    // 方块
    for (var i = 0; i < this.blocks.length; i++) {
      var b = this.blocks[i];
      var p = b.t / b.life;
      var scale = p < 0.12 ? 0.6 + (p / 0.12) * 0.4 : 1 - Math.max(0, p - 0.82) * 1.6;
      var r = b.r * Math.max(0.2, scale);
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(1, r), 0, Math.PI * 2);
      ctx.fillStyle = p > 0.72 ? '#FAC775' : '#1D9E75';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(0.5, r * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.fill();
    }

    // 漏点闪烁
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(226,75,74,' + (this.flash * 1.4).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // 状态层
    if (this.state === 'ready') {
      this._dim();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#26215C';
      ctx.font = '500 62px sans-serif';
      ctx.fillText('限时点靶', w / 2, h / 2 - 150);
      ctx.fillStyle = '#5F5E5A';
      ctx.font = '400 30px sans-serif';
      ctx.fillText('点中绿点拿分，时间到即结算', w / 2, h / 2 - 80);
      ctx.fillText('单局 30 秒', w / 2, h / 2 - 36);
      this._button('开始', w / 2 - 170, h / 2 + 30, 340, 104, '#1D9E75', '#FFFFFF', this.start.bind(this));
    } else if (this.state === 'over') {
      this._dim();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#26215C';
      ctx.font = '500 58px sans-serif';
      ctx.fillText('本局 ' + this.kills + ' 分', w / 2, h / 2 - 190);
      ctx.fillStyle = '#5F5E5A';
      ctx.font = '400 28px sans-serif';
      ctx.fillText('最高 ' + this.best + '  ·  漏点 ' + this.misses, w / 2, h / 2 - 128);

      var self = this;
      this._button('看广告 +8 秒继续', w / 2 - 230, h / 2 - 40, 460, 104, '#FAC775', '#412402', function () {
        self.showRewardedContinue();
      });
      this._button('再来一局', w / 2 - 170, h / 2 + 92, 340, 104, '#1D9E75', '#FFFFFF', function () {
        self.start();
      });
      this._button('分享给好友', w / 2 - 170, h / 2 + 224, 340, 92, '#FFFFFF', '#0F6E56', function () {
        self.ad.share({ title: '我点了 ' + self.kills + ' 分，你来试试' });
        self._toast('已调用分享');
      });
    }

    if (this.toast) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(38,33,92,.86)';
      roundRect(ctx, w / 2 - 200, h - 220, 400, 72, 36);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '400 28px sans-serif';
      ctx.fillText(this.toast.text, w / 2, h - 184);
    }
  };

  Game.prototype._dim = function () {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(246,244,238,.93)';
    ctx.fillRect(0, 0, this.vw, this.vh);
  };

  Game.prototype._button = function (text, x, y, w, h, bg, fg, action) {
    var ctx = this.ctx;
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.font = '500 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    this.btns.push({ x: x, y: y, w: w, h: h, action: action });
  };

  Game.prototype._toast = function (text) {
    this.toast = { text: text, t: 1.6 };
  };

  /** 激励视频：看完奖励 8 秒继续 */
  Game.prototype.showRewardedContinue = function () {
    var self = this;
    var id = this.cfg.adUnits && this.cfg.adUnits[this.ad.name + 'Rewarded'];
    this.ad.showRewardedAd(id).then(function (ok) {
      if (!ok) {
        self._toast('未看完广告，没有奖励');
        return;
      }
      self.state = 'playing';
      self.timeLeft = 8;
      self.btns = [];
      self._toast('已加 8 秒');
    });
  };

  Game.prototype.tick = function () {
    var now = this.ad.now();
    if (!this.lastTs) this.lastTs = now;
    var dt = Math.min((now - this.lastTs) / 1000, 0.05);
    this.lastTs = now;
    this.btns = [];
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

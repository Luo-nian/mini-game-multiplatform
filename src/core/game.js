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
    this.lastPointer = null;
    this._result = null;

    // 动画状态
    this.tweens = []; // [{carId, fx, fy, tx, ty, t, dur}] 松手吸附补间（格坐标）
    this.passT = 0;   // 过关驶出动画进度（秒）
    this.stars = 0;   // 本关星级 1~3

    // 进度与设置
    this.starMap = {};   // { 关卡号: 星级 }，求和得到总星数
    this.sfxOn = true;
    this.page = 0;       // 选关页（每页 30 关）
    this.levelsPerPage = 30;

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
    this.sfxOn = this.ad.storage.get('mg_sfx', '1') !== '0';
    try {
      this.starMap = JSON.parse(this.ad.storage.get('mg_stars', '{}')) || {};
    } catch (e) {
      this.starMap = {};
    }
  };

  /** 已获得的总星数 / 满星数 */
  Game.prototype.totalStars = function () {
    var n = 0;
    for (var k in this.starMap) {
      if (Object.prototype.hasOwnProperty.call(this.starMap, k)) n += this.starMap[k];
    }
    return n;
  };

  Game.prototype.starsOf = function (level) {
    return this.starMap[level] || 0;
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
    this.tweens = [];
    this.passT = 0;
    this.stars = 0;
    this.ad.storage.set('mg_level', String(level));
    if (level > this.best) {
      this.best = level;
      this.ad.storage.set('mg_best_level', String(level));
    }
    // 新手引导：只在第一次玩第 1 关时触发，免费给一步提示 + 文案
    if (level === 1 && !this.ad.storage.get('mg_tut')) {
      var h = MG.rush.hint(this.board);
      if (h) {
        this.hint = h;
        this.hintT = 6;
      }
      this._toast('拖开挡路的车，让红车开到出口');
      this.ad.storage.set('mg_tut', '1');
    }
  };

  Game.prototype.nextLevel = function () {
    this.startLevel(this.level + 1);
  };

  // ---------- 坐标换算 ----------

  /** 车辆矩形。gx/gy 是视觉格位（可小数），缺省用数据位 */
  Game.prototype._carRect = function (car, gx, gy) {
    var cs = this.cell;
    var vx = gx === undefined ? car.x : gx;
    var vy = gy === undefined ? car.y : gy;
    var pad = cs * 0.09;
    var x = this.boardX + vx * cs + pad;
    var y = this.boardY + vy * cs + pad;
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

  /** 音效统一入口（config 与玩家开关双重控制） */
  Game.prototype._sfx = function (name) {
    if (this.cfg.sfx === false || !this.sfxOn) return;
    if (this.ad.sfx) this.ad.sfx(name);
  };

  /**
   * 按钮动作分发。
   * 按钮只登记 {kind, arg}，点击时查表执行 —— 这样渲染每帧重建按钮列表
   * 不产生任何闭包/新函数，小游戏上避免 GC 抖动（选关页一屏 30 个按钮尤其明显）。
   */
  Game.prototype._act = function (kind, arg) {
    switch (kind) {
      case 'start':
        this.startLevel(arg);
        break;
      case 'next':
        this.nextLevel();
        break;
      case 'restart':
        this.startLevel(this.level);
        break;
      case 'hint':
        this.askHint();
        break;
      case 'share':
        this._share();
        break;
      case 'levels':
        this.state = 'levels';
        this.page = Math.max(0, Math.floor((this.best - 1) / this.levelsPerPage));
        break;
      case 'pick':
        this.startLevel(arg);
        break;
      case 'page':
        this.page = Math.max(0, this.page + arg);
        break;
      case 'back':
        this.state = this.board ? 'playing' : 'ready';
        break;
      case 'sfx':
        this.sfxOn = !this.sfxOn;
        this.ad.storage.set('mg_sfx', this.sfxOn ? '1' : '0');
        if (this.sfxOn) this._sfxForce('btn');
        break;
      default:
        break;
    }
  };

  /** 忽略开关强制发声（用于「打开音效」时的即时试听） */
  Game.prototype._sfxForce = function (name) {
    if (this.cfg.sfx === false) return;
    if (this.ad.sfx) this.ad.sfx(name);
  };

  Game.prototype.onPointer = function (p) {
    var i;
    // 记录最近一次原始输入，调试时画在屏幕上
    this.lastPointer = { x: p.x, y: p.y, type: p.type };
    this._result = null;

    // 按钮优先
    if (p.type === 'up' || p.type === 'down') {
      for (i = 0; i < this.btns.length; i++) {
        var b = this.btns[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          // 置灰按钮必须直接跳过，不能「命中即 return」——
          // 否则它会吃掉落在自己范围内的点击，表现为「点旁边那个能点的按钮却毫无反应」
          if (b.enabled === false) continue;
          this._result = 'hit-btn';
          if (p.type === 'down') {
            if (b.enabled !== false) this._sfx('btn');
            this._act(b.kind, b.arg);
          }
          return;
        }
      }
      this._result = 'miss-btn';
    }

    // 选关页不接受棋盘操作
    if (this.state === 'levels') return;

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
        baseX: car.x,
        baseY: car.y,
        dx: 0,
        dy: 0,
        // 上限在按下时按「起点位置」算一次：拖拽过程中车辆位置会变，
        // 若每帧重算会得到相对新位置的上限，导致拖过头又弹回来。
        maxUp: MG.rush.maxSlide(this.board, car.id, -1),
        maxDown: MG.rush.maxSlide(this.board, car.id, 1),
        snap: 0, // 已越过的格数（用于越格震动反馈）
        dir: car.dir,
      };
      this.hint = null;
      this.hintT = 0;
      this._sfx('tap');
      return;
    }

    if (p.type === 'move' && this.drag) {
      var d = this.drag;
      // 跟手：视觉偏移直接跟随手指（像素），数据位不动，松手才结算
      var raw = d.dir === 'h' ? p.x - d.sx : p.y - d.sy;
      var cell = this.cell;
      var minPx = -d.maxUp * cell;
      var maxPx = d.maxDown * cell;
      if (raw < minPx) raw = minPx;
      if (raw > maxPx) raw = maxPx;
      if (d.dir === 'h') {
        d.dx = raw;
        d.dy = 0;
      } else {
        d.dx = 0;
        d.dy = raw;
      }
      var gridNow = Math.round(raw / cell);
      if (gridNow !== d.snap) {
        d.snap = gridNow;
        this.ad.vibrate();
      }
      return;
    }

    if (p.type === 'up' && this.drag) {
      var d2 = this.drag;
      var cell2 = this.cell;
      var delta = Math.round((d2.dir === 'h' ? d2.dx : d2.dy) / cell2);
      if (delta > d2.maxDown) delta = d2.maxDown;
      if (delta < -d2.maxUp) delta = -d2.maxUp;

      var moved = 0;
      if (delta !== 0) {
        moved = MG.rush.move(this.board, d2.carId, delta);
      }

      // 吸附补间：从「视觉位置」滑到「最终数据位」。move 可能实际走得比 delta 少
      //（理论上 clamp 后不会，但保险起见以实际 moved 为准），tween 终点跟着修正。
      // 同一辆车的旧补间作废（快速连拖场景）
      for (var ti = this.tweens.length - 1; ti >= 0; ti--) {
        if (this.tweens[ti].carId === d2.carId) this.tweens.splice(ti, 1);
      }
      this.tweens.push({
        carId: d2.carId,
        fx: d2.baseX + (d2.dir === 'h' ? d2.dx / cell2 : 0),
        fy: d2.baseY + (d2.dir === 'v' ? d2.dy / cell2 : 0),
        tx: d2.baseX + (d2.dir === 'h' ? moved : 0),
        ty: d2.baseY + (d2.dir === 'v' ? moved : 0),
        t: 0,
        dur: 0.09,
      });
      // 同一辆车的旧补间作废
      this.tweens = this.tweens.filter(function (t, idx, arr) {
        return !(t.carId === d2.carId && arr.indexOf(t) !== idx);
      });

      this.drag = null;
      if (delta !== 0) {
        this.moves += 1;
        this._sfx('slide');
        this._afterMove();
      }
    }
  };

  Game.prototype._afterMove = function () {
    if (this.state === 'playing' && MG.rush.isSolved(this.board)) {
      this.state = 'solved';
      this.passT = 0;
      this.sinceAd += 1;
      // 星级：最少步数内 = 3 星；多 2 步内 = 2 星；其余 1 星
      if (this.moves <= this.minSteps) this.stars = 3;
      else if (this.moves <= this.minSteps + 2) this.stars = 2;
      else this.stars = 1;
      // 存档只增不减：重玩打出低分不覆盖高分
      var oldStars = this.starsOf(this.level);
      if (this.stars > oldStars) {
        this.starMap[this.level] = this.stars;
        try {
          this.ad.storage.set('mg_stars', JSON.stringify(this.starMap));
        } catch (e) {}
      }
      this._sfx('pass');
      if (this.stars === 3) this._sfx('star');
      if (this.sinceAd >= 3) {
        this.sinceAd = 0;
        var id = this.cfg.adUnits && this.cfg.adUnits[this.ad.name + 'Interstitial'];
        var ad = this.ad;
        // 插屏延迟到驶出动画后弹，避免打断高光时刻
        setTimeout(function () {
          ad.showInterstitial(id);
        }, 900);
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
    var i;
    if (this.hintT > 0) this.hintT = Math.max(0, this.hintT - dt);
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) this.toast = null;
    }
    // 吸附补间推进
    for (i = this.tweens.length - 1; i >= 0; i--) {
      var tw = this.tweens[i];
      tw.t += dt / tw.dur;
      if (tw.t >= 1) this.tweens.splice(i, 1);
    }
    if (this.state === 'solved') {
      this.solvedT += dt;
      this.passT += dt;
    }
  };

  /**
   * 车辆的「视觉格位」（小数）：渲染用，与数据位（board 里的整数）分离。
   * 优先级：拖拽跟手 > 吸附补间 > 数据位。
   */
  Game.prototype._carVisual = function (car) {
    var d = this.drag;
    if (d && d.carId === car.id) {
      return {
        gx: d.baseX + (d.dir === 'h' ? d.dx / this.cell : 0),
        gy: d.baseY + (d.dir === 'v' ? d.dy / this.cell : 0),
      };
    }
    for (var i = 0; i < this.tweens.length; i++) {
      var tw = this.tweens[i];
      if (tw.carId === car.id) {
        // easeOut：先快后慢，吸附手感
        var k = 1 - Math.pow(1 - Math.min(tw.t, 1), 3);
        return { gx: tw.fx + (tw.tx - tw.fx) * k, gy: tw.fy + (tw.ty - tw.fy) * k };
      }
    }
    return { gx: car.x, gy: car.y };
  };

  // ---------- 渲染 ----------

  Game.prototype.render = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    this._applyTransform();
    // 复用数组而不是每帧新建（小游戏上减少 GC 抖动）
    this.btns.length = 0;
    var w = this.vw;
    var h = this.vh;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    if (this.state === 'levels') {
      this._renderLevels(w, h);
      if (this.toast) this._renderToast(w, h);
      if (this.cfg.debug) this._renderDebug();
      return;
    }

    // 首屏由自己的遮罩层全屏覆盖，HUD 与棋盘不画（否则会从半透明遮罩下透出来）；
    // 底部操作按钮只在真正能操作时画
    if (this.state !== 'ready') {
      this._renderHud(w);
      this._renderBoard();
    }
    if (this.state === 'playing') this._renderFooter(w, h);

    if (this.state === 'ready') this._renderReady(w, h);
    if (this.state === 'solved') this._renderSolved(w, h);

    if (this.toast) this._renderToast(w, h);
    if (this.cfg.debug) this._renderDebug();
  };

  Game.prototype._renderToast = function (w, h) {
    var ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(38,33,92,.88)';
    roundRect(ctx, w / 2 - 250, h - 300, 500, 74, 37);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '400 28px sans-serif';
    ctx.fillText(this.toast.text, w / 2, h - 263);
  };

  /** 选关页：每页 30 关（5 列 × 6 行），显示星级与锁定状态 */
  Game.prototype._renderLevels = function (w, h) {
    var ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = C.ink;
    ctx.font = '500 52px sans-serif';
    ctx.fillText('选择关卡', w / 2, 120);
    ctx.fillStyle = C.inkHint;
    ctx.font = '400 26px sans-serif';
    var total = MG.levels ? MG.levels.length : 0;
    ctx.fillText(
      '已通关 ' + this.best + ' 关　★ ' + this.totalStars() + ' / ' + total * 3,
      w / 2,
      178
    );

    var cols = 5;
    var cellW = (w - 80) / cols;
    var cellH = 132;
    var top = 240;
    var start = this.page * this.levelsPerPage;

    for (var i = 0; i < this.levelsPerPage; i++) {
      var lv = start + i + 1;
      if (total && lv > total) break;
      var cx = 40 + (i % cols) * cellW;
      var cy = top + Math.floor(i / cols) * cellH;
      var open = lv <= Math.max(1, this.best);
      var st = this.starsOf(lv);

      ctx.fillStyle = open ? '#FFFFFF' : 'rgba(0,0,0,0.045)';
      roundRect(ctx, cx + 6, cy + 6, cellW - 12, cellH - 12, 20);
      ctx.fill();
      ctx.strokeStyle = lv === this.level ? C.accent : C.gridLine;
      ctx.lineWidth = lv === this.level ? 4 : 1;
      ctx.stroke();

      ctx.fillStyle = open ? C.ink : 'rgba(95,94,90,.4)';
      ctx.font = '500 40px sans-serif';
      ctx.fillText(String(lv), cx + cellW / 2, cy + 52);

      if (open) {
        var s = '';
        for (var k = 0; k < 3; k++) s += k < st ? '★' : '☆';
        ctx.fillStyle = st >= 3 ? '#F5A623' : C.inkHint;
        ctx.font = '400 24px sans-serif';
        ctx.fillText(s, cx + cellW / 2, cy + 98);
      } else {
        ctx.fillStyle = 'rgba(95,94,90,.4)';
        ctx.font = '400 24px sans-serif';
        ctx.fillText('锁', cx + cellW / 2, cy + 98);
      }

      this.btns.push({
        x: cx + 6, y: cy + 6, w: cellW - 12, h: cellH - 12,
        kind: 'pick', arg: lv, enabled: open,
      });
    }

    var rows = Math.ceil(this.levelsPerPage / cols);
    var by = top + rows * cellH + 20;
    var pages = Math.max(1, Math.ceil((total || 30) / this.levelsPerPage));
    var bw = (w - 120) / 3;
    this._button('上一页', 40, by, bw, 96, C.btnGhost, C.btnGhostText, 'page', -1, this.page > 0);
    this._button(
      (this.page + 1) + ' / ' + pages,
      40 + bw + 20, by, bw, 96, 'rgba(0,0,0,0.04)', C.inkHint, null, null, false
    );
    this._button('下一页', 40 + (bw + 20) * 2, by, bw, 96, C.btnGhost, C.btnGhostText, 'page', 1, this.page < pages - 1);
    this._button('返回', w / 2 - 170, by + 116, 340, 96, C.btn, C.btnText, 'back');

    // 音效开关放右下角，不占视觉重心
    this._button(this.sfxOn ? '音效 开' : '音效 关', w - 200, h - 130, 160, 76, 'rgba(0,0,0,0.04)', this.sfxOn ? C.btnGhostText : C.inkHint, 'sfx');
  };

  /** 调试层：把关键信息画在屏幕上，替代 Console（真机上也能看） */
  Game.prototype._renderDebug = function () {
    var ctx = this.ctx;
    var info = this.ad.getSystemInfo();
    var lines = [
      'platform=' + this.ad.name +
        '  canvas=' + (this.ad.getCanvas ? (this.ad.getCanvas() || {}).width : '?') + 'x' + (this.ad.getCanvas ? (this.ad.getCanvas() || {}).height : '?'),
      'css=' + info.width.toFixed(0) + 'x' + info.height.toFixed(0) +
        '  dpr=' + info.dpr + '  scale=' + (this.ad._scale ? this.ad._scale.toFixed(3) : '1') +
        '  virtual=' + this.vw + 'x' + this.vh.toFixed(0),
      'state=' + this.state + '  level=' + this.level + '  moves=' + this.moves + '  cars=' + (this.board ? this.board.cars.length : 0),
      'tap=' + (this.lastPointer
        ? this.lastPointer.type + ' ' + this.lastPointer.x.toFixed(0) + ',' + this.lastPointer.y.toFixed(0) + '  ' + (this._result || '')
        : 'none'),
      'btn=' + (this.btns.length
        ? this.btns.map(function (b) { return b.x.toFixed(0) + ',' + b.y.toFixed(0) + ' ' + b.w + 'x' + b.h; }).join(' | ')
        : 'none'),
      'selftest=' + (this.selfTestMsg || 'none'),
    ];
    var pad = 10;
    var lh = 26;
    var boxH = lines.length * lh + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(0, this.vh - boxH, this.vw, boxH);
    ctx.fillStyle = '#7CFFB2';
    ctx.font = '400 20px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], pad, this.vh - boxH + pad + lh * i + lh / 2);
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

    // 过关驶出动画：红车加速冲出画面（0.55s），带一点拖影透明
    var solvedShift = 0;
    var solvedAlpha = 1;
    if (this.state === 'solved') {
      var target = MG.rush.carById(this.board, this.board.targetId);
      if (target) {
        var k = Math.min(this.passT / 0.55, 1);
        solvedShift = k * k * (MG.rush.SIZE - target.x + 2);
        solvedAlpha = 1 - Math.max(0, (this.passT - 0.25) / 0.3);
        if (solvedAlpha < 0) solvedAlpha = 0;
      }
    }

    // 车辆
    for (var ci = 0; ci < this.board.cars.length; ci++) {
      var car = this.board.cars[ci];
      var vis = this._carVisual(car);
      if (car.id === this.board.targetId && this.state === 'solved') {
        vis.gx += solvedShift;
      }
      var r = this._carRect(car, vis.gx, vis.gy);
      var isTarget = car.id === this.board.targetId;
      var isHint = this.hint && this.hint.carId === car.id && this.hintT > 0;

      ctx.globalAlpha = isTarget && this.state === 'solved' ? solvedAlpha : 1;
      ctx.fillStyle = isTarget ? C.target : C.carColors[car.id % C.carColors.length];
      roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.28);
      ctx.fill();

      // 车身高光：顶部一条浅色圆角，增加立体感（静态帧的高级感靠这个）
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      roundRect(ctx, r.x + r.w * 0.12, r.y + r.h * 0.14, r.w * 0.76, Math.min(r.h * 0.22, 16), 8);
      ctx.fill();

      if (isTarget) {
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.lineWidth = 4;
        roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.28);
        ctx.stroke();
      }
      if (isHint) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 6;
        roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.28);
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
      ctx.globalAlpha = 1;
    }
  };

  Game.prototype._renderFooter = function (w, h) {
    var by = this.boardY + this.boardW + 70;
    var bw = (w - 120) / 2;

    this._button('重开', 40, by, bw, 104, C.btnGhost, C.btnGhostText, 'restart', null, this.state === 'playing');
    this._button('提示（看广告）', 80 + bw, by, bw, 104, C.btn, C.btnText, 'hint', null, this.state === 'playing');
  };

  Game.prototype._renderReady = function (w, h) {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(246,244,238,.94)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ink;
    ctx.font = '500 64px sans-serif';
    ctx.fillText('车位脱困', w / 2, h / 2 - 280);
    ctx.fillStyle = C.inkSoft;
    ctx.font = '400 30px sans-serif';
    ctx.fillText('拖动车辆腾出通道', w / 2, h / 2 - 206);
    ctx.fillText('把红车从右侧出口开走', w / 2, h / 2 - 158);

    ctx.fillStyle = C.inkHint;
    ctx.font = '400 26px sans-serif';
    var total = MG.levels ? MG.levels.length : 0;
    ctx.fillText(
      '已通关 ' + this.best + ' 关　★ ' + this.totalStars() + ' / ' + total * 3,
      w / 2,
      h / 2 - 92
    );
    ctx.fillText('继续第 ' + this.level + ' 关', w / 2, h / 2 - 40);

    this._button('开始', w / 2 - 170, h / 2 + 20, 340, 108, C.btn, C.btnText, 'start', this.level);
    this._button('选关', w / 2 - 170, h / 2 + 150, 340, 96, C.btnGhost, C.btnGhostText, 'levels', null, this.best > 0);
    this._button(this.sfxOn ? '音效 开' : '音效 关', w - 200, h - 130, 160, 76, 'rgba(0,0,0,0.04)', this.sfxOn ? C.btnGhostText : C.inkHint, 'sfx');
  };

  Game.prototype._renderSolved = function (w, h) {
    var ctx = this.ctx;
    // 面板在红车驶出动画(0.55s)后渐入，不打断高光时刻
    var appear = (this.passT - 0.5) / 0.3;
    if (appear <= 0) return;
    if (appear > 1) appear = 1;
    ctx.globalAlpha = appear;
    ctx.fillStyle = 'rgba(246,244,238,.94)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 星级
    var starText = '';
    for (var si = 0; si < 3; si++) starText += si < this.stars ? '★' : '☆';
    ctx.fillStyle = this.stars >= 3 ? '#F5A623' : C.inkHint;
    ctx.font = '400 64px sans-serif';
    ctx.fillText(starText, w / 2, h / 2 - 232);

    ctx.fillStyle = C.ink;
    ctx.font = '500 60px sans-serif';
    ctx.fillText(this.stars >= 3 ? '完美过关' : '过关', w / 2, h / 2 - 140);
    ctx.fillStyle = C.inkSoft;
    ctx.font = '400 30px sans-serif';
    ctx.fillText('用了 ' + this.moves + ' 步　最少 ' + this.minSteps + ' 步', w / 2, h / 2 - 68);

    this._button('下一关', w / 2 - 170, h / 2 + 10, 340, 108, C.btn, C.btnText, 'next');
    this._button('分享给好友', w / 2 - 170, h / 2 + 140, 340, 96, C.btnGhost, C.btnGhostText, 'share');
    this._button('重玩本关', 40, h - 150, (w - 120) / 2, 96, 'rgba(0,0,0,0.04)', C.inkHint, 'restart');
    this._button('选关', w - 40 - (w - 120) / 2, h - 150, (w - 120) / 2, 96, 'rgba(0,0,0,0.04)', C.inkHint, 'levels');
    ctx.globalAlpha = 1;
  };

  Game.prototype._share = function () {
    this.ad.share({
      title: '我过了第 ' + this.level + ' 关，你行你也来｜车位脱困',
      // 带上关卡号：好友点开直达同一关，形成可比拼的入口
      query: 'level=' + this.level,
    });
    this._toast('已发起分享');
  };

  Game.prototype._restart = function () {
    this.startLevel(this.level);
  };

  /**
   * 画按钮并登记命中区。
   * action 用 (kind, arg) 表达而不是函数 —— 渲染每帧重建按钮，用函数就得每帧新建闭包。
   * kind 为 null 表示纯展示（如页码），不可点。
   */
  Game.prototype._button = function (text, x, y, w, h, bg, fg, kind, arg, enabled) {
    var ctx = this.ctx;
    var on = enabled !== false && kind !== null && kind !== undefined;
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
    this.btns.push({ x: x, y: y, w: w, h: h, kind: kind, arg: arg, enabled: on });
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

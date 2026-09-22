/**
 * 车位脱困 · 玩法引擎（纯逻辑，零渲染零平台依赖）
 *
 * 棋盘 6x6，出口固定在右侧第 3 行（EXIT_ROW）。
 * 车辆沿自身轴向滑动，目标车(默认 id=0, 水平)从出口开走即过关。
 *
 * 为什么自带求解器：关卡是程序生成的，必须"生成后用 BFS 验解"才能投放，
 * 否则会给玩家无解关卡。求解器同时用于「提示」功能。
 *
 * 性能要求：求解器必须够快，否则玩家点「开始」会卡。
 * 做法：状态用扁平位置数组、占用表用 Uint8Array 复用、移动时增量清/填该车格子，
 *      不克隆棋盘、不构造对象。
 */
(function (root) {
  var MG = root.MG || (root.MG = {});
  var SIZE = 6;
  var EXIT_ROW = 2;

  var R = {};

  /** 可复现随机数（同一 seed 出同一批关卡，方便复现问题） */
  R.makeRng = function (seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  };

  /** 占用表（第一维 y，第二维 x） */
  function buildOcc(b, skipId) {
    var occ = [];
    for (var y = 0; y < SIZE; y++) occ.push([0, 0, 0, 0, 0, 0]);
    for (var i = 0; i < b.cars.length; i++) {
      var c = b.cars[i];
      if (c.id === skipId) continue;
      for (var k = 0; k < c.len; k++) {
        var x = c.dir === 'h' ? c.x + k : c.x;
        var y2 = c.dir === 'v' ? c.y + k : c.y;
        if (x >= 0 && x < SIZE && y2 >= 0 && y2 < SIZE) occ[y2][x] = 1;
      }
    }
    return occ;
  }

  function canStep(occ, car, delta) {
    if (car.dir === 'h') {
      var nx = car.x + delta;
      if (nx < 0 || nx + car.len > SIZE) return false;
      return occ[car.y][delta > 0 ? nx + car.len - 1 : nx] === 0;
    }
    var ny = car.y + delta;
    if (ny < 0 || ny + car.len > SIZE) return false;
    return occ[delta > 0 ? ny + car.len - 1 : ny][car.x] === 0;
  }

  R.carById = function (b, id) {
    for (var i = 0; i < b.cars.length; i++) if (b.cars[i].id === id) return b.cars[i];
    return null;
  };

  /** 该车沿该方向最多能连续走几格 */
  R.maxSlide = function (b, carId, delta) {
    var car = R.carById(b, carId);
    if (!car) return 0;
    var occ = buildOcc(b, carId);
    var probe = { x: car.x, y: car.y, len: car.len, dir: car.dir };
    var n = 0;
    while (n < SIZE) {
      if (!canStep(occ, probe, delta)) break;
      if (probe.dir === 'h') probe.x += delta;
      else probe.y += delta;
      n += 1;
    }
    return n;
  };

  /** 移动（就地修改）。delta = 沿自身方向移动的格数，可正可负。返回实际移动格数 */
  R.move = function (b, carId, delta) {
    var car = R.carById(b, carId);
    if (!car) return 0;
    var occ = buildOcc(b, carId);
    var probe = { x: car.x, y: car.y, len: car.len, dir: car.dir };
    var step = delta > 0 ? 1 : -1;
    var moved = 0;
    while (moved < Math.abs(delta)) {
      if (!canStep(occ, probe, step)) break;
      if (probe.dir === 'h') probe.x += step;
      else probe.y += step;
      moved += 1;
    }
    car.x = probe.x;
    car.y = probe.y;
    return moved;
  };

  R.isSolved = function (b) {
    var t = R.carById(b, b.targetId);
    return !!t && t.dir === 'h' && t.y === EXIT_ROW && t.x + t.len === SIZE;
  };

  R.clone = function (b) {
    return {
      targetId: b.targetId,
      cars: b.cars.map(function (c) {
        return { id: c.id, x: c.x, y: c.y, len: c.len, dir: c.dir };
      }),
    };
  };

  /**
   * BFS 最短解
   * 返回 { solvable, minSteps, firstMove:{carId,delta}, nodes }
   * maxDepth：只搜到该深度（win 在该深度内仍会被检出，但不再向下扩展）。
   * 生成期用「target+6」的有界搜索代替完整求解 —— 太简单的浅层就命中、太难的被
   * 深度截断，都不用搜满整棵树，实测能把高难度关卡生成耗时从 20s 降到 2~4s。
   */
  R.solve = function (board, maxNodes, maxDepth) {
    maxNodes = maxNodes || 120000;
    var cars = board.cars;
    var n = cars.length;
    var lens = new Array(n);
    var hFlag = new Array(n);
    var targetIdx = -1;
    var i;
    for (i = 0; i < n; i++) {
      lens[i] = cars[i].len;
      hFlag[i] = cars[i].dir === 'h';
      if (cars[i].id === board.targetId) targetIdx = i;
    }
    if (targetIdx < 0) return { solvable: false, nodes: 0 };

    var start = new Array(n * 2);
    for (i = 0; i < n; i++) {
      start[i * 2] = cars[i].x;
      start[i * 2 + 1] = cars[i].y;
    }

    var occ = new Uint8Array(SIZE * SIZE);
    function fillAll(pos) {
      occ.fill(0);
      for (var ci = 0; ci < n; ci++) {
        var x = pos[ci * 2];
        var y = pos[ci * 2 + 1];
        var L = lens[ci];
        var k;
        if (hFlag[ci]) {
          var base = y * SIZE + x;
          for (k = 0; k < L; k++) occ[base + k] = 1;
        } else {
          for (k = 0; k < L; k++) occ[(y + k) * SIZE + x] = 1;
        }
      }
    }
    function clearCar(pos, ci) {
      var x = pos[ci * 2];
      var y = pos[ci * 2 + 1];
      var L = lens[ci];
      var k;
      if (hFlag[ci]) {
        var base = y * SIZE + x;
        for (k = 0; k < L; k++) occ[base + k] = 0;
      } else {
        for (k = 0; k < L; k++) occ[(y + k) * SIZE + x] = 0;
      }
    }
    function setCar(pos, ci) {
      var x = pos[ci * 2];
      var y = pos[ci * 2 + 1];
      var L = lens[ci];
      var k;
      if (hFlag[ci]) {
        var base = y * SIZE + x;
        for (k = 0; k < L; k++) occ[base + k] = 1;
      } else {
        for (k = 0; k < L; k++) occ[(y + k) * SIZE + x] = 1;
      }
    }
    function keyOf(pos) {
      var s = '';
      for (var ci = 0; ci < pos.length; ci++) s += pos[ci] + ',';
      return s;
    }
    function isWin(pos) {
      return pos[targetIdx * 2] + lens[targetIdx] === SIZE && pos[targetIdx * 2 + 1] === EXIT_ROW;
    }

    var startKey = keyOf(start);
    var queue = [start];
    var keys = [startKey];
    var seen = {};
    seen[startKey] = 0;
    var firstMove = {};
    firstMove[startKey] = null;
    var head = 0;
    var nodes = 0;

    while (head < queue.length && nodes < maxNodes) {
      var pos = queue[head];
      var key = keys[head];
      head += 1;
      nodes += 1;
      var d = seen[key];

      if (isWin(pos)) {
        return { solvable: true, minSteps: d, firstMove: firstMove[key], nodes: nodes };
      }
      // 有界搜索：该层只判 win 不扩展（子节点会落在 maxDepth+1 层）
      if (maxDepth !== undefined && d >= maxDepth) continue;

      fillAll(pos);
      for (var ci = 0; ci < n; ci++) {
        var L = lens[ci];
        var x0 = pos[ci * 2];
        var y0 = pos[ci * 2 + 1];
        clearCar(pos, ci);
        for (var s = -1; s <= 1; s += 2) {
          // ⚠️ 游戏规则：一辆车一次拖「任意格」= 1 步。
          // BFS 每个邻居 = 该车沿该方向一次滑到某个可达位置（1..max 格，代价都是 1）。
          // 之前写成每次只走 1 格，minSteps 变成「格数」—— 星级判定、难度曲线全部失真。
          for (var step = 1; step <= SIZE; step++) {
            var nx = hFlag[ci] ? x0 + s * step : x0;
            var ny = hFlag[ci] ? y0 : y0 + s * step;
            if (hFlag[ci]) {
              if (nx < 0 || nx + L > SIZE) break;
            } else {
              if (ny < 0 || ny + L > SIZE) break;
            }
            // 路径逐格检查：前沿格被占则更远也到不了
            var edgeX = hFlag[ci] ? (s > 0 ? nx + L - 1 : nx) : nx;
            var edgeY = hFlag[ci] ? ny : (s > 0 ? ny + L - 1 : ny);
            if (occ[edgeY * SIZE + edgeX]) break;

            var np = pos.slice();
            np[ci * 2] = nx;
            np[ci * 2 + 1] = ny;
            var nk = keyOf(np);
            if (seen[nk] !== undefined) continue;
            seen[nk] = d + 1;
            firstMove[nk] = firstMove[key] || { carId: cars[ci].id, delta: s * step };
            queue.push(np);
            keys.push(nk);
          }
        }
        setCar(pos, ci);
      }
    }
    return { solvable: false, nodes: nodes };
  };

  /** 提示：给当前局面的一步最优走法 */
  R.hint = function (board) {
    var r = R.solve(board, 150000);
    if (!r.solvable || !r.firstMove) return null;
    return r.firstMove;
  };

  /**
   * 程序化生成关卡
   * 难度随 level 缓升；生成后必须过求解器，保证有解。
   * 若多次尝试都没达到目标难度，就返回已找到的最难的一关（宁可简单，绝不给无解）。
   */
  R.generate = function (level, seed) {
    var rng = R.makeRng((seed || 12345) + level * 7919);
    var wantCars = Math.min(4 + Math.floor((level - 1) / 4), 10);
    var wantMin = Math.min(1 + Math.floor((level - 1) / 4), 10);

    var best = null;

    for (var attempt = 0; attempt < 40; attempt++) {
      var cars = [{ id: 0, x: 0, y: EXIT_ROW, len: 2, dir: 'h' }];
      var used = [];
      for (var y = 0; y < SIZE; y++) used.push([0, 0, 0, 0, 0, 0]);
      used[EXIT_ROW][0] = 1;
      used[EXIT_ROW][1] = 1;

      var id = 1;
      var guard = 0;
      while (cars.length < wantCars && guard < 300) {
        guard += 1;
        var len = rng() < 0.72 ? 2 : 3;
        var dir = rng() < 0.5 ? 'h' : 'v';
        var maxX = dir === 'h' ? SIZE - len : SIZE - 1;
        var maxY = dir === 'v' ? SIZE - len : SIZE - 1;
        var x = Math.floor(rng() * (maxX + 1));
        var y2 = Math.floor(rng() * (maxY + 1));

        var ok = true;
        for (var k = 0; k < len; k++) {
          var cx = dir === 'h' ? x + k : x;
          var cy = dir === 'v' ? y2 + k : y2;
          if (used[cy][cx]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        for (var m = 0; m < len; m++) {
          used[dir === 'h' ? y2 : y2 + m][dir === 'h' ? x + m : x] = 1;
        }
        cars.push({ id: id, x: x, y: y2, len: len, dir: dir });
        id += 1;
      }

      var board = { targetId: 0, cars: cars };
      if (R.isSolved(board)) continue;
      var res = R.solve(board, 30000);
      if (!res.solvable) continue;
      if (res.minSteps >= wantMin) {
        return { board: board, minSteps: res.minSteps, level: level };
      }
      if (!best || res.minSteps > best.minSteps) best = { board: board, minSteps: res.minSteps };
    }

    if (best) return { board: best.board, minSteps: best.minSteps, level: level };

    return {
      level: level,
      minSteps: 1,
      board: {
        targetId: 0,
        cars: [
          { id: 0, x: 0, y: EXIT_ROW, len: 2, dir: 'h' },
          { id: 1, x: 0, y: 0, len: 3, dir: 'v' },
        ],
      },
    };
  };

  /**
   * 取关卡：优先读离线关卡表（零计算，秒开），表外则现生成兜底。
   * 关卡表由 tools/genlevels.mjs 离线产出，见 src/data/levels.js。
   */
  R.getLevel = function (level) {
    var table = MG.levels;
    if (table && level >= 1 && level <= table.length) {
      var d = table[level - 1];
      var cars = [];
      for (var i = 0; i < d.c.length; i++) {
        var t = d.c[i];
        cars.push({ id: i, x: t[0], y: t[1], len: t[2], dir: t[3] ? 'h' : 'v' });
      }
      return { board: { targetId: 0, cars: cars }, minSteps: d.m, level: level };
    }
    return R.generate(level);
  };

  R.SIZE = SIZE;
  R.EXIT_ROW = EXIT_ROW;
  MG.rush = R;
})(typeof globalThis !== 'undefined' ? globalThis : this);

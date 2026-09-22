/**
 * 内置自测（调试用，上线前关掉）
 *
 * 为什么需要它：开发者工具的自动化接口在部分环境下不响应，而「看得见点不着 / 屏幕全白」
 * 这类问题必须在**真实小游戏环境**里才能确认。所以让游戏自己跑：
 *   注入「原生坐标」-> 走完整换算链路 -> 检查状态变化 -> 画在屏幕上 + POST 回本机
 *
 * 上报地址：tools/report-server.mjs（默认 http://127.0.0.1:8899/report）
 * 注意：小游戏要在开发者工具里关闭域名校验（project.config.json 的 setting.urlCheck=false）
 */
(function (root) {
  var MG = root.MG || (root.MG = {});

  MG.selfTest = function (ad, game) {
    var cfg = MG.config || {};
    var url = cfg.reportUrl || 'http://127.0.0.1:8899/report';
    var lines = [];
    var sc = ad._scale || 1;
    var info = ad.getSystemInfo();
    var cv = ad.getCanvas ? ad.getCanvas() : null;

    function log(s) {
      lines.push(s);
      if (root.console) console.log('[自测] ' + s);
    }

    function startBtn() {
      var found = null;
      for (var i = 0; i < game.btns.length; i++) {
        if (game.btns[i].y < game.vh * 0.8) found = game.btns[i];
      }
      return found;
    }

    /** 注入原生坐标（换算由适配层负责，与真实手指同一条路径） */
    function inject(vx, vy, type) {
      if (!ad._handler) return false;
      ad._handler({ x: vx / sc, y: vy / sc, type: type });
      return true;
    }

    function report(tag) {
      var payload = {
        tag: tag,
        platform: ad.name,
        canvas: cv ? cv.width + 'x' + cv.height : '?',
        dpr: info.dpr,
        scale: sc,
        state: game.state,
        level: game.level,
        moves: game.moves,
        cars: game.board ? game.board.cars.length : 0,
        result: game._result,
        last: game.lastPointer,
        lines: lines,
      };
      log('上报 tag=' + tag);
      game.selfTestMsg = '自测:' + tag + ' state=' + game.state;
      ad.httpPost(url, payload).then(function (r) {
        log('上报结果 ' + JSON.stringify(r));
      });
    }

    log('平台=' + ad.name + ' 画布=' + (cv ? cv.width + 'x' + cv.height : '?') + ' dpr=' + info.dpr + ' scale=' + sc);
    log('虚拟画布=' + game.vw + 'x' + Math.round(game.vh) + ' 状态=' + game.state + ' 按钮数=' + game.btns.length);

    setTimeout(function () {
      var btn = startBtn();
      log('开始按钮=' + (btn ? Math.round(btn.x) + ',' + Math.round(btn.y) + ' ' + btn.w + 'x' + btn.h : 'none'));
      if (!btn) {
        report('no-start-button');
        return;
      }

      var vx = btn.x + btn.w / 2;
      var vy = btn.y + btn.h / 2;
      log('注入原生点击(' + Math.round(vx / sc) + ',' + Math.round(vy / sc) + ') 对应虚拟(' + Math.round(vx) + ',' + Math.round(vy) + ')');
      if (!inject(vx, vy, 'down')) {
        log('适配层未暴露 _handler，无法注入');
        report('no-handler');
        return;
      }

      setTimeout(function () {
        log('点击后 状态=' + game.state + ' 命中=' + game._result + ' 车数=' + (game.board ? game.board.cars.length : 0));
        report('click-start');

        setTimeout(function () {
          // 找一辆可移动的车拖一下
          var car = null;
          var cars = game.board ? game.board.cars : [];
          for (var i = 0; i < cars.length; i++) {
            var c = cars[i];
            if (c.id === game.board.targetId) continue;
            var up = MG.rush.maxSlide(game.board, c.id, -1);
            var dn = MG.rush.maxSlide(game.board, c.id, 1);
            if (up > 0 || dn > 0) {
              car = { id: c.id, delta: up > 0 ? -1 : 1 };
              break;
            }
          }
          if (!car) {
            report('no-movable-car');
            return;
          }
          var rec = null;
          var obj = null;
          for (var j = 0; j < cars.length; j++) {
            if (cars[j].id === car.id) obj = cars[j];
          }
          rec = game._carRect(obj);
          var movesBefore = game.moves;
          inject(rec.x + rec.w / 2, rec.y + rec.h / 2, 'down');
          inject(rec.x + rec.w / 2, rec.y + rec.h / 2 + car.delta * game.cell, 'move');
          inject(rec.x + rec.w / 2, rec.y + rec.h / 2 + car.delta * game.cell, 'up');
          setTimeout(function () {
            log('拖拽后 moves=' + game.moves + '（之前 ' + movesBefore + '）');
            report('drag');
          }, 400);
        }, 400);
      }, 700);
    }, 2500);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

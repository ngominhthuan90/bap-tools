/* =====================================================================
   Gọi số — chuông và giọng đọc
   Dùng giọng tiếng Việt có sẵn trên máy (Web Speech API). Microsoft Edge có
   giọng tự nhiên HoaiMy / NamMinh; Chrome trên Windows dùng giọng "Microsoft An"
   nếu đã cài gói giọng nói tiếng Việt của Windows.
   Các lượt đọc được xếp hàng, không bao giờ đọc chồng lên nhau.
   ===================================================================== */
(function () {
  "use strict";
  var V = {}, ctx = null, queue = [], playing = false, gen = 0, timer = 0;
  var synth = window.speechSynthesis || null;

  function ac() {
    if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  // Trình duyệt chỉ cho phát âm thanh sau khi người dùng bấm vào trang
  V.unlock = function () {
    ac();
    if (synth) { try { var u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); } catch (e) {} }
  };
  V.voices = function () {
    if (!synth) return [];
    return synth.getVoices().filter(function (v) { return /^vi([-_]|$)/i.test(v.lang); }).sort(function (a, b) {
      function score(v) { return (/natural|online/i.test(v.name) ? 0 : /microsoft/i.test(v.name) ? 1 : 2); }
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });
  };
  V.onVoices = function (fn) {
    if (!synth) return;
    fn();
    if (synth.addEventListener) synth.addEventListener("voiceschanged", fn);
    else synth.onvoiceschanged = fn;
  };
  V.pickVoice = function (name) {
    var list = V.voices();
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return list[0] || null;
  };

  // Chuông "ding-dong" hai nốt, tự tổng hợp
  V.chime = function () {
    var c = ac();
    if (!c) return Promise.resolve();
    var t = c.currentTime + 0.05;
    [[880, 0], [698.46, 0.45]].forEach(function (x) {
      var o = c.createOscillator(), g = c.createGain(), s = t + x[1];
      o.type = "sine"; o.frequency.value = x[0];
      o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.32, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.9);
      o.start(s); o.stop(s + 0.95);
    });
    return new Promise(function (r) { setTimeout(r, 1250); });
  };

  V.say = function (text, opt) {
    opt = opt || {};
    return new Promise(function (resolve) {
      if (!synth || !text) return resolve();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "vi-VN";
      var v = V.pickVoice(opt.voice);
      if (v) u.voice = v;
      u.rate = opt.rate || 0.95;
      u.volume = opt.volume == null ? 1 : opt.volume;
      var done = false, t;
      function end() { if (done) return; done = true; clearTimeout(t); resolve(); }
      u.onend = end; u.onerror = end;
      t = setTimeout(end, 4000 + text.length * 160); // phòng khi trình duyệt không báo đọc xong
      synth.speak(u);
    });
  };

  // Ước lượng thời gian đọc (để máy chủ xếp lịch, các màn hình không đọc chồng)
  V.estimate = function (text, opt) {
    opt = opt || {};
    var once = 600 + String(text).length * 70 / (opt.rate || 0.95);
    return Math.round((opt.chime === false ? 0 : 1250) + once * (opt.repeat || 1) + 500);
  };

  // Một lượt thông báo: chuông rồi đọc (1 hoặc 2 lần)
  function announce(item) {
    var o = item.opt || {}, g = gen;
    var p = o.chime === false ? Promise.resolve() : V.chime();
    var times = o.repeat || 1;
    for (var i = 0; i < times; i++) {
      p = p.then(function (k) {
        return function () {
          if (g !== gen) return;
          return (k > 0 ? new Promise(function (r) { setTimeout(r, 700); }) : Promise.resolve()).then(function () {
            if (g === gen) return V.say(item.text, o);
          });
        };
      }(i));
    }
    return p;
  }
  function pump() {
    if (playing || !queue.length) return;
    var it = queue[0], wait = it.at ? it.at - Date.now() : 0;
    if (wait > 50) { clearTimeout(timer); timer = setTimeout(pump, Math.min(wait, 60000)); return; }
    queue.shift();
    playing = true;
    var g = gen;
    if (V.onStart) V.onStart(it);
    announce(it).then(function () {
      if (g !== gen) return;
      playing = false;
      if (V.onEnd) V.onEnd(it);
      pump();
    });
  }
  // item: { text, at (giờ máy này, ms) , opt: { voice, rate, repeat, chime } }
  V.enqueue = function (item) { queue.push(item); pump(); };
  V.stop = function () {
    gen++; queue = []; playing = false; clearTimeout(timer);
    if (synth) synth.cancel();
  };
  V.busy = function () { return playing || queue.length > 0; };
  V.supported = !!synth;

  window.GoiSoVoice = V;
})();

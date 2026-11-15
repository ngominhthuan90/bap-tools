/* Gọi số — cài đặt giọng đọc dùng chung cho bàn gọi và màn hình chờ trên cùng máy */
(function () {
  "use strict";
  var KEY = "goiso-voice";
  var DEF = { voice: "", rate: 0.95, digits: false, repeat: 1, chime: true, lead: "Mời bệnh nhân số" };
  function get() { return Object.assign({}, DEF, BT.store.get(KEY, {})); }
  function set(v) { BT.store.set(KEY, v); }

  var NO_VOICE = "Máy này chưa có giọng tiếng Việt nên chỉ có tiếng chuông. Mở trang bằng Microsoft Edge (có sẵn giọng HoaiMy, NamMinh), " +
    "hoặc cài giọng tiếng Việt trong Windows: Cài đặt, Thời gian và ngôn ngữ, Giọng nói, Thêm giọng.";

  // Vẽ các ô cài đặt giọng vào box; sample(): trả về {room, q, n} để nghe thử
  function voiceForm(box, sample) {
    var v = get();
    box.innerHTML =
      '<div class="row"><label class="field"><span>Giọng</span><select data-k="voice"></select></label>' +
      '<label class="field" style="max-width:150px"><span>Tốc độ</span><select data-k="rate"><option value="0.8">Chậm</option><option value="0.95">Vừa</option><option value="1.1">Nhanh</option></select></label></div>' +
      '<div class="row"><label class="field"><span>Cách đọc số 125</span><select data-k="digits"><option value="0">một trăm hai mươi lăm</option><option value="1">một hai năm</option></select></label>' +
      '<label class="field" style="max-width:150px"><span>Số lần đọc</span><select data-k="repeat"><option value="1">1 lần</option><option value="2">2 lần</option></select></label></div>' +
      '<label class="field"><span>Câu mời</span><input type="text" data-k="lead" maxlength="40"></label>' +
      '<label class="check"><input type="checkbox" data-k="chime"> Chuông trước khi đọc</label>' +
      '<div class="row" style="align-items:center;flex-wrap:nowrap"><button type="button" class="btn btn-sm" data-test>Nghe thử</button>' +
      '<span class="note" data-vnote style="margin:0"></span></div>';
    var sel = box.querySelector('[data-k="voice"]'), note = box.querySelector("[data-vnote]");
    function fillVoices() {
      var list = GoiSoVoice.voices(), cur = get().voice;
      sel.innerHTML = list.length ? list.map(function (x) {
        return '<option value="' + BT.esc(x.name) + '">' + BT.esc(x.name.replace(/\s*-\s*Vietnamese.*$/i, "").replace(/^Microsoft\s+/i, "")) + "</option>";
      }).join("") : '<option value="">Chưa có giọng tiếng Việt</option>';
      if (cur && list.some(function (x) { return x.name === cur; })) sel.value = cur;
      note.textContent = list.length ? "" : NO_VOICE;
      note.style.color = list.length ? "" : "var(--err)";
    }
    if (GoiSoVoice.supported) GoiSoVoice.onVoices(fillVoices); else { sel.innerHTML = '<option value="">Trình duyệt không hỗ trợ đọc</option>'; note.textContent = NO_VOICE; }
    box.querySelector('[data-k="rate"]').value = String(v.rate);
    box.querySelector('[data-k="digits"]').value = v.digits ? "1" : "0";
    box.querySelector('[data-k="repeat"]').value = String(v.repeat);
    box.querySelector('[data-k="lead"]').value = v.lead;
    box.querySelector('[data-k="chime"]').checked = v.chime !== false;
    box.addEventListener("change", function () {
      var n = get();
      n.voice = sel.value;
      n.rate = parseFloat(box.querySelector('[data-k="rate"]').value) || 0.95;
      n.digits = box.querySelector('[data-k="digits"]').value === "1";
      n.repeat = parseInt(box.querySelector('[data-k="repeat"]').value, 10) || 1;
      n.lead = box.querySelector('[data-k="lead"]').value.trim() || DEF.lead;
      n.chime = box.querySelector('[data-k="chime"]').checked;
      set(n);
    });
    box.querySelector("[data-test]").addEventListener("click", function () {
      box.dispatchEvent(new Event("change"));
      GoiSoVoice.unlock();
      GoiSoVoice.stop();
      var s = sample ? sample() : null, o = get();
      var text = s ? GoiSoQueue.speech(s.room, s.q, s.n, { digits: o.digits, lead: o.lead }) : o.lead + " một trăm hai mươi lăm, đến quầy số 2";
      GoiSoVoice.enqueue({ text: text, opt: o });
    });
  }

  window.GoiSoUI = { get: get, set: set, voiceForm: voiceForm, DEF: DEF, NO_VOICE: NO_VOICE };
})();

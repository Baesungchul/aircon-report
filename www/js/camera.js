/* ═══════════════════════════════
   앱 내장 카메라 (가로 4:3 고정)
   - 시스템 카메라 대신 getUserMedia 사용
   - 미리보기부터 가로 4:3 프레임 고정 (보고서 사진 칸과 동일 비율)
   - 출력 해상도는 설정(⚙️ 설정 → 📷 사진 해상도)에서 3단계로 선택 가능
     (표준 1000×750 / 고화질 1600×1200 / 최고화질 2000×1500) - localStorage 'ac_cam_res_v1'
   - 셔터를 누르면 즉시 카메라 종료 + 안내 메시지, 첨부는 재압축 없이 빠르게
═══════════════════════════════ */
(function () {
  let stream = null;
  let videoEl = null;
  let overlayEl = null;
  let ctx = null;          // { uid, type, sid }
  let facing = 'environment';
  let capturing = false;   // 중복 촬영 방지

  const TARGET = 4 / 3;    // 가로/세로 = 4:3 (가로)

  // ★ 사진 해상도 설정 (설정 화면에서 선택, 기본값 '표준' = 기존 동작과 동일)
  const CAM_RES_KEY = 'ac_cam_res_v1';
  const CAM_RES_PRESETS = {
    std:   { w: 1000, h: 750,  idealW: 1920, idealH: 1440, label: '표준 (1000×750)',     short: '표준' },
    high:  { w: 1600, h: 1200, idealW: 2560, idealH: 1920, label: '고화질 (1600×1200)',  short: '고화질' },
    ultra: { w: 2000, h: 1500, idealW: 3200, idealH: 2400, label: '최고화질 (2000×1500)', short: '최고' }
  };
  const CAM_RES_ORDER = ['std', 'high', 'ultra'];
  window.CAM_RES_PRESETS = CAM_RES_PRESETS;
  window.CAM_RES_KEY = CAM_RES_KEY;

  function getCamResKey() {
    var key = 'std';
    try { key = localStorage.getItem(CAM_RES_KEY) || 'std'; } catch (e) {}
    return CAM_RES_PRESETS[key] ? key : 'std';
  }
  function getCamResPreset() { return CAM_RES_PRESETS[getCamResKey()]; }
  // ★ 카메라 화면 안 해상도 선택 메뉴 (설정 화면과 같은 키 공유 - 서로 즉시 반영)
  function closeResMenu() {
    var m = overlayEl && overlayEl.querySelector('#camResMenu');
    if (m) m.remove();
  }
  function openResMenu() {
    if (!overlayEl) return;
    var exist = overlayEl.querySelector('#camResMenu');
    if (exist) { exist.remove(); return; }  // 다시 누르면 닫기
    var cur = getCamResKey();
    var menu = document.createElement('div');
    menu.id = 'camResMenu';
    menu.style.cssText = 'position:absolute;top:58px;left:50%;transform:translateX(-50%);' +
      'background:rgba(18,18,18,.96);border:1px solid rgba(255,255,255,.18);border-radius:14px;' +
      'overflow:hidden;z-index:6;min-width:240px;box-shadow:0 8px 24px rgba(0,0,0,.5);';
    menu.innerHTML = CAM_RES_ORDER.map(function (k, i) {
      var p = CAM_RES_PRESETS[k];
      var on = (k === cur);
      return '<div class="camResOpt" data-k="' + k + '" style="display:flex;align-items:center;justify-content:space-between;gap:12px;' +
        'padding:14px 16px;color:#fff;font-size:14px;cursor:pointer;' +
        (on ? 'background:rgba(124,92,255,.35);font-weight:700;' : '') +
        (i < CAM_RES_ORDER.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,.08);' : '') + '">' +
        '<span>' + p.short + '</span>' +
        '<span style="font-size:13px;opacity:.9;">' + p.w + '×' + p.h + (on ? ' ✓' : '') + '</span>' +
      '</div>';
    }).join('');
    overlayEl.appendChild(menu);
    menu.querySelectorAll('.camResOpt').forEach(function (o) {
      o.onclick = function () {
        var k = o.getAttribute('data-k');
        try { localStorage.setItem(CAM_RES_KEY, k); } catch (e) {}
        var preset = CAM_RES_PRESETS[k];
        OUT_W = preset.w; OUT_H = preset.h;
        updateResBtn();
        // 설정 화면의 셀렉트도 동기화 (열려 있을 수 있음)
        try { var sel = document.getElementById('camResSelect'); if (sel) sel.value = k; } catch (e) {}
        if (typeof showToast === 'function') showToast('📐 ' + preset.label, 'ok');
        closeResMenu();
        startStream();  // 캡처 스트림도 새 해상도로 재시작
      };
    });
  }
  function updateResBtn() {
    var b = overlayEl && overlayEl.querySelector('#camRes');
    if (b) { var p = getCamResPreset(); b.textContent = '📐 ' + p.w + '×' + p.h; }
  }

  // 현재 선택된 해상도 (카메라를 열 때마다 다시 읽음 - 설정 변경이 다음 촬영부터 바로 반영됨)
  let OUT_W = CAM_RES_PRESETS.std.w;
  let OUT_H = CAM_RES_PRESETS.std.h;

  function ensureDom() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'camOverlay';
    overlayEl.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#000;display:none;' +
      'flex-direction:column;align-items:center;justify-content:center;';
    overlayEl.innerHTML =
      '<div id="camStage" style="position:relative;width:100%;max-width:560px;aspect-ratio:4/3;' +
        'background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;">' +
        '<video id="camVideo" playsinline autoplay muted ' +
          'style="width:100%;height:100%;object-fit:cover;"></video>' +
        '<div style="position:absolute;top:10px;left:0;right:0;text-align:center;color:#fff;' +
          'font-size:13px;text-shadow:0 1px 3px #000;pointer-events:none;">가로 4:3 고정</div>' +
      '</div>' +
      '<div style="position:absolute;top:14px;left:14px;">' +
        '<button id="camClose" type="button" style="width:44px;height:44px;border:none;border-radius:50%;' +
          'background:rgba(0,0,0,.5);color:#fff;font-size:20px;">✕</button>' +
      '</div>' +
      '<div style="position:absolute;top:14px;right:14px;">' +
        '<button id="camFlip" type="button" style="width:44px;height:44px;border:none;border-radius:50%;' +
          'background:rgba(0,0,0,.5);color:#fff;font-size:20px;">🔄</button>' +
      '</div>' +
      '<div style="position:absolute;top:14px;left:0;right:0;display:flex;justify-content:center;pointer-events:none;">' +
        '<button id="camRes" type="button" style="pointer-events:auto;height:34px;padding:0 16px;border:none;border-radius:17px;' +
          'background:rgba(0,0,0,.5);color:#fff;font-size:13px;font-weight:700;">📐 표준</button>' +
      '</div>' +
      '<div style="position:absolute;bottom:0;left:0;right:0;height:120px;display:flex;' +
        'align-items:center;justify-content:center;background:rgba(0,0,0,.35);">' +
        '<button id="camShot" type="button" style="width:72px;height:72px;border-radius:50%;' +
          'border:5px solid #fff;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.3);"></button>' +
      '</div>';
    document.body.appendChild(overlayEl);

    videoEl = overlayEl.querySelector('#camVideo');
    overlayEl.querySelector('#camShot').addEventListener('click', capture);
    overlayEl.querySelector('#camClose').addEventListener('click', close);
    overlayEl.querySelector('#camFlip').addEventListener('click', flip);
    overlayEl.querySelector('#camRes').addEventListener('click', openResMenu);
  }

  async function startStream() {
    stopStream();
    var preset = getCamResPreset();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width:  { ideal: preset.idealW },
          height: { ideal: preset.idealH }
        }
      });
      videoEl.srcObject = stream;
      videoEl.style.transform = (facing === 'user') ? 'scaleX(-1)' : 'none';
      await videoEl.play().catch(() => {});
    } catch (e) {
      if (typeof showToast === 'function') showToast('카메라를 열 수 없어요. 권한을 확인해주세요.', 'err');
      close();
    }
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function flip() {
    facing = (facing === 'environment') ? 'user' : 'environment';
    startStream();
  }

  function capture() {
    if (capturing) return;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) {
      if (typeof showToast === 'function') showToast('카메라 준비 중이에요. 잠시 후 다시 눌러주세요.');
      return;
    }
    capturing = true;

    // 가로 4:3로 중앙 크롭
    let sw = vw, sh = vh, sx = 0, sy = 0;
    const cur = vw / vh;
    if (cur > TARGET) { sw = Math.round(vh * TARGET); sx = Math.round((vw - sw) / 2); }
    else if (cur < TARGET) { sh = Math.round(vw / TARGET); sy = Math.round((vh - sh) / 2); }

    // 출력 해상도는 설정에서 고른 프리셋 그대로 (표준/고화질/최고화질)
    const canvas = document.createElement('canvas');
    canvas.width  = OUT_W;
    canvas.height = OUT_H;
    const c = canvas.getContext('2d');
    if (facing === 'user') { c.translate(OUT_W, 0); c.scale(-1, 1); }  // 전면은 좌우 반전 보정
    c.drawImage(videoEl, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);  // 동기 — 이 시점에 프레임 확보됨

    // dataUrl 동기 추출 (재압축 단계 생략 → 지연 최소화)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // ctx 값은 close() 전에 미리 복사 (close가 ctx=null로 만듦)
    const _uid = ctx.uid, _type = ctx.type, _sid = ctx.sid;

    // ★ 프레임을 이미 잡았으니 카메라를 즉시 닫고 바로 안내 표시
    close();
    if (typeof showToast === 'function') showToast('📸 사진 추가 중…');

    // 카메라 닫힘이 먼저 그려진 뒤 첨부 처리 → 끊김 없이 즉각 반응
    setTimeout(() => {
      if (typeof addCapturedPhotoDataUrl === 'function') {
        addCapturedPhotoDataUrl(dataUrl, _uid, _type, _sid);
      }
    }, 0);
  }

  function close() {
    stopStream();
    closeResMenu();
    if (overlayEl) overlayEl.style.display = 'none';
    ctx = null;
    capturing = false;
  }

  // 카메라가 열려있는지 (뒤로가기 처리에서 사용)
  window.isInAppCameraOpen = function () {
    return !!(overlayEl && overlayEl.style.display === 'flex');
  };
  // 외부에서 카메라 닫기 (뒤로가기 처리에서 사용)
  window.closeInAppCamera = close;

  // 외부 진입점: render.js 버튼에서 호출
  window.openInAppCamera = function (uid, type, sid) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (typeof showToast === 'function') showToast('이 기기에서는 카메라를 사용할 수 없어요.', 'err');
      return;
    }
    // ★ 해상도 설정을 매번 다시 읽음 - 설정 화면에서 바꾸면 다음 촬영부터 바로 반영
    var preset = getCamResPreset();
    OUT_W = preset.w;
    OUT_H = preset.h;
    ctx = { uid: +uid, type: type, sid: (sid != null && sid !== '') ? +sid : null };
    facing = 'environment';
    capturing = false;
    ensureDom();
    updateResBtn();  // 현재 해상도 라벨 표시
    overlayEl.style.display = 'flex';
    startStream();
  };
})();

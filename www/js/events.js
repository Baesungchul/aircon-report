/* ═══════════════════════════════
   EVENT BINDING
═══════════════════════════════ */
function bindAll() {
  // 헤더 버튼
  const btnCo = document.getElementById('btnCoInfo');
  if (btnCo) btnCo.addEventListener('click', openCoModal);  // 구버전 호환
  document.getElementById('coModalClose').addEventListener('click', closeCoModal);
  document.getElementById('coModalCancel').addEventListener('click', closeCoModal);
  document.getElementById('coModalSave').addEventListener('click', saveCoInfo);
  const btnSP = document.getElementById('btnSavePhotos');
  if (btnSP) btnSP.addEventListener('click', savePhotosToFolder);
  document.getElementById('btnSetFolder').addEventListener('click', selectPhotoFolder);
  document.getElementById('btnClearFolder').addEventListener('click', clearPhotoFolder);
  document.getElementById('btnFlushNow').addEventListener('click', flushPendingSaves);
  document.getElementById('btnResumeFolder').addEventListener('click', resumeFolderPermission);
  document.getElementById('btnResetSaved').addEventListener('click', resetSavedState);
  document.getElementById('btnAdd').addEventListener('click', () => addUnit());
  document.getElementById('newName').addEventListener('keydown', e => { if(e.key==='Enter') addUnit(); });
  document.getElementById('btnBulk')?.addEventListener('click', bulkAdd);
  document.getElementById('btnExp')?.addEventListener('click', ()=>{ units.forEach(u=>u.open=true); renderAll(); });
  document.getElementById('btnCol')?.addEventListener('click', ()=>{ units.forEach(u=>u.open=false); renderAll(); });
  document.getElementById('srch')?.addEventListener('input', renderAll);

  // ★ 작업 유형 토글
  document.querySelectorAll('input[name="workType"]').forEach(r => {
    r.addEventListener('change', e => {
      const newType = e.target.value;
      const oldType = currentWorkType;

      // 가정 → 시설 변경 시: 호수에 customer 데이터 있으면 경고
      if (oldType === 'household' && newType === 'facility') {
        const hasUnitCustomer = units.some(u =>
          u.customer && (u.customer.phone || u.customer.address || u.customer.memo));
        if (hasUnitCustomer) {
          // ★ 자동으로 첫 호수의 customer를 facilityCustomer로 복사 (확인 없이)
          const firstWithData = units.find(u =>
            u.customer && (u.customer.phone || u.customer.address || u.customer.memo));
          if (firstWithData && firstWithData.customer) {
            facilityCustomer = {
              phone:   firstWithData.customer.phone   || facilityCustomer.phone   || '',
              contact: firstWithData.customer.contact || facilityCustomer.contact || '',
              address: firstWithData.customer.address || facilityCustomer.address || '',
              memo:    firstWithData.customer.memo    || facilityCustomer.memo    || ''
            };
          }
        }
      }
      // 시설 → 가정: 호수 2개 이상이면 차단
      else if (oldType === 'facility' && newType === 'household') {
        if (units.length >= 2) {
          // 라디오 원복
          const r0 = document.getElementById('workTypeFacility');
          if (r0) r0.checked = true;

          // 안내 다이얼로그
          const wrap = document.createElement('div');
          wrap.innerHTML = `
            <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1700;display:flex;align-items:center;justify-content:center;padding:16px;" id="modeBlockOverlay">
              <div style="background:var(--sf);border-radius:14px;padding:20px;max-width:400px;width:100%;">
                <div style="font-size:16px;font-weight:800;margin-bottom:8px;">🏠 가정용으로 변경 불가</div>
                <div style="font-size:13px;color:var(--mu);line-height:1.7;margin-bottom:16px;">
                  현재 <b style="color:var(--tx);">${units.length}개</b> 영역이 입력되어 있습니다.<br>
                  가정용은 <b style="color:var(--tx);">1호수만</b> 가능합니다.<br><br>
                  영역을 <b style="color:var(--dn);">1개만 남기고 삭제</b>하면<br>
                  가정용으로 변경할 수 있습니다.
                </div>
                <button class="btn b-ghost" style="width:100%;justify-content:center;" id="modeBlockClose">확인</button>
              </div>
            </div>`;
          document.body.appendChild(wrap.firstElementChild);
          document.getElementById('modeBlockClose').addEventListener('click', () => {
            document.getElementById('modeBlockOverlay')?.remove();
          });
          return;
        }
        // ★ 시설 → 가정: facilityCustomer를 첫 호수 customer로 복사
        if (facilityCustomer.phone || facilityCustomer.address || facilityCustomer.memo || facilityCustomer.contact) {
          if (units[0]) {
            units[0].customer = units[0].customer || {};
            if (!units[0].customer.phone)   units[0].customer.phone   = facilityCustomer.phone || '';
            if (!units[0].customer.contact) units[0].customer.contact = facilityCustomer.contact || '';
            if (!units[0].customer.address) units[0].customer.address = facilityCustomer.address || '';
            if (!units[0].customer.memo)    units[0].customer.memo    = facilityCustomer.memo || '';
          }
        }
      }

      currentWorkType = newType;
      applyWorkTypeUI();
      renderAll();
      sessionAutoSave();
    });
  });

  // ★ 시설 고객 정보 입력 이벤트
  ['facilityPhone', 'facilityContact', 'facilityAddress', 'facilityMemo', 'facilityWorkTarget', 'facilityPrice', 'facilityStartTime', 'facilityEndTime'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        if (id === 'facilityPhone') facilityCustomer.phone = el.value.trim();
        else if (id === 'facilityContact') facilityCustomer.contact = el.value.trim();
        else if (id === 'facilityAddress') facilityCustomer.address = el.value.trim();
        else if (id === 'facilityMemo') facilityCustomer.memo = el.value.trim();
        else if (id === 'facilityWorkTarget') facilityCustomer.workTarget = el.value.trim();
        else if (id === 'facilityPrice') facilityCustomer.price = el.value.trim();
        else if (id === 'facilityStartTime') facilityCustomer.startTime = el.value;
        else if (id === 'facilityEndTime') facilityCustomer.endTime = el.value;
        sessionAutoSave();
      });
    }
  });

  // ★ 시설 고객 더보기 토글
  document.getElementById('facilityCustMoreBtn')?.addEventListener('click', () => {
    const detail = document.getElementById('facilityCustDetail');
    const btn = document.getElementById('facilityCustMoreBtn');
    if (!detail || !btn) return;
    const isOpen = detail.style.display !== 'none';
    detail.style.display = isOpen ? 'none' : '';
    btn.textContent = isOpen ? '더보기 ▼' : '접기 ▲';
  });

  // ★ 뒤로가기 통합 처리는 state.js의 setupBackButtonHandler에서 함
  // (여기 중복 핸들러 제거 - 두 곳에서 처리하면 동시 실행으로 모달 두 개 닫힘)

  document.getElementById('btnSave').addEventListener('click', handleSaveClick);
  document.getElementById('btnNew')?.addEventListener('click', newWork);
  document.getElementById('btnLoad')?.addEventListener('click', openLoadList);

  // (헤더 접기/스크롤숨김 제거 - 일반 페이지 스크롤 사용)
  document.getElementById('saveDlgClose').addEventListener('click', closeSaveDialog);
  document.getElementById('saveDlgCancel').addEventListener('click', closeSaveDialog);
  document.getElementById('saveDlgOk').addEventListener('click', doSave);
  document.getElementById('saveNameInp').addEventListener('keydown', e=>{ if(e.key==='Enter') doSave(); });
  document.getElementById('btnSlClose').addEventListener('click', ()=>document.getElementById('slModal').classList.remove('open'));

  // 보고서
  document.getElementById('btnGen').addEventListener('click', buildAndPreview);
  document.getElementById('btnPDF')?.addEventListener('click', exportPDF);
  document.getElementById('btnJPG')?.addEventListener('click', exportJPG);
  document.getElementById('btnPDF2').addEventListener('click', exportPDF);
  document.getElementById('btnJPG2').addEventListener('click', exportJPG);
  document.getElementById('btnPvClose').addEventListener('click', () => {
    document.getElementById('pvModal').classList.remove('open');
    _resetPvZoom();
    setViewportZoom(false);
  });

  // ★ 보고서 줌 리셋 - state.js의 popstate에서도 호출됨
  function _resetPvZoom() {
    document.querySelectorAll('#pvScroll .rpage').forEach(p => {
      const baseScale = parseFloat(p.dataset.baseScale) || 0.72;
      p.style.transform = `scale(${baseScale})`;
      const box = p.parentElement;
      if (box && box.classList.contains('pv-pg-scaled')) {
        const w = 794 * baseScale;
        const h = 1123 * baseScale;
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        const wrap = box.parentElement;
        if (wrap && wrap.classList.contains('pv-pg-wrap')) {
          wrap.style.width = `${w}px`;
          wrap.style.height = `${h}px`;
        }
      }
    });
    _pvZoom = 1;
    const pvScroll = document.getElementById('pvScroll');
    if (pvScroll) pvScroll.classList.remove('zoomed');
  }
  window._resetPvZoom = _resetPvZoom;

  // viewport 메타 변경 - 손가락 줌 활성/비활성 (★ width=390 고정: 기기 무관 동일 비율)
  function setViewportZoom(allow) {
    const meta = document.getElementById('metaViewport');
    if (!meta) return;
    const content = allow
      ? 'width=390,user-scalable=yes'
      : 'width=390,initial-scale=1,maximum-scale=1,user-scalable=no';
    meta.setAttribute('content', content);

    // ★ 차단으로 전환 시 - 현재 줌도 강제 리셋
    // (모바일 브라우저가 줌 상태를 유지하는 버그 방지)
    if (!allow) {
      // 잠시 메타를 제거했다가 다시 설정해야 적용되는 브라우저가 있음
      requestAnimationFrame(() => {
        meta.setAttribute('content', 'width=390,initial-scale=1,maximum-scale=1,user-scalable=no');
        // 강제 스크롤 위치 리셋 (줌 영향 제거)
        window.scrollTo(0, window.scrollY);
      });
    }
  }
  // 전역 노출 (다른 파일에서도 호출 가능)
  window.setViewportZoom = setViewportZoom;

  // 미리보기 줌 컨트롤 - 기본 스케일에 사용자 줌 배율 적용
  let _pvZoom = 1;
  function setPvZoom(z) {
    _pvZoom = Math.max(0.5, Math.min(3, z));
    document.querySelectorAll('#pvScroll .rpage').forEach(p => {
      const baseScale = parseFloat(p.dataset.baseScale) || 0.72;
      const finalScale = baseScale * _pvZoom;
      p.style.transform = `scale(${finalScale})`;
      // 부모 박스 크기 변경 (스크롤 영역 위해)
      const box = p.parentElement;
      if (box && box.classList.contains('pv-pg-scaled')) {
        const w = 794 * finalScale;
        const h = 1123 * finalScale;
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        // ★ wrap도 같이 크기 맞춤 (그렇지 않으면 화면 틀어짐)
        const wrap = box.parentElement;
        if (wrap && wrap.classList.contains('pv-pg-wrap')) {
          wrap.style.width = `${w}px`;
          wrap.style.height = `${h}px`;
        }
      }
    });
    // ★★★ .zoomed 클래스는 이제 단순 상태 마커 (CSS에서 layout 영향 없음)
    //     이 클래스로 align-items를 바꾸는 CSS를 절대 다시 넣지 말 것
    //     - 1.213 이전: align-items:center → .zoomed면 flex-start → 확대 순간 가운데→좌측 점프
    //     - 1.220 수정: CSS를 "align-items:safe center"로 변경하여 점프 제거
    //     자세한 내용은 styles.css의 .pv-scroll 주석 참고
    const pvScroll = document.getElementById('pvScroll');
    if (pvScroll) {
      if (_pvZoom > 1.01) pvScroll.classList.add('zoomed');
      else pvScroll.classList.remove('zoomed');
    }
  }
  document.getElementById('btnPvZoomIn')?.addEventListener('click', () => setPvZoom(_pvZoom + 0.2));
  document.getElementById('btnPvZoomOut')?.addEventListener('click', () => setPvZoom(_pvZoom - 0.2));
  // ★ 보고서탭 해상도 콤보 - 설정과 동일 값 저장, 설정 셀렉트도 동기화
  const _pvRes = document.getElementById('pvResSelect');
  if (_pvRes) _pvRes.addEventListener('change', () => {
    try { localStorage.setItem(window.REPORT_RES_KEY || 'ac_report_res_v1', _pvRes.value); } catch (e) {}
    const _ss = document.getElementById('reportResSelect'); if (_ss) _ss.value = _pvRes.value;
    const _p = window.REPORT_RES_PRESETS && window.REPORT_RES_PRESETS[_pvRes.value];
    if (typeof showToast === 'function') showToast('✓ 보고서 해상도: ' + (_p ? _p.label : _pvRes.value), 'ok');
  });

  // ★ 두 손가락 핀치 줌 - CSS transform 사용 (브라우저 viewport 줌 X → 깨끗한 화질)
  const pvScroll = document.getElementById('pvScroll');
  if (pvScroll) {
    // 시작점 기준 (점프 방지 위해 시작 시 스크롤/줌 기록)
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let pinchStartFinger = null;   // 화면 좌표 (스크롤 영역 내)
    let pinchStartScroll = null;   // 시작 시 스크롤 위치
    let pinchTimer = 0;
    let pendingTouches = null;

    // ★ Touch 객체(clientX/Y)와 캐시된 좌표 객체(x/y) 둘 다 지원
    const tx = (t) => (t.clientX !== undefined ? t.clientX : t.x);
    const ty = (t) => (t.clientY !== undefined ? t.clientY : t.y);
    const getDist = (touches) => {
      const dx = tx(touches[0]) - tx(touches[1]);
      const dy = ty(touches[0]) - ty(touches[1]);
      return Math.sqrt(dx * dx + dy * dy);
    };
    const getCenter = (touches) => ({
      x: (tx(touches[0]) + tx(touches[1])) / 2,
      y: (ty(touches[0]) + ty(touches[1])) / 2
    });

    pvScroll.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = getDist(e.touches);
        pinchStartZoom = _pvZoom;
        const center = getCenter(e.touches);
        const rect = pvScroll.getBoundingClientRect();
        pinchStartFinger = {
          x: center.x - rect.left,
          y: center.y - rect.top
        };
        pinchStartScroll = {
          left: pvScroll.scrollLeft,
          top: pvScroll.scrollTop
        };
        pvScroll.style.touchAction = 'none';
      }
    }, { passive: true });

    pvScroll.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pendingTouches = [
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY }
        ];
        if (!pinchTimer) pinchTimer = requestAnimationFrame(processPinch);
      }
    }, { passive: false });

    function processPinch() {
      pinchTimer = 0;
      if (!pendingTouches) return;
      const touches = pendingTouches;
      pendingTouches = null;

      const dist = getDist(touches);
      const center = getCenter(touches);
      const rect = pvScroll.getBoundingClientRect();

      // ★ pinchStartDist가 0이면 자동 복구
      if (!pinchStartDist || pinchStartDist === 0) {
        pinchStartDist = dist;
        pinchStartZoom = _pvZoom;
        pinchStartFinger = {
          x: center.x - rect.left,
          y: center.y - rect.top
        };
        pinchStartScroll = {
          left: pvScroll.scrollLeft,
          top: pvScroll.scrollTop
        };
        return;
      }

      // 시작점 기준 줌 계산
      const ratio = dist / pinchStartDist;
      const newZoom = Math.max(0.5, Math.min(3, pinchStartZoom * ratio));
      const actualRatio = newZoom / pinchStartZoom;

      // 손가락 현재 위치 (스크롤 영역 내)
      const fingerX = center.x - rect.left;
      const fingerY = center.y - rect.top;

      // 시작 시점 손가락 위치의 콘텐츠 절대 좌표
      const contentX = pinchStartScroll.left + pinchStartFinger.x;
      const contentY = pinchStartScroll.top + pinchStartFinger.y;

      // 줌 적용 (setPvZoom 후 scrollWidth/Height 변경됨)
      setPvZoom(newZoom);

      // 확대 후 같은 콘텐츠 좌표
      const newContentX = contentX * actualRatio;
      const newContentY = contentY * actualRatio;

      // 새 스크롤 = 콘텐츠 좌표 - 현재 손가락 화면 위치
      // (손가락이 그 콘텐츠를 가리키게)
      pvScroll.scrollLeft = newContentX - fingerX;
      pvScroll.scrollTop = newContentY - fingerY;
    }

    pvScroll.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        pinchStartDist = 0;
        pinchStartFinger = null;
        pinchStartScroll = null;
        pendingTouches = null;
        pvScroll.style.touchAction = 'pan-x pan-y';
      }
    }, { passive: true });

    pvScroll.addEventListener('touchcancel', () => {
      pinchStartDist = 0;
      pinchStartFinger = null;
      pinchStartScroll = null;
      pendingTouches = null;
      pvScroll.style.touchAction = 'pan-x pan-y';
    }, { passive: true });
  }

  // 이미지 모달
  function closeImgModal() {
    const m = document.getElementById('imgModal');
    if (!m.classList.contains('open')) return;
    m.classList.remove('open');
    // 줌 리셋
    const img = document.getElementById('modalImg');
    if (img) {
      img.style.transform = '';
      img.style.transformOrigin = '';
    }
    _imgZoom = 1;
    _imgPanX = 0;
    _imgPanY = 0;
    // 방금 닫았다고 표시 → 다음 popstate는 종료 확인 안 함
    if (typeof window._markModalJustClosed === 'function') window._markModalJustClosed();
    if (history.state?.imgModal) history.back();
  }
  document.getElementById('imgX').addEventListener('click', closeImgModal);
  // ★ 화면 영역 클릭 닫기 제거 - 닫기 버튼만으로 닫기 (확대 중 실수 클릭 방지)

  // ★ 사진 모달 핀치 줌 + 한 손가락 팬
  let _imgZoom = 1;
  let _imgPanX = 0;
  let _imgPanY = 0;
  attachPinchZoomToImage(document.getElementById('imgModal'), document.getElementById('modalImg'),
    (z, px, py) => { _imgZoom = z; _imgPanX = px; _imgPanY = py; window.__imgZoom = z; },
    () => ({ zoom: _imgZoom, panX: _imgPanX, panY: _imgPanY })
  );

  // ═══════ 사진 뷰어 좌우 슬라이드 (달력처럼: 손가락 따라 밀리고 놓으면 페이지 넘김) ═══════
  let _pvNav = { imgs: [], idx: -1 };
  let _pvAnim = false;
  function _pvImg() { return document.getElementById('modalImg'); }
  function _pvW() { return window.innerWidth || 360; }
  function _pvResetZoom() {
    _imgZoom = 1; _imgPanX = 0; _imgPanY = 0; window.__imgZoom = 1;
    const im = _pvImg();
    if (im) { im.style.transform = ''; im.style.transformOrigin = ''; }
  }
  function _pvBuildList(t) {
    const group = t.closest('.thumbs') || t.closest('.sp-photos');
    let imgs = group ? Array.prototype.slice.call(group.querySelectorAll('img[data-photo-id]')) : [];
    if (!imgs.length) imgs = [t];
    _pvNav = { imgs: imgs, idx: Math.max(0, imgs.indexOf(t)) };
  }
  // 썸네일 t의 이미지를 모달에 로드(초기 + 백그라운드 원본). transform/transition 은 건드리지 않음
  function _pvLoadInto(t) {
    if (!t) return;
    const pid = t.dataset.photoId;
    const p = pid ? findPhotoById(pid) : null;
    const modalImg = _pvImg();
    let initialSrc = '';
    if (p && p._originalDataUrl) initialSrc = p._originalDataUrl;
    else if (p && p.dataUrl) initialSrc = p.dataUrl;
    else if (t.src) initialSrc = t.src;
    const src = (initialSrc && !initialSrc.startsWith('data:image/svg+xml')) ? initialSrc : '';
    if (modalImg) modalImg.src = src;
    if (p && !p._originalDataUrl && (p.fileHandle || (p._workDir && p.fileName))) {
      (async () => {
        try {
          let fh = p.fileHandle;
          if (!fh && p._workDir && p.fileName) { fh = await p._workDir.getFileHandle(p.fileName); p.fileHandle = fh; }
          const file = await fh.getFile();
          const dataUrl = await blobToDataURL(file);
          p._originalDataUrl = dataUrl;
          const m = _pvImg(), mod = document.getElementById('imgModal');
          if (m && mod && mod.classList.contains('open') && _pvNav.imgs[_pvNav.idx] === t) m.src = dataUrl;
        } catch (e) { console.warn('원본 로드 실패:', e.message); }
      })();
    }
  }
  window._pvOpenFromThumb = function (t) {
    _pvBuildList(t);
    _pvResetZoom();
    const modalImg = _pvImg();
    if (modalImg) { modalImg.style.opacity = '1'; modalImg.style.transition = ''; modalImg.style.transform = ''; }
    const t0 = _pvNav.imgs[_pvNav.idx];
    const pid = t0 && t0.dataset.photoId; const p = pid ? findPhotoById(pid) : null;
    let s0 = (p && p._originalDataUrl) || (p && p.dataUrl) || (t0 && t0.src) || '';
    if (s0 && s0.indexOf('data:image/svg+xml') === 0) s0 = '';
    showImg(s0);
    _pvLoadInto(t0);
    _pvUpdateArrows();
  };
  // 넘기기: 순수 페이드 — 현재 사진이 흐려지고 다음 사진이 제자리에서 나타남 (슬라이드/따라밀림 없음)
  function _pvFade(dir) {
    if (_pvAnim) return;
    if (!_pvNav.imgs || _pvNav.imgs.length < 2) return;
    const n = _pvNav.idx + dir;
    if (n < 0 || n >= _pvNav.imgs.length) return;
    const img = _pvImg(); if (!img) { _pvNav.idx = n; return; }
    const W = _pvW();
    _pvAnim = true;
    // 현재 사진: 민 방향으로 슬라이드 아웃
    img.style.transition = 'transform .16s ease-in, opacity .16s ease-in';
    img.style.transform = 'translateX(' + (dir > 0 ? -W : W) + 'px)';
    img.style.opacity = '0';
    setTimeout(function () {
      _pvNav.idx = n;
      _pvLoadInto(_pvNav.imgs[n]);
      _pvUpdateArrows();
      // 새 사진: 제자리에서 페이드 인만 (밀려 들어오지 않음)
      img.style.transition = 'none';
      img.style.transform = 'translateX(0)';
      img.style.opacity = '0';
      requestAnimationFrame(function () {
        img.style.transition = 'opacity .2s ease-out';
        img.style.opacity = '1';
        setTimeout(function () { _pvAnim = false; img.style.transition = ''; }, 210);
      });
    }, 160);
  }
  function _pvUpdateArrows() {
    const multi = _pvNav.imgs && _pvNav.imgs.length > 1;
    const prev = document.getElementById('imgPrev'), next = document.getElementById('imgNext'), cnt = document.getElementById('imgCount');
    if (prev) prev.style.display = (multi && _pvNav.idx > 0) ? 'flex' : 'none';
    if (next) next.style.display = (multi && _pvNav.idx < _pvNav.imgs.length - 1) ? 'flex' : 'none';
    if (cnt) { if (multi) { cnt.style.display = 'block'; cnt.textContent = (_pvNav.idx + 1) + ' / ' + _pvNav.imgs.length; } else { cnt.style.display = 'none'; } }
  }
  const _imgPrevBtn = document.getElementById('imgPrev'), _imgNextBtn = document.getElementById('imgNext');
  if (_imgPrevBtn) _imgPrevBtn.addEventListener('click', (e) => { e.stopPropagation(); _pvFade(-1); });
  if (_imgNextBtn) _imgNextBtn.addEventListener('click', (e) => { e.stopPropagation(); _pvFade(1); });
  // 스와이프 감지(확대 안 됐을 때만) → 좌우로 밀면 페이드 교체. 드래그 중 시각 변화 없음
  const _imgModalEl = document.getElementById('imgModal');
  (function () {
    if (!_imgModalEl) return;
    let sx = 0, sy = 0, st = 0, active = false;
    _imgModalEl.addEventListener('touchstart', function (e) {
      if (_pvAnim || !e.touches || e.touches.length !== 1 || (window.__imgZoom || 1) > 1.01) { active = false; return; }
      if (!_pvNav.imgs || _pvNav.imgs.length < 2) { active = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); active = true;
    }, { passive: true });
    _imgModalEl.addEventListener('touchend', function (e) {
      if (!active) return; active = false;
      const t = e.changedTouches && e.changedTouches[0]; if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      const fast = (Date.now() - st) < 400;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && (Math.abs(dx) > 60 || fast)) _pvFade(dx < 0 ? 1 : -1);
    }, { passive: true });
    _imgModalEl.addEventListener('touchcancel', function () { active = false; }, { passive: true });
  })();

  /**
   * 이미지에 핀치 줌 + 한 손가락 팬 부착
   * 시작점 기준 + RAF에서 최신 터치 정보만 처리 (간단하고 정확)
   */
  function attachPinchZoomToImage(container, img, setState, getState) {
    if (!container || !img) return;

    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let pinchStartPan = null;
    let pinchStartCenter = null;
    let imgOriginalCenter = null;  // transform 적용 전 이미지 중심 화면 좌표
    let panStartTouch = null;
    let rafId = 0;
    let pendingTouches = null;

    // ★ Touch 객체(clientX/Y)와 캐시된 좌표 객체(x/y) 둘 다 지원
    const tx = (t) => (t.clientX !== undefined ? t.clientX : t.x);
    const ty = (t) => (t.clientY !== undefined ? t.clientY : t.y);
    const getDist = (touches) => {
      const dx = tx(touches[0]) - tx(touches[1]);
      const dy = ty(touches[0]) - ty(touches[1]);
      return Math.sqrt(dx * dx + dy * dy);
    };
    const getCenter = (touches) => ({
      x: (tx(touches[0]) + tx(touches[1])) / 2,
      y: (ty(touches[0]) + ty(touches[1])) / 2
    });

    function apply() {
      const s = getState();
      img.style.transformOrigin = 'center center';
      img.style.transform = `translate(${s.panX}px, ${s.panY}px) scale(${s.zoom})`;
    }

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinchStartDist = getDist(e.touches);
        pinchStartCenter = getCenter(e.touches);
        const s = getState();
        pinchStartZoom = s.zoom;
        pinchStartPan = { x: s.panX, y: s.panY };

        // 이미지 원래 중심 = 현재 시각적 중심 - 현재 pan
        const rect = img.getBoundingClientRect();
        imgOriginalCenter = {
          x: rect.left + rect.width / 2 - s.panX,
          y: rect.top + rect.height / 2 - s.panY
        };
      } else if (e.touches.length === 1) {
        const s = getState();
        if (s.zoom > 1.05) {
          panStartTouch = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            panX: s.panX,
            panY: s.panY
          };
        } else {
          panStartTouch = null;
        }
      }
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pendingTouches = {
          type: 'pinch',
          touches: [
            { x: e.touches[0].clientX, y: e.touches[0].clientY },
            { x: e.touches[1].clientX, y: e.touches[1].clientY }
          ]
        };
        if (!rafId) rafId = requestAnimationFrame(process);
      } else if (e.touches.length === 1 && panStartTouch) {
        e.preventDefault();
        pendingTouches = {
          type: 'pan',
          x: e.touches[0].clientX,
          y: e.touches[0].clientY
        };
        if (!rafId) rafId = requestAnimationFrame(process);
      }
    }, { passive: false });

    function process() {
      rafId = 0;
      if (!pendingTouches) return;
      const p = pendingTouches;
      pendingTouches = null;

      if (p.type === 'pinch') {
        const dist = getDist(p.touches);
        const center = getCenter(p.touches);

        // ★ pinchStartDist가 0이거나 NaN이면 현재 상태를 시작점으로 (자동 복구)
        if (!pinchStartDist || pinchStartDist === 0) {
          pinchStartDist = dist;
          pinchStartCenter = center;
          const sNow = getState();
          pinchStartZoom = sNow.zoom;
          pinchStartPan = { x: sNow.panX, y: sNow.panY };
          const rect = img.getBoundingClientRect();
          imgOriginalCenter = {
            x: rect.left + rect.width / 2 - sNow.panX,
            y: rect.top + rect.height / 2 - sNow.panY
          };
          return;  // 다음 프레임부터 정상 계산
        }

        // 시작점 기준 비율
        const ratio = dist / pinchStartDist;
        const newZoom = Math.max(1, Math.min(5, pinchStartZoom * ratio));
        const actualRatio = newZoom / pinchStartZoom;

        // 시각적 중심 (시작 시점)
        const visualCenterX = imgOriginalCenter.x + pinchStartPan.x;
        const visualCenterY = imgOriginalCenter.y + pinchStartPan.y;

        // 손가락이 시각적 중심에서 떨어진 거리
        const fromCenterX = pinchStartCenter.x - visualCenterX;
        const fromCenterY = pinchStartCenter.y - visualCenterY;

        // 손가락 이동 (시작 → 현재)
        const moveX = center.x - pinchStartCenter.x;
        const moveY = center.y - pinchStartCenter.y;

        // 새 pan
        const newPanX = pinchStartPan.x + moveX + fromCenterX * (1 - actualRatio);
        const newPanY = pinchStartPan.y + moveY + fromCenterY * (1 - actualRatio);

        setState(newZoom, newPanX, newPanY);
        apply();
      } else if (p.type === 'pan' && panStartTouch) {
        const dx = p.x - panStartTouch.x;
        const dy = p.y - panStartTouch.y;
        const s = getState();
        setState(s.zoom, panStartTouch.panX + dx, panStartTouch.panY + dy);
        apply();
      }
    }

    container.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        pinchStartDist = 0;
        pinchStartCenter = null;
        imgOriginalCenter = null;
        // 한 손가락 남으면 팬 시작점으로
        if (e.touches.length === 1) {
          const s = getState();
          if (s.zoom > 1.05) {
            panStartTouch = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
              panX: s.panX,
              panY: s.panY
            };
          }
        }
      }
      if (e.touches.length === 0) {
        panStartTouch = null;
        const s = getState();
        if (s.zoom < 1.05) {
          setState(1, 0, 0);
          apply();
        }
      }
    }, { passive: true });

    container.addEventListener('touchcancel', () => {
      pinchStartDist = 0;
      pinchStartCenter = null;
      imgOriginalCenter = null;
      panStartTouch = null;
      pendingTouches = null;
    }, { passive: true });
  }
  window.attachPinchZoomToImage = attachPinchZoomToImage;

  // 유닛 리스트 이벤트 위임
  const ul = document.getElementById('uList');

  ul.addEventListener('click', e => {
    const t = e.target;

    // 카드 토글
    // ★ 저장된 글 칩 - 해당 채널 최신 글 바로 열기 (헤더 접기/펼치기보다 먼저 처리)
    const chip = t.closest('.u-post-chip');
    if (chip) {
      e.stopPropagation();
      const _ch = chip.getAttribute('data-ch');
      if (window.ClaudeAI && ClaudeAI.openPostByChannel) ClaudeAI.openPostByChannel(_ch);
      return;
    }

    const top = t.closest('.u-top');
    if (top && !t.closest('.edit-ic') && !t.closest('.del-btn') && !t.closest('.bdg') && !t.closest('.sp-del') && !t.closest('.add-sp-btn') && !t.closest('.reorder-btn') && !t.closest('.u-gal-btn') && !t.closest('.u-post-chip')) {
      const id = +top.dataset.id;
      const u = findU(id);
      if(u){
        u.open=!u.open;
        renderAll();
        // ★ 펼쳤으면 이 호수의 원본 사진들 백그라운드 preload
        if (u.open) {
          preloadUnitPhotos(u);
          // ★ 화면 표시용 lazy 사진(썸네일) 있으면 로딩 모달 + 완료 시 자동 닫기
          showPhotoLoadingModalForUnit(u);
        }
      }
      return;
    }
    // 이름 수정
    if (t.closest('.edit-ic')) {
      e.stopPropagation();
      startEdit(+t.closest('[data-uid]').dataset.uid); return;
    }
    // ★ 휴지통 토글
    const trashHdr = t.closest('.trash-hdr');
    if (trashHdr) {
      e.stopPropagation();
      const u = findU(+trashHdr.dataset.uid);
      if (u) { u._trashOpen = !u._trashOpen; renderAll(); }
      return;
    }
    // ★ 휴지통 사진 1장 복원
    const trashRestore = t.closest('.trash-restore-one');
    if (trashRestore) {
      e.stopPropagation();
      const u = findU(+trashRestore.dataset.uid);
      const ti = +trashRestore.dataset.tidx;
      if (u && u._trash && u._trash[ti]) {
        const p = u._trash.splice(ti, 1)[0];
        const type = p._trashType || 'before';
        delete p._trashType;
        if (!u[type]) u[type] = [];
        u[type].push(p);
        if (u._trash.length === 0) u._trashOpen = false;
        renderAll(); updateStats(); sessionAutoSave();
        showToast('↩️ 사진 복원됨', 'ok');
      }
      return;
    }
    // ★ 휴지통 전체 복원
    const trashRestoreAll = t.closest('.trash-restore-all');
    if (trashRestoreAll) {
      e.stopPropagation();
      const u = findU(+trashRestoreAll.dataset.uid);
      if (u && u._trash && u._trash.length > 0) {
        const n = u._trash.length;
        u._trash.forEach(p => {
          const type = p._trashType || 'before';
          delete p._trashType;
          if (!u[type]) u[type] = [];
          u[type].push(p);
        });
        u._trash = [];
        u._trashOpen = false;
        renderAll(); updateStats(); sessionAutoSave();
        showToast(`↩️ ${n}장 모두 복원됨`, 'ok');
      }
      return;
    }
    // ★ 휴지통 비우기
    const trashEmpty = t.closest('.trash-empty');
    if (trashEmpty) {
      e.stopPropagation();
      const u = findU(+trashEmpty.dataset.uid);
      if (u && u._trash && u._trash.length > 0) {
        if (confirm(`🗑️ 삭제된 사진 ${u._trash.length}장을 완전히 비울까요?\n\n(이 작업은 되돌릴 수 없습니다)`)) {
          u._trash = [];
          u._trashOpen = false;
          renderAll();
          showToast('휴지통을 비웠습니다', 'ok');
        }
      }
      return;
    }
    // 호수별 갤러리 저장
    const ugb = t.closest('.u-gal-btn');
    if (ugb) {
      e.stopPropagation();
      if (window.Gallery && Gallery.exportUnitPhotosToGallery) Gallery.exportUnitPhotosToGallery(+ugb.dataset.uid);
      else showToast('갤러리 기능을 사용할 수 없습니다 (재빌드 필요)', 'err');
      return;
    }
    // 삭제
    const db2 = t.closest('.del-btn');
    if (db2) { e.stopPropagation(); deleteUnit(+db2.dataset.id); return; }
    // 사진 썸네일 삭제 → 휴지통으로 이동 (복원 가능)
    const tdl = t.closest('.th-del');
    if (tdl) {
      // ★ sp-th-del(특이사항 사진)은 document 핸들러에서 처리 — 전파를 막지 않고 양보
      if (tdl.classList.contains('sp-th-del')) return;
      e.stopPropagation();
      const uid=+tdl.dataset.uid, type=tdl.dataset.type, idx=+tdl.dataset.idx;
      const u=findU(uid);
      if(u){
        // ★ 2026-07-11 이중 가드: 공유로 받은 사진은 삭제 불가(재오픈 시 되살아나 순서만 꼬임)
        const _tp = u[type] && u[type][idx];
        if (_tp && (_tp._borrowedIncoming || (window._borrowedShare && _tp._cloudUploaded && !_tp._addedByMe))) {
          showToast('👥 공유 사진은 올린 사람만 삭제할 수 있습니다', 'err');
          return;
        }
        // ★ 내가 공유작업에 올린 사진: 서버 삭제가 성공해야 로컬에서도 제거(실패 시 안내 - 보통 보안규칙 문제)
        if (_tp && window._borrowedShare && _tp._addedByMe && window.CloudPhotoSync && CloudPhotoSync.deleteBorrowedPhoto) {
          const _btp = _tp, _bu = u, _btype = type;
          (async function () {
            let ok = false;
            try { ok = await CloudPhotoSync.deleteBorrowedPhoto(window._borrowedShare.ownerUid, window._borrowedShare.workId, _btp); } catch (e) {}
            if (ok) {
              const _bi = _bu[_btype].indexOf(_btp);
              if (_bi >= 0) _bu[_btype].splice(_bi, 1);
              renderAll(); updateStats(); if (typeof sessionAutoSave === 'function') sessionAutoSave();
            } else if (typeof showToast === 'function') {
              showToast('공유 사진 삭제 실패 — 서버 보안규칙(delete 권한)을 확인하세요', 'err');
            }
          })();
          return;
        }
        // ★ 즉시 반영(전체 재렌더 없음): 썸네일 노드만 바로 제거 → 지연 0.
        //   무거운 renderAll(모든 base64 재생성, ~2초)을 안 돌리고 개수·배지·통계만 가볍게 갱신.
        const _delWrap = tdl.closest('.th-wrap');
        const _delThumbs = _delWrap && _delWrap.parentElement;   // .thumbs
        // 삭제할 사진 식별: data-photo-id 우선, 없으면 화면상 위치(형제 인덱스)로 확실히
        const _delImg = _delWrap && _delWrap.querySelector('img[data-photo-id]');
        const _delPid = _delImg && _delImg.dataset.photoId ? _delImg.dataset.photoId : null;
        let _visualIdx = -1;
        if (_delThumbs && _delWrap) _visualIdx = Array.prototype.indexOf.call(_delThumbs.children, _delWrap);
        if (_delWrap) _delWrap.remove();   // 화면에서 즉시 제거
        // ★ 삭제 직후 대기 중이던 lazy 재렌더가 되살리지 못하게 취소
        try { if (typeof _lazyRerenderTimer !== 'undefined' && _lazyRerenderTimer) clearTimeout(_lazyRerenderTimer); } catch (e) {}
        let _removed = null;
        if (_delPid) {
          const _k = u[type].findIndex(p => p && String(p.id) === _delPid);
          if (_k >= 0) _removed = u[type].splice(_k, 1)[0];
        }
        if (!_removed && _visualIdx >= 0 && _visualIdx < u[type].length) _removed = u[type].splice(_visualIdx, 1)[0];
        if (!_removed && u[type][idx]) _removed = u[type].splice(idx, 1)[0];
        if (_removed) {
          if (!u._trash) u._trash = [];   // 휴지통으로 이동 (세션 한정)
          _removed._trashType = type;      // 복원 시 작업전/후 구분
          u._trash.push(_removed);
        }
        if (typeof _updateUnitCardMeta === 'function') _updateUnitCardMeta(u);
        updateStats(); sessionAutoSave();
      }
      return;
    }
    // 개별 사진 폴더로 저장 (↓ 버튼)
    const tsv = t.closest('.th-save-btn');
    if (tsv) {
      e.stopPropagation();
      // 특이사항 사진 저장은 별도 처리
      if (tsv.classList.contains('sp-save-btn')) {
        const uid=+tsv.dataset.uid, sid=+tsv.dataset.sid, idx=+tsv.dataset.idx;
        const u=findU(uid); if(!u) return;
        const s=u.specials.find(s=>s.id===sid); if(!s) return;
        const p=s.photos[idx]; if(!p) return;
        const sIdx = u.specials.indexOf(s);
        saveSinglePhoto(p, u.name, `특이${sIdx+1}_`, idx+1);
      } else {
        const uid=+tsv.dataset.uid, type=tsv.dataset.type, idx=+tsv.dataset.idx;
        const u=findU(uid); if(!u) return;
        const p=u[type][idx]; if(!p) return;
        const label = type==='before' ? '전' : '후';
        saveSinglePhoto(p, u.name, label, idx+1);
      }
      return;
    }
    // 사진 크게 보기 (좌우 슬라이드 지원)
    if (t.tagName==='IMG' && t.closest('.th-wrap')) {
      if (window.__riJustDragged && (Date.now() - window.__riJustDragged) < 450) return;  // 방금 순서 드래그한 경우 열지 않음
      if (typeof window._pvOpenFromThumb === 'function') window._pvOpenFromThumb(t);
      return;
    }
  });

  // 파일 업로드 위임
  // 파일 업로드 위임 (압축 처리 포함)
  ul.addEventListener('change', e => {
    const t = e.target;
    if (t.type!=='file' || !t.files || !t.files.length) return;
    e.stopPropagation();
    const uid  = +t.dataset.uid;
    const type = t.dataset.type;
    const sid  = t.dataset.sid ? +t.dataset.sid : null;
    const files = Array.from(t.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;

    let totalOrig = 0, totalNew = 0, processed = 0;

    files.forEach(f => {
      compressImage(f).then(result => {
        const { dataUrl, origKB, newKB, w, h, wasCropped } = result;
        totalOrig += origKB;
        totalNew  += newKB;
        processed++;

        const u = findU(uid); if(!u) return;
        const photo = makePhoto(dataUrl);  // 고유 ID 부여

        if (type === 'special' && sid) {
          const s = u.specials.find(s => s.id === sid);
          if (s) {
            s.photos.push(photo);
            renderAll(); updateStats(); sessionAutoSave();
            enqueueAutoSave(photo, u.name, '특이');
          }
        } else {
          u[type].push(photo);
          renderAll(); updateStats(); sessionAutoSave();
          const label = type === 'before' ? '전' : '후';
          enqueueAutoSave(photo, u.name, label);
        }

        // 마지막 파일 처리 완료 시 토스트
        if (processed === files.length) {
          const ratio = totalOrig > 0 ? Math.round((1 - totalNew/totalOrig)*100) : 0;
          const cropNote = wasCropped ? ' · 세로→가로 변환' : '';
          showToast(`📸 ${files.length}장${cropNote} | ${totalOrig}KB → ${totalNew}KB (${ratio}% 절감)`, 'ok');
        }
      });
    });

    t.value = '';
  });

  // textarea 위임
  ul.addEventListener('input', e => {
    const t=e.target;
    if (!t.classList.contains('sp-txt')) return;
    const u=findU(+t.dataset.uid); if(!u) return;
    const s=u.specials.find(s=>s.id===+t.dataset.sid); if(s){ s.desc=t.value; sessionAutoSave(); }
  });
}

/* ═══════════════════════════════
   UNIT OPERATIONS
═══════════════════════════════ */
function findU(id){ return units.find(u=>u.id===id); }

/* ── 단일 사진 추가 (파일 입력 + 앱 내장 카메라 공용) ── */
function addCapturedPhoto(file, uid, type, sid) {
  return compressImage(file).then(result => {
    const { dataUrl, origKB, newKB } = result;
    const u = findU(+uid); if (!u) return null;
    const photo = makePhoto(dataUrl);
    if (type === 'special' && sid) {
      const s = u.specials.find(s => s.id === +sid);
      if (!s) return null;
      s.photos.push(photo);
      renderAll(); updateStats(); sessionAutoSave();
      enqueueAutoSave(photo, u.name, '특이');
    } else {
      u[type].push(photo);
      renderAll(); updateStats(); sessionAutoSave();
      const label = type === 'before' ? '전' : '후';
      enqueueAutoSave(photo, u.name, label);
    }
    const ratio = origKB > 0 ? Math.round((1 - newKB/origKB)*100) : 0;
    if (typeof showToast === 'function') {
      showToast(`📸 1장 | ${origKB}KB → ${newKB}KB (${ratio}% 절감)`, 'ok');
    }
    return photo;
  });
}

/* ── 앱 내장 카메라 전용: 이미 1000×1333로 만들어진 dataUrl을 재압축 없이 바로 첨부 ── */
function addCapturedPhotoDataUrl(dataUrl, uid, type, sid) {
  const u = findU(+uid); if (!u) return null;
  const photo = makePhoto(dataUrl);
  if (type === 'special' && sid) {
    const s = u.specials.find(s => s.id === +sid);
    if (!s) return null;
    s.photos.push(photo);
    renderAll(); updateStats(); sessionAutoSave();
    enqueueAutoSave(photo, u.name, '특이');
  } else {
    u[type].push(photo);
    renderAll(); updateStats(); sessionAutoSave();
    const label = type === 'before' ? '전' : '후';
    enqueueAutoSave(photo, u.name, label);
  }
  if (typeof showToast === 'function') showToast('📸 사진을 추가했어요', 'ok');
  return photo;
}

/* ── 사진 객체 헬퍼 (중복 방지를 위한 ID 시스템) ──
   사진 저장 형태:
   - 신규: { id: 'p_xxx', dataUrl: 'data:image/...', savedToFolder: false }
   - 구버전 호환: 'data:image/...' (문자열) → 자동으로 객체로 정규화
*/
let _photoIdCounter = 0;
/* ★ 2026-08-13: 이 id 를 사진의 **영구 고유번호(pid)** 로 쓴다.
   찍는 순간 발급되고 _session.json 에 저장돼, 순서를 바꾸든 작업 전↔후로 옮기든 안 바뀐다.
   (사진을 찾을 때 호수·전후·파일명으로 이름을 다시 계산하던 방식이 유실 사고의 뿌리였다.
    자세한 내용: 메모리 project_photo_pid_design)
   ⚠️ 카운터는 앱을 켤 때마다 1부터 시작하므로 그것만으로는 세션 간 충돌이 가능하다.
      영구 식별자가 되는 이상 난수를 섞어 충돌 여지를 없앤다. */
function newPhotoId() {
  return `p_${Date.now().toString(36)}_${++_photoIdCounter}_${Math.random().toString(36).slice(2, 7)}`;
}
function makePhoto(dataUrl) {
  return { id: newPhotoId(), dataUrl, savedToFolder: false };
}

// 1x1 투명 placeholder
const PHOTO_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect width='60' height='60' fill='%23333'/><text x='30' y='33' text-anchor='middle' fill='%23888' font-size='11'>📷</text></svg>";

// 사진의 dataUrl 추출 (객체든 문자열이든) - lazy 로딩 지원
function photoUrl(p) {
  if (typeof p === 'string') return p;
  if (p.dataUrl) return p.dataUrl;
  // lazy 사진: placeholder 반환 + 백그라운드 로딩 트리거
  // ★ fileHandle 또는 _workDir+fileName 둘 다 지원
  const canLoad = p.fileHandle || (p._workDir && p.fileName);
  if (p.lazy && canLoad && !p._loading) {
    p._loading = true;
    loadLazyPhoto(p);
  }
  return PHOTO_PLACEHOLDER;
}

// ★ 보고서용 - 원본 우선 (썸네일은 보고서에 쓰면 화질 떨어짐)
function photoUrlFull(p) {
  if (typeof p === 'string') return p;
  if (p._originalDataUrl) return p._originalDataUrl;  // 원본
  if (p.dataUrl) return p.dataUrl;                      // 썸네일 (폴백)
  return PHOTO_PLACEHOLDER;
}

// 백그라운드에서 lazy 사진 로딩 + DOM 갱신
async function loadLazyPhoto(p) {
  try {
    // ★ fileHandle 확보 (이미 있으면 그대로, 없으면 _workDir에서)
    let fh = p.fileHandle;
    if (!fh && p._workDir && p.fileName) {
      fh = await p._workDir.getFileHandle(p.fileName);
      p.fileHandle = fh;  // 캐싱
    }
    if (!fh) {
      p._loading = false;
      return;
    }
    const file = await fh.getFile();
    const dataUrl = await blobToDataURL(file);
    p.dataUrl = dataUrl;
    p.lazy = false;
    p._loading = false;
    // 해당 사진을 보여주는 img 태그 갱신
    let _updated = 0;
    if (p.id) {
      document.querySelectorAll(`img[data-photo-id="${p.id}"]`).forEach(img => {
        img.src = dataUrl; _updated++;
      });
    }
    // ★ id 매칭 실패(사진에 id 없음) 시에도 확실히 반영되도록 전체 재렌더 예약
    if (_updated === 0 && typeof scheduleLazyRerender === 'function') scheduleLazyRerender();
  } catch(e) {
    p._loading = false;
    console.warn('[photo lazy load] 실패:', e.message);
  }
}

// ★ 모든 사진의 원본 로드 (보고서/PDF/JPG 생성 전)
async function ensureAllPhotosLoaded() {
  const targets = [];
  for (const u of (units || [])) {
    (u.before || []).forEach(p => { if (p && !p._originalDataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p); });
    (u.after  || []).forEach(p => { if (p && !p._originalDataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p); });
    (u.specials || []).forEach(s => {
      (s.photos || []).forEach(p => { if (p && !p._originalDataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p); });
    });
  }
  if (targets.length === 0) return;

  showOverlay?.(`📷 보고서용 사진 로딩 중... (${targets.length}장)`);
  const BATCH = 6;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    await Promise.all(batch.map(async p => {
      try {
        // ★ fileHandle 확보 (이미 있으면 그대로, 없으면 _workDir에서 가져옴)
        let fh = p.fileHandle;
        if (!fh && p._workDir && p.fileName) {
          fh = await p._workDir.getFileHandle(p.fileName);
          p.fileHandle = fh;  // 캐싱
        }
        if (!fh) return;
        const file = await fh.getFile();
        const dataUrl = await blobToDataURL(file);
        p._originalDataUrl = dataUrl;
        if (!p.dataUrl) p.dataUrl = dataUrl;
        p.lazy = false;
      } catch(e) {
        console.warn('[ensureAllPhotos] 실패:', e.message);
      }
    }));
    showOverlay?.(`📷 보고서용 사진 로딩 중... (${Math.min(i+BATCH, targets.length)}/${targets.length})`);
  }
  hideOverlay?.();
}
window.ensureAllPhotosLoaded = ensureAllPhotosLoaded;

/* ★ 2026-08-13: 이름이 dialogs.js 의 photoId()(새 id 발급)와 겹쳐 있었다.
   지금은 로드 순서 덕에 dialogs 판이 이겨서 우연히 동작하지만, 순서가 바뀌면
   복원된 사진 id 가 전부 undefined 가 되는 구조였다. 이름을 분리한다. */
function photoIdOf(p) {
  if (typeof p === 'string') return null;
  return p.id;
}

// ★ ID로 photo 객체 찾기 (units 전체 검색)
function findPhotoById(pid) {
  for (const u of (units || [])) {
    for (const p of (u.before || [])) if (p && p.id == pid) return p;
    for (const p of (u.after  || [])) if (p && p.id == pid) return p;
    for (const s of (u.specials || [])) {
      for (const p of (s.photos || [])) if (p && p.id == pid) return p;
    }
  }
  return null;
}

// ★ 호수 펼침 시 사진 preload (백그라운드 - 사용자가 클릭 전에 미리 로드)
const _preloadedUnits = new Set();
async function preloadUnitPhotos(u) {
  if (!u || _preloadedUnits.has(u.id)) return;
  _preloadedUnits.add(u.id);

  const targets = [];
  (u.before || []).forEach(p => {
    if (p && !p._originalDataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
  });
  (u.after || []).forEach(p => {
    if (p && !p._originalDataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
  });
  if (targets.length === 0) return;

  // 백그라운드 - 3장씩 (부담 최소화)
  const BATCH = 3;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    await Promise.all(batch.map(async p => {
      try {
        let fh = p.fileHandle;
        if (!fh && p._workDir && p.fileName) {
          fh = await p._workDir.getFileHandle(p.fileName);
          p.fileHandle = fh;
        }
        if (!fh) return;
        const file = await fh.getFile();
        p._originalDataUrl = await blobToDataURL(file);
      } catch(e) {}
    }));
    // 부담 분산
    await new Promise(r => setTimeout(r, 50));
  }
}

// ★ 호수 펼칠 때 lazy 사진이 있으면 로딩 모달 표시 (완료 시 자동 닫기)
async function showPhotoLoadingModalForUnit(u) {
  if (!u) return;
  // 화면 표시용 lazy 사진들 수집 (dataUrl 없는 것)
  const pending = [];
  (u.before || []).forEach(p => { if (p && !p.dataUrl) pending.push(p); });
  (u.after  || []).forEach(p => { if (p && !p.dataUrl) pending.push(p); });
  (u.specials || []).forEach(s => {
    (s.photos || []).forEach(p => { if (p && !p.dataUrl) pending.push(p); });
  });
  if (pending.length === 0) return;  // 모두 로드됨 - 모달 안 띄움

  const total = pending.length;
  console.log(`[사진로딩] ${u.name}: ${total}장 대기`);

  // 이미 다른 호수에서 모달이 떠있으면 중복 표시 안 함
  if (document.getElementById('photoLoadOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'photoLoadOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1650;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--sf);border-radius:14px;padding:24px 28px;max-width:340px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.5);">
      <div style="font-size:32px;margin-bottom:14px;">📷</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:6px;">${u.name || '호수'} 사진 불러오는 중</div>
      <div id="photoLoadCount" style="font-size:13px;color:var(--mu);margin-bottom:14px;">0 / ${total}장</div>
      <div style="height:6px;background:var(--bd);border-radius:3px;overflow:hidden;">
        <div id="photoLoadBar" style="height:100%;background:var(--ac);border-radius:3px;width:0%;transition:width 0.3s;"></div>
      </div>
      <div style="font-size:11px;color:var(--mu);margin-top:12px;line-height:1.5;">사진이 완전히 표시될 때까지<br>잠시만 기다려 주세요</div>
      <button id="photoLoadCancel" style="margin-top:14px;background:transparent;border:1px solid var(--bd);color:var(--mu);padding:6px 14px;border-radius:6px;font-size:12px;">취소</button>
    </div>`;
  document.body.appendChild(overlay);

  // 취소 버튼
  let cancelled = false;
  overlay.querySelector('#photoLoadCancel').addEventListener('click', () => {
    cancelled = true;
    overlay.remove();
  });

  // ★ 그 호수만 우선 로드 (전역 lazy 로딩 락에 막히지 않음)
  if (typeof loadLazyPhotosForUnit === 'function') {
    console.log('[사진로딩] loadLazyPhotosForUnit 호출');
    // 비동기로 시작 (await 안 함 - 폴링이 진행 추적)
    loadLazyPhotosForUnit(u).catch(e => console.warn('[사진로딩] 실패:', e));
  } else if (typeof startLazyPhotoLoading === 'function') {
    console.log('[사진로딩] startLazyPhotoLoading 호출 (폴백)');
    startLazyPhotoLoading();
  } else {
    console.warn('[사진로딩] 로더 함수 없음!');
  }

  // 진행상황 폴링
  const countEl = overlay.querySelector('#photoLoadCount');
  const barEl   = overlay.querySelector('#photoLoadBar');
  const startedAt = Date.now();
  const MAX_WAIT_MS = 30000;  // 최대 30초 (60→30 단축)
  let lastLoaded = 0;
  let stuckSince = Date.now();

  while (!cancelled) {
    const stillPending = pending.filter(p => !p.dataUrl).length;
    const loaded = total - stillPending;
    const pct = Math.round((loaded / total) * 100);
    if (countEl) countEl.textContent = `${loaded} / ${total}장`;
    if (barEl)   barEl.style.width = pct + '%';

    if (stillPending === 0) break;
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      console.warn('[사진로딩] 타임아웃 - 강제 종료');
      break;
    }
    // 5초간 진행 없으면 멈춘 것으로 판단 → 우선 로드 재시도
    if (loaded === lastLoaded) {
      if (Date.now() - stuckSince > 5000) {
        console.warn('[사진로딩] 5초간 진행 없음 - 우선 로드 재시도');
        if (typeof loadLazyPhotosForUnit === 'function') {
          loadLazyPhotosForUnit(u).catch(e => console.warn('[사진로딩] 재시도 실패:', e));
        } else if (typeof startLazyPhotoLoading === 'function') {
          startLazyPhotoLoading();
        }
        stuckSince = Date.now();
      }
    } else {
      lastLoaded = loaded;
      stuckSince = Date.now();
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // 100% 표시 잠깐 보여주고 닫기
  if (!cancelled) {
    if (barEl) barEl.style.width = '100%';
    await new Promise(r => setTimeout(r, 300));
  }
  overlay.remove();
  console.log(`[사진로딩] ${u.name} 완료: ${total - pending.filter(p => !p.dataUrl).length}/${total}장`);
}

// ★ 불러온 직후 - 모든 lazy 사진을 백그라운드로 점진 로드
// (placeholder 표시되는 거 자동 교체)
let _lazyLoadingInProgress = false;
async function startLazyPhotoLoading() {
  if (_lazyLoadingInProgress) return;
  _lazyLoadingInProgress = true;

  let failed = 0;
  try {
    const targets = [];
    for (const u of (units || [])) {
      (u.before || []).forEach(p => {
        if (p && !p.dataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
      });
      (u.after || []).forEach(p => {
        if (p && !p.dataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
      });
      (u.specials || []).forEach(s => {
        (s.photos || []).forEach(p => {
          if (p && !p.dataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
        });
      });
    }
    if (targets.length === 0) return;

    console.log(`[lazy load] ${targets.length}장 백그라운드 로딩 시작`);
    // 사진 1장 로드 시도 (성공 시 true)
    async function _loadOnePhoto(p) {
      try {
        if (p._originalDataUrl) {
          p.dataUrl = p._originalDataUrl;
          p.lazy = false;
          document.querySelectorAll(`img[data-photo-id="${p.id}"]`).forEach(img => { img.src = p._originalDataUrl; });
          return true;
        }
        let fh = p.fileHandle;
        if (!fh && p._workDir && p.fileName) {
          fh = await p._workDir.getFileHandle(p.fileName);
          p.fileHandle = fh;
        }
        if (!fh) return false;
        const file = await fh.getFile();
        const dataUrl = await blobToDataURL(file);
        p.dataUrl = dataUrl;
        p._originalDataUrl = p._originalDataUrl || dataUrl;
        p.lazy = false;
        document.querySelectorAll(`img[data-photo-id="${p.id}"]`).forEach(img => { img.src = dataUrl; });
        return true;
      } catch (e) {
        console.warn(`[lazy load] 실패 (${p.fileName || p.id}):`, e.message);
        return false;
      }
    }

    // ★ 배치 작게 (4→2) - 사진 한 번에 너무 많이 디코딩 안 함
    const BATCH = 2;
    let retryList = [];
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      await Promise.all(batch.map(async p => { if (!(await _loadOnePhoto(p))) retryList.push(p); }));
      // ★ 강제 paint - 배치마다 화면 갱신 보장 (사진이 점진적으로 보이도록)
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));
    }

    // ★ 실패분 재시도 - 네이티브 파일 접근이 일시적으로 실패(10장 중 일부만 로드)하는 경우가 잦아
    //   곧바로 권한 경고를 띄우지 말고, 동시성 낮춰(1장씩) 잠깐씩 쉬며 최대 2회 다시 시도한다.
    for (let round = 1; round <= 2 && retryList.length > 0; round++) {
      console.warn(`[lazy load] ${round}차 재시도 ${retryList.length}장`);
      await new Promise(r => setTimeout(r, 400 * round));
      const stillFailed = [];
      for (const p of retryList) {
        if (!(await _loadOnePhoto(p))) stillFailed.push(p);
        await new Promise(r => setTimeout(r, 15));  // 파일 접근 간격 (동시성 경합 완화)
      }
      retryList = stillFailed;
    }
    failed = retryList.length;

    if (failed > 0) {
      console.warn(`[lazy load] 완료: ${targets.length - failed}장 성공, ${failed}장 실패`);
      if (typeof showToast === 'function') {
        showToast(`⚠️ 사진 ${failed}장이 아직 안 열렸어요. 잠시 후 다시 불러오거나 폴더 권한을 확인해주세요`, 'err');
      }
    } else {
      console.log(`[lazy load] 완료: ${targets.length}장 성공`);
    }
  } finally {
    _lazyLoadingInProgress = false;
  }
}
window.startLazyPhotoLoading = startLazyPhotoLoading;

// ★ 특정 호수의 사진만 우선 로드 (호수 펼칠 때 호출)
//   - 전역 startLazyPhotoLoading이 도는 중이어도 이 호수 사진 먼저 처리
async function loadLazyPhotosForUnit(u) {
  if (!u) return;
  const targets = [];
  (u.before || []).forEach(p => {
    if (p && !p.dataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
  });
  (u.after || []).forEach(p => {
    if (p && !p.dataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
  });
  (u.specials || []).forEach(s => {
    (s.photos || []).forEach(p => {
      if (p && !p.dataUrl && (p.fileHandle || (p._workDir && p.fileName))) targets.push(p);
    });
  });
  if (targets.length === 0) return;

  console.log(`[lazy unit] ${u.name}: ${targets.length}장 우선 로드`);
  // 사진 1장 로드 (성공 시 true)
  async function _loadOne(p) {
    try {
      let fh = p.fileHandle;
      if (!fh && p._workDir && p.fileName) {
        fh = await p._workDir.getFileHandle(p.fileName);
        p.fileHandle = fh;
      }
      if (!fh) return false;
      const file = await fh.getFile();
      const dataUrl = await blobToDataURL(file);
      p.dataUrl = dataUrl;
      p.lazy = false;
      document.querySelectorAll(`img[data-photo-id="${p.id}"]`).forEach(img => { img.src = dataUrl; });
      return true;
    } catch (e) {
      console.warn(`[lazy unit] 실패 (${p.fileName || p.id}):`, e.message);
      return false;
    }
  }
  // ★ 배치 작게 + paint 양보 (사진 점진적으로 보이도록)
  const BATCH = 2;
  let retryList = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    await Promise.all(batch.map(async p => { if (!(await _loadOne(p))) retryList.push(p); }));
    // 강제 paint - 사진 점진적으로 보이도록
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));
  }
  // ★ 일시적 파일접근 실패분 재시도 (동시성 낮춰 1장씩, 최대 2회)
  for (let round = 1; round <= 2 && retryList.length > 0; round++) {
    await new Promise(r => setTimeout(r, 400 * round));
    const stillFailed = [];
    for (const p of retryList) {
      if (!(await _loadOne(p))) stillFailed.push(p);
      await new Promise(r => setTimeout(r, 15));
    }
    retryList = stillFailed;
  }
}
window.loadLazyPhotosForUnit = loadLazyPhotosForUnit;
// 배열을 객체 배열로 정규화 (문자열은 객체로 변환)
function normalizePhotos(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(p => {
    if (typeof p === 'string') return makePhoto(p);
    if (!p.id) p.id = newPhotoId();
    if (typeof p.savedToFolder !== 'boolean') p.savedToFolder = false;
    return p;
  });
}
// units 전체 정규화 (불러오기 / 세션 복원 시 호출)
function normalizeUnits(arr) {
  return (arr||[]).map(u => ({
    ...u,
    before: normalizePhotos(u.before),
    after:  normalizePhotos(u.after),
    specials: (u.specials||[]).map(s => ({
      ...s,
      photos: normalizePhotos(s.photos)
    })),
    // customer 필드 기본값 보장 (이전 버전 데이터에는 없을 수 있음)
    customer: u.customer || { phone: '', address: '', memo: '' }
  }));
}

function addUnit(name) {
  // ★ 가정용 모드 + 이미 1호수 있으면 안내
  if (currentWorkType === 'household' && units.length >= 1) {
    showHouseholdLimitDialog();
    return;
  }
  const inp=document.getElementById('newName');
  const n=(name!==undefined?name:inp.value).trim();
  if(!n){ showToast('호수명을 입력해주세요','err'); return; }
  const _newU={id:nid++,name:n,before:[],after:[],specials:[],open:true,customer:{phone:'',address:'',memo:''}};
  units.push(_newU);
  // ★ 생성 즉시 workNN 번호 고정 (미사용 최소번호) - 이름 변경/저장 순서와 무관하게 유지
  if (typeof getWorkNumberForUnit === 'function') { try { getWorkNumberForUnit(_newU); } catch(e){} }
  if(name===undefined){ inp.value=''; inp.focus(); }
  renderAll(); updateStats(); sessionAutoSave();
  showToast(`✅ "${n}" 호수가 추가되었습니다`, 'ok');
}

function bulkAdd() {
  // ★ 가정용 모드면 일괄 추가 불가
  if (currentWorkType === 'household') {
    showHouseholdLimitDialog();
    return;
  }
  const raw=prompt('여러 호수를 한꺼번에 입력하세요\n\n📌 구분자: 쉼표(,) 또는 슬래시(/)\n\n예시 1) 101동 201호, 101동 202호, 101동 203호\n예시 2) 201호 / 202호 / 203호');
  if(!raw) return;
  // 반각/전각 쉼표, 반각/전각 슬래시, 줄바꿈 모두 구분자로 인식
  const lines=raw.split(/[,，\/／\n]/).map(l=>l.trim()).filter(Boolean);
  if(lines.length===0) return;
  if(lines.length===1) {
    showToast('구분자(쉼표/슬래시)가 없습니다. 단일 호수로 추가합니다','err');
  }
  lines.forEach(l=>{
    const _u={id:nid++,name:l,before:[],after:[],specials:[],open:false,customer:{phone:'',address:'',memo:''}};
    units.push(_u);
    if (typeof getWorkNumberForUnit === 'function') { try { getWorkNumberForUnit(_u); } catch(e){} }
  });
  renderAll(); updateStats(); sessionAutoSave();
  showToast(`${lines.length}개 호수 추가됨`,'ok');
}

async function deleteUnit(id) {
  const _u = (typeof findU === 'function') ? findU(id) : (units || []).find(x => x.id === id);
  const _uname = (_u && _u.name) || '';
  if(!confirm('이 호수를 삭제할까요?')) return;
  units=units.filter(u=>u.id!==id);
  renderAll(); updateStats(); sessionAutoSave();
  /* ★ 2026-08-13: 그 호수에 상대가 보탠 사진이 클라우드에 남아 있으면,
     다음에 작업을 열 때 그 사진을 다시 받으면서 호수까지 되살아난다.
     (평소 정리는 상대 기여분을 일부러 보존하기 때문)
     내 작업일 때만 그 호수의 클라우드 사진을 같이 정리한다. */
  try {
    if (!window._borrowedShare && _uname && typeof currentFolderName !== 'undefined' && currentFolderName
        && window.CloudPhotoSync && CloudPhotoSync.deleteUnitCloudPhotos) {
      const _n = await CloudPhotoSync.deleteUnitCloudPhotos(currentFolderName, _uname);
      if (_n > 0 && typeof showToast === 'function') showToast('공유된 사진 ' + _n + '장도 함께 정리했습니다', 'ok');
    }
  } catch (e) { console.warn('[호수삭제] 클라우드 사진 정리 실패', e); }
  // ★ customers 캐시 무효화 (호수 삭제 시 visits에서 사라지도록)
  if (typeof invalidateCustomersCache === 'function') {
    invalidateCustomersCache();
  }
}

function startEdit(id) {
  const u=findU(id); if(!u) return;
  const el=document.getElementById(`nm-${id}`); if(!el) return;
  const oldName = u.name;  // ★ 변경 전 이름 기억
  // ★ 이름을 바꾸기 전에 workNN 번호를 유닛에 고정해 둔다 (2026-08-09)
  //   안 그러면 새 이름으로 새 번호가 발급되어 디스크 폴더와 어긋난다.
  if (typeof getWorkNumberForUnit === 'function') { try { getWorkNumberForUnit(u); } catch(e){} }
  const inp=document.createElement('input');
  inp.className='u-name-inp'; inp.value=u.name;
  inp.addEventListener('click',e=>e.stopPropagation());
  inp.addEventListener('blur',async ()=>{
    const newName = inp.value.trim() || u.name;
    u.name = newName;
    // ★ 이름→번호 매핑 재구성 (옛 이름 잔재 제거, u._workNum 은 그대로 유지됨)
    if (typeof rebuildWorkNumbers === 'function') { try { rebuildWorkNumbers(); } catch(e){} }
    renderAll();
    updateStats();
    sessionAutoSave();

    // ★ 호수명이 실제로 바뀌었고 전화번호가 있으면 customer visit 갱신
    if (oldName !== newName && u.customer?.phone) {
      const phone = u.customer.phone.replace(/[^\d]/g, '');
      if (phone.length >= 9) {
        try {
          // 옛 unit 이름 추적용 - saveCustomerForUnit이 매칭하도록
          u._oldUnitName = oldName;
          await saveCustomerForUnit(u);
          if (typeof flushCustomersXlsx === 'function') flushCustomersXlsx().catch(()=>{});
        } catch(err) {
          console.warn('호수명 변경 후 customer 갱신 실패:', err);
        }
      }
    }
  });
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key==='Escape') inp.blur(); e.stopPropagation(); });
  el.replaceWith(inp); inp.focus(); inp.select();
}

async function clearAll() {
  const aptInput = document.getElementById('aptName');
  const apt = aptInput?.value || '';
  const hasFolder = !!currentFolderName;
  const hasData = units.length > 0 || apt;

  // 데이터 없으면 그냥 통과
  if (!hasData) {
    showToast('초기화할 작업이 없습니다', 'ok');
    return;
  }

  // 확인 메시지
  let msg = `🗑️ 현재 작업을 완전히 삭제할까요?\n\n`;
  msg += `${apt || '(이름 없음)'}\n호수 ${units.length}개\n\n`;
  if (hasFolder) {
    msg += `※ 저장 폴더와 사진도 모두 삭제됩니다.\n작업 기록에서도 제거됩니다.\n`;
  } else {
    msg += `※ 현재 작업 내용이 모두 사라집니다.\n`;
  }
  msg += `이 작업은 되돌릴 수 없습니다.`;

  if (!confirm(msg)) return;

  showOverlay('삭제 중...');
  const safetyTimeout = setTimeout(() => {
    hideOverlay();
    showToast('삭제 시간 초과 - 다시 시도해주세요', 'err');
  }, 30000);

  try {
    // 1) 저장 폴더 삭제 (있으면)
    const folderName = currentFolderName;
    if (folderName && photoFolderHandle) {
      try {
        let perm = await photoFolderHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await photoFolderHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
          let deleted = false;
          // 1차 recursive
          try {
            await photoFolderHandle.removeEntry(folderName, { recursive: true });
            deleted = true;
          } catch(e1) { console.warn('recursive 삭제 실패:', e1.message); }
          // 2차 수동 재귀
          if (!deleted && typeof deleteDirectoryContents === 'function') {
            try {
              const dh = await photoFolderHandle.getDirectoryHandle(folderName);
              await deleteDirectoryContents(dh);
              await photoFolderHandle.removeEntry(folderName);
              deleted = true;
            } catch(e2) { console.warn('수동 삭제 실패:', e2.message); }
          }
          // 3차 빈 폴더 시도
          if (!deleted) {
            try { await photoFolderHandle.removeEntry(folderName); deleted = true; } catch(e3) {}
          }
        }
      } catch(e) { console.warn('폴더 삭제 중 오류:', e.message); }

      // 인덱스/캐시 정리
      if (typeof scheduleIndexDelete === 'function') scheduleIndexDelete(folderName);
      if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
      if (typeof invalidateCustomersV2 === 'function') invalidateCustomersV2();
      if (typeof invalidateCustomersCache === 'function') invalidateCustomersCache();
    }

    // 2) 화면/상태 완전 초기화
    units = []; nid = 1;
    currentWorkId = '';
    currentFolderName = null;
    /* ⭐ 2026-08-13 버그수정 — 여기서 '빌려보기(_borrowedShare)' 표시를 안 지우고 있었다.
       newWork 는 지우는데(1829·1901행) 이 초기화 경로만 빠져 있었다.
       그래서 공유받은 작업을 열어 둔 채 🗑 초기화한 뒤 새로 사진을 찍어 저장하면
       saveToFolder 의 _borrowedShare 분기를 타서 **남의 작업에 사진이 올라갔다.** */
    try {
      if (window._borrowedShare) {
        window._borrowedShare = null;
        if (window.CloudPhotoSync && CloudPhotoSync.stopLivePhotoSync) CloudPhotoSync.stopLivePhotoSync();
      }
    } catch (e) { console.warn('[초기화] 공유 열람 해제 실패', e); }
    facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
    if (typeof resetWorkType === 'function') resetWorkType();
    if (typeof _indexCounter !== 'undefined') _indexCounter.clear();
    if (typeof _unitWorkNumber !== 'undefined') _unitWorkNumber.clear();
    if (typeof _savedPhotoIds !== 'undefined') _savedPhotoIds.clear();
    if (typeof pendingSaves !== 'undefined') pendingSaves.length = 0;
    if (typeof _dataDirty !== 'undefined') _dataDirty = false;

    document.getElementById('rpWrap').innerHTML = '';
    if (aptInput) { aptInput.value = ''; aptInput.placeholder = '작업명을 입력하세요'; }
    const dateEl = document.getElementById('workDate');
    if (dateEl && typeof kstDateStr === 'function') dateEl.value = kstDateStr();
    const workerEl = document.getElementById('workerName');
    if (workerEl) workerEl.value = '';

    const btnPDF = document.getElementById('btnPDF'); if (btnPDF) btnPDF.disabled = true;
    const btnJPG = document.getElementById('btnJPG'); if (btnJPG) btnJPG.disabled = true;

    if (typeof _lastSaveSnapshot === 'string' && typeof quickSnapshot === 'function') {
      _lastSaveSnapshot = quickSnapshot();
    }

    renderAll();
    updateStats();

    // 3) 세션 자동저장 (빈 상태로 덮어써서 재실행 시 부활 방지)
    try { if (typeof sessionAutoSaveNow === 'function') await sessionAutoSaveNow(); } catch(e) {}

    clearTimeout(safetyTimeout);
    hideOverlay();
    showToast('✓ 작업 삭제됨', 'ok');
  } catch(e) {
    clearTimeout(safetyTimeout);
    hideOverlay();
    showToast('삭제 실패: ' + e.message, 'err');
  }
}

// ★ 외부에서 호출: 폴더가 삭제됐을 때, 현재 화면이 그 폴더면 화면도 초기화
// (작업기록/고객/방문 삭제 시 사용 - 앱 재시작해도 부활 안 하도록)
async function clearIfCurrent(deletedFolderName) {
  if (!deletedFolderName) return false;
  if (currentFolderName !== deletedFolderName) return false;

  // 화면/상태 완전 초기화 (clearAll의 후반부와 동일)
  units = []; nid = 1;
  currentWorkId = '';
  currentFolderName = null;
  facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
  if (typeof resetWorkType === 'function') resetWorkType();
  if (typeof _indexCounter !== 'undefined') _indexCounter.clear();
  if (typeof _unitWorkNumber !== 'undefined') _unitWorkNumber.clear();
  if (typeof _savedPhotoIds !== 'undefined') _savedPhotoIds.clear();
  if (typeof pendingSaves !== 'undefined') pendingSaves.length = 0;
  if (typeof _dataDirty !== 'undefined') _dataDirty = false;
  if (typeof resetWorkGlobals === 'function') resetWorkGlobals();   // ★ 저장글 등 작업 귀속 전역도 함께 비움

  const rpWrap = document.getElementById('rpWrap'); if (rpWrap) rpWrap.innerHTML = '';
  const aptInput = document.getElementById('aptName');
  if (aptInput) { aptInput.value = ''; aptInput.placeholder = '작업명을 입력하세요'; }
  const dateEl = document.getElementById('workDate');
  if (dateEl && typeof kstDateStr === 'function') dateEl.value = kstDateStr();
  const workerEl = document.getElementById('workerName');
  if (workerEl) workerEl.value = '';

  const btnPDF = document.getElementById('btnPDF'); if (btnPDF) btnPDF.disabled = true;
  const btnJPG = document.getElementById('btnJPG'); if (btnJPG) btnJPG.disabled = true;

  if (typeof _lastSaveSnapshot === 'string' && typeof quickSnapshot === 'function') {
    _lastSaveSnapshot = quickSnapshot();
  }

  if (typeof renderAll === 'function') renderAll();
  if (typeof updateStats === 'function') updateStats();

  // 세션 자동저장 (빈 상태로 덮어쓰기 → 재실행 시 부활 방지)
  try { if (typeof sessionAutoSaveNow === 'function') await sessionAutoSaveNow(); } catch(e) {}

  return true;
}
// 전역 노출
if (typeof window !== 'undefined') window.clearIfCurrent = clearIfCurrent;

/* ══════════════════════════════════════════
   현재 작업 삭제 (확인 팝업 없이 실제 삭제만 수행)
   - 폴더/사진 삭제 + 스케줄 인덱스 삭제 + 화면 초기화(clearIfCurrent) + 달력 새로고침
   - 호출부에서 확인 팝업을 책임진다
══════════════════════════════════════════ */
async function performDeleteCurrentWork() {
  var folderName = (typeof currentFolderName !== 'undefined') ? currentFolderName : null;
  try { if (typeof showOverlay === 'function') showOverlay('삭제 중...'); } catch (e) {}
  try {
    if (folderName && typeof photoFolderHandle !== 'undefined' && photoFolderHandle) {
      var deleted = false;
      try { await photoFolderHandle.removeEntry(folderName, { recursive: true }); deleted = true; }
      catch (e1) {
        try {
          var dh = await photoFolderHandle.getDirectoryHandle(folderName);
          if (typeof deleteDirectoryContents === 'function') await deleteDirectoryContents(dh);
          await photoFolderHandle.removeEntry(folderName); deleted = true;
        } catch (e2) {}
      }
      if (typeof scheduleIndexDelete === 'function') scheduleIndexDelete(folderName);
      if (typeof invalidateRecordsCache === 'function') invalidateRecordsCache();
      if (typeof invalidateCustomersV2 === 'function') invalidateCustomersV2();
      if (typeof invalidateCustomersCache === 'function') invalidateCustomersCache();
      // 자동백업 거울에서도 이 작업 제거 (복원 시 부활 방지)
      try { if (window.AutoBackup && AutoBackup.removeFromBackup) await AutoBackup.removeFromBackup(folderName); } catch (e) {}
    }
    // 화면/상태를 새 작업으로 초기화 (currentFolderName이 folderName과 같을 때만 리셋됨)
    if (typeof clearIfCurrent === 'function') { try { await clearIfCurrent(folderName); } catch (e) {} }
    // 달력 갱신 (열려 있으면 반영)
    try { if (typeof window !== 'undefined' && window.__calendarRefresh) await window.__calendarRefresh(); } catch (e) {}
    if (typeof showToast === 'function') showToast('🗑️ 작업이 삭제되었습니다', 'ok');
  } finally {
    try { if (typeof hideOverlay === 'function') hideOverlay(); } catch (e) {}
  }
}
if (typeof window !== 'undefined') window.performDeleteCurrentWork = performDeleteCurrentWork;

// ★ 사진 삭제 즉시 반영용: 전체 renderAll 없이 해당 호수 카드의 개수/배지/완료상태만 갱신
function _updateUnitCardMeta(u) {
  try {
    if (!u) return;
    const card = document.getElementById('card-' + u.id);
    if (!card) return;
    const hB = (u.before || []).length > 0, hA = (u.after || []).length > 0;
    card.classList.toggle('done', hB && hA);
    card.classList.toggle('part', (hB || hA) && !(hB && hA));
    const pB = card.querySelector('.pane-b .cnt'); if (pB) pB.textContent = (u.before || []).length;
    const pA = card.querySelector('.pane-a .cnt'); if (pA) pA.textContent = (u.after || []).length;
    const bd = card.querySelector('.u-head-actions .bdg');
    if (bd) {
      if (hB && hA) { bd.className = 'bdg bdg-ok'; bd.textContent = '완료'; }
      else if (hB || hA) { bd.className = 'bdg bdg-pt'; bd.textContent = (hB ? ('전' + u.before.length) : '') + (hA ? ('후' + u.after.length) : '') + '장'; }
      else { bd.className = 'bdg bdg-no'; bd.textContent = '사진없음'; }
    }
  } catch (e) {}
}
if (typeof window !== 'undefined') window._updateUnitCardMeta = _updateUnitCardMeta;

/* ══════════════════════════════════════════
   작업탭을 벗어날 때 가드 (저장 버튼은 그대로 두고, 이동 직전 확인)
   반환: true = 이동 진행, false = 작업탭에 머무름
   - 호수 있음 + 저장 안 된 변경 → 저장/저장안함/취소
   - 호수 0개 + 이미 저장된 작업 → "내용 없음, 삭제?" (취소=머무름)
   - 호수 0개 + 새 작업(미저장) → 그냥 이동
══════════════════════════════════════════ */
let _guardLeaveBusy = false;   // ★ 이동-저장 확인/저장이 진행 중일 때 중복 진입 차단(사진 2장 중복 방지)
async function guardLeaveWorkTab() {
  // ★ 이미 저장/확인이 진행 중이면(느린 업로드 대기 중 다른 곳을 또 누른 경우)
  //   확인 팝업이 다시 뜨고 저장이 두 번 돌아 사진이 중복되던 문제 차단 → 지금은 무시하고 머무름.
  if (_guardLeaveBusy) return false;
  _guardLeaveBusy = true;
  try {
  // 실제로 작업탭에 있을 때만 동작 (다른 탭이 이미 떠 있으면 통과)
  try {
    var activeTab = document.querySelector('.tab-item.active');
    if (activeTab && activeTab.dataset && activeTab.dataset.tab !== 'work') return true;
  } catch (e) {}

  var hasUnits = false;
  try { hasUnits = (typeof units !== 'undefined') && Array.isArray(units) && units.length > 0; } catch (e) {}

  // ── 호수가 하나도 없는 경우 ──
  if (!hasUnits) {
    var saved = (typeof currentFolderName !== 'undefined') && !!currentFolderName;
    if (!saved) return true; // 저장된 적 없는 새 작업 → 물어볼 것 없이 이동
    var del = confirm('작업 내용(호수)이 없습니다.\n\n현재 작업을 삭제할까요?\n· 폴더·사진·스케줄에서 함께 제거됩니다 (되돌릴 수 없음)\n\n[취소]를 누르면 작업탭에 그대로 머뭅니다.');
    if (!del) return false;           // 취소 → 머무름
    await performDeleteCurrentWork();  // 삭제 후 이동
    return true;
  }

  // ── 호수가 있는 경우: 변경사항 확인 ──
  var changed = true;
  try {
    if (typeof quickSnapshot === 'function' && typeof _lastSaveSnapshot === 'string') {
      changed = (quickSnapshot() !== _lastSaveSnapshot);
    }
  } catch (e) {}
  if (!changed) return true; // 바뀐 게 없으면 그냥 이동

  // 저장 폴더가 없으면 저장 자체가 불가 → 이동만 허용
  if (typeof photoFolderHandle === 'undefined' || !photoFolderHandle) return true;

  // confirm은 2지선다라 2단계로 3지선다 구현
  var doSave = confirm('변경사항이 있습니다.\n\n저장하고 이동할까요?\n\n[확인] 저장 후 이동\n[취소] 저장하지 않고 이동할지 다시 선택');
  if (doSave) {
    // ★ 저장은 백그라운드로 → 스케줄 탭이 '먼저' 뜨고 저장은 뒤에서 진행(사용자 대기 없음).
    //   _isSavingInBackground 플래그로, 이동 후 다른 작업을 열 때 saveToFolder가 이 저장을
    //   기다렸다 진행하므로 데이터 경합 없음. 안전 타임아웃으로 먹통 방지.
    try {
      if (typeof saveToFolder === 'function') {
        window._isSavingInBackground = true;
        var _bgTimer = setTimeout(function () {
          if (window._isSavingInBackground) { console.warn('[이동저장] 안전 타임아웃 - 플래그 해제'); window._isSavingInBackground = false; }
        }, 15000);
        Promise.resolve()
          .then(function () { return saveToFolder({ auto: true, force: true, silent: true, _fromBackground: true }); })
          .catch(function (e) { if (typeof showToast === 'function') showToast('저장 실패: ' + (e && e.message), 'err'); })
          .finally(function () { clearTimeout(_bgTimer); window._isSavingInBackground = false; });
      } else if (typeof sessionAutoSaveNow === 'function') {
        sessionAutoSaveNow();
      }
    } catch (e) { window._isSavingInBackground = false; }
    return true;   // 저장을 기다리지 않고 즉시 이동
  }
  // 2단계: 저장 없이 이동 vs 머무름
  var discard = confirm('저장하지 않고 이동할까요?\n\n[확인] 저장 안 하고 이동\n[취소] 작업탭에 머무르기');
  return !!discard;
  } finally { _guardLeaveBusy = false; }
}
if (typeof window !== 'undefined') window.guardLeaveWorkTab = guardLeaveWorkTab;

// 새 작업 시작
async function newWork(presetDate) {
  // 공유 작업탭 실시간 구독 해제(새 작업으로 전환)
  if (window.CloudPhotoSync && CloudPhotoSync.stopLivePhotoSync) CloudPhotoSync.stopLivePhotoSync();
  // 작업 내용이 없으면 바로 초기화
  if (units.length === 0) {
    document.getElementById('workDate').value = (presetDate || kstDateStr());
    document.getElementById('aptName').value  = '';
    document.getElementById('aptName').placeholder = '작업명을 입력하세요';
    document.getElementById('workerName').value = '';
    currentWorkId = '';
    currentFolderName = null;
    window._borrowedShare = null;
    nid = 1;
    // ★ facilityCustomer 완전 초기화 (workType 전환 시 부활 방지)
    facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
    if (typeof resetWorkGlobals === 'function') resetWorkGlobals();   // 저장글·참고메모·종료일
    if (typeof resetWorkType === 'function') resetWorkType();
    if (typeof _indexCounter !== 'undefined') _indexCounter.clear();
    if (typeof _unitWorkNumber !== 'undefined') _unitWorkNumber.clear();
    if (typeof _savedPhotoIds !== 'undefined') _savedPhotoIds.clear();
    if (typeof pendingSaves !== 'undefined') pendingSaves.length = 0;
    if (typeof _dataDirty !== 'undefined') _dataDirty = false;
    if (typeof _lastSaveSnapshot === 'string') _lastSaveSnapshot = quickSnapshot ? quickSnapshot() : '';
    renderAll();
    updateStats();
    try { await sessionAutoSaveNow(); } catch(e) {}
    showToast('🆕 새 작업', 'ok');
    return;
  }

  // 변경 여부 체크 (실제 데이터 비교 - dirty 플래그는 거짓 양성 많음)
  const currentSnap = (typeof quickSnapshot === 'function') ? quickSnapshot() : '';
  const hasChanges = (currentSnap !== _lastSaveSnapshot);

  const totalPhotos = units.reduce((s,u) =>
    s + u.before.length + u.after.length +
    u.specials.reduce((a,sp) => a+sp.photos.length, 0), 0);

  // 확인 메시지 (1.240: 변경사항 있으면 3-way 선택)
  let _skipBackgroundSave = false;
  if (photoFolderHandle && hasChanges) {
    // 변경 있음 - 3-way: 1) 저장 후 새작업  2) 저장 없이 새작업  3) 취소
    // confirm은 2-way라 두 단계로 분리:
    //   1단계: 저장할까? (예/아니오)
    //   2단계: 그래서 새작업 시작할까? (예/아니오) - 마지막 회피 기회
    const wantSave = confirm(
      `📋 현재 작업: 호수 ${units.length}개, 사진 ${totalPhotos}장\n\n` +
      `💾 저장 안 된 변경사항이 있어요.\n\n` +
      `확인 → 저장 후 진행\n` +
      `취소 → 저장 안 함`
    );
    // 새작업 진행 여부 마지막 확인
    if (!confirm(wantSave ? '🆕 새 작업을 시작할까요?\n(현재 작업은 저장됩니다)' : '🆕 새 작업을 시작할까요?\n(저장 안 됨 - 변경 버림)')) return;
    _skipBackgroundSave = !wantSave;
  } else {
    // 변경 없음 또는 폴더 없음 - 단순 확인
    const msg = photoFolderHandle
      ? `📋 현재 작업: 호수 ${units.length}개, 사진 ${totalPhotos}장\n\n(이미 저장됨) 새 작업을 시작할까요?`
      : `📋 현재 작업: 호수 ${units.length}개, 사진 ${totalPhotos}장\n\n⚠️ 저장 폴더가 없어 사진은 저장되지 않습니다.\n새 작업을 시작할까요?`;
    if (!confirm(msg)) return;
    _skipBackgroundSave = true;  // 변경 없으니 백그라운드 저장 스킵
  }

  // ★★★ 핵심: 이전 상태 캡처 후 즉시 UI 초기화
  const prevUnits = units;
  const prevWorkId = currentWorkId;
  const prevFolderName = currentFolderName;
  const prevWorkType = currentWorkType;
  const prevFacilityCustomer = { ...facilityCustomer };
  const prevWorkPosts = (typeof workPosts !== 'undefined' && Array.isArray(workPosts)) ? workPosts : [];
  const prevWorkPostMemo = (typeof workPostMemo !== 'undefined') ? workPostMemo : '';
  const prevWorkEndDate = (typeof currentWorkEndDate !== 'undefined') ? currentWorkEndDate : '';
  const prevDirty = hasChanges;
  // ★ DOM 값도 캡처 (백그라운드 저장 시 사용)
  const prevApt    = document.getElementById('aptName').value || '';
  const prevDate   = document.getElementById('workDate').value || '';
  const prevWorker = document.getElementById('workerName').value || '';

  // ★ UI 즉시 초기화 (사용자는 이미 새 작업 상태로 인식)
  units = [];
  nid = 1;
  currentWorkId = '';
  currentFolderName = null;
  window._borrowedShare = null;
  if (typeof resetWorkGlobals === 'function') resetWorkGlobals();   // 저장글·참고메모·종료일
  if (typeof resetWorkType === 'function') resetWorkType();
  document.getElementById('rpWrap').innerHTML = '';
  { const _b = document.getElementById('btnPDF'); if (_b) _b.disabled = true; }
  { const _b = document.getElementById('btnJPG'); if (_b) _b.disabled = true; }
  document.getElementById('aptName').value = '';
  document.getElementById('aptName').placeholder = '작업명을 입력하세요';
  document.getElementById('workDate').value = (presetDate || kstDateStr());
  document.getElementById('workerName').value = '';
  if (window.WorkerCombo) { WorkerCombo.autofillIfEmpty(); WorkerCombo.refresh(); }
  if (typeof _indexCounter !== 'undefined') _indexCounter.clear();
  if (typeof _unitWorkNumber !== 'undefined') _unitWorkNumber.clear();
  if (typeof _savedPhotoIds !== 'undefined') _savedPhotoIds.clear();
  if (typeof pendingSaves !== 'undefined') pendingSaves.length = 0;
  if (typeof _dataDirty !== 'undefined') _dataDirty = false;
  if (typeof _lastSaveSnapshot === 'string') _lastSaveSnapshot = quickSnapshot();

  renderAll();
  updateStats();
  showToast('🆕 새 작업', 'ok');

  // ★ 빈 세션 강제 저장 (백그라운드 저장 시작 전에!) - force로 가드 우회
  //   - 백그라운드 저장이 시작되면 _isSavingInBackground=true 되어 일반 sessionAutoSaveNow는 차단됨
  //   - 빈 세션을 IndexedDB/localStorage에 박아두면 이후 무슨 일이 있어도 빈 상태로 복원
  try { await sessionAutoSaveNow({ force: true }); } catch(e) {}

  // ★ 백그라운드 저장 (UI 차단 없음) - 사용자가 저장 선택했고 변경 있을 때만
  if (photoFolderHandle && prevDirty && !_skipBackgroundSave) {
    _saveInBackground(prevUnits, prevWorkId, prevFolderName, prevWorkType, prevFacilityCustomer, prevApt, prevDate, prevWorker, prevWorkPosts, prevWorkEndDate, prevWorkPostMemo);
  } else if (_skipBackgroundSave && prevDirty) {
    console.log('[새작업] 사용자가 저장 안 함 선택 → 백그라운드 저장 스킵');
  }
}

// 백그라운드 저장 중 플래그 (전역 노출 - customers.js에서 접근)
let _isSavingInBackground = false;
Object.defineProperty(window, '_isSavingInBackground', {
  get: () => _isSavingInBackground,
  set: (v) => { _isSavingInBackground = v; }
});

// 백그라운드 저장 - UI 차단 없이 이전 작업 데이터를 저장
async function _saveInBackground(prevUnits, prevWorkId, prevFolderName, prevWorkType, prevFacilityCustomer, prevApt, prevDate, prevWorker, prevWorkPosts, prevWorkEndDate, prevWorkPostMemo) {
  _isSavingInBackground = true;
  // ★ 안전 타임아웃 (1.272): 무슨 일이 있어도 12초 후엔 플래그 강제 해제
  //   - saveToFolder가 어떤 이유로든 hang하면 추가/새작업 버튼이 영구 먹통되는 것 방지
  const _bgSafetyTimer = setTimeout(() => {
    if (_isSavingInBackground) {
      console.warn('[백그라운드저장] 안전 타임아웃 - 플래그 강제 해제');
      _isSavingInBackground = false;
    }
  }, 12000);
  // 현재 전역 상태 + DOM 값 백업
  const savedUnits = units;
  const savedWorkId = currentWorkId;
  const savedFolderName = currentFolderName;
  const savedWorkType = currentWorkType;
  const savedFacilityCustomer = { ...facilityCustomer };
  const savedWorkPosts = (typeof workPosts !== 'undefined' && Array.isArray(workPosts)) ? workPosts : [];
  const savedWorkPostMemo = (typeof workPostMemo !== 'undefined') ? workPostMemo : '';
  const savedWorkEndDate = (typeof currentWorkEndDate !== 'undefined') ? currentWorkEndDate : '';
  const aptEl    = document.getElementById('aptName');
  const dateEl   = document.getElementById('workDate');
  const workerEl = document.getElementById('workerName');
  const savedApt    = aptEl?.value || '';
  const savedDate   = dateEl?.value || '';
  const savedWorker = workerEl?.value || '';
  // ★ _unitWorkNumber 백업 (1.246) - 백그라운드 저장이 이전 호수를 다시 등록하여
  //   새 호수의 workNum이 size+1로 잘못 잡히는 버그 방지 (work02부터 시작되던 문제)
  const savedWorkNumberMap = (typeof _unitWorkNumber !== 'undefined')
    ? new Map(_unitWorkNumber)
    : null;

  try {
    // ★ 전역 상태 + DOM을 이전 작업 값으로 일시 교체
    units = prevUnits;
    currentWorkId = prevWorkId;
    currentFolderName = prevFolderName;
    currentWorkType = prevWorkType;
    facilityCustomer = prevFacilityCustomer;
    workPosts = prevWorkPosts || [];
    workPostMemo = prevWorkPostMemo || '';
    currentWorkEndDate = prevWorkEndDate || '';
    if (aptEl)    aptEl.value    = prevApt    || '';
    if (dateEl)   dateEl.value   = prevDate   || '';
    if (workerEl) workerEl.value = prevWorker || '';

    // 저장 (오버레이 없이 조용히)
    await saveToFolder({ auto: true, force: true, silent: true, _fromBackground: true });

    // 고객 정보 저장
    if (typeof flushAllCustomers === 'function') {
      await flushAllCustomers();
    }

    console.log('✅ 백그라운드 저장 완료:', prevApt);
    showToast('✅ 이전 작업 저장 완료', 'ok');
  } catch(e) {
    console.error('백그라운드 저장 실패:', e);
    showToast('⚠️ 이전 작업 백그라운드 저장 실패: ' + e.message, 'err');
  } finally {
    // ★ 현재 작업 상태 + DOM 복원
    units = savedUnits;
    currentWorkId = savedWorkId;
    currentFolderName = savedFolderName;
    currentWorkType = savedWorkType;
    facilityCustomer = savedFacilityCustomer;
    workPosts = savedWorkPosts;
    workPostMemo = savedWorkPostMemo;
    currentWorkEndDate = savedWorkEndDate;
    if (aptEl)    aptEl.value    = savedApt;
    if (dateEl)   dateEl.value   = savedDate;
    if (workerEl) workerEl.value = savedWorker;
    // ★ _unitWorkNumber 복원 (1.246) - 백그라운드 저장이 이전 호수를 다시 등록한 것 되돌림
    if (savedWorkNumberMap && typeof _unitWorkNumber !== 'undefined') {
      _unitWorkNumber.clear();
      savedWorkNumberMap.forEach((v, k) => _unitWorkNumber.set(k, v));
    }
    _isSavingInBackground = false;
    clearTimeout(_bgSafetyTimer);  // ★ 정상 완료 시 안전 타이머 해제 (1.272)

    // ★ 백그라운드 저장 끝난 후 즉시 현재(빈) 상태를 세션에 강제 저장 (1.234)
    //   - 새작업 직후 앱 종료해도 빈 상태가 복원되도록 보장
    //   - force: true로 가드 우회 (백그라운드 직후라 가드는 풀렸지만 안전을 위해)
    try { await sessionAutoSaveNow({ force: true }); } catch(e) {}
  }
}

// (이전 savePhotosForNewWork 함수는 saveToFolder로 통합되어 제거)


// ═══════════════════════════════
// 호수별 고객 정보 입력 이벤트 (이벤트 위임)
// ═══════════════════════════════
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.classList || !(el.classList.contains('cust-inp') || el.classList.contains('cust-memo'))) return;

  const uid = el.dataset.uid;
  const field = el.dataset.field;
  if (!uid || !field) return;

  const u = units.find(x => String(x.id) === String(uid));
  if (!u) return;

  if (!u.customer) u.customer = { phone: '', address: '', memo: '' };

  // 전화번호 자동 하이픈
  if (field === 'phone') {
    const raw = el.value.replace(/[^\d]/g, '');
    let formatted = el.value;
    if (raw.length === 11 && raw.startsWith('010')) formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length === 10 && raw.startsWith('02')) formatted = `${raw.slice(0,2)}-${raw.slice(2,6)}-${raw.slice(6)}`;
    else if (raw.length === 11) formatted = `${raw.slice(0,3)}-${raw.slice(3,7)}-${raw.slice(7)}`;
    else if (raw.length === 10) formatted = `${raw.slice(0,3)}-${raw.slice(3,6)}-${raw.slice(6)}`;
    if (formatted !== el.value) {
      const cur = el.selectionStart;
      el.value = formatted;
      try { el.setSelectionRange(cur+1, cur+1); } catch(e2) {}
    }
  }

  u.customer[field] = el.value;
  u.customer._dirty = true;  // 미저장 변경 표시
  sessionAutoSave();

  // 호수 카드의 저장 버튼 상태 갱신
  updateCustSaveBtnState(u.id);
});

// 호수 카드의 저장 버튼 상태 표시 갱신
function updateCustSaveBtnState(unitId) {
  const u = units.find(x => String(x.id) === String(unitId));
  if (!u) return;
  const statusEl = document.querySelector(`.cust-save-status[data-uid="${unitId}"]`);
  const btnEl = document.querySelector(`.cust-save-btn[data-uid="${unitId}"]`);
  if (!statusEl || !btnEl) return;

  const hasPhone = (u.customer?.phone || '').trim().length >= 9;
  const dirty = u.customer?._dirty;

  if (!hasPhone) {
    btnEl.disabled = true;
    btnEl.classList.add('disabled');
    statusEl.innerHTML = '<span style="color:var(--mu);">전화번호를 입력하세요</span>';
  } else if (dirty) {
    btnEl.disabled = false;
    btnEl.classList.remove('disabled');
    statusEl.innerHTML = '<span style="color:var(--wn);">● 저장 안 됨</span>';
  } else if (u.customer?._savedAt) {
    btnEl.disabled = false;
    btnEl.classList.remove('disabled');
    statusEl.innerHTML = `<span style="color:var(--ac2);">✓ ${u.customer._savedAt} 저장됨</span>`;
  } else {
    btnEl.disabled = false;
    btnEl.classList.remove('disabled');
    statusEl.innerHTML = '';
  }
}

// 호수 카드의 저장 버튼 클릭 (이벤트 위임)
document.addEventListener('click', async e => {
  // ★ 특이사항 삭제 (document 레벨)
  const spDelBtn = e.target.closest('.sp-del');
  if (spDelBtn) {
    e.stopPropagation();
    const uid = +spDelBtn.dataset.uid;
    const sid = +spDelBtn.dataset.sid;
    const u = findU(uid);
    if (u) {
      const _sp = (u.specials || []).find(x => x && x.id === sid);
      if (!_sp) { showToast('특이사항을 찾을 수 없습니다', 'err'); return; }

      /* ★ 2026-08-12: 공유작업(빌려보기)에서 지울 때는 클라우드 사진까지 정리해야 한다.
           안 그러면 화면에서만 사라지고, 다시 열 때 클라우드 사진으로 특이사항이 되살아난다
           (openInWorkTab이 special{N} 역할 사진을 보고 특이사항 칸을 다시 만들기 때문). */
      if (window._borrowedShare && (_sp.photos || []).length) {
        const _mine = _sp.photos.filter(p => p && p._addedByMe);
        const _others = _sp.photos.filter(p => p && !p._addedByMe);
        if (_others.length) {
          showToast('👥 상대가 올린 사진이 들어있어 이 특이사항은 지울 수 없습니다', 'err');
          return;
        }
        (async function () {
          let failed = 0;
          for (const p of _mine) {
            let ok = false;
            try {
              ok = await CloudPhotoSync.deleteBorrowedPhoto(
                window._borrowedShare.ownerUid, window._borrowedShare.workId, p);
            } catch (err) {}
            if (!ok) failed++;
          }
          if (failed) {
            showToast('사진 ' + failed + '장을 서버에서 지우지 못했습니다 - 잠시 후 다시 시도해주세요', 'err');
            return;   // 일부만 지우고 목록에서 빼면 다시 열 때 되살아나므로 중단
          }
          u.specials = u.specials.filter(x => x && x.id !== sid);
          renderAll(); sessionAutoSave();
        })();
        return;
      }

      u.specials = u.specials.filter(x => x && x.id !== sid);
      renderAll(); sessionAutoSave();
    }
    return;
  }

  // ★ 특이사항 사진 삭제 (document 레벨)
  const spPhDel = e.target.closest('.sp-th-del');
  if (spPhDel) {
    e.stopPropagation();
    const uid = +spPhDel.dataset.uid;
    const sid = +spPhDel.dataset.sid;
    const idx = +spPhDel.dataset.idx;
    const u = findU(uid);
    if (u) {
      const s = u.specials.find(s => s.id === sid);
      // ★ 2026-07-11 이중 가드: 공유로 받은 사진은 삭제 불가
      const _sp2 = s && s.photos && s.photos[idx];
      if (_sp2 && (_sp2._borrowedIncoming || (window._borrowedShare && _sp2._cloudUploaded && !_sp2._addedByMe))) {
        showToast('👥 공유 사진은 올린 사람만 삭제할 수 있습니다', 'err');
        return;
      }
      if (_sp2 && window._borrowedShare && _sp2._addedByMe && window.CloudPhotoSync && CloudPhotoSync.deleteBorrowedPhoto) {
        const _bsp = _sp2, _bs = s;
        (async function () {
          let ok = false;
          try { ok = await CloudPhotoSync.deleteBorrowedPhoto(window._borrowedShare.ownerUid, window._borrowedShare.workId, _bsp); } catch (e) {}
          if (ok) {
            const _bi = _bs.photos.indexOf(_bsp);
            if (_bi >= 0) _bs.photos.splice(_bi, 1);
            renderAll(); if (typeof sessionAutoSave === 'function') sessionAutoSave();
          } else if (typeof showToast === 'function') {
            showToast('공유 사진 삭제 실패 — 서버 보안규칙(delete 권한)을 확인하세요', 'err');
          }
        })();
        return;
      }
      if (s) {
        // ★ 즉시 반영(전체 재렌더 없음): 썸네일 노드만 바로 제거, data-photo-id로 식별
        const _spWrap = spPhDel.closest('.th-wrap');
        const _spImg = _spWrap && _spWrap.querySelector('img[data-photo-id]');
        const _spPid = _spImg && _spImg.dataset.photoId ? _spImg.dataset.photoId : null;
        if (_spWrap) _spWrap.remove();
        if (_spPid) {
          const _k = s.photos.findIndex(p => p && String(p.id) === _spPid);
          if (_k >= 0) s.photos.splice(_k, 1);
        } else if (s.photos[idx]) {
          s.photos.splice(idx, 1);
        }
        updateStats(); sessionAutoSave();
      }
    }
    return;
  }

  // ★ 특이사항 추가 (document 레벨)
  const addSpBtn = e.target.closest('.add-sp-btn');
  if (addSpBtn) {
    e.stopPropagation();
    const u = findU(+addSpBtn.dataset.uid);
    if (u) {
      u.specials.push({ id: Date.now(), desc: '', photos: [] });
      renderAll(); sessionAutoSave();
    }
    return;
  }

  // ★ 1) 고객 정보 토글 (접기/펼치기)
  const toggleEl = e.target.closest('.cust-toggle');
  if (toggleEl) {
    e.stopPropagation();
    const uid = toggleEl.dataset.uid;
    const u = units.find(x => String(x.id) === String(uid));
    if (!u) return;
    u.customerOpen = !u.customerOpen;
    // 부분 갱신 (전체 리렌더보다 빠름)
    const sec = toggleEl.closest('.cust-sec');
    if (sec) {
      const content = sec.querySelector('.cust-content');
      const arrow = sec.querySelector('.cust-toggle-arrow');
      if (content) content.style.display = u.customerOpen ? '' : 'none';
      if (arrow) arrow.textContent = u.customerOpen ? '▼' : '▶';
    }
    return;
  }

  // ★ 2) 위 호수와 동일 (직전 호수 복사)
  const copyPrevBtn = e.target.closest('.cust-copy-prev');
  if (copyPrevBtn) {
    e.stopPropagation();
    const uid = copyPrevBtn.dataset.uid;
    const fromId = copyPrevBtn.dataset.from;
    const u = units.find(x => String(x.id) === String(uid));
    const fromU = units.find(x => String(x.id) === String(fromId));
    if (u && fromU && fromU.customer) {
      copyCustomerInfo(u, fromU);
    }
    return;
  }

  // ★ 3) 다른 호수에서 복사 (선택)
  const copyOtherBtn = e.target.closest('.cust-copy-other');
  if (copyOtherBtn) {
    e.stopPropagation();
    const uid = copyOtherBtn.dataset.uid;
    showCopyFromOtherDialog(uid);
    return;
  }

  // ★ 4) 저장 버튼
  const btn = e.target.closest('.cust-save-btn');
  if (!btn) return;
  e.stopPropagation();

  const uid = btn.dataset.uid;
  const u = units.find(x => String(x.id) === String(uid));
  if (!u) return;

  if (!u.customer?.phone || u.customer.phone.replace(/[^\d]/g,'').length < 9) {
    showToast('올바른 전화번호를 입력하세요', 'err');
    return;
  }

  try {
    btn.disabled = true;
    await saveCustomerForUnit(u);
    u.customer._dirty = false;
    const now = new Date();
    u.customer._savedAt = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    updateCustSaveBtnState(uid);
    if (typeof flushCustomersXlsx === 'function') flushCustomersXlsx().catch(()=>{});
  } catch(err) {
    btn.disabled = false;
    console.error('[고객저장 상세]', err);
    console.error('  stack:', err?.stack);
    console.error('  unit:', u?.name, 'phone:', u?.customer?.phone);
    showToast('저장 실패: ' + (err.message || err), 'err');
  }
});

// 고객 정보 복사 (전화번호/주소/메모)
function copyCustomerInfo(targetUnit, fromUnit) {
  if (!targetUnit.customer) targetUnit.customer = { phone:'', address:'', memo:'' };
  targetUnit.customer.phone = fromUnit.customer.phone || '';
  targetUnit.customer.address = fromUnit.customer.address || '';
  targetUnit.customer.memo = fromUnit.customer.memo || '';
  targetUnit.customer._dirty = true;
  delete targetUnit.customer._savedAt;

  // UI에 즉시 반영 - 입력 필드들 업데이트
  const card = document.querySelector(`.cust-toggle[data-uid="${targetUnit.id}"]`)?.closest('.cust-sec');
  if (card) {
    const phoneInp = card.querySelector(`.cust-inp[data-field="phone"]`);
    const addrInp = card.querySelector(`.cust-inp[data-field="address"]`);
    const memoInp = card.querySelector(`.cust-memo[data-field="memo"]`);
    if (phoneInp) phoneInp.value = targetUnit.customer.phone;
    if (addrInp) addrInp.value = targetUnit.customer.address;
    if (memoInp) memoInp.value = targetUnit.customer.memo;
  }

  // 복사 버튼 영역 갱신 (이제 복사 버튼 숨겨야 함)
  // 그리고 토글 라벨도 갱신 필요 → 부분 리렌더
  if (typeof renderAll === 'function') {
    targetUnit.customerOpen = true;  // 펼친 상태 유지
    renderAll();
  }

  if (typeof markDataDirty === 'function') markDataDirty();
  if (typeof sessionAutoSave === 'function') sessionAutoSave();

  showToast(`✓ ${fromUnit.name} 정보 복사됨`, 'ok');
}

// 다른 호수에서 복사 - 선택 다이얼로그
function showCopyFromOtherDialog(uid) {
  const u = units.find(x => String(x.id) === String(uid));
  if (!u) return;

  const candidates = units.filter(other =>
    other.id !== u.id &&
    other.customer?.phone &&
    other.customer.phone.replace(/[^\d]/g, '').length >= 9
  );

  if (candidates.length === 0) {
    showToast('복사할 수 있는 호수가 없습니다', 'err');
    return;
  }

  const html = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1700;display:flex;align-items:center;justify-content:center;padding:16px;" id="copyOtherOverlay">
      <div style="background:var(--sf);border-radius:14px;padding:20px;max-width:480px;width:100%;max-height:80vh;display:flex;flex-direction:column;">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px;">📋 어느 호수에서 복사할까요?</div>
        <div style="font-size:12px;color:var(--mu);margin-bottom:14px;">선택한 호수의 전화번호/주소/메모가 ${escapeHtml(u.name)}에 복사됩니다.</div>
        <div style="overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
          ${candidates.map(c => `
            <button class="btn b-ghost copy-from-btn" data-from="${c.id}" style="width:100%;justify-content:flex-start;text-align:left;padding:12px;">
              <div style="display:flex;flex-direction:column;gap:3px;width:100%;">
                <div style="font-weight:700;color:var(--ac);">🏠 ${escapeHtml(c.name)}</div>
                <div style="font-size:12px;">📞 ${escapeHtml(c.customer.phone)}</div>
                ${c.customer.address ? `<div style="font-size:11px;color:var(--mu);">${escapeHtml(c.customer.address)}</div>` : ''}
              </div>
            </button>
          `).join('')}
        </div>
        <button class="btn b-ghost" id="copyOtherCancel" style="margin-top:14px;">취소</button>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);

  const close = () => document.getElementById('copyOtherOverlay')?.remove();

  document.querySelectorAll('.copy-from-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fromId = btn.dataset.from;
      const fromU = units.find(x => String(x.id) === String(fromId));
      if (fromU) {
        copyCustomerInfo(u, fromU);
      }
      close();
    });
  });

  document.getElementById('copyOtherCancel').addEventListener('click', close);
}

// HTML 이스케이프 (간단 버전)
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 호수의 고객 정보를 customers DB에 저장 (재방문이면 매칭)
async function saveCustomerForUnit(u) {
  if (!u) { console.log('🔴 [고객] u 없음'); return; }

  // ★ 시설 모드면 호수별 customer 저장 안 함 (시설 customer 별도)
  if (currentWorkType === 'facility') {
    console.log(`🟡 [고객] ${u.name} - 시설 모드, 호수별 저장 스킵`);
    return;
  }

  if (!u.customer) u.customer = { phone: '', address: '', memo: '' };

  let phone = (u.customer.phone || '').trim();
  if (!phone) {
    const phoneEl = document.querySelector(`.cust-inp[data-uid="${u.id}"][data-field="phone"]`);
    if (phoneEl) {
      phone = phoneEl.value.trim();
      u.customer.phone = phone;
    }
  }

  if (!phone) {
    console.log(`🟡 [고객] ${u.name} - 전화번호 없음, 스킵`);
    return;
  }

  const norm = normalizePhone(phone);
  const digits = norm.replace(/[^\d]/g, '');
  if (digits.length < 9) {
    console.log(`🟡 [고객] ${u.name} - 짧음 (${digits.length}자리), 스킵: ${phone}`);
    return;
  }

  console.log(`🔵 [고객] ${u.name} 저장 시도: ${norm}`);

  try {
    // customerSave 함수 (폴더 + IndexedDB 자동 저장)
    if (typeof customerSave !== 'function') {
      throw new Error('customerSave 함수 없음 - customer_storage.js 로드 실패?');
    }

    const nameEl = document.querySelector(`.cust-inp[data-uid="${u.id}"][data-field="name"]`);
    const addrEl = document.querySelector(`.cust-inp[data-uid="${u.id}"][data-field="address"]`);
    const memoEl = document.querySelector(`.cust-memo[data-uid="${u.id}"]`);
    const name = (nameEl?.value || u.customer.name || '').trim();
    const address = (addrEl?.value || u.customer.address || '').trim();
    const memo = (memoEl?.value || u.customer.memo || '').trim();

    const apt = document.getElementById('aptName').value || '';
    const date = document.getElementById('workDate').value || kstDateStr();
    const photoCount = u.before.length + u.after.length;

    // 기존 고객 확인 (재방문 토스트용)
    const existing = await customerLookup(norm);

    // ★ workId 보장
    if (typeof ensureWorkId === 'function') ensureWorkId();

    const result = await customerSave({
      phone: norm,
      name: name || undefined,   // 비어 있으면 기존 이름 보존(신규는 호수명 폴백)
      address: address,
      memo: memo,
      visit: {
        workId: currentWorkId || '',
        unitName: u.name,
        _oldUnitName: u._oldUnitName || null,  // ★ 호수명 변경 추적
        date: date,
        apt: apt,
        unit: u.name,
        work: photoCount > 0
          ? `Photos: ${photoCount}${u.specials.length ? `, Notes: ${u.specials.length}` : ''}`
          : (u.specials.length ? `Notes: ${u.specials.length}` : 'In progress')
      }
    });

    // 갱신 완료 후 _oldUnitName 정리
    delete u._oldUnitName;

    console.log(`🟢 [고객] ${u.name} 저장 성공:`, result.phone);

    if (!existing) {
      showToast(`✓ 신규 고객 등록: ${norm}`, 'ok');
    } else if (u._lastShownExisting !== norm) {
      showToast(`🔔 재의뢰 고객! ${existing.name || norm} (${existing.visitCount}회)`, 'ok');
      u._lastShownExisting = norm;

      if (nameEl && !nameEl.value && existing.name) {
        nameEl.value = existing.name;
        u.customer.name = existing.name;
      }
      if (addrEl && !addrEl.value && existing.address) {
        addrEl.value = existing.address;
        u.customer.address = existing.address;
      }
      if (memoEl && !memoEl.value && existing.memo) {
        memoEl.value = existing.memo;
        u.customer.memo = existing.memo;
      }
    }

    return result;
  } catch(err) {
    console.error(`🔴 [고객] ${u.name} 저장 실패:`, err);
    showToast(`고객 저장 실패: ${err.message || err}`, 'err');
    throw err;
  }
}

// 모든 호수의 고객 정보를 customers DB에 저장 (배치)
async function flushAllCustomers() {
  if (typeof units === 'undefined' || !units || units.length === 0) {
    return 0;
  }

  // V2 모드 (1.002+): 메타만 저장 (visits는 _session.json이 진실)
  // 기존 V1 호환을 위해 saveCustomerForUnit 호출은 유지
  let count = 0;
  let failed = 0;
  for (const u of units) {
    const phoneFromMem = (u.customer?.phone || '').trim();
    const phoneEl = document.querySelector(`.cust-inp[data-uid="${u.id}"][data-field="phone"]`);
    const phoneFromDom = phoneEl ? phoneEl.value.trim() : '';
    const phone = phoneFromDom || phoneFromMem;

    if (!phone) continue;

    if (!u.customer) u.customer = { phone: '', address: '', memo: '' };
    if (phoneFromDom) u.customer.phone = phoneFromDom;

    try {
      await saveCustomerForUnit(u);
      if (u.customer) {
        u.customer._dirty = false;
        const now = new Date();
        u.customer._savedAt = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      }
      if (typeof updateCustSaveBtnState === 'function') updateCustSaveBtnState(u.id);
      count++;
    } catch(e) {
      console.error(`  ❌ ${u.name}:`, e);
      failed++;
    }
  }

  // V2: 캐시 무효화 (다음 조회 시 _session.json 다시 스캔)
  if (typeof invalidateCustomersCache === 'function') {
    invalidateCustomersCache();
  }

  console.log(`🟢 [flush] 완료 - 성공 ${count}, 실패 ${failed}`);
  return count;
}

// 페이지 종료 시 저장
// 페이지 종료/숨김 시: 변경 있을 때만 저장 (빠르게)
function onPageEnd() {
  // 변경 없으면 스킵 (빠르게 종료)
  if (typeof _dataDirty !== 'undefined' && !_dataDirty) {
    return;
  }
  // 변경 있을 때만 customer 정보 저장 시도 (비동기, 결과 안 기다림)
  flushAllCustomers().then(() => {
    if (typeof flushCustomersXlsx === 'function') return flushCustomersXlsx();
  }).catch(()=>{});
}

window.addEventListener('pagehide', onPageEnd);
window.addEventListener('beforeunload', onPageEnd);

/* ═══════════════════════════════════════════════
   작업 유형 (workType) 헬퍼 함수
═══════════════════════════════════════════════ */

// UI에 workType 적용
function applyWorkTypeUI() {
  const facilitySec = document.getElementById('facilityCustSec');
  const newName = document.getElementById('newName');
  const btnAdd = document.getElementById('btnAdd');
  const btnBulk = document.getElementById('btnBulk');

  if (currentWorkType === 'facility') {
    if (facilitySec) facilitySec.style.display = '';
    // 시설 모드: 항상 추가 가능
    if (newName) {
      newName.disabled = false;
      newName.placeholder = '영역 추가 (예: 1웨이 1호, 작은 도서관)';
    }
    if (btnAdd) btnAdd.disabled = false;
    if (btnBulk) btnBulk.disabled = false;
  } else {
    if (facilitySec) facilitySec.style.display = 'none';
    // ★ 가정용 모드: 1호수 이상이면 추가 비활성화
    const lock = (units && units.length >= 1);
    if (newName) {
      newName.disabled = lock;
      newName.placeholder = lock
        ? '가정용은 1호수만 (모드 변경 가능)'
        : '호수 추가 (예: 101동 201호)';
    }
    if (btnAdd) btnAdd.disabled = lock;
    if (btnBulk) btnBulk.disabled = lock;
  }

  // 라디오 동기화
  const r = document.getElementById(currentWorkType === 'facility' ? 'workTypeFacility' : 'workTypeHousehold');
  if (r) r.checked = true;

  // 시설 고객 정보 input 동기화
  const phoneEl = document.getElementById('facilityPhone');
  const contactEl = document.getElementById('facilityContact');
  const addrEl = document.getElementById('facilityAddress');
  const memoEl = document.getElementById('facilityMemo');
  const wtEl = document.getElementById('facilityWorkTarget');
  const priceEl = document.getElementById('facilityPrice');
  const stEl = document.getElementById('facilityStartTime');
  const etEl = document.getElementById('facilityEndTime');
  if (phoneEl) phoneEl.value = facilityCustomer.phone || '';
  if (contactEl) contactEl.value = facilityCustomer.contact || '';
  if (addrEl) addrEl.value = facilityCustomer.address || '';
  if (memoEl) memoEl.value = facilityCustomer.memo || '';
  if (wtEl) wtEl.value = facilityCustomer.workTarget || '';
  if (priceEl) priceEl.value = facilityCustomer.price || '';
  if (stEl) stEl.value = facilityCustomer.startTime || '';
  if (etEl) etEl.value = facilityCustomer.endTime || '';
}

// workType 초기화
function resetWorkType() {
  currentWorkType = 'household';
  facilityCustomer = { phone: '', contact: '', address: '', memo: '' };
  applyWorkTypeUI();
}

// ★ 가정용 1호수 제한 안내 다이얼로그
function showHouseholdLimitDialog() {
  const html = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1700;display:flex;align-items:center;justify-content:center;padding:16px;" id="houseLimitOverlay">
      <div style="background:var(--sf);border-radius:14px;padding:20px;max-width:420px;width:100%;">
        <div style="font-size:16px;font-weight:800;margin-bottom:6px;">🏠 가정용은 1호수만 가능합니다</div>
        <div style="font-size:12px;color:var(--mu);margin-bottom:14px;line-height:1.6;">
          여러 호수가 필요한 경우:<br>
          • 다른 가정 작업이면 → <b>새 작업</b>으로 분리<br>
          • 한 고객의 여러 영역이면 → <b>공용시설 모드</b>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn b-orange" id="hlNewWork" style="width:100%;justify-content:center;">🆕 새 작업 만들기</button>
          <button class="btn b-blue" id="hlChangeMode" style="width:100%;justify-content:center;">🏢 공용시설 모드로 변경</button>
          <button class="btn b-ghost" id="hlCancel" style="width:100%;justify-content:center;">취소</button>
        </div>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);

  const close = () => document.getElementById('houseLimitOverlay')?.remove();

  document.getElementById('hlNewWork').addEventListener('click', () => {
    close();
    if (typeof newWork === 'function') newWork();
  });

  document.getElementById('hlChangeMode').addEventListener('click', () => {
    close();
    currentWorkType = 'facility';
    if (typeof applyWorkTypeUI === 'function') applyWorkTypeUI();
    renderAll();
    sessionAutoSave();
    showToast('🏢 공용시설 모드로 변경됨', 'ok');
  });

  document.getElementById('hlCancel').addEventListener('click', close);
}

// 페이지 로드 시 UI 적용
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(applyWorkTypeUI, 100);
});


function initInlineReorder() {
  if (window.__inlineReorderInited) return;
  window.__inlineReorderInited = true;

  var D = null;   // 드래그 상태 { wrap, container, arr, u, card, kind }

  // ★ 유령 사진(고스트) 멈춤 방지 — 강제 정리 / 커밋없는 취소 / 멈춘 드래그 워치독
  var _riWatchdog = null;
  function _riClearWatchdog() { if (_riWatchdog) { clearTimeout(_riWatchdog); _riWatchdog = null; } }
  function _riArmWatchdog() { _riClearWatchdog(); _riWatchdog = setTimeout(function () { console.warn('[인라인순서] 워치독: 멈춘 드래그 자동 정리'); cancelDrag(); }, 6000); }
  function hardCleanup() {   // 떠 있는 고스트/드래그 흔적을 전부 제거하고 상태 리셋
    _riClearWatchdog();
    try { var gs = document.querySelectorAll('.ri-ghost'); for (var i = 0; i < gs.length; i++) { if (gs[i].parentNode) gs[i].parentNode.removeChild(gs[i]); } } catch (e) {}
    try { var ds = document.querySelectorAll('.th-wrap.ri-drag'); for (var j = 0; j < ds.length; j++) { ds[j].classList.remove('ri-drag'); } } catch (e) {}
    try { var cs = document.querySelectorAll('.ri-active-card'); for (var k = 0; k < cs.length; k++) { cs[k].classList.remove('ri-active-card'); } } catch (e) {}
    D = null;
    window.__riDragging = false;
  }
  function cancelDrag() {   // 커밋 없이 취소 → 데이터 기준으로 화면 복구(진행중 이동 폐기)
    var had = !!D || !!document.querySelector('.ri-ghost');
    hardCleanup();
    if (had && typeof renderAll === 'function') { try { renderAll(); } catch (e) {} }
  }

  // wrap이 속한 배열/칸/종류 파악. kind: 'before' | 'after' | 'special'
  function ctxOf(wrap) {
    var container = wrap.parentElement;
    if (!container || !(container.classList.contains('thumbs') || container.classList.contains('sp-photos'))) return null;
    var card = wrap.closest('.u-card');
    if (!card) return null;
    var uid = parseInt(String(card.id).replace('card-', ''), 10);
    var u = (typeof findU === 'function') ? findU(uid) : null;
    if (!u) return null;
    var arr = null, kind = null;
    var spItem = wrap.closest('.sp-item');
    if (spItem) {
      var sid = parseInt(spItem.dataset.sid, 10);
      var sp = (u.specials || []).find(function (x) { return x.id === sid; });
      arr = sp && sp.photos; kind = 'special';
    } else if (wrap.closest('.pane-b')) { arr = u.before; kind = 'before'; }
    else if (wrap.closest('.pane-a')) { arr = u.after; kind = 'after'; }
    if (!arr) return null;
    return { u: u, arr: arr, container: container, card: card, kind: kind };
  }

  // 손가락을 따라다니는 고스트(모달과 동일한 느낌) ─ 실제 썸네일 이미지를 복제해 떠다니게 함
  function makeGhost(wrap, x, y) {
    var img = wrap.querySelector('img');
    var r = wrap.getBoundingClientRect();
    var g = document.createElement('div');
    g.className = 'ri-ghost';
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    if (img && img.src) { var im = new Image(); im.src = img.src; g.appendChild(im); }
    document.body.appendChild(g);
    D.ghost = g; D.gw = r.width; D.gh = r.height;
    positionGhost(x, y);
  }
  function positionGhost(x, y) {
    if (!D || !D.ghost) return;
    D.ghost.style.transform = 'translate(' + (x - D.gw / 2) + 'px,' + (y - D.gh / 2) + 'px)';
  }
  function removeGhost() {
    if (D && D.ghost && D.ghost.parentNode) D.ghost.parentNode.removeChild(D.ghost);
    if (D) D.ghost = null;
  }

  function start(handle, x, y) {
    // 2026-08-13: 공유 열람 중에도 순서 변경 허용 (순서는 원작업자 문서의 photoOrder 로 전달)
    hardCleanup();                                // ★ 이전 드래그 유령/흔적 강제 정리(재진입 방지)
    var wrap = handle.closest('.th-wrap');
    if (!wrap) return false;
    var ctx = ctxOf(wrap);
    if (!ctx) return false;
    D = { wrap: wrap, container: ctx.container, arr: ctx.arr, u: ctx.u, card: ctx.card, kind: ctx.kind, ghost: null };
    wrap.classList.add('ri-drag');
    ctx.card.classList.add('ri-active-card');
    makeGhost(wrap, x, y);
    window.__riDragging = true;
    _riArmWatchdog();                             // ★ 멈춘 드래그 감시 시작
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
    return true;
  }

  // 드롭 가능한 칸인가? 특이사항은 자기 칸만, 작업 전/후는 같은 카드의 전·후 칸 모두 허용
  function validTarget(cont) {
    if (!cont) return false;
    if (D.kind === 'special') return cont === D.container;
    return cont.classList.contains('thumbs') && cont.closest('.u-card') === D.card;
  }

  // 손가락이 놓인 칸(컨테이너) 판단. 썸네일 밖(첫 칸 위 등)도 소스 컨테이너로 폴백
  function _riContainerAt(x, y) {
    var el = document.elementFromPoint(x, y);
    var c = el ? el.closest('.thumbs, .sp-photos') : null;
    if (c && validTarget(c)) return c;
    if (D.kind !== 'special' && el) {                 // 같은 카드의 반대편 pane 위(빈 영역)면 그 pane thumbs
      var paneEl = el.closest('.pane');
      if (paneEl && paneEl.closest('.u-card') === D.card) {
        var tc = paneEl.querySelector('.thumbs');
        if (tc && validTarget(tc)) return tc;
      }
    }
    var cr = D.card.getBoundingClientRect();           // 소스 카드 범위 안이면 소스 컨테이너로
    if (x >= cr.left - 24 && x <= cr.right + 24 && y >= cr.top - 80 && y <= cr.bottom + 80) return D.container;
    return null;
  }
  // 손가락 위치로 삽입 기준 칸 결정(그리드 읽기순서: 윗줄 우선, 같은 줄은 왼쪽 우선). null이면 맨 끝
  function _riInsertRef(cont, x, y) {
    var kids = cont.querySelectorAll('.th-wrap');
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k === D.wrap) continue;
      var r = k.getBoundingClientRect();
      if (y < r.top) return k;                                  // 이 칸보다 윗줄 → 그 앞
      if (y <= r.bottom && x < r.left + r.width / 2) return k;  // 같은 줄 & 왼쪽 절반 → 그 앞
    }
    return null;                                                // 맨 끝
  }
  function moveTo(x, y) {
    if (!D) return;
    _riArmWatchdog();                          // ★ 움직임이 있으면 워치독 갱신
    positionGhost(x, y);                       // 고스트가 손가락을 따라옴
    var cont = _riContainerAt(x, y);
    if (!cont) return;
    var ref = _riInsertRef(cont, x, y);
    if (ref === D.wrap) return;
    if (ref) {
      if (D.wrap.parentElement === cont && D.wrap.nextElementSibling === ref) return;  // 이미 그 위치
      cont.insertBefore(D.wrap, ref);
    } else {
      if (cont.lastElementChild === D.wrap) return;
      cont.appendChild(D.wrap);
    }
  }

  function idsOf(cont) {
    return Array.prototype.slice.call(cont.querySelectorAll('.th-wrap img[data-photo-id]'))
      .map(function (i) { return i.dataset.photoId; });
  }
  function markResave(list) { list.forEach(function (pp) { if (pp && !pp._borrowedIncoming) pp.savedToFolder = false; }); }
  function afterCommit() {
    // ★ 순서변경(공유 사진 포함)도 '변경'으로 표시 → 저장 시 "이미 저장됨"으로 스킵되지 않게 함
    try { if (typeof markDataDirty === 'function') markDataDirty(); } catch (e) {}
    if (typeof renderAll === 'function') renderAll();
    if (typeof updateStats === 'function') updateStats();
    if (typeof sessionAutoSaveNow === 'function') { try { sessionAutoSaveNow(); } catch (e) {} }
    try {
      var _bo = window._borrowedShare;
      if (_bo && _bo.ownerUid && _bo.workId && window.CloudPhotoSync && CloudPhotoSync.pushPhotoOrder) {
        CloudPhotoSync.pushPhotoOrder(_bo.workId, units, _bo.ownerUid);   // 공유작업 → 원작업자 문서에
        // 전↔후·호수 이동은 순서가 아니라 사진 문서의 role/unitName → 따로 반영
        if (CloudPhotoSync.pushBorrowedPlacement) CloudPhotoSync.pushBorrowedPlacement(_bo.workId, units, _bo.ownerUid);
      } else if (typeof currentFolderName !== 'undefined' && currentFolderName
          && window.CloudPhotoSync && CloudPhotoSync.pushPhotoOrder) {
        CloudPhotoSync.pushPhotoOrder(currentFolderName, units, null, true);   // 내가 직접 정한 순서
      /* ⭐ 2026-08-13: 내 사진을 작업 전↔후(또는 다른 호수)로 옮기면 클라우드 이름 자체가 바뀐다
         (내 사진의 이름은 호수__전후__파일명 형태라 전/후가 이름에 박혀 있다).
         그래서 순서표(photoOrder)만 보내서는 상대에게 전달되지 않고, '저장'을 해야 비로소
         새 이름으로 다시 올라가고 옛 문서가 정리됐다 → 상대 쪽에서 실시간 반영이 안 됐다.
         → 옮긴 직후에 사진 동기화를 한 번 돌려 준다(로컬 파일은 건드리지 않는다).
         이미 올라간 것은 건너뛰므로 비용은 바뀐 사진 몇 장뿐이다. */
        if (CloudPhotoSync.autoUploadPhotos) {
          try { CloudPhotoSync.autoUploadPhotos(currentFolderName, units, { silent: true }); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // 특이사항: 같은 칸 내 순서만
  function commitSingle() {
    var arr = D.arr, order = idsOf(D.container);
    arr.sort(function (a, b) {
      var ia = order.indexOf(String(a && a.id)); var ib = order.indexOf(String(b && b.id));
      return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
    });
    markResave(arr);
    afterCommit();
    if (typeof showToast === 'function') showToast('✓ 순서 변경 완료', 'ok');
  }

  // 작업 전/후: 순서 + 전↔후 이동 반영 (DOM에서 양쪽 칸 재구성)
  function commitBeforeAfter() {
    var u = D.u;
    // 드래그된 사진의 id
    var img0 = D.wrap.querySelector('img[data-photo-id]');
    var pid = img0 && img0.dataset.photoId;
    if (!pid) { afterCommit(); return; }
    // 목적지 칸: 현재 D.wrap이 물리적으로 들어가 있는 pane 으로 판단
    var cont = D.wrap.parentElement;
    var toAfter  = !!(cont && cont.closest('.pane-a'));
    var toBefore = !!(cont && cont.closest('.pane-b'));
    if (!toAfter && !toBefore) { afterCommit(); return; }   // 알 수 없음 → 데이터 그대로 재렌더
    // 목적지 칸 안에서 D.wrap의 위치(삽입 인덱스)
    var kids = Array.prototype.slice.call(cont.querySelectorAll('.th-wrap'));
    var targetIdx = kids.indexOf(D.wrap);
    if (targetIdx < 0) targetIdx = kids.length;

    // ★ 결정적 이동: 원본 배열(before/after 어느쪽이든)에서 그 사진을 '빼고' 목적지에 '넣는다' → 양쪽 중복 불가
    function pull(arr) {
      if (!arr) return null;
      for (var i = 0; i < arr.length; i++) { if (arr[i] && String(arr[i].id) === String(pid)) return arr.splice(i, 1)[0]; }
      return null;
    }
    u.before = u.before || []; u.after = u.after || [];
    var photo = pull(u.before); var fromBefore = !!photo;
    if (!photo) { photo = pull(u.after); }
    if (!photo) { afterCommit(); return; }   // 못 찾음 → 재렌더

    var crossing = (fromBefore && toAfter) || (!fromBefore && toBefore);
    // 상대가 보탠 사진은 전↔후 이동 금지(순서만) → 원위치 복원
    if (crossing && !window.canMovePhotoSide(photo)) {
      if (fromBefore) u.before.push(photo); else u.after.push(photo);
      if (typeof showToast === 'function') showToast('상대가 보탠 사진은 작업 전↔후 이동을 할 수 없어요 (순서만 변경 가능)', 'err');
      afterCommit(); return;
    }
    var dest = toAfter ? u.after : u.before;
    if (targetIdx > dest.length) targetIdx = dest.length;
    dest.splice(targetIdx, 0, photo);
    if (crossing && !photo._borrowedIncoming) photo.savedToFolder = false;   // 새 위치에 다시 저장
    markResave(u.before); markResave(u.after);
    afterCommit();
    if (typeof showToast === 'function') showToast(crossing ? '✓ 사진 이동 완료' : '✓ 순서 변경 완료', 'ok');
  }

  function end() {
    _riClearWatchdog();
    window.__riDragging = false;
    if (!D) return;
    removeGhost();
    D.wrap.classList.remove('ri-drag');
    if (D.card) D.card.classList.remove('ri-active-card');
    try { if (D.kind === 'special') commitSingle(); else commitBeforeAfter(); }
    catch (err) { console.warn('[인라인순서] 커밋 실패', err && err.message); }
    D = null;
  }

  // ── 터치: 핸들(.th-drag)에서만 시작. 핸들은 CSS touch-action:none 이라 스크롤에 안 뺏김 ──
  document.addEventListener('touchstart', function (e) {
    var tg = e.target;
    var h = tg && tg.closest && tg.closest('.th-drag');
    if (!h) return;
    var t0 = e.touches && e.touches[0];
    start(h, t0 ? t0.clientX : 0, t0 ? t0.clientY : 0);
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!D) return;
    e.preventDefault();                       // 드래그 중 페이지 스크롤 차단
    var t = e.touches && e.touches[0];
    if (t) moveTo(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });

  // ── 마우스(데스크톱) ──
  document.addEventListener('mousedown', function (e) {
    var h = e.target && e.target.closest && e.target.closest('.th-drag');
    if (!h) return;
    e.preventDefault();
    start(h, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', function (e) { if (D) moveTo(e.clientX, e.clientY); });
  document.addEventListener('mouseup', end);

  // ★ 유실 대비 안전 정리: 터치 취소·앱 이탈/복귀·창 blur 시 멈춘 드래그를 되돌림
  document.addEventListener('pointercancel', function () { if (D || document.querySelector('.ri-ghost')) cancelDrag(); });
  window.addEventListener('blur', function () { if (D || document.querySelector('.ri-ghost')) cancelDrag(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && (D || document.querySelector('.ri-ghost'))) cancelDrag(); });
}
initInlineReorder();

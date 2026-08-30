/* ═══════════════════════════════════════════════
   tabbar.js — 하단 탭 네비게이션
   작업 / 기록 / 보고서 / 설정
   기존 모달(customerModal, settingsModal, pvModal)을
   탭 패널로 연결한다. (모달 코드 재활용)
═══════════════════════════════════════════════ */
(function () {
  'use strict';

  // 열려있는 모든 패널(모달) 닫기
  function closeAllPanels() {
    try { if (typeof closeCustomerModal === 'function') closeCustomerModal(); } catch (e) {}
    try { if (typeof closeSettings === 'function') closeSettings(); } catch (e) {}
    try { document.getElementById('pvModal')?.classList.remove('open'); } catch (e) {}
    try { document.getElementById('chatTabModal')?.classList.remove('open'); } catch (e) {}
  }

  // 탭 활성 표시
  function setActive(name) {
    document.querySelectorAll('.tab-item').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
  }

  // 현재 작업에 호수가 있는지
  function hasUnits() {
    try {
      return (typeof units !== 'undefined') && Array.isArray(units) && units.length > 0;
    } catch (e) { return false; }
  }

  function switchTab(name) {
    if (name === 'work') {
      closeAllPanels();
      setActive('work');
      return;
    }
    if (name === 'records') {
      closeAllPanels();
      if (typeof openCustomerModal === 'function') openCustomerModal();
      setActive('records');
      return;
    }
    if (name === 'chat') {
      closeAllPanels();
      var cm = document.getElementById('chatTabModal');
      if (cm) cm.classList.add('open');
      if (window.CloudChat && typeof CloudChat.openTab === 'function') CloudChat.openTab();
      setActive('chat');
      return;
    }
    if (name === 'report') {
      if (!hasUnits()) {
        if (typeof showToast === 'function') showToast('먼저 작업(호수)을 추가해주세요', 'err');
        setActive('work');
        return;
      }
      closeAllPanels();
      if (typeof buildAndPreview === 'function') buildAndPreview();
      setActive('report');
      return;
    }
    if (name === 'settings') {
      closeAllPanels();
      if (typeof openSettings === 'function') openSettings();
      setActive('settings');
      return;
    }
  }
  window.switchTab = switchTab;

  // FAB 새작업 버튼 표시/숨김
  function updateFab(tabName) {
    const fab = document.getElementById('fabNewWork');
    if (fab) fab.classList.toggle('visible', tabName === 'records');
    const fabW = document.getElementById('fabWriteWork');
    if (fabW) fabW.classList.toggle('visible', tabName === 'work');
  }

  function bindFab() {
    const fab = document.getElementById('fabNewWork');
    if (!fab) return;
    fab.addEventListener('click', () => {
      /* ⭐ 2026-08-22 달력을 펼친(전체화면 목록) 동안 이 버튼은 '＋'가 아니라 '▲ 달력으로'다.
         겉모습은 calendar.js _syncFab 가, 동작은 여기가 담당한다.
         접혀 있으면 __calCollapse() 가 false 를 돌려주므로 평소 흐름은 그대로다. */
      try { if (window.__calCollapse && window.__calCollapse()) return; } catch (e) {}
      const presetDate = window._calSelectedDate || null;
      // ★ 추가 메뉴(작업 추가 / 일정 추가) - calendar.js 제공
      if (typeof window.openCalendarAddMenu === 'function') {
        window.openCalendarAddMenu(presetDate);
        return;
      }
      // 폴백: 기록 모달 닫고 새 작업 시작
      try { if (typeof closeCustomerModal === 'function') closeCustomerModal(); } catch(e) {}
      if (typeof newWork === 'function') {
        newWork(presetDate);
      } else {
        const btnNew = document.getElementById('btnNew');
        if (btnNew) btnNew.click();
      }
    });
    const fabW = document.getElementById('fabWriteWork');
    if (fabW) fabW.addEventListener('click', () => {
      if (typeof window.openWriteMenu === 'function') window.openWriteMenu();
      else if (typeof showToast === 'function') showToast('글작성 모듈 로드 안됨','err');
    });
  }

  function bindTabbar() {
    // 탭 버튼
    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const target = btn.dataset.tab;
        // ★ 작업탭을 벗어날 때만 저장/삭제 가드 실행 (취소면 이동 중단)
        if (target !== 'work' && typeof window.guardLeaveWorkTab === 'function') {
          let proceed = true;
          try { proceed = await window.guardLeaveWorkTab(target); }
          catch (e) { proceed = true; }  // 가드 오류 시 이동 막지 않음
          if (!proceed) return;
        }
        switchTab(target);
      });
    });

    // FAB 버튼 바인딩
    bindFab();

    // ★ 모달 상태를 직접 감시해 탭을 동기화
    //   (어떤 함수가 모달을 열든/닫든 - 작업 불러오기 포함 - 탭이 항상 따라옴)
    const co = document.getElementById('customerModal');
    const se = document.getElementById('settingsModal');
    const pv = document.getElementById('pvModal');
    const ch = document.getElementById('chatTabModal');
    const isOpen = el => el && el.classList.contains('open');
    function syncTabs() {
      let active;
      if (isOpen(co)) active = 'records';
      else if (isOpen(ch)) active = 'chat';
      else if (isOpen(pv)) active = 'report';
      else if (isOpen(se)) active = 'settings';
      else active = 'work';
      setActive(active);
      updateFab(active);
    }
    const mo = new MutationObserver(syncTabs);
    [co, se, pv, ch].forEach(el => {
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    syncTabs(); // 초기 동기화
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTabbar);
  } else {
    bindTabbar();
  }
})();

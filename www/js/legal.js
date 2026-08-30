/* ═══════════════════════════════════════════════
   LEGAL ─ 이용약관 / 개인정보 처리방침 (설정 하단)
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  var APP = '현장 매니저';
  function contact() { return 'bsc500327@gmail.com'; }
  /* ★ 2026-08-23 계정 삭제 안내 페이지 (Play 정책상 '웹에서 삭제 요청' 경로가 필수).
       site/delete.html 을 호스팅에 배포한 주소 — 아래 INTRO_URL 과 같은 사이트다.
       ⚠️ PRIVACY 문자열이 이 변수를 쓰므로, 반드시 PRIVACY 위에 있어야 한다. */
  var DELETE_URL = 'https://work-report-826ec.web.app/delete.html';

  var TERMS =
    '<h3>제1조 (목적)</h3>' +
    '본 약관은 ‘' + APP + '’(이하 “앱”)의 이용 조건 및 절차, 이용자와 운영자의 권리·의무를 규정합니다.' +
    '<h3>제2조 (서비스 내용)</h3>' +
    '앱은 현장 작업 사진 촬영·보고서 생성, 일정 관리, 견적서·거래명세서 작성, 일정 공유 및 채팅 등의 기능을 제공합니다. 일부 기능(AI 분석·클라우드 공유 등)은 유료 구독 또는 별도 조건이 적용될 수 있습니다.' +
    '<h3>제3조 (계정)</h3>' +
    '클라우드 공유·채팅 등 일부 기능은 이메일 기반 로그인이 필요합니다. 이용자는 계정 정보를 스스로 관리할 책임이 있습니다.' +
    '<h3>제4조 (요금 및 구독)</h3>' +
    '유료 구독의 요금·제공 범위는 앱 내 안내에 따릅니다. 결제·환불은 관련 법령 및 앱 마켓(구글 플레이 등)의 정책을 따릅니다.' +
    '<h3>제5조 (이용자의 의무)</h3>' +
    '이용자는 타인의 권리를 침해하거나 법령을 위반하는 목적으로 앱을 사용해서는 안 됩니다. 촬영·저장·공유하는 사진 및 고객정보에 대한 수집·이용 동의 확보 책임은 이용자에게 있습니다.' +
    '<h3>제6조 (데이터 보관)</h3>' +
    '작업 사진·보고서 등 대부분의 데이터는 이용자 기기에 저장됩니다. 로그인·공유 사용 시 일부 데이터가 클라우드(Firebase)에 저장될 수 있습니다. 기기 분실·초기화 시 데이터가 손실될 수 있으므로 주기적 백업을 권장합니다.' +
    '<h3>제7조 (면책)</h3>' +
    '운영자는 천재지변, 기기 오류, 이용자 부주의, 제3자 서비스(클라우드·AI 등) 장애로 인한 데이터 손실·손해에 대해 책임을 지지 않습니다. 앱은 “있는 그대로” 제공됩니다.' +
    '<h3>제8조 (약관 변경)</h3>' +
    '운영자는 필요 시 약관을 변경할 수 있으며, 변경 시 앱 내 공지합니다.' +
    '<h3>제9조 (문의)</h3>' +
    '문의: ' + contact() + '<br><br><span style="color:var(--mu);font-size:11px;">시행일: 2026-07-14</span>';

  var PRIVACY =
    '<div style="font-size:11px;color:var(--mu);line-height:1.6;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--bd,#333);">' +
      '상호: 미래솔루션 · 대표: 배성철<br>' +
      '사업자등록번호: 333-06-03651 · 통신판매업신고번호: 제2026-경기평택-0535호<br>' +
      '소재지: 경기도 평택시 동삭1로22번길 40, 305동 1103호(동삭동, 더샵 지제역 센트럴파크3BL아파트)' +
    '</div>' +
    '<h3>1. 수집하는 정보</h3>' +
    '· 계정: 이메일, 닉네임(로그인 시)<br>· 작업 데이터: 현장명·고객명·주소·전화번호·가격·작업 사진 등 이용자가 입력·촬영한 정보<br>· 문서 작성 시: 고객 사업자등록증 이미지에서 추출한 상호·등록번호·대표자·주소 등(이용자가 촬영·입력)<br>· 기기/이용 정보: 앱 동작에 필요한 최소한의 저장소 데이터' +
    '<h3>2. 저장 위치</h3>' +
    '대부분의 데이터(사진·보고서·고객정보)는 <b>이용자 기기 내부</b>에 저장됩니다. 로그인·일정공유·채팅을 사용할 경우 해당 데이터는 Google Firebase(클라우드)에 저장·전송됩니다.' +
    '<h3>3. 이용 목적</h3>' +
    '보고서·견적서·거래명세서 생성, 일정 관리, 이용자 간 일정·사진 공유 및 채팅, 서비스 개선을 위해 사용합니다.' +
    '<h3>4. AI 처리</h3>' +
    '문자·사진·사업자등록증 분석 등 AI 기능 사용 시, 해당 이미지·텍스트는 분석을 위해 AI 처리 서버(Anthropic Claude)로 전송될 수 있습니다. 분석 결과는 이용자 기기에 저장되며, 학습 기능은 설정에서 끌 수 있습니다.' +
    '<h3>5. 제3자 제공</h3>' +
    '이용자가 ‘일정 공유’로 지정한 상대에게는 공유된 일정·사진·채팅 내용이 제공됩니다. 그 외에는 법령에 의한 경우를 제외하고 제3자에게 제공하지 않습니다.' +
    '<h3>6. 보관 및 파기</h3>' +
    '기기 내 데이터는 이용자가 직접 삭제할 수 있습니다(앱 삭제 또는 저장 폴더 삭제).<br>' +
    '<b>계정 삭제</b>를 요청하면 클라우드에 저장된 다음 항목이 <b>모두 삭제</b>됩니다 — 계정(로그인 정보), 일정·작업·사진·저장한 글, 1:1 채팅 대화와 첨부파일(대화방째 삭제), 서버 백업, AI 학습기록, 일정 공유 관계, 팀 참여 정보(남은 사람이 없으면 팀도 삭제).<br>' +
    '팀 단체 채팅에서는 본인이 보낸 메시지와 첨부파일만 삭제하고 방에서 나갑니다(남은 이용자의 대화는 보존).<br>' +
    '구독 해지 후 미구독 상태가 6개월 지속되면 클라우드 데이터가 정리될 수 있습니다(삭제 30일 전 안내). 채팅 첨부파일은 업로드 후 일정 기간이 지나면 자동 삭제됩니다. 법령상 보존이 필요한 거래·결제 기록은 관련 법에서 정한 기간 동안 보관될 수 있습니다.' +
    '<h3>7. 이용자 권리</h3>' +
    '이용자는 본인 데이터의 열람·수정·삭제를 요청할 수 있습니다.<br>' +
    '· 앱에서: <b>설정 ▸ 기본 정보 ▸ 로그인 ▸ 🗑 계정·데이터 삭제</b><br>' +
    '· 앱을 삭제하셨다면: <a href="' + DELETE_URL + '" target="_blank" rel="noopener" onclick="if(window.openDeleteGuide){openDeleteGuide();return false;}" style="color:var(--ac);">계정 삭제 안내 페이지</a> 또는 아래 연락처로 요청하세요.' +
    '<h3>8. 광고</h3>' +
    '앱은 이용자 데이터를 광고 목적으로 판매하지 않습니다.' +
    '<h3>9. 문의</h3>' +
    '개인정보 관련 문의: ' + contact() + '<br><br><span style="color:var(--mu);font-size:11px;">시행일: 2026-08-30</span>';

  function openDoc(title, html) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:2600;display:flex;align-items:flex-start;justify-content:center;padding:28px 12px;overflow-y:auto;';
    ov.innerHTML = '<div style="background:var(--sf);border-radius:14px;padding:20px;max-width:520px;width:100%;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<div style="font-size:16px;font-weight:800;">' + title + '</div>' +
        '<button class="btn b-ghost b-xs" id="lgClose">✕</button></div>' +
      '<div class="legal-body" style="font-size:13px;line-height:1.7;color:var(--tx);">' + html + '</div>' +
      '<button class="btn b-blue" id="lgOk" style="width:100%;justify-content:center;margin-top:14px;">확인</button></div>';
    document.body.appendChild(ov);
    var st = document.createElement('style');
    st.textContent = '.legal-body h3{font-size:13px;font-weight:800;margin:14px 0 4px;color:var(--ac);}';
    ov.appendChild(st);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#lgClose').onclick = close;
    ov.querySelector('#lgOk').onclick = close;
  }
  window.openTerms = function () { openDoc('📄 이용약관', TERMS); };
  window.openPrivacy = function () { openDoc('🔒 개인정보 처리방침', PRIVACY); };

  /* ═══════════════════════════════════════════════
     현장매니저 소개 (2026-08-12)
       · 앱 안에서는 번들된 intro.html 을 전체화면으로 띄운다(오프라인 OK)
       · 지인에게 보낼 때는 웹에 배포한 같은 페이지 주소를 공유한다
     ⚠️ Firebase 호스팅 배포 후 아래 INTRO_URL 한 줄만 실제 주소로 바꾸면 됩니다.
        (비워두면 공유 시 Play 스토어 주소만 보냅니다)
  ═══════════════════════════════════════════════ */
  var INTRO_URL = 'https://work-report-826ec.web.app';   // site/ 폴더를 호스팅에 배포한 주소
  var PLAY_URL  = 'https://play.google.com/store/apps/details?id=com.baesungchul.workreport';
  /* ★ 2026-08-17 사용자 오픈채팅방 (카카오톡).
       방을 옮기게 되면 이 한 줄만 바꾸면 된다. 비워두면 설정에서 버튼이 사라진다. */
  var OPENCHAT_URL = 'https://open.kakao.com/o/gQszlnJi';

  // 외부 링크는 앱 내부 웹뷰가 아니라 시스템 브라우저/스토어로 보낸다
  function openExternal(url) {
    try {
      if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) {
        Capacitor.Plugins.Browser.open({ url: url });
        return;
      }
    } catch (e) {}
    try { window.open(url, '_system'); } catch (e) { window.open(url, '_blank'); }
  }

  /* 카카오톡 오픈채팅방 열기 — 앱 내부 웹뷰가 아니라 카카오톡/브라우저로 넘긴다 */
  window.openChatRoom = function () {
    if (!OPENCHAT_URL) {
      if (typeof showToast === 'function') showToast('오픈채팅방 주소가 설정되지 않았습니다', 'err');
      return;
    }
    openExternal(OPENCHAT_URL);
  };
  window.hasChatRoom = function () { return !!OPENCHAT_URL; };

  /* ★ 2026-08-27 Play 리뷰 화면 열기 — 설정의 '리뷰 남기기' 전용.
       ⚠️ 인앱 리뷰 API(js/review.js)를 버튼으로 부르면 안 된다(쿼터에 걸리면 아무 일도 안 일어난다).
          구글 문서가 "그 용도라면 스토어로 보내라"고 했고, 이게 그 경로다.
       ⚠️ openExternal 을 꼭 거칠 것 — 인앱 웹뷰로 열면 Play 앱으로 안 넘어간다(오픈채팅에서 겪음). */
  window.openStoreReview = function () {
    openExternal(PLAY_URL + '&showAllReviews=true');
  };

  /* ★ 2026-08-23 계정 삭제 안내 페이지 열기 — 인앱 웹뷰가 아니라 시스템 브라우저로 보낸다.
       (개인정보 처리방침 7조의 링크와 설정 화면에서 쓴다) */
  window.openDeleteGuide = function () { openExternal(DELETE_URL); };

  window.openIntro = function () {
    var ov = document.createElement('div');
    ov.id = 'introOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:#0a2f33;z-index:2700;display:flex;flex-direction:column;';
    ov.innerHTML =
      '<div style="flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;' +
        'padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:#0a2f33;color:#fff;">' +
        '<div style="font-size:15px;font-weight:800;">ℹ️ 현장매니저 소개</div>' +
        '<button id="introClose" style="background:rgba(255,255,255,.14);color:#fff;border:none;' +
          'border-radius:8px;padding:7px 13px;font-size:14px;cursor:pointer;">✕</button></div>' +
      '<iframe id="introFrame" src="intro.html" style="flex:1;width:100%;border:none;background:#f4f8f7;"></iframe>';
    document.body.appendChild(ov);

    // intro.html 안에서 설치 링크를 누르면 postMessage 로 알려온다 → 시스템 브라우저로 전달
    function onMsg(e) {
      var d = e && e.data;
      if (d && d.intro === 'openExternal' && d.url) openExternal(d.url);
    }
    window.addEventListener('message', onMsg);

    function close() {
      window.removeEventListener('message', onMsg);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    }
    ov.querySelector('#introClose').onclick = close;
    window.closeIntro = close;
  };

  window.shareIntro = function () {
    var txt = '현장매니저 — 사진 남기는 모든 현장 작업자용\n' +
      '현직 에어컨 청소기사가 직접 만든 현장 작업 관리 앱입니다.\n' +
      '사진만 찍으면 보고서가 끝나고, 블로그 글·견적서도 AI가 써줍니다.\n\n' +
      (INTRO_URL ? ('앱 소개: ' + INTRO_URL + '\n') : '') +
      '설치: ' + PLAY_URL;

    // 1순위: 안드로이드 기본 공유 시트 (카톡·문자 바로 선택 가능)
    try {
      if (navigator.share) {
        navigator.share({ title: '현장매니저', text: txt }).catch(function () {});
        return;
      }
    } catch (e) {}
    // 2순위: 클립보드 복사
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          if (typeof showToast === 'function') showToast('✓ 소개 문구를 복사했어요. 카톡에 붙여넣으세요', 'ok');
        });
        return;
      }
    } catch (e) {}
    // 3순위: 그래도 안 되면 화면에 띄워 직접 복사
    openDoc('📤 소개 보내기', '<div style="white-space:pre-wrap;font-size:13px;">' +
      txt.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>');
  };
})();

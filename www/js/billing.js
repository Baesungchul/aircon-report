/* ═══════════════════════════════════════════════
   BILLING ─ RevenueCat (Google Play) 구독 연동 (네이티브 전용)
   - 플러그인: @revenuecat/purchases-capacitor  (npm i 후 npx cap sync)
   - 엔타이틀먼트(active entitlements)가 플랜의 진실 공급원 → Subs.setBillingPlan(k)
   - 웹/PWA에서는 동작하지 않음(구글 결제는 앱에서만). 이땐 수동 등급 안내로 폴백.
   ★ 아래 3개 상수를 RevenueCat/Play Console 값으로 채우세요.
═══════════════════════════════════════════════ */
(function () {
  'use strict';
  window.Billing = window.Billing || {};

  /* ===== 설정값 (여기만 채우면 됨) ===== */
  var RC_API_KEY = 'goog_KAOcjnTVghdrXIqEvOQwcDfpPCU';   // RevenueCat > Project settings > API keys > Google 공개키 (goog_ 로 시작)
  var PLAN_PRODUCTS = {  // Play Console 구독 '상품 ID' (또는 base plan id) → 플랜
    lite:   'manager_lite_monthly',
    basic:  'manager_basic_monthly',
    pro:    'manager_pro_monthly',
    master: 'manager_master_monthly'
  };
  var PLAN_ENTITLEMENTS = {  // RevenueCat 'Entitlement' 식별자 → 플랜
    lite:   'lite',
    basic:  'basic',
    pro:    'pro',
    master: 'master'
  };
  /* ==================================== */

  var _ready = false;

  function isNative() { try { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); } catch (e) { return false; } }
  function RC() { return window.Purchases || (window.Capacitor && Capacitor.Plugins && (Capacitor.Plugins.Purchases || Capacitor.Plugins.PurchasesPlugin)) || null; }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'ok'); }
  function uid() { try { return (window.Cloud && Cloud.user && Cloud.user.uid) || null; } catch (e) { return null; } }
  function readInfo(res) { return (res && (res.customerInfo || res)) || null; }

  Billing.available = function () { return _ready && !!RC(); };

  // customerInfo → 활성 엔타이틀먼트 → 플랜 반영
  function applyInfo(info) {
    try {
      var active = (info && info.entitlements && info.entitlements.active) || {};
      var plan = null;
      ['master', 'pro', 'basic', 'lite'].forEach(function (k) { if (!plan && active[PLAN_ENTITLEMENTS[k]]) plan = k; });
      if (window.Subs && Subs.setBillingPlan) Subs.setBillingPlan(plan);
    } catch (e) { console.warn('[Billing] applyInfo', e); }
  }

  Billing.init = async function () {
    if (!isNative()) return;
    var rc = RC();
    if (!rc) { console.log('[Billing] RevenueCat 플러그인 없음(앱 재빌드 필요)'); return; }
    if (!RC_API_KEY) { console.log('[Billing] RC_API_KEY 미설정'); return; }
    try {
      await rc.configure({ apiKey: RC_API_KEY, appUserID: uid() || undefined });
      _ready = true;
      try { rc.addCustomerInfoUpdateListener(function (info) { applyInfo(info); }); } catch (e) {}
      var ci = await rc.getCustomerInfo();
      applyInfo(readInfo(ci));
      console.log('[Billing] RevenueCat 준비 완료');
    } catch (e) { console.warn('[Billing] init 실패', e); }
  };

  // 로그인/로그아웃 시 RevenueCat 사용자 연결
  document.addEventListener('cloud-auth-changed', function (e) {
    if (!Billing.available()) return;
    var rc = RC(); if (!rc) return;
    try {
      if (e && e.detail && e.detail.user && uid()) rc.logIn({ appUserID: uid() }).then(function (r) { applyInfo(readInfo(r)); }).catch(function () {});
      else rc.logOut().then(function (r) { applyInfo(readInfo(r)); }).catch(function () {});
    } catch (err) {}
  });

  Billing.purchase = async function (planKey) {
    if (!isNative()) { toast('결제는 앱(안드로이드)에서만 가능합니다', 'err'); return; }
    var rc = RC();
    if (!rc || !_ready) { toast('결제 모듈이 준비되지 않았어요 (앱 재빌드/설정 확인)', 'err'); return; }
    var prodId = PLAN_PRODUCTS[planKey];
    if (!prodId) { toast('상품 정보가 없습니다', 'err'); return; }
    try {
      var offs = await rc.getOfferings();
      var offering = (offs && (offs.current || (offs.all && offs.all.default))) || null;
      var pkgs = (offering && offering.availablePackages) || [];
      var pkg = null;
      for (var i = 0; i < pkgs.length; i++) {
        var pr = pkgs[i].product || {};
        var _pid = String(pr.identifier || '').split(':')[0];
        if (pr.identifier === prodId || _pid === prodId || pkgs[i].identifier === prodId) { pkg = pkgs[i]; break; }
      }
      if (!pkg) { toast('구독 상품을 찾을 수 없어요 (Play 상품/RevenueCat 오퍼링 확인)', 'err'); return; }
      var res = await rc.purchasePackage({ aPackage: pkg });
      applyInfo(readInfo(res));
      toast('✅ 구독이 시작되었습니다', 'ok');
    } catch (e) {
      var msg = (e && (e.message || e.code)) || '';
      if ((e && e.userCancelled) || /cancel/i.test(msg)) return;
      toast('결제 실패: ' + msg, 'err');
    }
  };

  Billing.restore = async function () {
    var rc = RC(); if (!rc || !_ready) { toast('앱에서만 가능합니다', 'err'); return; }
    try { var res = await rc.restorePurchases(); applyInfo(readInfo(res)); toast('구매 내역을 복원했습니다', 'ok'); }
    catch (e) { toast('복원 실패: ' + ((e && e.message) || ''), 'err'); }
  };

  Billing.manage = function () {
    var url = 'https://play.google.com/store/account/subscriptions';
    try { if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser) { Capacitor.Plugins.Browser.open({ url: url }); return; } } catch (e) {}
    try { window.open(url, '_blank'); } catch (e) {}
  };

  document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { Billing.init(); }, 1200); });
})();

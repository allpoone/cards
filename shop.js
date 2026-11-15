/* ============================================================
   ALL PO ONE — shop.js
   ------------------------------------------------------------
   장바구니 드로어 · 계좌이체 주문서 · 주문 완료(입금 안내) ·
   손님용 주문 조회 화면을 담당합니다.
   데이터는 store.js(APOStore)를 통해서만 읽고 씁니다.
   ============================================================ */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var CFG = typeof SITE_CONFIG !== "undefined" ? SITE_CONFIG : {};
  var LS_BUYER = "apo.buyer.v1";

  var STATUS = {
    pending_payment: { label: "입금대기", cls: "pending", desc: "입금을 기다리고 있습니다." },
    paid: { label: "입금완료", cls: "paid", desc: "입금이 확인되었습니다. 발송 준비 중입니다." },
    shipped: { label: "발송완료", cls: "shipped", desc: "상품이 발송되었습니다." },
    cancelled: { label: "취소됨", cls: "cancelled", desc: "주문이 취소되었습니다." },
  };

  var TIMELINE = ["pending_payment", "paid", "shipped"];

  var lastFocus = null;
  var lookupMode = "no";
  var busy = false;

  /* ── 유틸 ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function won(n) {
    return "₩" + (Number(n) || 0).toLocaleString("ko-KR");
  }

  /* 적립금 표기: 1,200P */
  function pts(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + "P";
  }

  /* 숫자와 단위(P)를 서로 다른 색으로 그리는 마크업 — 0P · 1,200P */
  function ptsHtml(n) {
    return '<span class="pt-num">' + (Number(n) || 0).toLocaleString("ko-KR") +
      '</span><span class="pt-unit">P</span>';
  }

  function digits(s) {
    return String(s == null ? "" : s).replace(/[^0-9]/g, "");
  }

  function toast(msg, kind) {
    if (window.APO && APO.toast) return APO.toast(msg, kind);
    return null;
  }

  function store() {
    return window.APOStore || null;
  }

  function statusOf(o) {
    return STATUS[o && o.status] || STATUS.pending_payment;
  }

  function statusPill(status) {
    var s = STATUS[status] || STATUS.pending_payment;
    return '<span class="status-pill" data-status="' + esc(s.cls) + '">' + esc(s.label) + "</span>";
  }

  function stamp(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function phoneText(v) {
    var d = digits(v);
    if (d.length === 11) return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
    if (d.length === 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    return d;
  }

  function copy(text, okMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    var done = function (ok) {
      toast(ok ? (okMsg || "복사했습니다.") : "복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.", ok ? "ok" : "warn");
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
    } else {
      done(fallback());
    }
  }

  /* 계좌 정보 */
  function bankInfo() {
    var b = CFG.bankAccount || {};
    var bank = String(b.bank || "").trim();
    var number = String(b.number || "").trim();
    var holder = String(b.holder || "").trim();
    return {
      bank: bank,
      number: number,
      holder: holder,
      ready: !!(bank && number),
      line: [bank, number, holder ? "예금주 " + holder : ""].filter(Boolean).join(" "),
    };
  }

  function bankMarkup(compact) {
    var b = bankInfo();
    if (!b.ready) {
      return (
        '<div class="bank bank--empty">' +
        '<p class="bank__label">입금 계좌</p>' +
        '<p class="bank__pending">계좌 정보 준비 중입니다.</p>' +
        '<p class="bank__note">판매자 오픈톡으로 입금 계좌를 문의해 주세요. 계좌가 등록되면 이 화면에 바로 표시됩니다.</p>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-inquire>오픈톡으로 문의</button>' +
        "</div>"
      );
    }
    return (
      '<div class="bank">' +
      '<p class="bank__label">입금 계좌</p>' +
      (compact
        ? '<p class="bank__line">' + esc(b.line) + "</p>"
        : '<div class="bank__rows">' +
          (b.bank ? '<div><span>은행</span><b>' + esc(b.bank) + "</b></div>" : "") +
          '<div><span>계좌번호</span><b class="bank__num">' + esc(b.number) + "</b></div>" +
          (b.holder ? '<div><span>예금주</span><b>' + esc(b.holder) + "</b></div>" : "") +
          "</div>") +
      '<button class="btn btn--ghost btn--sm" type="button" data-copy="bank">계좌 복사</button>' +
      "</div>"
    );
  }

  /* ── 화면 상태 헬퍼 ───────────────────────────────────── */
  function anyOverlay() {
    var ids = ["cartDrawer", "checkoutModal", "doneModal", "lookupModal", "detailModal", "authModal", "mypageModal"];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el && !el.hidden) return true;
    }
    return false;
  }

  function syncLock() {
    document.body.classList.toggle("modal-open", anyOverlay());
  }

  function openEl(el) {
    if (!el) return;
    if (!anyOverlay()) lastFocus = document.activeElement;
    el.hidden = false;
    syncLock();
  }

  function closeEl(el) {
    if (!el || el.hidden) return;
    el.hidden = true;
    syncLock();
    if (!anyOverlay()) stopTicker();
    if (!anyOverlay() && lastFocus && lastFocus.focus) {
      try { lastFocus.focus(); } catch (e) { /* 무시 */ }
    }
  }

  /* ── 장바구니 ─────────────────────────────────────────── */
  function artStyle(p) {
    return "--c1:" + (p.c1 || "#1b2233") + ";--c2:" + (p.c2 || "#3b4a63") +
      ";--accent:" + (p.accent || "#fff") + ";";
  }

  function renderCart() {
    var s = store();
    if (!s) return;

    var lines = s.cart();
    var count = s.cartCount();
    var total = s.cartTotal();

    /* 헤더 · 플로팅 바 */
    var badge = $("cartBadge");
    if (badge) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = count === 0;
    }
    var headerTotal = $("cartHeaderTotal");
    if (headerTotal) {
      headerTotal.textContent = count ? won(total) : "";
      headerTotal.hidden = count === 0;
    }
    var bar = $("cartBar");
    if (bar) {
      bar.hidden = count === 0;
      $("cartBarCount").textContent = count;
      $("cartBarTotal").textContent = won(total);
    }
    var titleN = $("cartTitleCount");
    if (titleN) titleN.textContent = count ? "(" + count + ")" : "";

    var body = $("cartBody");
    var foot = $("cartFoot");
    if (!body || !foot) return;

    if (!lines.length) {
      body.innerHTML =
        '<div class="cart-empty">' +
        '<p class="cart-empty__icon" aria-hidden="true">🛒</p>' +
        '<p class="cart-empty__title">장바구니가 비어 있습니다</p>' +
        '<p class="cart-empty__desc">마음에 드는 박스·오리파를 담아 보세요.</p>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-close-cart>상품 둘러보기</button>' +
        "</div>";
      foot.hidden = true;
      foot.innerHTML = "";
      return;
    }

    body.innerHTML = lines.map(function (l) {
      var p = l.product;
      return (
        '<article class="cart-line" data-id="' + esc(p.id) + '">' +
        '<div class="cart-line__art" style="' + artStyle(p) + '" aria-hidden="true">' +
        '<span class="cart-line__glyph">' + esc(p.glyph || "📦") + "</span>" +
        "</div>" +
        '<div class="cart-line__info">' +
        '<h3 class="cart-line__name">' + esc(p.name) + "</h3>" +
        '<p class="cart-line__meta">' + esc(SITE_CONFIG.shopName) + " · " + esc(s.unitOf(p)) + "당 " + won(l.unitPrice) + "</p>" +
        '<div class="cart-line__row">' +
        '<div class="qty qty--sm" role="group" aria-label="' + esc(p.name) + ' 수량">' +
        '<button class="qty__btn" type="button" data-cart-step="-1" data-id="' + esc(p.id) + '" aria-label="수량 줄이기">−</button>' +
        '<input class="qty__input" type="number" inputmode="numeric" min="1" max="' + p.stock +
        '" value="' + l.qty + '" data-cart-qty="' + esc(p.id) + '" aria-label="수량" />' +
        '<button class="qty__btn" type="button" data-cart-step="1" data-id="' + esc(p.id) + '" aria-label="수량 늘리기">+</button>' +
        "</div>" +
        '<strong class="cart-line__sum">' + won(l.lineTotal) + "</strong>" +
        "</div>" +
        '<p class="cart-line__stock">남은 수량 ' + p.stock + esc(s.unitOf(p)) + "</p>" +
        "</div>" +
        '<button class="cart-line__del" type="button" data-cart-remove="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' 삭제">×</button>' +
        "</article>"
      );
    }).join("");

    foot.hidden = false;
    foot.innerHTML =
      '<div class="cart-sum">' +
      "<span>총 상품 금액</span>" +
      "<strong>" + won(total) + "</strong>" +
      "</div>" +
      '<p class="cart-note">계좌이체 주문 · 입금 확인 후 순차 발송됩니다.<br />주문 후 <b>10분 내</b> 미입금 시 자동 취소됩니다.</p>' +
      '<button class="btn btn--gold btn--block" type="button" data-go-checkout>주문하기</button>';
  }

  function openCart() {
    renderCart();
    openEl($("cartDrawer"));
    var closeBtn = $("cartDrawer") && $("cartDrawer").querySelector("[data-close-cart]");
    if (closeBtn) closeBtn.focus();
  }

  function closeCart() {
    closeEl($("cartDrawer"));
  }

  function stepCart(id, delta) {
    var s = store();
    if (!s) return;
    var line = null;
    s.cart().forEach(function (l) { if (l.id === id) line = l; });
    if (!line) return;
    var p = s.getProduct(id);
    var next = Math.min(p ? p.stock : line.qty, Math.max(0, line.qty + delta));
    if (line.qty + delta > (p ? p.stock : line.qty)) {
      toast("남은 재고가 " + p.stock + s.unitOf(p) + "입니다.", "warn");
      return;
    }
    s.setQty(id, next);
  }

  /* ── 주문서 ───────────────────────────────────────────── */
  function savedBuyer() {
    try { return JSON.parse(localStorage.getItem(LS_BUYER) || "null") || {}; } catch (e) { return {}; }
  }

  function saveBuyer(form) {
    try {
      localStorage.setItem(LS_BUYER, JSON.stringify({
        name: form.name, phone: form.phone, postcode: form.postcode,
        address: form.address, address_detail: form.address_detail,
      }));
    } catch (e) { /* 무시 */ }
  }

  function summaryMarkup(lines, total) {
    return (
      '<div class="co-summary">' +
      '<p class="co-summary__label">주문 상품 ' + lines.length + "종</p>" +
      '<ul class="co-summary__list">' +
      lines.map(function (l) {
        return '<li><span class="co-summary__name">' + esc(l.product.name) +
          ' <em>×' + l.qty + "</em></span><b>" + won(l.lineTotal) + "</b></li>";
      }).join("") +
      "</ul>" +
      '<div class="co-summary__total"><span>총 입금액</span><strong>' + won(total) + "</strong></div>" +
      "</div>"
    );
  }

  /* ── 적립금 (주문서 계산) ─────────────────────────────── */
  var checkoutUsePoints = 0;

  function pointsCalcState() {
    var s = store();
    if (!s) return null;
    var lines = s.cart();
    var total = s.cartTotal();
    var rates = [];
    lines.forEach(function (l) {
      if (!l.product || l.product.earnPoints === false) return;
      var r = s.productRate ? s.productRate(l.product) : s.pointRate();
      if (r > 0 && rates.indexOf(r) === -1) rates.push(r);
    });
    var excluded = lines.filter(function (l) { return l.product && l.product.earnPoints === false; }).length;
    var cached = s.cachedPoints ? s.cachedPoints() : null;
    return {
      lines: lines,
      total: total,
      rates: rates,
      excluded: excluded,
      rate: rates.length === 1 ? rates[0] : (rates.length ? null : 0),
      balance: cached ? Number(cached.balance) || 0 : null,
    };
  }

  /* 실결제 금액 기준 적립 예정 포인트 (상품별 적립률 · 서버와 같은 방식) */
  function earnFor(state, use) {
    var s = store();
    if (!s || !state || state.total <= 0) return 0;
    if (s.calcEarnForLines) return s.calcEarnForLines(state.lines, state.total, use);
    return 0;
  }

  function pointsBoxMarkup(user) {
    if (!user) return "";
    var s0 = store();
    if (!s0 || !s0.pointsReady || !s0.pointsReady()) return "";
    var st = pointsCalcState();
    if (!st) return "";
    var balance = st.balance;
    return (
      '<div class="co-points" id="coPoints">' +
      '<div class="co-points__head">' +
      '<span class="co-points__label">보유 적립금</span>' +
      '<strong class="co-points__balance" id="coPointBalance">' +
      (balance == null ? "조회 중…" : pts(balance)) + "</strong>" +
      (st.excluded
        ? '<span class="co-points__note">적립 제외 상품 ' + st.excluded + "종</span>"
        : "") +
      "</div>" +
      '<div class="co-points__row">' +
      '<input id="coUsePoints" type="tel" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="사용할 적립금" value="0"' +
      (balance === 0 ? " disabled" : "") + " />" +
      '<span class="co-points__unit">P</span>' +
      '<button class="btn btn--ghost btn--xs" type="button" data-use-all-points' +
      (balance === 0 ? " disabled" : "") + ">전액 사용</button>" +
      "</div>" +
      '<p class="co-points__hint" id="coPointsHint">' + esc(earnHint(st)) + "</p>" +
      '<dl class="co-points__sum">' +
      "<div><dt>상품 합계</dt><dd>" + won(st.total) + "</dd></div>" +
      '<div><dt>적립금 사용</dt><dd id="coUsed">- ' + won(0) + "</dd></div>" +
      '<div class="is-total"><dt>최종 입금액</dt><dd id="coFinal">' + won(st.total) + "</dd></div>" +
      '<div class="is-earn"><dt>입금확인 시 적립</dt><dd id="coEarn">' +
      pts(earnFor(st, 0)) + "</dd></div>" +
      "</dl>" +
      "</div>"
    );
  }

  function earnHint(st) {
    if (st == null) return "";
    /* 숫자(기본 적립률)로도 부를 수 있습니다. */
    if (typeof st === "number") st = { rates: st > 0 ? [st] : [] };
    var rates = st.rates || [];
    if (!rates.length) return "지금은 적립률이 0%인 상품만 담겨 있습니다.";
    var head = rates.length === 1
      ? "실결제 금액(적립금 사용분 제외)의 " + rates[0] + "% 적립"
      : "상품별 적립률(" + rates.join(" · ") + "%)로 실결제 금액 기준 적립";
    return head + " · 적립 제외 상품은 빠지고 100원 단위로 반올림됩니다.";
  }

  /* 입력에 따라 최종 입금액·적립 예정 포인트를 다시 계산 */
  function updateCheckoutPoints() {
    var s = store();
    if (!s) return;
    var st = pointsCalcState();
    if (!st) return;
    var input = $("coUsePoints");
    var hint = $("coPointsHint");
    var maxUse = Math.min(st.balance == null ? 0 : st.balance, st.total);
    var use = input ? Math.floor(Number(String(input.value).replace(/[^0-9]/g, "")) || 0) : 0;

    if (use > maxUse) {
      use = maxUse;
      if (hint) hint.textContent = "보유 적립금(" + pts(st.balance || 0) + ")까지만 사용할 수 있습니다.";
    } else if (hint) {
      hint.textContent = earnHint(st);
    }
    if (input && String(input.value) !== String(use)) input.value = String(use);
    checkoutUsePoints = use;

    var finalPay = Math.max(0, st.total - use);
    var earn = earnFor(st, use);
    if ($("coUsed")) $("coUsed").textContent = "- " + won(use);
    if ($("coFinal")) $("coFinal").textContent = won(finalPay);
    if ($("coEarn")) $("coEarn").textContent = pts(earn);
    var submit = $("checkoutSubmit");
    if (submit) {
      submit.dataset.label = (currentUser() ? "주문하기" : "비회원으로 주문하기") + " · " + won(finalPay);
      if (!submit.disabled) submit.textContent = submit.dataset.label;
    }
  }

  /* 주문서에 적립금이 늦게 도착하면 값만 채워 줍니다. */
  function fillCheckoutPoints() {
    var s = store();
    if (!s || !$("coPointBalance")) return;
    s.myPoints()
      .then(function (p) {
        if (!$("coPointBalance")) return;
        $("coPointBalance").textContent = pts(p.balance);
        var input = $("coUsePoints");
        var allBtn = document.querySelector("[data-use-all-points]");
        if (input && p.balance > 0) input.disabled = false;
        if (allBtn && p.balance > 0) allBtn.disabled = false;
        updateCheckoutPoints();
      })
      .catch(function () { /* 업그레이드 전이면 조용히 0P */ });
  }

  function openCheckout() {
    var s = store();
    if (!s) return;
    var lines = s.cart();
    if (!lines.length) {
      toast("장바구니가 비어 있습니다.", "warn");
      return;
    }

    var user = currentUser();
    var mustLogin = s.requireLogin ? s.requireLogin() : false;

    /* 사장님이 [회원 로그인 필수] 로 바꿔 두었으면 먼저 로그인 */
    if (mustLogin && !user) {
      closeEl($("cartDrawer"));
      openAuth("login", {
        notice: "이 쇼핑몰은 회원만 주문할 수 있습니다. 로그인 또는 회원가입 후 주문해 주세요.",
        next: "checkout",
      });
      return;
    }

    var total = s.cartTotal();
    var saved = savedBuyer();
    var meta = user && s.userMeta ? s.userMeta() : {};
    var ship = (meta && meta.shipping) || {};
    /* 로그인 회원은 계정에 저장된 정보 → 없으면 이 브라우저에 저장된 정보 */
    var buyer = {
      name: (meta && meta.name) || saved.name || "",
      phone: meta && meta.phone ? phoneText(meta.phone) : (saved.phone || ""),
      postcode: ship.postcode || saved.postcode || "",
      address: ship.address || saved.address || "",
      address_detail: ship.address_detail || saved.address_detail || "",
    };
    var demo = s.isDemo();

    /* 가입된 계정에 휴대폰 번호가 있으면 주문서에서 자동 입력 + 수정 불가 */
    var phoneLocked = !!(user && meta && meta.phone);

    var accountLine = user
      ? '<p class="co__member">' + esc(userLabel(user)) + "님 계정으로 주문합니다. <span>" + esc(userContact(user)) + "</span></p>"
      : '<div class="co__guest">' +
        '<p>지금은 <b>비회원</b>으로 주문합니다. 로그인하면 배송지가 자동으로 채워지고 [내 주문]에서 내역을 볼 수 있습니다.</p>' +
        '<button class="btn btn--ghost btn--xs" type="button" data-auth-open="login" data-auth-next="checkout">로그인 / 회원가입 후 주문하기</button>' +
        "</div>";

    var submitLabel = user ? "주문하기 · " + won(total) : "비회원으로 주문하기 · " + won(total);

    checkoutUsePoints = 0;

    $("checkoutBody").innerHTML =
      '<div class="co">' +
      '<p class="co__eyebrow">ACCOUNT TRANSFER ORDER</p>' +
      '<h2 class="co__title" id="checkoutTitle">계좌이체 주문서</h2>' +
      '<p class="co__lede">주문서를 보내면 입금 계좌와 주문번호가 나옵니다. 입금 확인 후 [입금완료]로 상태가 바뀝니다.</p>' +
      accountLine +
      (demo
        ? '<p class="co__demo">DB 연동 전 테스트 모드입니다. 주문은 이 브라우저에만 저장되고, 사장님 페이지(admin.html)에서 확인할 수 있습니다.</p>'
        : "") +
      '<form id="checkoutForm" class="co-form" novalidate>' +
      '<fieldset class="co-fieldset">' +
      '<legend>주문자 정보</legend>' +
      '<div class="field">' +
      '<label for="coName">주문자명 <span class="req">*</span></label>' +
      '<input id="coName" name="name" type="text" autocomplete="name" maxlength="30" placeholder="홍길동" value="' + esc(buyer.name || "") + '" />' +
      '<p class="field__err" data-err="coName" hidden></p>' +
      "</div>" +
      '<div class="field">' +
      '<label for="coDepositor">입금자명 <span class="opt">(주문자와 다를 때만)</span></label>' +
      '<input id="coDepositor" name="depositor" type="text" maxlength="30" placeholder="실제 입금자 이름" />' +
      '<p class="field__hint">은행 이체 시 표시되는 이름이 다르면 적어 주세요. 확인이 빨라집니다.</p>' +
      "</div>" +
      '<div class="field">' +
      '<label for="coPhone">연락처(휴대폰) <span class="req">*</span></label>' +
      '<input id="coPhone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="010-0000-0000" value="' + esc(buyer.phone || "") + '"' +
      (phoneLocked ? ' readonly aria-readonly="true" class="is-locked"' : "") + " />" +
      (phoneLocked
        ? '<p class="field__hint"><b>가입된 번호</b>로 주문합니다. 번호를 바꾸려면 <b>마이페이지 → 내 정보</b>에서 변경해 주세요.</p>'
        : "") +
      '<p class="field__err" data-err="coPhone" hidden></p>' +
      "</div>" +
      "</fieldset>" +

      '<fieldset class="co-fieldset">' +
      "<legend>배송지</legend>" +
      '<div class="field field--zip">' +
      '<label for="coPostcode">우편번호 <span class="req">*</span></label>' +
      '<input id="coPostcode" name="postcode" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="6" placeholder="00000" value="' + esc(buyer.postcode || "") + '" />' +
      '<p class="field__err" data-err="coPostcode" hidden></p>' +
      "</div>" +
      '<div class="field">' +
      '<label for="coAddress">주소 <span class="req">*</span></label>' +
      '<input id="coAddress" name="address" type="text" autocomplete="street-address" maxlength="120" placeholder="서울특별시 강남구 테헤란로 1" value="' + esc(buyer.address || "") + '" />' +
      '<p class="field__err" data-err="coAddress" hidden></p>' +
      "</div>" +
      '<div class="field">' +
      '<label for="coAddressDetail">상세주소</label>' +
      '<input id="coAddressDetail" name="address_detail" type="text" maxlength="80" placeholder="101동 1001호" value="' + esc(buyer.address_detail || "") + '" />' +
      "</div>" +
      '<div class="field">' +
      '<label for="coMemo">배송 메모 <span class="opt">(선택)</span></label>' +
      '<input id="coMemo" name="memo" type="text" maxlength="120" placeholder="예: 문 앞에 놓아 주세요" />' +
      "</div>" +
      "</fieldset>" +

      summaryMarkup(lines, total) +

      pointsBoxMarkup(user) +

      '<div class="co-err" id="checkoutError" hidden></div>' +

      '<div class="co-actions">' +
      '<button class="btn btn--gold btn--block" type="submit" id="checkoutSubmit">' + esc(submitLabel) + "</button>" +
      '<button class="btn btn--ghost btn--block" type="button" data-close-checkout>장바구니로 돌아가기</button>' +
      "</div>" +
      '<p class="co__agree">주문을 넣으면 입금대기 상태로 접수되며, <b>10분 안에 입금하지 않으면 자동으로 취소</b>됩니다(재고는 다시 판매됩니다). 입금 확인 후 발송이 시작됩니다.</p>' +
      "</form>" +
      "</div>";

    $("checkoutForm").addEventListener("submit", submitOrder);
    closeEl($("cartDrawer"));
    openEl($("checkoutModal"));

    /* 적립금 사용칸 */
    var useInput = $("coUsePoints");
    if (useInput) {
      useInput.addEventListener("input", updateCheckoutPoints);
      useInput.addEventListener("blur", updateCheckoutPoints);
    }
    var allPointsBtn = document.querySelector("[data-use-all-points]");
    if (allPointsBtn) {
      allPointsBtn.addEventListener("click", function () {
        var st = pointsCalcState();
        if (!st || st.balance == null) return;
        if ($("coUsePoints")) $("coUsePoints").value = String(Math.min(st.balance, st.total));
        updateCheckoutPoints();
      });
    }
    if (user) fillCheckoutPoints();
    var first = $("coName");
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function setFieldError(id, msg) {
    var input = $(id);
    var err = document.querySelector('[data-err="' + id + '"]');
    if (input) input.classList.toggle("is-invalid", !!msg);
    if (err) {
      err.textContent = msg || "";
      err.hidden = !msg;
    }
  }

  function validate(form) {
    var errors = [];
    setFieldError("coName", "");
    setFieldError("coPhone", "");
    setFieldError("coPostcode", "");
    setFieldError("coAddress", "");

    if (!form.name) { setFieldError("coName", "주문자명을 입력해 주세요."); errors.push("coName"); }
    var d = digits(form.phone);
    if (!d) { setFieldError("coPhone", "연락처를 입력해 주세요."); errors.push("coPhone"); }
    else if (d.length < 9 || d.length > 11 || d[0] !== "0") {
      setFieldError("coPhone", "휴대폰 번호를 정확히 입력해 주세요. (예: 010-0000-0000)");
      errors.push("coPhone");
    }
    var zip = digits(form.postcode);
    if (!zip) { setFieldError("coPostcode", "우편번호를 입력해 주세요."); errors.push("coPostcode"); }
    else if (zip.length !== 5) { setFieldError("coPostcode", "우편번호 5자리를 입력해 주세요."); errors.push("coPostcode"); }
    if (!form.address || form.address.length < 2) {
      setFieldError("coAddress", "주소를 입력해 주세요.");
      errors.push("coAddress");
    }
    return errors;
  }

  function submitOrder(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (busy) return;
    var s = store();
    if (!s) return;

    var form = {
      name: ($("coName").value || "").trim(),
      depositor: ($("coDepositor").value || "").trim(),
      phone: ($("coPhone").value || "").trim(),
      postcode: ($("coPostcode").value || "").trim(),
      address: ($("coAddress").value || "").trim(),
      address_detail: ($("coAddressDetail").value || "").trim(),
      memo: ($("coMemo").value || "").trim(),
      usePoints: checkoutUsePoints || 0,
    };

    var bad = validate(form);
    var errBox = $("checkoutError");
    if (bad.length) {
      if (errBox) {
        errBox.textContent = "입력하지 않았거나 형식이 맞지 않는 항목이 있습니다.";
        errBox.hidden = false;
      }
      var first = $(bad[0]);
      if (first) first.focus();
      return;
    }
    if (errBox) errBox.hidden = true;

    var btn = $("checkoutSubmit");
    busy = true;
    if (btn) {
      btn.disabled = true;
      btn.dataset.label = btn.textContent;
      btn.textContent = "주문 처리 중…";
    }

    s.placeOrder(form).then(function (order) {
      busy = false;
      saveBuyer(form);
      /* 로그인 회원이면 최근 배송지를 계정에도 저장 (다음 주문 때 자동 입력) */
      if (currentUser() && s.saveShipping) s.saveShipping(form);
      closeEl($("checkoutModal"));
      closeCart();
      renderCart();
      showDone(order);
    }).catch(function (err) {
      busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.label || "주문하기";
      }
      var box = $("checkoutError");
      if (box) {
        box.textContent = (err && err.message) || "주문을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        box.hidden = false;
      }
      if (err && (err.code === "OUT_OF_STOCK" || err.code === "EMPTY_CART")) {
        s.reload();
        renderCart();
        if (err.code === "EMPTY_CART") closeEl($("checkoutModal"));
      }
    });
  }

  /* ── 입금 마감 (10분) 카운트다운 ─────────────────────── */
  var tickHandle = null;
  var expiring = false;

  function mmss(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(t / 60);
    var s = t % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function expiryMarkup(order, compact) {
    if (!order || order.status !== "pending_payment") return "";
    var s = store();
    var at = s && s.expiresAtOf ? s.expiresAtOf(order) : 0;
    if (!at) return "";
    return (
      '<p class="expire' + (compact ? " expire--compact" : "") + '">' +
      '<span class="expire__icon" aria-hidden="true">⏰</span>' +
      '<span>입금 마감 <b data-expire-at="' + at + '">' + mmss(at - Date.now()) + "</b> 남음</span>" +
      '<span class="expire__note">10분 내 미입금 시 자동 취소</span>' +
      "</p>"
    );
  }

  function paintCountdowns() {
    var nodes = document.querySelectorAll("[data-expire-at]");
    if (!nodes.length) {
      stopTicker();
      return;
    }
    var now = Date.now();
    var justExpired = false;

    for (var i = 0; i < nodes.length; i++) {
      var at = Number(nodes[i].getAttribute("data-expire-at")) || 0;
      var left = at - now;
      if (left <= 0) {
        nodes[i].textContent = "00:00";
        if (!nodes[i].getAttribute("data-expired")) {
          nodes[i].setAttribute("data-expired", "1");
          justExpired = true;
        }
      } else {
        nodes[i].textContent = mmss(left);
      }
    }

    if (justExpired && !expiring) {
      expiring = true;
      onExpired();
    }
  }

  function startTicker() {
    paintCountdowns();
    if (tickHandle) return;
    tickHandle = setInterval(paintCountdowns, 1000);
  }

  function stopTicker() {
    if (!tickHandle) return;
    clearInterval(tickHandle);
    tickHandle = null;
  }

  /* 10분이 지나면 서버에 정리를 요청하고 화면을 새로 고칩니다. */
  function onExpired() {
    var s = store();
    if (!s) {
      expiring = false;
      return;
    }
    s.expireNow()
      .then(function (res) {
        if (res && res.expired) {
          toast("입금 시간(10분)이 지나 주문이 자동 취소되었습니다. 재고는 다시 판매됩니다.", "warn");
          renderCart();
        }
        if (!$("lookupModal").hidden) runLookup();
      })
      .catch(function () { /* 무시 */ })
      .then(function () { expiring = false; });
  }

  function askCancel(orderNo, name, phone) {
    var s = store();
    if (!s) return;
    var ok = window.confirm(
      orderNo + " 주문을 취소할까요?\n취소하면 담았던 상품의 재고가 바로 되돌아갑니다."
    );
    if (!ok) return;

    s.cancelMyOrder(orderNo, name, phone)
      .then(function () {
        toast("주문을 취소했습니다. 재고가 복구되었습니다.", "ok");
        renderCart();
        if (!$("lookupModal").hidden) runLookup();
        refreshMypage();
      })
      .catch(function (err) {
        toast((err && err.message) || "주문을 취소하지 못했습니다.", "warn");
      });
  }

  /* ── 주문 완료 · 입금 안내 ────────────────────────────── */
  function showDone(order) {
    var s = store();
    var st = statusOf(order);
    var demo = order.mode === "demo";

    $("doneBody").innerHTML =
      '<div class="done">' +
      '<p class="done__eyebrow">ORDER RECEIVED</p>' +
      '<h2 class="done__title" id="doneTitle">주문이 접수되었습니다</h2>' +
      '<p class="done__sub">아래 계좌로 입금해 주시면 확인 후 발송됩니다.</p>' +

      '<div class="done__meta">' +
      '<div class="done__meta-row">' +
      '<span class="done__meta-label">주문번호</span>' +
      '<strong class="done__no" id="doneOrderNo">' + esc(order.order_no) + "</strong>" +
      '<button class="btn btn--ghost btn--xs" type="button" data-copy="order">복사</button>' +
      "</div>" +
      '<div class="done__meta-row">' +
      '<span class="done__meta-label">현재 상태</span>' +
      statusPill(order.status) +
      "</div>" +
      "</div>" +

      expiryMarkup(order, false) +

      bankMarkup(false) +

      '<div class="done__amount">' +
      "<span>입금 금액</span>" +
      "<strong>" + won(order.total_amount) + "</strong>" +
      "</div>" +

      (Number(order.used_points) > 0 || Number(order.earned_points) > 0
        ? '<div class="done__points">' +
          (Number(order.used_points) > 0
            ? "<p>적립금 " + pts(order.used_points) + " 사용 (주문 금액에서 차감)</p>"
            : "") +
          (Number(order.earned_points) > 0
            ? "<p><b>입금 확인되면 " + pts(order.earned_points) + " 적립</b>됩니다.</p>"
            : "") +
          "</div>"
        : "") +

      '<ul class="done__items">' +
      (order.items || []).map(function (it) {
        return "<li><span>" + esc(it.product_name) + ' <em>×' + it.qty + "</em></span><b>" + won(it.line_total) + "</b></li>";
      }).join("") +
      "</ul>" +

      '<div class="done__box">' +
      '<p>' + esc(CFG.transferNotice || "입금 확인 후 주문 상태가 [입금완료]로 변경됩니다.") + "</p>" +
      (CFG.shippingNotice ? "<p>" + esc(CFG.shippingNotice) + "</p>" : "") +
      (bankInfo().ready ? "" : '<p class="done__box-warn">입금 계좌가 아직 등록되지 않았습니다. 오픈톡으로 계좌를 문의해 주세요.</p>') +
      "</div>" +

      (demo
        ? '<p class="done__demo">DB 연동 전 테스트 모드입니다. 이 주문은 이 브라우저에만 저장되며, 사장님 페이지(admin.html)에서 상태를 바꿔 볼 수 있습니다.</p>'
        : "") +

      '<div class="done__actions">' +
      '<button class="btn btn--ghost btn--sm" type="button" data-open-lookup="' + esc(order.order_no) + '">내 주문 조회</button>' +
      (String(CFG.openKakaoUrl || "").trim()
        ? '<a class="btn btn--kakao btn--sm" href="' + esc(CFG.openKakaoUrl) + '" target="_blank" rel="noopener noreferrer">오픈톡 문의</a>'
        : '<button class="btn btn--kakao btn--sm" type="button" data-inquire>오픈톡 문의</button>') +
      '<button class="btn btn--gold btn--sm" type="button" data-close-done>확인</button>' +
      "</div>" +

      '<p class="done__save">주문번호를 꼭 저장해 두세요. [내 주문 조회]에서 주문 상태를 확인할 수 있습니다.</p>' +
      "</div>";

    if (!s) return;
    openEl($("doneModal"));
    startTicker();
    var ok = $("doneModal").querySelector("[data-close-done]");
    if (ok) ok.focus();
  }

  /* ── 주문 조회 ────────────────────────────────────────── */
  function lookupIdentityMarkup() {
    return (
      '<div class="lookup__panes">' +
      '<div class="lookup__pane" data-pane="no"' + (lookupMode === "no" ? "" : " hidden") + ">" +
      '<div class="field">' +
      '<label for="lookupNo">주문번호</label>' +
      '<input id="lookupNo" type="text" autocomplete="off" placeholder="APO-20261116-ABCD" maxlength="24" />' +
      "</div>" +
      "</div>" +
      '<div class="lookup__pane" data-pane="info"' + (lookupMode === "info" ? "" : " hidden") + ">" +
      '<div class="lookup__grid">' +
      '<div class="field">' +
      '<label for="lookupName">주문자명</label>' +
      '<input id="lookupName" type="text" autocomplete="name" maxlength="30" placeholder="홍길동" />' +
      "</div>" +
      '<div class="field">' +
      '<label for="lookupPhone">연락처</label>' +
      '<input id="lookupPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="010-0000-0000" />' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function openLookup(orderNo) {
    var s = store();
    var user = currentUser();
    lookupMode = user ? "me" : "no";

    $("lookupBody").innerHTML =
      '<div class="lookup">' +
      '<h2 class="lookup__title" id="lookupTitle">' + (user ? "내 주문" : "내 주문 조회") + "</h2>" +
      '<p class="lookup__lede">' +
      (user
        ? esc(userLabel(user)) + "님으로 주문한 내역입니다."
        : "주문번호 또는 주문자명 + 연락처로 주문 상태를 확인하세요.") +
      "</p>" +
      '<div class="lookup__tabs" role="group" aria-label="조회 방법">' +
      (user
        ? '<button class="lookup__tab" type="button" data-lookup-mode="me" aria-pressed="true">내 주문</button>'
        : "") +
      '<button class="lookup__tab" type="button" data-lookup-mode="no" aria-pressed="' + (user ? "false" : "true") + '">주문번호로 조회</button>' +
      '<button class="lookup__tab" type="button" data-lookup-mode="info" aria-pressed="false">연락처 + 주문자명</button>' +
      "</div>" +
      '<form id="lookupForm" class="lookup__form" novalidate' + (user ? " hidden" : "") + ">" +
      lookupIdentityMarkup() +
      '<button class="btn btn--gold btn--block" type="submit" id="lookupSubmit">조회하기</button>' +
      "</form>" +
      '<div class="lookup__results" id="lookupResults" aria-live="polite"></div>' +
      "</div>";

    $("lookupForm").addEventListener("submit", runLookup);
    openEl($("lookupModal"));
    startTicker();

    if (user) {
      runLookup();
    } else if (orderNo) {
      $("lookupNo").value = orderNo;
      setTimeout(function () { runLookup(); }, 80);
    } else {
      var input = $("lookupNo");
      if (input) setTimeout(function () { input.focus(); }, 60);
    }
  }

  function orderCard(o) {
    var s = store();
    var st = statusOf(o);
    var stepIndex = o.status === "cancelled" ? -1 : TIMELINE.indexOf(o.status);

    var timeline = o.status === "cancelled"
      ? '<p class="order-card__cancelled">취소된 주문입니다. 재고는 다시 판매 가능 상태로 복구되었습니다.</p>'
      : '<ol class="timeline">' +
        TIMELINE.map(function (k, i) {
          var done = i <= stepIndex;
          return '<li class="timeline__item' + (done ? " is-done" : "") + '">' +
            '<span class="timeline__dot" aria-hidden="true"></span>' +
            '<span class="timeline__label">' + esc(STATUS[k].label) + "</span></li>";
        }).join("") +
        "</ol>";

    return (
      '<article class="order-card" data-status="' + esc(st.cls) + '">' +
      '<header class="order-card__head">' +
      '<div>' +
      '<p class="order-card__no">' + esc(o.order_no) + "</p>" +
      '<p class="order-card__date">' + esc(stamp(o.created_at)) + " 주문</p>" +
      "</div>" +
      statusPill(o.status) +
      "</header>" +
      '<p class="order-card__desc">' + esc(st.desc) + "</p>" +
      expiryMarkup(o, true) +
      timeline +
      '<ul class="order-card__items">' +
      (o.items || []).map(function (it) {
        return "<li><span>" + esc(it.product_name) + ' <em>×' + it.qty + "</em></span><b>" + won(it.line_total) + "</b></li>";
      }).join("") +
      "</ul>" +
      '<div class="order-card__total"><span>총 입금액</span><strong>' + won(o.total_amount) + "</strong></div>" +
      (Number(o.used_points) > 0 || Number(o.earned_points) > 0
        ? '<div class="order-card__points">' +
          (Number(o.used_points) > 0 ? "<span>적립금 사용 <b>-" + pts(o.used_points) + "</b></span>" : "") +
          (Number(o.earned_points) > 0
            ? "<span>" + (o.points_awarded ? "적립 완료" : "적립 예정") + " <b>+" + pts(o.earned_points) + "</b></span>"
            : "") +
          "</div>"
        : "") +
      (o.status === "pending_payment" ? bankMarkup(true) : "") +
      '<dl class="order-card__info">' +
      "<dt>주문자</dt><dd>" + esc(o.customer_name) + (o.depositor_name && o.depositor_name !== o.customer_name ? " (입금자 " + esc(o.depositor_name) + ")" : "") + "</dd>" +
      "<dt>연락처</dt><dd>" + esc(phoneText(o.phone)) + "</dd>" +
      "<dt>배송지</dt><dd>" + esc([o.postcode ? "(" + o.postcode + ")" : "", o.address, o.address_detail].filter(Boolean).join(" ")) + "</dd>" +
      (o.memo ? "<dt>배송 메모</dt><dd>" + esc(o.memo) + "</dd>" : "") +
      "</dl>" +
      '<div class="order-card__actions">' +
      '<button class="btn btn--ghost btn--xs" type="button" data-copy="order" data-order-no="' + esc(o.order_no) + '">주문번호 복사</button>' +
      (o.status === "pending_payment"
        ? '<button class="btn btn--danger btn--xs" type="button" data-cancel-order="' + esc(o.order_no) +
          '" data-cancel-name="' + esc(o.customer_name) + '" data-cancel-phone="' + esc(digits(o.phone)) +
          '">주문 취소</button>'
        : "") +
      "</div>" +
      "</article>"
    );
  }

  function runLookup(e) {
    if (e && e.preventDefault) e.preventDefault();
    var s = store();
    if (!s) return;

    var results = $("lookupResults");
    var query = { orderNo: "", name: "", phone: "" };

    /* 로그인 회원: 주문번호 없이 내 주문 전체 */
    if (lookupMode === "me") {
      results.innerHTML = '<p class="lookup__loading">불러오는 중…</p>';
      s.myOrders()
        .then(function (list) {
          if (!list || !list.length) {
            results.innerHTML =
              '<div class="lookup__empty">' +
              "<p>아직 주문 내역이 없습니다.</p>" +
              '<p class="lookup__empty-desc">이 계정으로 주문하면 이곳에 바로 표시됩니다. 다른 이름·연락처로 주문했다면 [주문번호로 조회]를 사용해 주세요.</p>' +
              '<button class="btn btn--ghost btn--sm" type="button" data-close-lookup>상품 보러 가기</button>' +
              "</div>";
            return;
          }
          results.innerHTML =
            '<p class="lookup__count">' + list.length + "건의 주문을 찾았습니다.</p>" +
            list.map(orderCard).join("");
        })
        .catch(function (err) {
          results.innerHTML =
            '<p class="lookup__hint">' +
            esc((err && err.message) || "주문 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.") +
            "</p>";
        });
      return;
    }

    if (lookupMode === "no") {
      query.orderNo = ($("lookupNo").value || "").trim();
      if (!query.orderNo) {
        results.innerHTML = '<p class="lookup__hint">주문번호를 입력해 주세요.</p>';
        $("lookupNo").focus();
        return;
      }
    } else {
      query.name = ($("lookupName").value || "").trim();
      query.phone = digits($("lookupPhone").value);
      if (!query.name || query.phone.length < 9) {
        results.innerHTML = '<p class="lookup__hint">주문자명과 연락처를 정확히 입력해 주세요.</p>';
        return;
      }
    }

    results.innerHTML = '<p class="lookup__loading">조회 중…</p>';

    s.lookupOrders(query).then(function (list) {
      if (!list || !list.length) {
        results.innerHTML =
          '<div class="lookup__empty">' +
          "<p>해당 주문을 찾을 수 없습니다.</p>" +
          '<p class="lookup__empty-desc">주문번호와 연락처를 다시 확인해 주세요. 찾기 어려우면 오픈톡으로 문의해 주세요.</p>' +
          '<button class="btn btn--kakao btn--sm" type="button" data-inquire>오픈톡 문의</button>' +
          "</div>";
        return;
      }
      results.innerHTML =
        '<p class="lookup__count">' + list.length + "건의 주문을 찾았습니다.</p>" +
        list.map(orderCard).join("");
    }).catch(function (err) {
      results.innerHTML = '<p class="lookup__hint">' +
        esc((err && err.message) || "조회에 실패했습니다. 잠시 후 다시 시도해 주세요.") + "</p>";
    });
  }

  /* ============================================================
     회원 — 로그인 · 회원가입 · 계정 표시
     ============================================================ */
  var authMode = "login";
  var authNotice = "";
  var authNext = "";
  var authBusy = false;

  function authSdk() {
    return store();
  }

  function currentUser() {
    var s = authSdk();
    return s && s.user ? s.user() : null;
  }

  /* 손님 계정의 아이디 (내부 이메일 @member.allpoone.local 은 화면에 내보내지 않습니다) */
  function memberId(user) {
    if (!user) return "";
    var s = authSdk();
    if (s && s.displayId) return s.displayId(user);
    var meta = user.user_metadata || {};
    if (meta.username) return String(meta.username);
    var mail = String(user.email || "");
    if (/@member\.allpoone\.local$/i.test(mail)) return mail.split("@")[0];
    return "";
  }

  function userLabel(user) {
    if (!user) return "";
    var id = memberId(user);
    if (id) return id;
    var meta = user.user_metadata || {};
    if (meta.name) return String(meta.name);
    var mail = String(user.email || "");
    return mail ? mail.split("@")[0] : "";
  }

  /* 계정 줄에 보여줄 로그인 정보 — 손님은 아이디, 사장님은 이메일 */
  function userContact(user) {
    if (!user) return "";
    var id = memberId(user);
    return id ? "아이디 " + id : String(user.email || "");
  }

  /* 헤더: 로그인 전에는 [로그인], 로그인 후에는 아이디 + 보유 적립금 + [내 주문] + [로그아웃] */
  function renderAccount() {
    var user = currentUser();
    var openBtn = $("authOpenBtn");
    var box = $("headerUser");
    var mail = $("headerUserMail");

    if (openBtn) openBtn.hidden = !!user;
    if (box) box.hidden = !user;

    /* 사장님 페이지 링크는 관리자 계정으로 로그인했을 때만 (푸터 아래) */
    var adminLink = $("adminLink");
    if (adminLink) {
      var s = authSdk();
      adminLink.hidden = !(user && s && s.isAdminUser && s.isAdminUser(user));
    }
    if (mail && user) {
      mail.textContent = userLabel(user);
      mail.title = memberId(user) ? "아이디 " + memberId(user) : String(user.email || "");
    }

    paintHeaderPoints();
  }

  /* 헤더 적립금 배지 */
  function paintHeaderPoints() {
    var el = $("headerPoints");
    if (!el) return;
    var user = currentUser();
    var s = store();
    var ready = !!(s && s.pointsReady && s.pointsReady());
    if (!user || !ready) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    var cached = s.cachedPoints ? s.cachedPoints() : null;
    if (cached) {
      el.innerHTML = ptsHtml(cached.balance);
      el.hidden = false;
      el.title = "보유 적립금 " + pts(cached.balance);
      return;
    }
    el.innerHTML = '<span class="pt-num">…</span><span class="pt-unit">P</span>';
    el.hidden = false;
    if (s && s.myPoints) {
      s.myPoints().then(function (p) {
        if (!currentUser()) return;
        el.innerHTML = ptsHtml(p.balance);
        el.title = "보유 적립금 " + pts(p.balance);
        if ($("authPointsBalance")) fillAuthPoints(p);
      }).catch(function () {
        /* 업그레이드 전 DB → 배지는 숨김 */
        el.hidden = true;
      });
    }
  }

  /* 적립금 내역 줄 — 계정 모달과 마이페이지가 함께 씁니다. */
  function pointsRowsHtml(rows, limit) {
    var list = (rows || []).slice(0, limit || 12);
    if (!list.length) return '<li class="pt-row pt-row--empty">아직 적립금 내역이 없습니다.</li>';
    return list.map(function (t) {
      var plus = t.amount > 0;
      var label = t.kind === "earn" ? "적립" : t.kind === "use" ? "사용" : t.kind === "refund" ? "환불" : "조정";
      return '<li class="pt-row">' +
        '<div class="pt-row__main"><b class="pt-row__label" data-kind="' + esc(t.kind) + '">' + esc(label) + "</b>" +
        '<span class="pt-row__memo">' + esc(t.memo || t.order_no || "") + "</span></div>" +
        '<div class="pt-row__side"><b class="pt-row__amt' + (plus ? " is-plus" : " is-minus") + '">' +
        (plus ? "+" : "-") + pts(Math.abs(t.amount)) + "</b>" +
        '<span class="pt-row__date">' + esc(stamp(t.created_at)) + "</span></div></li>";
    }).join("");
  }

  /* 계정 모달의 적립금 영역 */
  function fillAuthPoints(data) {
    if (!$("authPointsBalance")) return;
    $("authPointsBalance").textContent = pts(data.balance);
    var rateEl = $("authPointsRate");
    if (rateEl) rateEl.textContent = earnHint(data.rate);
    var list = $("authPointsList");
    if (!list) return;
    list.innerHTML = pointsRowsHtml(data.transactions, 12);
  }

  function loadAuthPoints() {
    var s = store();
    if (!s || !currentUser() || !$("authPointsBalance")) return;
    var cached = s.cachedPoints ? s.cachedPoints() : null;
    if (cached) fillAuthPoints(cached);
    s.myPoints()
      .then(function (p) { if ($("authPointsBalance")) fillAuthPoints(p); })
      .catch(function (err) {
        if ($("authPointsBalance")) $("authPointsBalance").textContent = "-";
        var rateEl = $("authPointsRate");
        if (rateEl) rateEl.textContent = (err && err.code === "NEED_UPGRADE")
          ? "적립금은 DB 업그레이드(supabase-upgrade-v3.sql) 후에 사용할 수 있습니다."
          : "적립금을 불러오지 못했습니다.";
      });
  }

  function authPaneMarkup() {
    var s = authSdk();
    var user = currentUser();
    var demo = s && s.isDemo ? s.isDemo() : false;

    if (user) {
      var meta = user.user_metadata || {};
      return (
        '<div class="auth">' +
        '<p class="auth__eyebrow">MY ACCOUNT</p>' +
        '<h2 class="auth__title" id="authTitle">' + esc(userLabel(user)) + "님</h2>" +
        '<p class="auth__lede">' + esc(userContact(user)) + "<br />" +
        (meta.phone ? "연락처 " + esc(phoneText(meta.phone)) : "연락처를 등록하면 주문서가 자동으로 채워집니다.") +
        "</p>" +
        '<div class="auth__points" id="authPoints">' +
        '<div class="auth__points-head">' +
        "<span>보유 적립금</span>" +
        '<strong id="authPointsBalance">…P</strong>' +
        "</div>" +
        '<p class="auth__points-rate" id="authPointsRate">적립금을 불러오는 중…</p>' +
        '<ul class="auth__points-list" id="authPointsList"></ul>' +
        "</div>" +
        '<div class="auth__actions">' +
        '<button class="btn btn--gold btn--block" type="button" data-open-lookup>내 주문 보기</button>' +
        '<button class="btn btn--ghost btn--block" type="button" data-auth-logout>로그아웃</button>' +
        '<button class="btn btn--text" type="button" data-close-auth>닫기</button>' +
        "</div>" +
        "</div>"
      );
    }

    var isSignup = authMode === "signup";

    return (
      '<div class="auth">' +
      '<p class="auth__eyebrow">MEMBER</p>' +
      '<h2 class="auth__title" id="authTitle">' + (isSignup ? "회원가입" : "로그인") + "</h2>" +
      '<p class="auth__lede">로그인하면 주문할 때 배송지가 자동으로 채워지고, [내 주문]에서 주문 내역을 바로 볼 수 있습니다.</p>' +
      (authNotice ? '<p class="auth__notice">' + esc(authNotice) + "</p>" : "") +
      (demo
        ? '<p class="auth__notice auth__notice--warn">지금은 DB 연동 전 테스트 모드입니다. 회원 로그인 대신 비회원 주문으로 진행해 주세요.</p>'
        : "") +
      '<div class="auth__tabs" role="group" aria-label="로그인 또는 회원가입">' +
      '<button class="auth__tab" type="button" data-auth-mode="login" aria-pressed="' + (isSignup ? "false" : "true") + '">로그인</button>' +
      '<button class="auth__tab" type="button" data-auth-mode="signup" aria-pressed="' + (isSignup ? "true" : "false") + '">회원가입</button>' +
      "</div>" +
      '<form id="authForm" class="auth__form" novalidate>' +
      '<div class="field">' +
      '<label for="authId">' +
      (isSignup
        ? '아이디 <span class="req">*</span>'
        : '아이디 <span class="req">*</span>') +
      "</label>" +
      '<input id="authId" type="text" inputmode="text" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="' +
        (isSignup ? "20" : "80") + '" placeholder="' +
        (isSignup ? "영문·숫자 4~20자" : "아이디 입력") + '" />' +
      '<p class="field__hint">' +
      (isSignup
        ? "영문 소문자·숫자·_·- 4~20자. @(이메일)는 쓸 수 없습니다."
        : "가입하신 아이디로 로그인해 주세요.") +
      "</p>" +
      '<p class="field__err" data-err="authId" hidden></p>' +
      "</div>" +
      '<div class="field">' +
      '<label for="authPassword">비밀번호 <span class="req">*</span></label>' +
      '<input id="authPassword" type="password" autocomplete="' + (isSignup ? "new-password" : "current-password") + '" maxlength="72" placeholder="' + (isSignup ? "6자 이상" : "비밀번호") + '" />' +
      '<p class="field__err" data-err="authPassword" hidden></p>' +
      "</div>" +
      (isSignup
        ? '<div class="auth__grid">' +
          '<div class="field">' +
          '<label for="authName">이름 <span class="req">*</span></label>' +
          '<input id="authName" type="text" autocomplete="name" maxlength="30" placeholder="홍길동" required aria-required="true" />' +
          "</div>" +
          '<div class="field">' +
          '<label for="authPhone">휴대폰 번호 <span class="req">*</span></label>' +
          '<input id="authPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="010-0000-0000" />' +
          '<p class="field__err" data-err="authPhone" hidden></p>' +
          "</div>" +
          "</div>" +
          '<p class="field__hint">휴대폰 번호는 주문서에 자동으로 채워집니다. 같은 번호로는 한 번만 가입할 수 있습니다.</p>'
        : "") +
      '<p class="auth__error" id="authError" role="alert" hidden></p>' +
      '<button class="btn btn--gold btn--block" type="submit" id="authSubmit"' + (demo ? " disabled" : "") + ">" +
      (isSignup ? "가입하기" : "로그인") +
      "</button>" +
      "</form>" +
      '<div class="auth__foot">' +
      '<button class="btn btn--ghost btn--xs" type="button" data-auth-guest>비회원으로 주문하기</button>' +
      '<span class="auth__foot-note">' +
      (isSignup
        ? "아이디·비밀번호만으로 가입합니다. 이메일 주소는 받지 않습니다."
        : "비밀번호를 잊으면 사장님께 오픈톡으로 문의해 주세요.") +
      "</span>" +
      "</div>" +
      "</div>"
    );
  }

  function renderAuth() {
    var body = $("authBody");
    if (!body) return;
    body.innerHTML = authPaneMarkup();
    var first = $("authId");
    if (first && !currentUser()) setTimeout(function () { try { first.focus(); } catch (e) {} }, 60);
    if (currentUser()) loadAuthPoints();
  }

  function openAuth(mode, opts) {
    opts = opts || {};
    if (currentUser()) {
      authMode = "login";
      authNotice = "";
      authNext = "";
      renderAuth();
      openEl($("authModal"));
      return;
    }
    authMode = mode === "signup" ? "signup" : "login";
    authNotice = opts.notice || "";
    authNext = opts.next || "";
    renderAuth();
    openEl($("authModal"));
  }

  function setAuthMode(mode) {
    authMode = mode === "signup" ? "signup" : "login";
    authNotice = "";
    renderAuth();
  }

  function setAuthError(msg) {
    var box = $("authError");
    if (!box) return;
    box.textContent = msg || "";
    box.hidden = !msg;
  }

  function setAuthBusy(on, label) {
    authBusy = !!on;
    var btn = $("authSubmit");
    if (!btn) return;
    btn.disabled = !!on;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label || "처리 중…";
    } else if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
    }
  }

  function afterAuth(res, isSignup) {
    setAuthBusy(false);
    renderAccount();

    if (res && res.needsConfirm) {
      authMode = "login";
      authNotice = res.message;
      renderAuth();
      var box = $("authError");
      if (box) {
        box.textContent = res.message;
        box.hidden = false;
      }
      return;
    }

    var user = (res && res.user) || currentUser();
    closeEl($("authModal"));
    toast((userLabel(user) || "회원") + "님 " + (isSignup ? "환영합니다!" : "로그인했습니다."), "ok");

    if (authNext === "checkout") openCheckout();
    authNext = "";
  }

  function submitAuth(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (authBusy) return;
    var s = authSdk();
    if (!s) return;

    var loginRaw = ($("authId") ? $("authId").value : "").trim();
    var pw = $("authPassword") ? $("authPassword").value : "";
    var isSignup = authMode === "signup";
    var hasAt = loginRaw.indexOf("@") >= 0;

    setAuthError("");
    if (!loginRaw) {
      setAuthError("아이디를 입력해 주세요.");
      if ($("authId")) $("authId").focus();
      return;
    }
    if (isSignup) {
      if (hasAt) {
        setAuthError("아이디에는 @를 쓸 수 없습니다. 영문 소문자·숫자·_·- 4~20자로 입력해 주세요.");
        if ($("authId")) $("authId").focus();
        return;
      }
      if (!/^[a-z0-9_-]{4,20}$/.test(loginRaw.toLowerCase())) {
        setAuthError("아이디는 영문 소문자·숫자·_·- 4~20자로 입력해 주세요.");
        if ($("authId")) $("authId").focus();
        return;
      }
    } else if (hasAt) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginRaw)) {
        setAuthError("이메일 형식을 확인해 주세요.");
        return;
      }
    } else if (!/^[a-zA-Z0-9_-]{2,64}$/.test(loginRaw)) {
      setAuthError("아이디는 영문·숫자·_·- 2~64자로 입력해 주세요.");
      return;
    }
    if (!pw) { setAuthError("비밀번호를 입력해 주세요."); if ($("authPassword")) $("authPassword").focus(); return; }
    if (isSignup && pw.length < 6) { setAuthError("비밀번호는 6자 이상으로 입력해 주세요."); return; }

    var name = $("authName") ? ($("authName").value || "").trim() : "";
    var phone = $("authPhone") ? digits($("authPhone").value) : "";

    if (isSignup) {
      if (!name) {
        setAuthError("이름을 입력해 주세요.");
        if ($("authName")) $("authName").focus();
        return;
      }
      if (!phone) {
        setAuthError("휴대폰 번호를 입력해 주세요.");
        if ($("authPhone")) $("authPhone").focus();
        return;
      }
      if (!/^01[016789][0-9]{7,8}$/.test(phone)) {
        setAuthError("휴대폰 번호를 정확히 입력해 주세요. (예: 010-0000-0000)");
        if ($("authPhone")) $("authPhone").focus();
        return;
      }
    }

    setAuthBusy(true, isSignup ? "가입 중…" : "로그인 중…");

    /* 가입 전에 같은 번호가 있는지 확인 — DB 함수가 없으면 그냥 진행합니다. */
    var ready = isSignup && s.checkPhoneAvailable
      ? s.checkPhoneAvailable(phone)
      : Promise.resolve({ ok: true });

    ready
      .then(function (chk) {
        if (chk && chk.ok === false) {
          setAuthBusy(false);
          setAuthError("이미 가입된 휴대폰 번호입니다.");
          if ($("authPhone")) $("authPhone").focus();
          return null;
        }
        return isSignup
          ? s.signUpUser(loginRaw, pw, { name: name, phone: phone })
          : s.signInUser(loginRaw, pw);
      })
      .then(function (res) {
        if (!res) return;
        afterAuth(res, isSignup);
      })
      .catch(function (err) {
        setAuthBusy(false);
        setAuthError((err && err.message) || (isSignup ? "가입하지 못했습니다." : "로그인하지 못했습니다."));
      });
  }

  function doLogoutUser() {
    var s = authSdk();
    if (!s) return;
    s.signOutUser().then(function () {
      renderAccount();
      closeEl($("authModal"));
      if ($("mypageModal") && !$("mypageModal").hidden) {
        mypageTab = "info";
        renderMypage();
      }
      toast("로그아웃했습니다.", "ok");
    });
  }

  /* ============================================================
     마이페이지 — 내 정보 · 주문 내역 · 적립금 / 비회원 주문 조회
     ============================================================ */
  var mypageTab = "info";
  var mpLookupMode = "no";
  var mpLastQuery = null;
  var mpSaveBusy = false;
  var mpOrders = null;
  var mpOrderFilter = "all";

  function mypageTabsMarkup(active) {
    var tabs = [
      { k: "info", label: "내 정보" },
      { k: "orders", label: "주문 내역" },
      { k: "points", label: "적립금" }
    ];
    return (
      '<div class="mypage__tabs" role="tablist" aria-label="마이페이지 메뉴">' +
      tabs.map(function (t) {
        return '<button class="mypage__tab" type="button" role="tab" data-mypage-tab="' + t.k + '" aria-selected="' +
          (active === t.k ? "true" : "false") + '">' + t.label + "</button>";
      }).join("") +
      "</div>"
    );
  }

  function mypageInfoMarkup(user) {
    var meta = (user && user.user_metadata) || {};
    var loginId = memberId(user);
    /* 이메일 계정은 아이디가 없으므로 가입한 이메일을 보여 줍니다. */
    var id = loginId || String((user && user.email) || "");
    var name = String(meta.name || "");
    var phone = digits(meta.phone);
    return (
      '<form id="mypageForm" class="mypage__form" novalidate>' +
      '<div class="field">' +
      '<label for="mpId">' + (loginId ? "아이디" : "이메일") + '</label>' +
      '<input id="mpId" type="text" value="' + esc(id) + '" readonly aria-readonly="true" class="is-locked" />' +
      '<p class="field__hint">' +
      (loginId ? "아이디는 바꿀 수 없습니다." : "가입한 이메일이 표시됩니다. 바꿀 수 없습니다.") +
      "</p>" +
      "</div>" +
      '<div class="field">' +
      '<label for="mpName">이름 <span class="req">*</span></label>' +
      '<input id="mpName" type="text" autocomplete="name" maxlength="30" value="' + esc(name) + '" placeholder="홍길동" />' +
      '<p class="field__err" data-err="mpName" hidden></p>' +
      "</div>" +
      '<div class="field">' +
      '<label for="mpPhone">휴대폰 번호 <span class="req">*</span></label>' +
      '<input id="mpPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" value="' + esc(phoneText(phone)) + '" placeholder="010-0000-0000" />' +
      '<p class="field__hint">주문서 연락처로 자동 입력됩니다. 같은 번호로는 한 번만 가입할 수 있습니다.</p>' +
      '<p class="field__err" data-err="mpPhone" hidden></p>' +
      "</div>" +
      '<div class="mypage__grid">' +
      '<div class="field">' +
      '<label for="mpPw">새 비밀번호 <span class="opt">선택</span></label>' +
      '<input id="mpPw" type="password" autocomplete="new-password" maxlength="72" placeholder="바꿀 때만 입력" />' +
      '<p class="field__err" data-err="mpPw" hidden></p>' +
      "</div>" +
      '<div class="field">' +
      '<label for="mpPw2">새 비밀번호 확인</label>' +
      '<input id="mpPw2" type="password" autocomplete="new-password" maxlength="72" placeholder="한 번 더 입력" />' +
      '<p class="field__err" data-err="mpPw2" hidden></p>' +
      "</div>" +
      "</div>" +
      '<p class="auth__error" id="mypageError" role="alert" hidden></p>' +
      '<button class="btn btn--gold btn--block" type="submit" id="mypageSave">저장</button>' +
      '<p class="mypage__hint">저장하면 주문서 이름·연락처에도 바로 반영됩니다.</p>' +
      "</form>"
    );
  }

  function mypageOrdersMarkup() {
    return (
      '<div class="chips mypage__order-filters" id="mypageOrderFilters" role="group" aria-label="주문 상태 필터"></div>' +
      '<div class="mypage__orders" id="mypageOrders"><p class="lookup__loading">불러오는 중…</p></div>'
    );
  }

  function mypagePointsMarkup() {
    return (
      '<div class="mypage__points">' +
      '<div class="mypage__balance">' +
      "<span>보유 적립금</span>" +
      '<strong id="mypagePointsBalance">…P</strong>' +
      '<p id="mypagePointsRate">적립금을 불러오는 중…</p>' +
      "</div>" +
      '<ul class="auth__points-list mypage__points-list" id="mypagePointsList"><li class="pt-row pt-row--empty">불러오는 중…</li></ul>' +
      "</div>"
    );
  }

  function mypageGuestMarkup() {
    var no = mpLookupMode === "no";
    return (
      '<div class="mypage">' +
      '<p class="mypage__eyebrow">MY PAGE</p>' +
      '<h2 class="mypage__title" id="mypageTitle">마이페이지</h2>' +
      '<p class="mypage__lede">로그인하시면 내 정보 수정 · 주문 내역 · 적립금을 한곳에서 관리할 수 있어요.</p>' +
      '<button class="btn btn--gold btn--block mypage__login" type="button" data-auth-open="login">로그인 / 회원가입</button>' +
      '<div class="mypage__sep"><span>비회원 주문 조회</span></div>' +
      '<p class="mypage__note">주문번호 또는 주문자명 + 연락처로 주문 상태를 확인할 수 있어요.</p>' +
      '<div class="lookup__tabs" role="group" aria-label="조회 방법">' +
      '<button class="lookup__tab" type="button" data-mp-mode="no" aria-pressed="' + (no ? "true" : "false") + '">주문번호로 조회</button>' +
      '<button class="lookup__tab" type="button" data-mp-mode="info" aria-pressed="' + (no ? "false" : "true") + '">연락처 + 주문자명</button>' +
      "</div>" +
      '<form id="mpLookupForm" class="lookup__form" novalidate>' +
      '<div class="lookup__panes">' +
      '<div class="lookup__pane" data-mp-pane="no"' + (no ? "" : " hidden") + ">" +
      '<div class="field">' +
      '<label for="mpLookupNo">주문번호</label>' +
      '<input id="mpLookupNo" type="text" autocomplete="off" placeholder="APO-20261116-ABCD" maxlength="24" />' +
      "</div>" +
      "</div>" +
      '<div class="lookup__pane" data-mp-pane="info"' + (no ? " hidden" : "") + ">" +
      '<div class="lookup__grid">' +
      '<div class="field">' +
      '<label for="mpLookupName">주문자명</label>' +
      '<input id="mpLookupName" type="text" autocomplete="name" maxlength="30" placeholder="홍길동" />' +
      "</div>" +
      '<div class="field">' +
      '<label for="mpLookupPhone">연락처</label>' +
      '<input id="mpLookupPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="010-0000-0000" />' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<button class="btn btn--ghost btn--block" type="submit" id="mpLookupSubmit">조회하기</button>' +
      "</form>" +
      '<div class="lookup__results" id="mpLookupResults" aria-live="polite"></div>' +
      "</div>"
    );
  }

  function renderMypage() {
    var body = $("mypageBody");
    if (!body) return;
    var user = currentUser();

    if (!user) {
      body.innerHTML = mypageGuestMarkup();
      return;
    }

    var meta = user.user_metadata || {};
    var sub = [userContact(user)];
    if (meta.phone) sub.push("연락처 " + phoneText(meta.phone));

    body.innerHTML =
      '<div class="mypage">' +
      '<p class="mypage__eyebrow">MY PAGE</p>' +
      '<h2 class="mypage__title" id="mypageTitle">' + esc(userLabel(user)) + "님</h2>" +
      '<p class="mypage__lede">' + esc(sub.filter(Boolean).join(" · ")) + "</p>" +
      mypageTabsMarkup(mypageTab) +
      '<div class="mypage__panel" data-mypage-pane="info"' + (mypageTab === "info" ? "" : " hidden") + ">" +
      mypageInfoMarkup(user) +
      "</div>" +
      '<div class="mypage__panel" data-mypage-pane="orders"' + (mypageTab === "orders" ? "" : " hidden") + ">" +
      mypageOrdersMarkup() +
      "</div>" +
      '<div class="mypage__panel" data-mypage-pane="points"' + (mypageTab === "points" ? "" : " hidden") + ">" +
      mypagePointsMarkup() +
      "</div>" +
      '<div class="mypage__foot">' +
      '<button class="btn btn--ghost btn--sm" type="button" data-mypage-logout>로그아웃</button>' +
      "</div>" +
      "</div>";

    applyMypageTab();
  }

  /* 탭 표시만 바꿉니다 (입력 중인 값이 지워지지 않도록 다시 그리지 않음) */
  function applyMypageTab() {
    var tabs = document.querySelectorAll("#mypageBody [data-mypage-tab]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute("aria-selected", tabs[i].getAttribute("data-mypage-tab") === mypageTab ? "true" : "false");
    }
    var panes = document.querySelectorAll("#mypageBody [data-mypage-pane]");
    for (var j = 0; j < panes.length; j++) {
      panes[j].hidden = panes[j].getAttribute("data-mypage-pane") !== mypageTab;
    }
    if (mypageTab === "orders") loadMypageOrders();
    if (mypageTab === "points") loadMypagePoints();
  }

  function setMypageTab(tab) {
    mypageTab = tab === "orders" || tab === "points" ? tab : "info";
    applyMypageTab();
  }

  function openMypage(tab) {
    mypageTab = tab === "orders" || tab === "points" ? tab : "info";
    mpLookupMode = "no";
    mpLastQuery = null;
    mpOrders = null;
    mpOrderFilter = "all";
    renderMypage();
    openEl($("mypageModal"));
    startTicker();
    if (!currentUser()) {
      var input = $("mpLookupNo");
      if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 80);
    }
  }

  function loadMypageOrders() {
    var box = $("mypageOrders");
    var s = store();
    if (!box || !s || !currentUser()) return;
    box.innerHTML = '<p class="lookup__loading">불러오는 중…</p>';
    s.myOrders()
      .then(function (list) {
        if (!$("mypageOrders")) return;
        mpOrders = list || [];
        renderMypageOrders();
      })
      .catch(function (err) {
        if (!$("mypageOrders")) return;
        box.innerHTML = '<p class="lookup__hint">' +
          esc((err && err.message) || "주문 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.") + "</p>";
      });
  }

  /* 주문 상태 필터 칩 (전체 · 입금대기 · 입금완료 · 발송완료 · 취소주문) + 건수 */
  function renderMypageOrderFilters() {
    var box = $("mypageOrderFilters");
    if (!box) return;
    var list = mpOrders || [];
    var counts = { all: list.length, pending_payment: 0, paid: 0, shipped: 0, cancelled: 0 };
    list.forEach(function (o) {
      if (counts[o.status] != null) counts[o.status]++;
    });
    var chips = [
      { k: "all", label: "전체" },
      { k: "pending_payment", label: "입금대기" },
      { k: "paid", label: "입금완료" },
      { k: "shipped", label: "발송완료" },
      { k: "cancelled", label: "취소주문" }
    ];
    box.innerHTML = chips.map(function (c) {
      return '<button class="chip" type="button" data-order-filter="' + c.k + '" aria-pressed="' +
        (mpOrderFilter === c.k ? "true" : "false") + '">' + c.label +
        '<span class="chip__n">' + (counts[c.k] || 0) + "</span></button>";
    }).join("");
  }

  function renderMypageOrders() {
    var box = $("mypageOrders");
    if (!box) return;
    renderMypageOrderFilters();

    var all = mpOrders || [];
    var list = mpOrderFilter === "all" ? all : all.filter(function (o) { return o.status === mpOrderFilter; });

    if (!list.length) {
      box.innerHTML =
        '<div class="lookup__empty">' +
        "<p>" + (all.length ? "이 상태의 주문이 없습니다." : "아직 주문 내역이 없습니다.") + "</p>" +
        '<p class="lookup__empty-desc">' +
        (all.length
          ? "다른 상태 칩을 눌러 보세요."
          : "이 계정으로 주문하면 이곳에 바로 표시됩니다. 다른 이름·연락처로 주문했다면 비회원 주문 조회를 이용해 주세요.") +
        "</p>" +
        (all.length ? "" : '<button class="btn btn--ghost btn--sm" type="button" data-close-mypage>상품 보러 가기</button>') +
        "</div>";
      return;
    }

    box.innerHTML =
      '<p class="lookup__count">' + list.length + "건의 주문을 찾았습니다.</p>" +
      list.map(orderCard).join("");
  }

  function fillMypagePoints(data) {
    var bal = $("mypagePointsBalance");
    if (!bal) return;
    bal.innerHTML = ptsHtml(data.balance);
    var rateEl = $("mypagePointsRate");
    if (rateEl) rateEl.textContent = earnHint(data.rate);
    var list = $("mypagePointsList");
    if (list) list.innerHTML = pointsRowsHtml(data.transactions, 30);
  }

  function loadMypagePoints() {
    var s = store();
    if (!s || !currentUser() || !$("mypagePointsBalance")) return;
    var ready = s.pointsReady ? s.pointsReady() : false;
    var rateEl = $("mypagePointsRate");
    var list = $("mypagePointsList");

    if (!ready) {
      $("mypagePointsBalance").innerHTML = ptsHtml(0);
      if (rateEl) {
        rateEl.textContent = "적립금 기능이 아직 준비되지 않았습니다. DB 업그레이드(supabase-upgrade-v3.sql) 후에 표시됩니다.";
      }
      if (list) list.innerHTML = '<li class="pt-row pt-row--empty">적립금 내역이 없습니다.</li>';
      return;
    }

    var cached = s.cachedPoints ? s.cachedPoints() : null;
    if (cached) fillMypagePoints(cached);

    s.myPoints()
      .then(fillMypagePoints)
      .catch(function (err) {
        if (!$("mypagePointsBalance")) return;
        $("mypagePointsBalance").textContent = "-";
        if (rateEl) {
          rateEl.textContent = (err && err.code === "NEED_UPGRADE")
            ? "적립금은 DB 업그레이드(supabase-upgrade-v3.sql) 후에 사용할 수 있습니다."
            : "적립금을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        }
      });
  }

  /* 비회원 주문 조회 (마이페이지 안) */
  function setMpLookupMode(mode) {
    mpLookupMode = mode === "info" ? "info" : "no";
    var tabs = document.querySelectorAll("#mypageBody [data-mp-mode]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute("aria-pressed", tabs[i].getAttribute("data-mp-mode") === mpLookupMode ? "true" : "false");
    }
    var panes = document.querySelectorAll("#mypageBody [data-mp-pane]");
    for (var j = 0; j < panes.length; j++) {
      panes[j].hidden = panes[j].getAttribute("data-mp-pane") !== mpLookupMode;
    }
    var focusEl = mpLookupMode === "no" ? $("mpLookupNo") : $("mpLookupName");
    if (focusEl) focusEl.focus();
  }

  function runMypageLookup() {
    var s = store();
    var results = $("mpLookupResults");
    if (!s || !results) return;

    var query = { orderNo: "", name: "", phone: "" };
    if (mpLookupMode === "no") {
      query.orderNo = (($("mpLookupNo") || {}).value || "").trim();
      if (!query.orderNo) {
        results.innerHTML = '<p class="lookup__hint">주문번호를 입력해 주세요.</p>';
        if ($("mpLookupNo")) $("mpLookupNo").focus();
        return;
      }
    } else {
      query.name = (($("mpLookupName") || {}).value || "").trim();
      query.phone = digits(($("mpLookupPhone") || {}).value || "");
      if (!query.name || query.phone.length < 9) {
        results.innerHTML = '<p class="lookup__hint">주문자명과 연락처를 정확히 입력해 주세요.</p>';
        return;
      }
    }

    mpLastQuery = { mode: mpLookupMode, query: query };
    results.innerHTML = '<p class="lookup__loading">조회 중…</p>';

    s.lookupOrders(query)
      .then(function (list) {
        if (!$("mpLookupResults")) return;
        if (!list || !list.length) {
          results.innerHTML =
            '<div class="lookup__empty">' +
            "<p>해당 주문을 찾을 수 없습니다.</p>" +
            '<p class="lookup__empty-desc">주문번호와 연락처를 다시 확인해 주세요. 찾기 어려우면 오픈톡으로 문의해 주세요.</p>' +
            '<button class="btn btn--kakao btn--sm" type="button" data-inquire>오픈톡 문의</button>' +
            "</div>";
          return;
        }
        results.innerHTML =
          '<p class="lookup__count">' + list.length + "건의 주문을 찾았습니다.</p>" +
          list.map(orderCard).join("");
      })
      .catch(function (err) {
        if (!$("mpLookupResults")) return;
        results.innerHTML = '<p class="lookup__hint">' +
          esc((err && err.message) || "조회에 실패했습니다. 잠시 후 다시 시도해 주세요.") + "</p>";
      });
  }

  /* 주문 취소 뒤 화면 갱신 */
  function refreshMypage() {
    var modal = $("mypageModal");
    if (!modal || modal.hidden) return;
    if (currentUser()) {
      if (mypageTab === "orders") loadMypageOrders();
      return;
    }
    if (mpLastQuery) runMypageLookup();
  }

  function setMpFieldError(name, msg) {
    var el = document.querySelector('#mypageBody [data-err="' + name + '"]');
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function setMpBusy(on) {
    mpSaveBusy = !!on;
    var btn = $("mypageSave");
    if (!btn) return;
    btn.disabled = !!on;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = "저장 중…";
    } else if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
    }
  }

  function saveMypageProfile(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (mpSaveBusy) return;
    var s = store();
    var user = currentUser();
    if (!s || !user) return;

    var meta = user.user_metadata || {};
    var oldName = String(meta.name || "").trim();
    var oldPhone = digits(meta.phone);

    var name = (($("mpName") || {}).value || "").trim();
    var phone = digits(($("mpPhone") || {}).value || "");
    var pw = ($("mpPw") || {}).value || "";
    var pw2 = ($("mpPw2") || {}).value || "";

    ["mpName", "mpPhone", "mpPw", "mpPw2"].forEach(function (k) { setMpFieldError(k, ""); });
    var box = $("mypageError");
    if (box) { box.textContent = ""; box.hidden = true; }

    var bad = null;
    if (!name) { setMpFieldError("mpName", "이름을 입력해 주세요."); bad = bad || "mpName"; }
    if (!phone) { setMpFieldError("mpPhone", "휴대폰 번호를 입력해 주세요."); bad = bad || "mpPhone"; }
    else if (!/^01[016789][0-9]{7,8}$/.test(phone)) {
      setMpFieldError("mpPhone", "휴대폰 번호를 정확히 입력해 주세요. (예: 010-0000-0000)");
      bad = bad || "mpPhone";
    }
    if (pw) {
      if (pw.length < 6) { setMpFieldError("mpPw", "비밀번호는 6자 이상으로 입력해 주세요."); bad = bad || "mpPw"; }
      else if (pw !== pw2) { setMpFieldError("mpPw2", "새 비밀번호가 서로 다릅니다."); bad = bad || "mpPw2"; }
    } else if (pw2) {
      setMpFieldError("mpPw2", "바꿀 비밀번호를 위 칸에 먼저 입력해 주세요.");
      bad = bad || "mpPw2";
    }
    if (bad) {
      var first = $(bad);
      if (first) first.focus();
      return;
    }

    var phoneChanged = phone !== oldPhone;
    if (!phoneChanged && name === oldName && !pw) {
      toast("바뀐 내용이 없습니다.", "info");
      return;
    }

    setMpBusy(true);

    /* 번호를 바꿀 때만 중복 가입 확인 */
    var check = phoneChanged && s.checkPhoneAvailable
      ? s.checkPhoneAvailable(phone)
      : Promise.resolve({ ok: true });

    check
      .then(function (chk) {
        if (chk && chk.ok === false) {
          setMpBusy(false);
          setMpFieldError("mpPhone", "이미 가입된 휴대폰 번호입니다.");
          if ($("mpPhone")) $("mpPhone").focus();
          return null;
        }
        return s.updateProfile({ name: name, phone: phone, password: pw }).then(function () {
          setMpBusy(false);
          renderAccount();
          if ($("mpPw")) $("mpPw").value = "";
          if ($("mpPw2")) $("mpPw2").value = "";
          var now = currentUser();
          var nowMeta = (now && now.user_metadata) || {};
          if ($("mpName")) $("mpName").value = String(nowMeta.name || name);
          if ($("mpPhone")) $("mpPhone").value = phoneText(digits(nowMeta.phone) || phone);
          /* 모달 제목·안내줄도 새 값으로 */
          if ($("mypageTitle") && now) $("mypageTitle").textContent = userLabel(now) + "님";
          var lede = document.querySelector("#mypageBody .mypage__lede");
          if (lede && now) {
            var parts = [userContact(now)];
            if (nowMeta.phone) parts.push("연락처 " + phoneText(nowMeta.phone));
            lede.textContent = parts.filter(Boolean).join(" · ");
          }
          toast(pw ? "개인정보와 비밀번호를 바꿨습니다." : "개인정보를 저장했습니다.", "ok");
        });
      })
      .catch(function (err) {
        setMpBusy(false);
        var errBox = $("mypageError");
        if (errBox) {
          errBox.textContent = (err && err.message) || "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
          errBox.hidden = false;
        }
      });
  }

  /* ── 이벤트 연결 ──────────────────────────────────────── */
  function setLookupMode(mode) {
    lookupMode = mode;
    var tabs = document.querySelectorAll("[data-lookup-mode]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute("aria-pressed", tabs[i].getAttribute("data-lookup-mode") === mode ? "true" : "false");
    }
    var panes = document.querySelectorAll(".lookup__pane");
    for (var j = 0; j < panes.length; j++) {
      panes[j].hidden = panes[j].getAttribute("data-pane") !== mode;
    }
    var form = $("lookupForm");
    if (form) form.hidden = mode === "me";
    if (mode === "me") {
      runLookup();
      return;
    }
    var focusEl = mode === "no" ? $("lookupNo") : $("lookupName");
    if (focusEl) focusEl.focus();
  }

  function wire() {
    document.addEventListener("click", function (e) {
      var t = e.target;

      if (t.closest("[data-open-cart]")) {
        e.preventDefault();
        openCart();
        return;
      }
      if (t.closest("[data-open-lookup]")) {
        e.preventDefault();
        var btn = t.closest("[data-open-lookup]");
        var orderNo = btn.getAttribute("data-open-lookup") || "";
        closeEl($("doneModal"));
        closeEl($("authModal"));
        closeEl($("mypageModal"));
        closeCart();
        /* 로그인 회원은 마이페이지(주문 내역), 비회원은 주문 조회 */
        if (currentUser()) openMypage("orders");
        else openLookup(orderNo);
        return;
      }

      /* ── 회원 ── */
      if (t.closest("#mypageBtn")) {
        e.preventDefault();
        closeEl($("checkoutModal"));
        closeEl($("authModal"));
        closeCart();
        openMypage("info");
        return;
      }
      var mpTab = t.closest("[data-mypage-tab]");
      if (mpTab) {
        e.preventDefault();
        setMypageTab(mpTab.getAttribute("data-mypage-tab"));
        return;
      }
      var mpFilter = t.closest("#mypageOrderFilters [data-order-filter]");
      if (mpFilter) {
        e.preventDefault();
        mpOrderFilter = mpFilter.getAttribute("data-order-filter") || "all";
        renderMypageOrders();
        return;
      }
      if (t.closest("[data-close-mypage]")) {
        e.preventDefault();
        closeEl($("mypageModal"));
        return;
      }
      if (t.closest("[data-mypage-logout]")) {
        e.preventDefault();
        doLogoutUser();
        return;
      }
      var mpMode = t.closest("[data-mp-mode]");
      if (mpMode) {
        e.preventDefault();
        setMpLookupMode(mpMode.getAttribute("data-mp-mode"));
        return;
      }
      var authOpen = t.closest("[data-auth-open]");
      if (authOpen) {
        e.preventDefault();
        closeEl($("checkoutModal"));
        closeEl($("mypageModal"));
        openAuth(authOpen.getAttribute("data-auth-open"), {
          next: authOpen.getAttribute("data-auth-next") || "",
        });
        return;
      }
      var authTab = t.closest("[data-auth-mode]");
      if (authTab) {
        e.preventDefault();
        setAuthMode(authTab.getAttribute("data-auth-mode"));
        return;
      }
      if (t.closest("[data-auth-guest]")) {
        e.preventDefault();
        var wasNext = authNext;
        authNext = "";
        closeEl($("authModal"));
        if (wasNext === "checkout") openCheckout();
        return;
      }
      if (t.closest("[data-auth-logout]")) {
        e.preventDefault();
        doLogoutUser();
        return;
      }
      if (t.closest("[data-close-cart]")) {
        e.preventDefault();
        closeCart();
        return;
      }
      if (t.closest("[data-go-checkout]")) {
        e.preventDefault();
        openCheckout();
        return;
      }

      var stepBtn = t.closest("[data-cart-step]");
      if (stepBtn) {
        e.preventDefault();
        stepCart(stepBtn.getAttribute("data-id"), Number(stepBtn.getAttribute("data-cart-step")));
        return;
      }
      var delBtn = t.closest("[data-cart-remove]");
      if (delBtn) {
        e.preventDefault();
        var s = store();
        if (s) {
          s.removeFromCart(delBtn.getAttribute("data-cart-remove"));
          toast("장바구니에서 삭제했습니다.", "ok");
        }
        return;
      }

      var copyBtn = t.closest("[data-copy]");
      if (copyBtn) {
        var kind = copyBtn.getAttribute("data-copy");
        if (kind === "bank") {
          var b = bankInfo();
          if (!b.ready) {
            toast("입금 계좌가 아직 등록되지 않았습니다.", "warn");
            return;
          }
          copy(b.line, "계좌 정보를 복사했습니다.");
          return;
        }
        if (kind === "order") {
          var no = copyBtn.getAttribute("data-order-no") ||
            (($("doneOrderNo") && $("doneOrderNo").textContent) || "");
          if (no) copy(no, "주문번호를 복사했습니다.");
          return;
        }
      }

      var modeBtn = t.closest("[data-lookup-mode]");
      if (modeBtn) {
        e.preventDefault();
        setLookupMode(modeBtn.getAttribute("data-lookup-mode"));
        return;
      }

      var cancelBtn = t.closest("[data-cancel-order]");
      if (cancelBtn) {
        e.preventDefault();
        askCancel(
          cancelBtn.getAttribute("data-cancel-order"),
          cancelBtn.getAttribute("data-cancel-name") || "",
          cancelBtn.getAttribute("data-cancel-phone") || ""
        );
        return;
      }
    });

    $("checkoutModal").addEventListener("click", function (e) {
      if (!e.target.closest("[data-close-checkout]")) return;
      closeEl($("checkoutModal"));
      /* 주문서를 닫으면 장바구니로 돌아가기 */
      var s2 = store();
      if (s2 && s2.cart().length) openCart();
    });
    $("doneModal").addEventListener("click", function (e) {
      if (e.target.closest("[data-close-done]")) closeEl($("doneModal"));
    });
    $("lookupModal").addEventListener("click", function (e) {
      if (e.target.closest("[data-close-lookup]")) closeEl($("lookupModal"));
    });
    $("authModal").addEventListener("click", function (e) {
      if (e.target.closest("[data-close-auth]")) {
        authNext = "";
        closeEl($("authModal"));
      }
    });
    $("authModal").addEventListener("submit", submitAuth);

    $("mypageModal").addEventListener("click", function (e) {
      if (e.target.closest("[data-close-mypage]")) closeEl($("mypageModal"));
    });
    $("mypageModal").addEventListener("submit", function (e) {
      if (e.target && e.target.id === "mypageForm") return saveMypageProfile(e);
      if (e.target && e.target.id === "mpLookupForm") {
        e.preventDefault();
        return runMypageLookup();
      }
    });

    if ($("authOpenBtn")) {
      $("authOpenBtn").addEventListener("click", function () { openAuth("login", {}); });
    }
    $("cartDrawer").addEventListener("click", function (e) {
      if (e.target.closest("[data-close-cart]")) closeEl($("cartDrawer"));
    });

    /* 수량 직접 입력 */
    document.addEventListener("change", function (e) {
      var input = e.target.closest("[data-cart-qty]");
      if (!input) return;
      var s = store();
      if (!s) return;
      s.setQty(input.getAttribute("data-cart-qty"), Number(input.value) || 1);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("authModal").hidden) { authNext = ""; closeEl($("authModal")); return; }
      if (!$("mypageModal").hidden) { closeEl($("mypageModal")); return; }
      if (!$("checkoutModal").hidden) {
        closeEl($("checkoutModal"));
        var s3 = store();
        if (s3 && s3.cart().length) openCart();
        return;
      }
      if (!$("doneModal").hidden) { closeEl($("doneModal")); return; }
      if (!$("lookupModal").hidden) { closeEl($("lookupModal")); return; }
      if (!$("cartDrawer").hidden) { closeEl($("cartDrawer")); return; }
    });

    window.addEventListener("apo:cart", renderCart);
    window.addEventListener("apo:products", renderCart);
    window.addEventListener("apo:orders", renderCart);
    window.addEventListener("apo:auth", renderAccount);
    window.addEventListener("apo:settings", renderAccount);
    window.addEventListener("apo:points", function () { renderAccount(); if (!$("authModal").hidden) loadAuthPoints(); });
  }

  /* ── 테스트 모드 안내 / 초기 렌더 ─────────────────────── */
  function renderModeBanner() {
    var s = store();
    var banner = $("demoBanner");
    if (!s || !banner) return;

    if (s.isDemo()) {
      var text = $("demoBannerText");
      if (s.configured && s.dbError()) {
        if (text) text.textContent = "DB에 연결하지 못해 테스트 모드로 동작 중입니다. 주문은 이 브라우저에만 저장됩니다.";
        banner.setAttribute("data-state", "error");
      } else {
        if (text) text.textContent = "DB 연동 전 테스트 모드입니다. 지금 넣은 주문은 이 브라우저에만 저장되며, 사장님 페이지(admin.html)에서 확인할 수 있습니다.";
        banner.setAttribute("data-state", "demo");
      }
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  /* 로그인 상태 확인 전 헤더 깜빡임 방지 — 확인이 끝나면 풉니다. */
  function endAuthPending() {
    if (document.body && document.body.classList) document.body.classList.remove("auth-pending");
  }

  function boot() {
    var s = store();
    if (!s) { endAuthPending(); return; }
    s.init().then(function () {
      renderModeBanner();
      renderAccount();
      renderCart();
      wire();
      /* 이미 로그인된 세션이 있으면 헤더에 계정을 바로 표시 */
      if (s.loadSession) {
        s.loadSession().then(
          function () { renderAccount(); endAuthPending(); },
          function () { endAuthPending(); }
        );
      } else {
        endAuthPending();
      }
      /* 인증이 느리거나 막힌 경우에도 버튼은 보이게 (3초 안전장치) */
      setTimeout(endAuthPending, 3000);
    }, function () { endAuthPending(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.APOShop = {
    openCart: openCart,
    closeCart: closeCart,
    openCheckout: openCheckout,
    openLookup: openLookup,
    renderCart: renderCart,
    statusLabel: function (k) { return (STATUS[k] || STATUS.pending_payment).label; },
  };
})();

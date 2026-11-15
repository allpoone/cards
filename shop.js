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
    var ids = ["cartDrawer", "checkoutModal", "doneModal", "lookupModal", "detailModal"];
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
      '<p class="cart-note">계좌이체 주문 · 입금 확인 후 순차 발송됩니다.</p>' +
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

  function openCheckout() {
    var s = store();
    if (!s) return;
    var lines = s.cart();
    if (!lines.length) {
      toast("장바구니가 비어 있습니다.", "warn");
      return;
    }

    var total = s.cartTotal();
    var buyer = savedBuyer();
    var demo = s.isDemo();

    $("checkoutBody").innerHTML =
      '<div class="co">' +
      '<p class="co__eyebrow">ACCOUNT TRANSFER ORDER</p>' +
      '<h2 class="co__title" id="checkoutTitle">계좌이체 주문서</h2>' +
      '<p class="co__lede">주문서를 보내면 입금 계좌와 주문번호가 나옵니다. 입금 확인 후 [입금완료]로 상태가 바뀝니다.</p>' +
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
      '<input id="coPhone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="010-0000-0000" value="' + esc(buyer.phone || "") + '" />' +
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

      '<div class="co-err" id="checkoutError" hidden></div>' +

      '<div class="co-actions">' +
      '<button class="btn btn--gold btn--block" type="submit" id="checkoutSubmit">계좌이체로 주문하기 · ' + won(total) + "</button>" +
      '<button class="btn btn--ghost btn--block" type="button" data-close-checkout>장바구니로 돌아가기</button>' +
      "</div>" +
      '<p class="co__agree">주문을 넣으면 입금대기 상태로 접수되며, 입금 확인 후 발송이 시작됩니다.</p>' +
      "</form>" +
      "</div>";

    $("checkoutForm").addEventListener("submit", submitOrder);
    closeEl($("cartDrawer"));
    openEl($("checkoutModal"));
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
      closeEl($("checkoutModal"));
      closeCart();
      renderCart();
      showDone(order);
    }).catch(function (err) {
      busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.label || "계좌이체로 주문하기";
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

      bankMarkup(false) +

      '<div class="done__amount">' +
      "<span>입금 금액</span>" +
      "<strong>" + won(order.total_amount) + "</strong>" +
      "</div>" +

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
    lookupMode = "no";
    $("lookupBody").innerHTML =
      '<div class="lookup">' +
      '<h2 class="lookup__title" id="lookupTitle">내 주문 조회</h2>' +
      '<p class="lookup__lede">주문번호 또는 주문자명 + 연락처로 주문 상태를 확인하세요.</p>' +
      '<div class="lookup__tabs" role="group" aria-label="조회 방법">' +
      '<button class="lookup__tab" type="button" data-lookup-mode="no" aria-pressed="true">주문번호로 조회</button>' +
      '<button class="lookup__tab" type="button" data-lookup-mode="info" aria-pressed="false">연락처 + 주문자명</button>' +
      "</div>" +
      '<form id="lookupForm" class="lookup__form" novalidate>' +
      lookupIdentityMarkup() +
      '<button class="btn btn--gold btn--block" type="submit" id="lookupSubmit">조회하기</button>' +
      "</form>" +
      '<div class="lookup__results" id="lookupResults" aria-live="polite"></div>' +
      "</div>";

    $("lookupForm").addEventListener("submit", runLookup);
    openEl($("lookupModal"));

    if (orderNo) {
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
      timeline +
      '<ul class="order-card__items">' +
      (o.items || []).map(function (it) {
        return "<li><span>" + esc(it.product_name) + ' <em>×' + it.qty + "</em></span><b>" + won(it.line_total) + "</b></li>";
      }).join("") +
      "</ul>" +
      '<div class="order-card__total"><span>총 입금액</span><strong>' + won(o.total_amount) + "</strong></div>" +
      (o.status === "pending_payment" ? bankMarkup(true) : "") +
      '<dl class="order-card__info">' +
      "<dt>주문자</dt><dd>" + esc(o.customer_name) + (o.depositor_name && o.depositor_name !== o.customer_name ? " (입금자 " + esc(o.depositor_name) + ")" : "") + "</dd>" +
      "<dt>연락처</dt><dd>" + esc(phoneText(o.phone)) + "</dd>" +
      "<dt>배송지</dt><dd>" + esc([o.postcode ? "(" + o.postcode + ")" : "", o.address, o.address_detail].filter(Boolean).join(" ")) + "</dd>" +
      (o.memo ? "<dt>배송 메모</dt><dd>" + esc(o.memo) + "</dd>" : "") +
      "</dl>" +
      '<div class="order-card__actions">' +
      '<button class="btn btn--ghost btn--xs" type="button" data-copy="order" data-order-no="' + esc(o.order_no) + '">주문번호 복사</button>' +
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
        closeEl($("doneModal"));
        closeCart();
        openLookup(btn.getAttribute("data-open-lookup") || "");
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

  function boot() {
    var s = store();
    if (!s) return;
    s.init().then(function () {
      renderModeBanner();
      renderCart();
      wire();
    });
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

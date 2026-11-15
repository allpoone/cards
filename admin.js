/* ============================================================
   ALL PO ONE — admin.js
   사장님 페이지: 주문 상태 처리 · 재고 수정
   데이터는 store.js(APOStore)를 통해서만 다룹니다.
   ============================================================ */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var STATUS = {
    pending_payment: { label: "입금대기", cls: "pending" },
    paid: { label: "입금완료", cls: "paid" },
    shipped: { label: "발송완료", cls: "shipped" },
    cancelled: { label: "취소됨", cls: "cancelled" },
  };

  var TYPE = { box: "미개봉 박스", oripa: "오리파", single: "싱글·기타" };

  var orders = [];
  var filter = "all";
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

  function phoneText(v) {
    var d = digits(v);
    if (d.length === 11) return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
    if (d.length === 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    return d;
  }

  function stamp(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function toast(msg, kind) {
    var stack = $("toastStack");
    if (!stack) return;
    var el = document.createElement("div");
    el.className = "toast toast--" + (kind || "info");
    el.setAttribute("role", kind === "warn" ? "alert" : "status");
    el.innerHTML =
      '<span class="toast__icon" aria-hidden="true">' +
      (kind === "ok" ? "✅" : kind === "warn" ? "⚠️" : "💬") + "</span>" +
      '<span class="toast__msg">' + esc(msg) + "</span>";
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add("toast--out");
      setTimeout(function () { el.remove(); }, 260);
    }, kind === "warn" ? 4200 : 2600);
  }

  /* ============================================================
     로그인 · 잠금 — Supabase Auth(이메일 + 비밀번호)
     ============================================================ */
  function store() { return window.APOStore; }

  function dbMode() {
    var s = store();
    return !!s && !s.isDemo();
  }

  function loggedIn() {
    var s = store();
    if (!s) return false;
    return s.isDemo() ? s.isUnlocked() : s.isAdminSession();
  }

  function setLockMessage(message) {
    var err = $("lockError");
    if (!err) return;
    err.textContent = message || "";
    err.hidden = !message;
  }

  function showHeaderUser(user) {
    var el = $("whoami");
    if (!el) return;
    var email = user && user.email ? String(user.email) : "";
    el.textContent = email;
    el.hidden = !email;
  }

  function showApp(user) {
    $("adminLock").hidden = true;
    $("adminApp").hidden = false;
    var out = $("logoutBtn");
    if (out) {
      out.hidden = false;
      out.textContent = dbMode() ? "로그아웃" : "잠금";
    }
    showHeaderUser(user);
    loadAll();
  }

  function showLock(message) {
    $("adminApp").hidden = true;
    $("adminLock").hidden = false;
    $("logoutBtn").hidden = true;
    showHeaderUser(null);
    orders = [];
    setLockMessage(message);
    var inline = $("logoutInline");
    if (inline) inline.hidden = true;
    var pw = $("adminPassword");
    if (pw) pw.value = "";
    if (dbMode()) {
      var mail = $("adminEmail");
      if (mail) mail.focus();
    }
  }

  /* 로그인은 됐지만 관리자 권한(app_metadata.role)이 없는 계정 */
  function showNoAdmin(user, message) {
    var email = user && user.email ? String(user.email) : "";
    var msg = message || ("관리자 권한이 없는 계정입니다." + (email ? " (" + email + ")" : ""));
    showLock(msg);
    var inline = $("logoutInline");
    if (inline) inline.hidden = false;
  }

  function setLoginBusy(on) {
    var btn = $("loginBtn");
    if (!btn) return;
    btn.disabled = !!on;
    btn.textContent = on ? "로그인 중…" : "로그인";
  }

  /* DB 모드 = 이메일 로그인 / 테스트 모드 = 로컬 열기 */
  function applyLockMode() {
    var demo = !dbMode();
    var form = $("loginForm");
    var demoBox = $("demoLock");
    var desc = $("lockDesc");
    var hint = $("lockHint");
    if (form) form.hidden = demo;
    if (demoBox) demoBox.hidden = !demo;
    if (desc) desc.hidden = demo;
    if (hint) hint.hidden = demo;
  }

  function doLogout() {
    var s = store();
    if (!s) return;
    var demo = !dbMode();
    showLock("");
    s.signOut().then(function () {
      setLockMessage("");
      toast(demo ? "잠겼습니다." : "로그아웃했습니다.", "ok");
    });
  }

  function doLogin(email, password) {
    var s = store();
    if (!s) return;
    setLockMessage("");
    setLoginBusy(true);
    s.signIn(email, password)
      .then(function (res) {
        setLoginBusy(false);
        if (!res || !res.isAdmin) {
          showNoAdmin(res && res.user, "관리자 권한이 없는 계정입니다. 다른 계정으로 로그인하거나 로그아웃해 주세요.");
          return;
        }
        var hint = $("lockHint");
        if (hint) hint.hidden = false;
        showApp(res.user);
        toast("로그인했습니다.", "ok");
      })
      .catch(function (err) {
        setLoginBusy(false);
        setLockMessage((err && err.message) || "로그인하지 못했습니다.");
        var pw = $("adminPassword");
        if (pw) { pw.value = ""; pw.focus(); }
      });
  }

  function isAuthProblem(msg) {
    return /관리자|권한|JWT|jwt|토큰|token|세션|로그인|permission|not authorized/i.test(String(msg || ""));
  }

  /* ── 테스트 모드 안내 ─────────────────────────────────── */
  function renderModeBanner() {
    var s = window.APOStore;
    var banner = $("demoBanner");
    var text = $("demoBannerText");
    if (!s || !banner) return;
    /* 주문 없을 때 안내 문구도 모드에 맞춥니다. */
    var emptyDesc = $("orderEmptyDesc");
    if (emptyDesc) {
      emptyDesc.textContent = s.isDemo()
        ? "손님이 주문하면 이곳에 바로 표시됩니다. (같은 브라우저 테스트 모드 기준)"
        : "손님이 주문하면 이곳에 바로 표시됩니다. (실시간 DB 기준)";
    }
    if (s.isDemo()) {
      if (text) {
        text.textContent = s.dbError() && s.configured
          ? "DB에 연결하지 못해 테스트 모드로 동작 중입니다. 주문은 이 브라우저에만 저장됩니다."
          : "DB 연동 전 테스트 모드입니다. 주문은 이 브라우저(localStorage)에만 저장되며, 같은 브라우저에서 연 사이트의 주문이 표시됩니다.";
      }
      banner.setAttribute("data-state", s.dbError() && s.configured ? "error" : "demo");
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  /* ── 주문 목록 ────────────────────────────────────────── */
  function loadOrders() {
    var s = window.APOStore;
    if (!s) return Promise.resolve([]);
    busy = true;
    return s.listOrders()
      .then(function (list) {
        orders = list || [];
        orders.sort(function (a, b) {
          return new Date(b.created_at) - new Date(a.created_at);
        });
        renderOrders();
        return orders;
      })
      .catch(function (err) {
        var msg = (err && err.message) || "주문을 불러오지 못했습니다.";
        toast(msg, "warn");
        if (isAuthProblem(msg)) showLock(msg);
        return [];
      })
      .then(function (v) { busy = false; return v; });
  }

  function statusPill(status) {
    var s = STATUS[status] || STATUS.pending_payment;
    return '<span class="status-pill" data-status="' + esc(s.cls) + '">' + esc(s.label) + "</span>";
  }

  function orderActions(o) {
    var no = esc(o.order_no);
    if (o.status === "pending_payment") {
      return (
        '<button class="btn btn--gold btn--xs" type="button" data-act="paid" data-no="' + no + '">입금확인 완료</button>' +
        '<button class="btn btn--danger btn--xs" type="button" data-act="cancelled" data-no="' + no + '">미입금 취소(재고복구)</button>'
      );
    }
    if (o.status === "paid") {
      return (
        '<button class="btn btn--ghost btn--xs" type="button" data-act="shipped" data-no="' + no + '">발송완료</button>' +
        '<button class="btn btn--danger btn--xs" type="button" data-act="cancelled" data-no="' + no + '">주문 취소(재고복구)</button>'
      );
    }
    if (o.status === "shipped") {
      return '<span class="aorder__done">발송 처리 완료</span>';
    }
    return '<span class="aorder__done">취소된 주문 — 재고 복구됨</span>';
  }

  function orderCard(o) {
    var st = STATUS[o.status] || STATUS.pending_payment;
    var addr = [o.postcode ? "(" + o.postcode + ")" : "", o.address, o.address_detail].filter(Boolean).join(" ");
    var depositLine = o.depositor_name && o.depositor_name !== o.customer_name
      ? '<b class="aorder__dep">입금자 ' + esc(o.depositor_name) + "</b>"
      : "";

    return (
      '<article class="aorder" data-status="' + esc(st.cls) + '" data-no="' + esc(o.order_no) + '">' +
      '<header class="aorder__head">' +
      '<div class="aorder__id">' +
      '<span class="aorder__no">' + esc(o.order_no) + "</span>" +
      '<span class="aorder__time">' + esc(stamp(o.created_at)) + "</span>" +
      "</div>" +
      statusPill(o.status) +
      "</header>" +

      '<ul class="aorder__items">' +
      (o.items || []).map(function (it) {
        return "<li><span>" + esc(it.product_name) + ' <em>×' + it.qty + "</em></span><b>" + won(it.line_total) + "</b></li>";
      }).join("") +
      "</ul>" +

      '<div class="aorder__total"><span>총 입금액</span><strong>' + won(o.total_amount) + "</strong></div>" +

      '<dl class="aorder__info">' +
      "<dt>주문자</dt><dd>" + esc(o.customer_name) + " " + depositLine + "</dd>" +
      "<dt>연락처</dt><dd><a href=\"tel:" + esc(digits(o.phone)) + "\">" + esc(phoneText(o.phone)) + "</a></dd>" +
      "<dt>배송지</dt><dd>" + esc(addr || "-") + "</dd>" +
      (o.memo ? "<dt>메모</dt><dd>" + esc(o.memo) + "</dd>" : "") +
      "</dl>" +

      '<div class="aorder__actions">' + orderActions(o) + "</div>" +
      "</article>"
    );
  }

  function renderOrders() {
    var counts = { pending_payment: 0, paid: 0, shipped: 0, cancelled: 0 };
    var revenue = 0;
    orders.forEach(function (o) {
      if (counts[o.status] != null) counts[o.status]++;
      if (o.status === "paid" || o.status === "shipped") revenue += Number(o.total_amount) || 0;
    });

    $("statPending").textContent = counts.pending_payment;
    $("statPaid").textContent = counts.paid;
    $("statShipped").textContent = counts.shipped;
    $("statRevenue").textContent = won(revenue);
    $("cntAll").textContent = orders.length;
    $("cntPending").textContent = counts.pending_payment;
    $("cntPaid").textContent = counts.paid;
    $("cntShipped").textContent = counts.shipped;
    $("cntCancelled").textContent = counts.cancelled;

    var chips = document.querySelectorAll("#orderFilter .chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", chips[i].getAttribute("data-status") === filter ? "true" : "false");
    }

    var list = orders.filter(function (o) {
      return filter === "all" ? true : o.status === filter;
    });

    $("orderList").innerHTML = list.map(orderCard).join("");
    $("orderEmpty").hidden = list.length !== 0;
    if (!list.length && orders.length) {
      $("orderEmpty").querySelector("p").textContent = "이 상태의 주문이 없습니다.";
    } else if (!list.length) {
      $("orderEmpty").querySelector("p").textContent = "아직 주문이 없습니다.";
    }
  }

  /* ── 주문 상태 변경 ───────────────────────────────────── */
  function changeStatus(orderNo, status) {
    var s = window.APOStore;
    if (!s) return;
    var target = null;
    orders.forEach(function (o) { if (o.order_no === orderNo) target = o; });

    var ask = {
      paid: "입금이 확인되었습니까? 상태를 [입금완료]로 바꿉니다.",
      shipped: "발송을 마쳤습니까? 상태를 [발송완료]로 바꿉니다.",
      cancelled: "주문을 취소할까요?\n차감된 재고가 자동으로 복구되고, 0이었던 상품은 다시 판매 상태가 됩니다.",
    }[status];
    if (ask && !window.confirm(ask)) return;

    s.setOrderStatus(orderNo, status).then(function () {
      var label = (STATUS[status] || {}).label || status;
      toast((target ? target.order_no + " · " : "") + label + " 처리했습니다.", "ok");
      return loadOrders();
    }).catch(function (err) {
      toast((err && err.message) || "처리하지 못했습니다.", "warn");
    });
  }

  /* ── 재고 ─────────────────────────────────────────────── */
  function stockState(p) {
    if (p.stock <= 0) return { label: "품절", cls: "soldout" };
    if (p.status === "low") return { label: "마감임박", cls: "low" };
    return { label: "판매중", cls: "available" };
  }

  function renderStock() {
    var s = window.APOStore;
    if (!s) return;
    var list = s.products();
    $("stockList").innerHTML = list.map(function (p) {
      var st = stockState(p);
      return (
        '<div class="stock-row" data-id="' + esc(p.id) + '">' +
        '<div class="stock-row__name">' +
        '<span class="stock-row__title">' + esc(p.name) + "</span>" +
        '<span class="stock-row__meta">' + esc(TYPE[p.type] || p.type) + " · " + won(p.price) + " / " + esc(s.unitOf(p)) + "</span>" +
        "</div>" +
        '<div class="stock-row__ctrl">' +
        '<button class="qty__btn" type="button" data-stock-step="-1" data-id="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' 재고 줄이기">−</button>' +
        '<input class="qty__input stock-row__input" type="number" inputmode="numeric" min="0" max="9999" value="' + p.stock + '" data-stock-input="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' 재고" />' +
        '<button class="qty__btn" type="button" data-stock-step="1" data-id="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' 재고 늘리기">+</button>' +
        '<button class="btn btn--ghost btn--xs" type="button" data-stock-save="' + esc(p.id) + '">저장</button>' +
        "</div>" +
        '<span class="stock-row__state" data-status="' + st.cls + '">' + st.label + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function saveStock(id, value) {
    var s = window.APOStore;
    if (!s) return;
    s.setStock(id, value).then(function (p) {
      if (p) toast(p.name + " 재고를 " + p.stock + s.unitOf(p) + "로 저장했습니다.", "ok");
      renderStock();
    }).catch(function (err) {
      toast((err && err.message) || "재고를 저장하지 못했습니다.", "warn");
    });
  }

  /* ── 자동 입금 확인 로그 ──────────────────────────────── */
  var EVENT = {
    matched: { label: "자동 입금확인", cls: "matched" },
    ambiguous: { label: "확인 필요", cls: "ambiguous" },
    unmatched: { label: "매칭 없음", cls: "unmatched" },
    error: { label: "오류", cls: "unmatched" },
  };

  var REASON = {
    no_candidate: "입금액·입금자명이 맞는 입금대기 주문 없음",
    multiple_candidates: "같은 금액·입금자명 주문이 2건 이상",
    already_processed: "이미 처리된 주문",
    no_amount: "알림에서 금액을 찾지 못함",
    empty_text: "알림 내용 없음",
    auto: "자동 매칭",
  };

  function renderEvents(list) {
    var host = $("eventList");
    var hint = $("eventHint");
    var s = window.APOStore;
    if (!host || !hint) return;

    if (s && s.isDemo()) {
      host.innerHTML = "";
      hint.textContent = "DB 연동 전 테스트 모드에서는 자동 입금 확인 로그가 없습니다. Supabase 연동 후 은행 알림과 함께 사용할 수 있습니다.";
      hint.hidden = false;
      return;
    }

    if (!list || !list.length) {
      host.innerHTML = "";
      hint.textContent = "아직 자동 입금 확인 기록이 없습니다.";
      hint.hidden = false;
      return;
    }

    hint.hidden = true;
    host.innerHTML = list.map(function (e) {
      var meta = EVENT[e.status] || EVENT.unmatched;
      var candidates = Array.isArray(e.candidates) ? e.candidates : [];
      return (
        '<div class="event-row" data-status="' + esc(meta.cls) + '">' +
        '<div class="event-row__head">' +
        '<span class="event-pill" data-status="' + esc(meta.cls) + '">' + esc(meta.label) + "</span>" +
        (e.amount ? '<strong class="event-row__amount">' + won(e.amount) + "</strong>" : "") +
        '<span class="event-row__time">' + esc(stamp(e.created_at)) + "</span>" +
        "</div>" +
        '<p class="event-row__text">' + esc(e.raw_text) + "</p>" +
        '<p class="event-row__meta">' +
        (e.order_no
          ? "주문 " + esc(e.order_no) + " · "
          : "") +
        esc(REASON[e.reason] || e.reason || "") +
        (candidates.length ? " · 후보 " + esc(candidates.join(", ")) : "") +
        "</p>" +
        "</div>"
      );
    }).join("");
  }

  function loadEvents() {
    var s = window.APOStore;
    if (!s) return Promise.resolve([]);
    return s.listDepositEvents(30)
      .then(function (list) {
        renderEvents(list);
        return list;
      })
      .catch(function () {
        renderEvents([]);
        return [];
      });
  }

  /* ── 이벤트 ───────────────────────────────────────────── */
  function wire() {
    /* ── 이메일 + 비밀번호 로그인 ── */
    $("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = ($("adminEmail").value || "").trim();
      var pw = $("adminPassword").value || "";
      if (!email) {
        setLockMessage("관리자 이메일을 입력해 주세요.");
        $("adminEmail").focus();
        return;
      }
      if (!pw) {
        setLockMessage("비밀번호를 입력해 주세요.");
        $("adminPassword").focus();
        return;
      }
      doLogin(email, pw);
    });

    /* ── 로그아웃 / (테스트 모드) 잠금 ── */
    $("logoutBtn").addEventListener("click", doLogout);
    $("logoutInline").addEventListener("click", doLogout);

    /* ── 테스트 모드 전용: 로그인 없이 열기 ── */
    $("demoOpenBtn").addEventListener("click", function () {
      var s = store();
      if (s && s.unlock()) showApp(null);
    });

    $("orderFilter").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      filter = chip.getAttribute("data-status");
      renderOrders();
    });

    $("refreshBtn").addEventListener("click", function () {
      loadOrders();
      renderStock();
      loadEvents();
      toast("새로고침했습니다.", "ok");
    });

    $("eventReloadBtn").addEventListener("click", function () {
      loadEvents();
      toast("자동 입금 로그를 다시 불러왔습니다.", "ok");
    });

    $("stockReloadBtn").addEventListener("click", function () {
      window.APOStore.reload().then(function () { renderStock(); loadOrders(); });
      toast("재고를 다시 불러왔습니다.", "ok");
    });

    $("orderList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      changeStatus(btn.getAttribute("data-no"), btn.getAttribute("data-act"));
    });

    $("stockList").addEventListener("click", function (e) {
      var step = e.target.closest("[data-stock-step]");
      if (step) {
        var id = step.getAttribute("data-id");
        var input = document.querySelector('[data-stock-input="' + id + '"]');
        var cur = input ? Number(input.value) || 0 : 0;
        var next = Math.max(0, cur + Number(step.getAttribute("data-stock-step")));
        if (input) input.value = next;
        saveStock(id, next);
        return;
      }
      var save = e.target.closest("[data-stock-save]");
      if (save) {
        var sid = save.getAttribute("data-stock-save");
        var sinput = document.querySelector('[data-stock-input="' + sid + '"]');
        if (!sinput) return;
        saveStock(sid, Number(sinput.value) || 0);
      }
    });

    $("stockList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var input = e.target.closest("[data-stock-input]");
      if (!input) return;
      e.preventDefault();
      saveStock(input.getAttribute("data-stock-input"), Number(input.value) || 0);
    });

    window.addEventListener("apo:products", renderStock);

    /* 다른 탭(손님 화면)에서 주문이 들어오면 자동 반영 */
    window.addEventListener("storage", function (e) {
      if (!e.key || e.key.indexOf("apo.") !== 0) return;
      if (!loggedIn()) return;
      loadOrders();
      loadEvents();
    });
  }

  /* ── 시작 ─────────────────────────────────────────────── */
  function loadAll() {
    loadOrders();
    renderStock();
    loadEvents();
  }

  function boot() {
    var s = window.APOStore;
    if (!s) return;
    s.init().then(function () {
      renderModeBanner();
      wire();
      applyLockMode();

      if (s.isDemo()) {
        if (s.isUnlocked()) showApp(null);
        else showLock("");
        return;
      }

      /* 이미 로그인된 세션이 있으면 자동으로 이어서 열기 */
      s.loadSession().then(function (session) {
        var user = (session && session.user) || null;
        if (!user) { showLock(""); return; }
        if (!s.isAdminUser(user)) { showNoAdmin(user); return; }
        showApp(user);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

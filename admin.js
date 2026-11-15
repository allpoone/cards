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

  var TYPE = { box: "미개봉 박스", oripa: "오리파", etc: "기타" };
  var GAME = { pokemon: "포켓몬", onepiece: "원피스", other: "기타" };
  var EDITION = { "": "해당없음", KR: "한판(KR)", JP: "일판(JP)", EN: "영판(EN)" };

  function options(defs, selected) {
    return Object.keys(defs).map(function (k) {
      return '<option value="' + k + '"' + (String(selected || "") === k ? " selected" : "") + ">" +
        esc(defs[k]) + "</option>";
    }).join("");
  }

  var orders = [];
  var filter = "all";
  var busy = false;

  /* ── 사장님 페이지 탭 ─────────────────────────────────── */
  var adminTab = "orders";
  var TAB_KEYS = ["orders", "products", "members", "events"];

  function renderTabs() {
    var tabs = document.querySelectorAll("[data-admin-tab]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute("aria-selected", tabs[i].getAttribute("data-admin-tab") === adminTab ? "true" : "false");
    }
    var panes = document.querySelectorAll("[data-admin-pane]");
    for (var j = 0; j < panes.length; j++) {
      panes[j].hidden = panes[j].getAttribute("data-admin-pane") !== adminTab;
    }
  }

  function setAdminTab(key) {
    adminTab = TAB_KEYS.indexOf(key) >= 0 ? key : "orders";
    renderTabs();
    if (adminTab === "orders") loadOrders();
    else if (adminTab === "products") renderProducts();
    else if (adminTab === "members") loadMembers();
    else if (adminTab === "events") loadEvents();
  }

  /* ── 상세 설명 블록 에디터 (products.description 에 문자열로 저장) ── */
  var DESC_TAG = "APO_BLOCKS_V1::";

  function parseDescBlocks(raw) {
    var s = String(raw == null ? "" : raw);
    if (s.indexOf(DESC_TAG) !== 0) {
      return s.trim() ? [{ type: "text", text: s }] : [];
    }
    try {
      var arr = JSON.parse(s.slice(DESC_TAG.length));
      if (!Array.isArray(arr)) return [];
      return arr.map(function (b) {
        if (!b) return null;
        if (b.type === "photo") return { type: "photo", url: String(b.url || "") };
        return { type: "text", text: String(b.text || "") };
      }).filter(Boolean);
    } catch (e) {
      return [{ type: "text", text: s }];
    }
  }

  function serializeDescBlocks(scope) {
    var host = scope ? scope.querySelector("[data-desc-editor]") : null;
    if (!host) return undefined; /* 편집기가 없으면 기존 값을 그대로 둡니다 */
    var blocks = [];
    var nodes = host.querySelectorAll("[data-block]");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-block") === "photo") {
        var u = nodes[i].querySelector("[data-block-url]");
        var url = String(u ? u.value : "").trim();
        if (url) blocks.push({ type: "photo", url: url });
      } else {
        var t = nodes[i].querySelector("[data-block-text]");
        var txt = String(t ? t.value : "").trim();
        if (txt) blocks.push({ type: "text", text: txt });
      }
    }
    return blocks.length ? DESC_TAG + JSON.stringify(blocks) : "";
  }

  function descTools() {
    return (
      '<div class="desc-block__tools">' +
      '<button class="btn btn--text btn--xs" type="button" data-desc-move="-1">▲ 위로</button>' +
      '<button class="btn btn--text btn--xs" type="button" data-desc-move="1">▼ 아래로</button>' +
      '<button class="btn btn--text btn--xs" type="button" data-desc-del>삭제</button>' +
      "</div>"
    );
  }

  function descBlockMarkup(block) {
    if (block && block.type === "photo") {
      var url = String(block.url || "");
      return (
        '<div class="desc-block" data-block="photo">' +
        '<div class="desc-block__photo">' +
        (url ? '<img src="' + esc(url) + '" alt="" />' : '<span class="desc-block__empty">아래에서 사진을 골라 주세요</span>') +
        "</div>" +
        '<div class="desc-block__pick">' +
        '<button class="btn btn--ghost btn--xs" type="button" data-block-pick>사진 선택</button>' +
        '<input type="file" accept="image/*" data-block-file hidden />' +
        '<input type="text" data-block-url maxlength="500" placeholder="사진 주소 (사진을 고르면 자동 입력)" value="' + esc(url) + '" />' +
        "</div>" +
        descTools() +
        "</div>"
      );
    }
    return (
      '<div class="desc-block" data-block="text">' +
      '<textarea data-block-text maxlength="2000" rows="3" placeholder="설명 문단을 입력해 주세요">' +
      esc((block && block.text) || "") +
      "</textarea>" +
      descTools() +
      "</div>"
    );
  }

  function descEditorMarkup(description) {
    var blocks = parseDescBlocks(description);
    return (
      '<div class="pf pf--wide desc-editor" data-desc-editor>' +
      "<span>상세 설명 <em>(글 · 사진 블록 — 손님 상세 화면에 순서대로 보입니다)</em></span>" +
      '<div class="desc-editor__blocks" data-desc-blocks>' +
      (blocks.length
        ? blocks.map(descBlockMarkup).join("")
        : '<p class="desc-editor__empty" data-desc-empty>블록이 없습니다. [+ 글 추가] 또는 [+ 사진 추가]로 설명을 만들어 주세요.</p>') +
      "</div>" +
      '<div class="desc-editor__actions">' +
      '<button class="btn btn--ghost btn--xs" type="button" data-desc-add="text">+ 글 추가</button>' +
      '<button class="btn btn--ghost btn--xs" type="button" data-desc-add="photo">+ 사진 추가</button>' +
      "</div>" +
      "</div>"
    );
  }

  function refreshDescEmpty(editor) {
    if (!editor) return;
    var box = editor.querySelector("[data-desc-blocks]");
    var empty = editor.querySelector("[data-desc-empty]");
    if (!box || !empty) return;
    empty.hidden = box.querySelectorAll("[data-block]").length > 0;
  }

  function addDescBlock(editor, type) {
    if (!editor) return;
    var box = editor.querySelector("[data-desc-blocks]");
    if (!box) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = descBlockMarkup(type === "photo" ? { type: "photo", url: "" } : { type: "text", text: "" });
    var node = wrap.firstChild;
    box.appendChild(node);
    refreshDescEmpty(editor);
    var focusEl = node.querySelector(type === "photo" ? "[data-block-pick]" : "[data-block-text]");
    if (type === "photo" && focusEl) focusEl.click();
    else if (focusEl) focusEl.focus();
  }

  function moveDescBlock(editor, block, dir) {
    if (!editor || !block || !dir) return;
    var parent = editor.querySelector("[data-desc-blocks]");
    if (!parent) return;
    if (dir < 0 && block.previousElementSibling) parent.insertBefore(block, block.previousElementSibling);
    if (dir > 0 && block.nextElementSibling) parent.insertBefore(block.nextElementSibling, block);
  }

  function renderDescPhotoPreview(block) {
    if (!block) return;
    var urlInput = block.querySelector("[data-block-url]");
    var url = String(urlInput ? urlInput.value : "").trim();
    var pic = block.querySelector(".desc-block__photo");
    if (pic) {
      pic.innerHTML = url
        ? '<img src="' + esc(url) + '" alt="" />'
        : '<span class="desc-block__empty">아래에서 사진을 골라 주세요</span>';
    }
  }

  function uploadDescPhoto(fileInput) {
    var s = window.APOStore;
    var block = fileInput.closest("[data-block]");
    if (!s || !s.uploadProductImage || !block || !fileInput.files || !fileInput.files[0]) return;
    var file = fileInput.files[0];
    var prow = fileInput.closest(".prow");
    var idHint = prow ? prow.getAttribute("data-id") : "new";
    var urlInput = block.querySelector("[data-block-url]");
    var pickBtn = block.querySelector("[data-block-pick]");
    if (pickBtn) { pickBtn.disabled = true; pickBtn.textContent = "올리는 중…"; }

    s.uploadProductImage(file, idHint)
      .then(function (res) {
        if (pickBtn) { pickBtn.disabled = false; pickBtn.textContent = "사진 선택"; }
        if (urlInput) urlInput.value = res.url;
        renderDescPhotoPreview(block);
        if (res.warning) toast(res.warning, "warn");
        else toast("사진을 올렸습니다. [저장]을 누르면 상품에 적용됩니다.", "ok");
      })
      .catch(function (err) {
        if (pickBtn) { pickBtn.disabled = false; pickBtn.textContent = "사진 선택"; }
        toast((err && err.message) || "사진을 올리지 못했습니다.", "warn");
      });
  }

  /* 오리파 총 구수 · 번호판 현황 */
  function oripaBoxMarkup(p) {
    var total = Number(p.totalSlots) || 0;
    var show = p.type === "oripa";
    return (
      '<div class="pf pf--wide oripa-box" data-oripa-box' + (show ? "" : " hidden") + '>' +
      '<p class="oripa-box__title">오리파 번호판</p>' +
      '<div class="oripa-box__row">' +
      '<label class="pf"><span>총 구수 (1~N번)</span>' +
      '<input type="number" inputmode="numeric" min="1" max="500" data-field="total_slots" value="' +
      (total > 0 ? total : "") + '" placeholder="예: 100" /></label>' +
      '<p class="oripa-box__status" data-seat-status>총 구수를 입력하고 [저장]하면 1~N번 번호판이 만들어집니다. (이미 팔린·입금대기 번호는 유지)</p>' +
      "</div>" +
      '<div class="oripa-seats" data-seat-map hidden></div>' +
      "</div>"
    );
  }

  /* 번호판 현황(읽기 전용 그리드) */
  function loadSeatMap(scope, id) {
    var s = window.APOStore;
    if (!s || !s.getOripaBoard || !scope || !id) return;
    var statusEl = scope.querySelector("[data-seat-status]");
    var mapEl = scope.querySelector("[data-seat-map]");
    s.getOripaBoard(id).then(function (b) {
      if (!mapEl) return;
      if (!b || !b.ready) {
        mapEl.hidden = true;
        if (statusEl) statusEl.textContent = "아직 번호판이 없습니다. 총 구수를 입력하고 [저장]하면 1~N번이 만들어집니다.";
        return;
      }
      var pick = {};
      var c = { available: 0, held: 0, sold: 0 };
      (b.seats || []).forEach(function (x) {
        pick[x.n] = x.s || "available";
        if (c[x.s] == null) c[x.s] = 0;
        c[x.s]++;
      });
      var html = "";
      var total = Number(b.total_slots) || 0;
      for (var n = 1; n <= total; n++) {
        html += '<span data-s="' + (pick[n] || "available") + '">' + n + "</span>";
      }
      mapEl.innerHTML = html || '<span class="oripa-seats__empty">번호판이 비어 있습니다.</span>';
      mapEl.hidden = false;
      if (statusEl) {
        statusEl.textContent = "총 " + total + "구 · 판매가능 " + (c.available || 0) +
          " · 입금대기 " + (c.held || 0) + " · 팔린 번호 " + (c.sold || 0);
      }
    });
  }

  function toggleOripaBox(scope, isOripa) {
    var box = scope ? scope.querySelector("[data-oripa-box]") : null;
    if (box) box.hidden = !isOripa;
  }

  /* ── 유틸 ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function won(n) {
    return "₩" + (Number(n) || 0).toLocaleString("ko-KR");
  }

  function pts(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + "P";
  }

  function digits(s) {
    return String(s == null ? "" : s).replace(/[^0-9]/g, "");
  }

  /* 적립률(%) 표기 — 2 / 2.5 / 3.25 */
  function rateText(v) {
    var n = Number(v);
    if (!isFinite(n)) return "0";
    return String(Math.round(n * 100) / 100);
  }

  /* 상점 기본 적립률 (새 상품 폼 기본값) */
  function shopRateText() {
    var s = window.APOStore;
    var r = s && s.pointRate ? Number(s.pointRate()) : 2;
    return isFinite(r) && r >= 0 ? rateText(r) : "2";
  }

  /* 상품에 적히는 적립률(%) — 상품 값이 없으면 상점 기본 적립률 */
  function productRateText(p) {
    if (p && p.pointRate != null) return rateText(p.pointRate);
    return shopRateText();
  }

  /* 적립금 지급 ON/OFF + 바로 옆 적립률(%) 입력칸 (한 줄) */
  function earnFieldMarkup(boxAttr, rateAttr, on, rateValue) {
    var checked = on !== false;
    var val = rateValue == null || rateValue === "" ? shopRateText() : rateText(rateValue);
    return (
      '<div class="pf pf--wide"><span>적립금 지급 <em>(ON/OFF)</em></span>' +
      '<div class="pf__check">' +
      '<label class="pf__earn"><input type="checkbox" ' + (checked ? "checked " : "") + boxAttr + " />" +
      " <span>이 상품을 살 때 적립금을 지급합니다</span></label>" +
      '<span class="pf__rate' + (checked ? "" : " is-off") + '">' +
      '<input type="number" inputmode="decimal" min="0" max="50" step="0.01" value="' +
      esc(val) + '" aria-label="상품 적립률(%)" ' + rateAttr + (checked ? "" : " disabled") + " />" +
      '<span class="pf__rate-unit">%</span>' +
      "</span>" +
      "</div>" +
      ratePatchHint() +
      "</div>"
    );
  }

  /* 상품별 적립률을 아직 저장할 수 없는 DB(패치 전)일 때 안내 */
  function ratePatchHint() {
    if (dbFeature("rate")) return "";
    return '<p class="pf__note">상품별 적립률 저장은 SQL 패치(supabase-patch-product-rate.sql)를 실행한 뒤부터 됩니다. 지금은 상점 기본 적립률로 계산됩니다.</p>';
  }

  /* 이 기능이 지금 DB에서 쓸 수 있는지 (테스트 모드에서는 항상 가능) */
  function dbFeature(name) {
    var s = window.APOStore;
    if (!s) return false;
    if (s.isDemo()) return true;
    if (!s.dbHas) return false;
    return !!s.dbHas(name);
  }

  /* 숨김(비공개) 체크박스 — 숨김 칸이 없는 DB(패치 전)에서는 잠금 + 안내 */
  function hiddenFieldMarkup(attr, on) {
    var ready = dbFeature("hidden");
    return (
      '<div class="pf pf--wide"><span>공개 설정</span>' +
      '<div class="pf__check">' +
      '<label class="pf__earn"><input type="checkbox" ' + (on ? "checked " : "") + attr +
      (ready ? "" : " disabled") + " />" +
      " <span>손님 화면에서 숨기기 (비공개)</span></label>" +
      "</div>" +
      (ready
        ? '<p class="pf__note">체크하면 손님 사이트 목록·검색·장바구니에서 빠집니다. 이 목록에서는 계속 보입니다.</p>'
        : '<p class="pf__note">숨김 기능은 SQL 패치(supabase-patch-product-rate.sql)를 실행한 뒤부터 쓸 수 있습니다.</p>') +
      "</div>"
    );
  }

  /* 체크박스에 맞춰 적립률 입력칸을 켜고 끕니다. */
  function syncEarnRate(box) {
    if (!box) return;
    var wrap = box.closest ? box.closest(".pf__check") : null;
    var input = wrap ? wrap.querySelector("[data-earn-rate]") : null;
    if (!input) return;
    var on = !!box.checked;
    input.disabled = !on;
    var host = input.parentNode;
    if (host && host.classList) host.classList.toggle("is-off", !on);
  }

  /* 적립률 입력값 검사 (0 ~ 50%) — 문제가 있으면 문자열, 비었으면 상점 기본, 정상이면 숫자 */
  function readRate(input) {
    if (!input) return null;
    var raw = String(input.value == null ? "" : input.value).trim();
    if (!raw) return Number(shopRateText());
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || n > 50) return "상품 적립률은 0 ~ 50 사이 숫자로 입력해 주세요.";
    return Math.round(n * 100) / 100;
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
    var loading = $("adminLoading");
    if (loading) loading.hidden = true;
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
    var loading = $("adminLoading");
    if (loading) loading.hidden = true;
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
    /* 숨긴 주문 탭: 다시 보이기 (숨김 해제) */
    var unhide = o.admin_hidden === true
      ? '<button class="btn btn--gold btn--xs" type="button" data-act="unhide" data-no="' + no + '">다시 보이기</button>'
      : "";
    /* 실수로 잘못 누르지 않도록 위험한 [취소]는 왼쪽, 주 액션은 오른쪽 끝에 둡니다. */
    if (o.status === "pending_payment") {
      return (
        '<button class="btn btn--danger btn--xs" type="button" data-act="cancelled" data-no="' + no + '">미입금 취소(재고복구)</button>' +
        '<button class="btn btn--gold btn--xs aorder__primary" type="button" data-act="paid" data-no="' + no + '">입금확인 완료</button>'
      );
    }
    if (o.status === "paid") {
      return (
        '<button class="btn btn--danger btn--xs" type="button" data-act="cancelled" data-no="' + no + '">주문 취소(재고복구)</button>' +
        '<button class="btn btn--ghost btn--xs aorder__primary" type="button" data-act="shipped" data-no="' + no + '">발송완료</button>'
      );
    }
    if (o.status === "shipped") {
      return (
        unhide +
        '<span class="aorder__done">발송 처리 완료</span>' +
        '<button class="btn btn--ghost btn--xs aorder__primary" type="button" data-act="hide" data-no="' + no + '">목록에서 숨기기</button>'
      );
    }
    return (
      unhide +
      '<button class="btn btn--ghost btn--xs" type="button" data-act="hide" data-no="' + no + '">목록에서 숨기기</button>' +
      '<button class="btn btn--danger btn--xs aorder__primary" type="button" data-del-order="' + no + '">완전 삭제</button>'
    );
  }

  function seatTagOf(it) {
    var v = it && (it.seat_numbers || it.seats);
    if (!Array.isArray(v) || !v.length) return "";
    return "(" + v.map(function (n) { return "#" + Number(n); }).join(", ") + ")";
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
      (o.admin_hidden === true ? '<span class="aorder__flag" title="사장님 목록에서만 숨겨진 주문">숨김</span>' : "") +
      "</header>" +

      '<ul class="aorder__items">' +
      (o.items || []).map(function (it) {
        var tag = seatTagOf(it);
        return "<li><span>" + esc(it.product_name) +
          (tag ? ' <em class="seat-nums">' + esc(tag) + "</em>" : "") +
          ' <em>×' + it.qty + "</em></span><b>" + won(it.line_total) + "</b></li>";
      }).join("") +
      "</ul>" +

      '<div class="aorder__total"><span>총 입금액</span><strong>' + won(o.total_amount) + "</strong></div>" +

      (Number(o.used_points) > 0 || Number(o.earned_points) > 0
        ? '<div class="aorder__points">' +
          (Number(o.used_points) > 0 ? "<span>적립금 사용 <b>-" + pts(o.used_points) + "</b></span>" : "") +
          (Number(o.earned_points) > 0
            ? "<span>" + (o.points_awarded ? "적립 완료" : "적립 예정") + " <b>+" + pts(o.earned_points) + "</b></span>"
            : "") +
          "</div>"
        : "") +

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
    /* 매출 요약은 숨긴 주문까지 전체 주문 기준 — 숨긴 발송완료 매출도 빠지지 않습니다. */
    var counts = { pending_payment: 0, paid: 0, shipped: 0, cancelled: 0 };
    var sums = { pending_payment: 0, paid: 0, shipped: 0, cancelled: 0 };
    var hiddenCounts = { pending_payment: 0, paid: 0, shipped: 0, cancelled: 0 };
    var revenue = 0;
    orders.forEach(function (o) {
      if (counts[o.status] != null) {
        sums[o.status] += Number(o.total_amount) || 0;
        if (o.admin_hidden === true) hiddenCounts[o.status]++;
        else counts[o.status]++;
      }
      if (o.status === "paid" || o.status === "shipped") revenue += Number(o.total_amount) || 0;
    });
    var hiddenTotal = hiddenCounts.pending_payment + hiddenCounts.paid + hiddenCounts.shipped + hiddenCounts.cancelled;

    $("statPending").textContent = counts.pending_payment;
    $("statPaid").textContent = counts.paid;
    $("statShipped").textContent = counts.shipped;
    $("statRevenue").textContent = won(revenue);
    if ($("statPendingAmt")) $("statPendingAmt").textContent = won(sums.pending_payment);
    if ($("statPaidAmt")) $("statPaidAmt").textContent = won(sums.paid);
    if ($("statShippedAmt")) $("statShippedAmt").textContent = won(sums.shipped);
    $("cntAll").textContent = counts.pending_payment + counts.paid + counts.shipped + counts.cancelled;
    $("cntPending").textContent = counts.pending_payment;
    $("cntPaid").textContent = counts.paid;
    $("cntShipped").textContent = counts.shipped;
    $("cntCancelled").textContent = counts.cancelled;
    if ($("cntHidden")) $("cntHidden").textContent = hiddenTotal;

    var chips = document.querySelectorAll("#orderFilter .chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", chips[i].getAttribute("data-status") === filter ? "true" : "false");
    }

    var list = orders.filter(function (o) {
      if (filter === "hidden") return o.admin_hidden === true;
      if (o.admin_hidden === true) return false;
      return filter === "all" ? true : o.status === filter;
    });

    $("orderList").innerHTML = list.map(orderCard).join("");
    $("orderEmpty").hidden = list.length !== 0;
    if (!list.length && orders.length) {
      $("orderEmpty").querySelector("p").textContent = filter === "hidden"
        ? "숨긴 주문이 없습니다."
        : "이 상태의 주문이 없습니다.";
    } else if (!list.length) {
      $("orderEmpty").querySelector("p").textContent = "아직 주문이 없습니다.";
    }
  }

  /* ── 주문 상태 변경 · 숨김 처리 ──────────────────────── */
  /* 취소 주문은 삭제, 취소·발송완료 주문은 목록에서만 숨김 */
  function askDeleteOrder(orderNo) {
    var s = window.APOStore;
    if (!s || !s.deleteOrder) {
      toast("주문 정리를 사용할 수 없습니다.", "warn");
      return;
    }
    var ask = "취소된 주문을 완전히 삭제할까요?\n삭제하면 되돌릴 수 없고, 주문 안의 상품 기록도 사라지며 손님의 주문 내역에서도 지워집니다.";
    if (!window.confirm(orderNo + "\n\n" + ask)) return;

    s.deleteOrder(orderNo).then(function (res) {
      var action = (res && res.action) || "deleted";
      toast(orderNo + " · " + (action === "hidden" ? "주문 목록에서 숨겼습니다." : "주문을 삭제했습니다."), "ok");
      return loadOrders();
    }).catch(function (err) {
      toast((err && err.message) || "주문을 정리하지 못했습니다.", "warn");
    });
  }

  function toggleOrderHidden(orderNo, hidden) {
    var s = window.APOStore;
    if (!s || !s.setOrderHidden) {
      toast("주문 숨기기를 사용할 수 없습니다.", "warn");
      return;
    }
    var ask = hidden
      ? "사장님 주문 목록에서만 숨길까요?\n(손님의 주문 내역에는 그대로 남습니다.)"
      : "숨김을 해제해 다시 보이게 할까요?";
    if (!window.confirm(orderNo + "\n\n" + ask)) return;

    s.setOrderHidden(orderNo, hidden).then(function () {
      toast(orderNo + " · " + (hidden ? "주문 목록에서 숨겼습니다." : "다시 보이게 했습니다."), "ok");
      return loadOrders();
    }).catch(function (err) {
      toast((err && err.message) || "주문을 처리하지 못했습니다.", "warn");
    });
  }

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

  /* ── 상품 관리 ────────────────────────────────────────── */
  function stockState(p) {
    if (p.stock <= 0) return { label: "품절", cls: "soldout" };
    if (p.status === "low") return { label: "마감임박", cls: "low" };
    return { label: "판매중", cls: "available" };
  }

  function thumbMarkup(p) {
    if (p.image) {
      return '<img src="' + esc(p.image) + '" alt="" loading="lazy" />';
    }
    return '<span aria-hidden="true">' + esc(p.glyph || "📦") + "</span>";
  }

  function rowMeta(p) {
    var s = window.APOStore;
    return [
      TYPE[p.type] || (p.type === "single" ? "기타" : p.type),
      GAME[p.game] || p.game,
      p.edition ? (EDITION[p.edition] || p.edition) : null,
      won(p.price) + " / " + (s ? s.unitOf(p) : "개"),
      "재고 " + p.stock,
    ].filter(Boolean).join(" · ");
  }

  function earnBadgeMarkup(p) {
    if (!p || p.earnPoints === false) return "";
    var t = productRateText(p);
    if (Number(t) <= 0) return "";
    return '<span class="prow__earn" title="입금 확인 시 적립">적립 ' + esc(t) + "%</span>";
  }

  function hiddenBadgeMarkup(p) {
    if (!p || p.hidden !== true) return "";
    return '<span class="prow__hide" title="손님 화면에서 숨김">숨김</span>';
  }

  function productRow(p) {
    var st = stockState(p);
    var fid = "photo-" + p.id;
    return (
      '<article class="prow" data-id="' + esc(p.id) + '"' + (p.hidden === true ? ' data-hidden="true"' : "") + ">" +
      '<div class="prow__top">' +
      '<div class="prow__thumb" data-id="' + esc(p.id) + '">' + thumbMarkup(p) + "</div>" +
      '<div class="prow__meta">' +
      '<b class="prow__title" data-title>' + esc(p.name) + "</b>" +
      '<span class="prow__sub" data-sub>' + esc(rowMeta(p)) + "</span>" +
      earnBadgeMarkup(p) +
      hiddenBadgeMarkup(p) +
      "</div>" +
      '<span class="prow__state" data-status="' + st.cls + '">' + st.label + "</span>" +
      '<button class="btn btn--ghost btn--xs" type="button" data-edit-toggle>수정</button>' +
      "</div>" +

      '<div class="prow__edit" hidden>' +
      '<div class="prow__grid">' +
      '<label class="pf pf--wide"><span>상품명</span>' +
      '<input type="text" data-field="name" maxlength="60" value="' + esc(p.name) + '" /></label>' +
      '<div class="pf pf--wide"><span>대표 사진 <em>(썸네일/메인)</em></span>' +
      '<div class="pf__photo">' +
      '<input type="file" accept="image/*" id="' + esc(fid) + '" data-photo-input="' + esc(p.id) + '" hidden />' +
      '<label class="btn btn--ghost btn--xs" for="' + esc(fid) + '">사진 선택</label>' +
      '<input type="text" data-field="image_url" value="' + esc(p.imageUrl || "") + '" placeholder="사진 주소 (사진을 고르면 자동 입력)" />' +
      '<span class="pf__busy" hidden>올리는 중…</span>' +
      '</div>' +
      '<span class="pf__preview" data-preview' + (p.image ? "" : " hidden") + ">" +
      (p.image ? '<img src="' + esc(p.image) + '" alt="" />' : "") +
      "</span>" +
      "</div>" +
      '<label class="pf"><span>종목</span>' +
      '<select data-field="game">' + options(GAME, p.game) + "</select></label>" +
      '<label class="pf"><span>유형</span>' +
      '<select data-field="type">' + options(TYPE, p.type === "single" ? "etc" : p.type) + "</select></label>" +
      '<label class="pf"><span>판본</span>' +
      '<select data-field="edition">' + options(EDITION, p.edition || "") + "</select></label>" +
      '<label class="pf"><span>가격(원)</span>' +
      '<input type="number" inputmode="numeric" min="0" data-field="price" value="' + p.price + '" /></label>' +
      '<label class="pf"><span>재고</span>' +
      '<input type="number" inputmode="numeric" min="0" max="99999" data-field="stock" value="' + p.stock + '" /></label>' +
      earnFieldMarkup('data-earn-toggle data-field="earn_points"', 'data-earn-rate data-field="point_rate"', p.earnPoints !== false, p.pointRate) +
      hiddenFieldMarkup('data-field="is_hidden"', p.hidden === true) +
      '<label class="pf pf--wide"><span>한줄 설명 <em>(선택)</em></span>' +
      '<input type="text" data-field="subtitle" maxlength="80" value="' + esc(p.subtitle || "") + '" placeholder="예: SV8a / 슈링크 O" /></label>' +
      descEditorMarkup(p.description || "") +
      oripaBoxMarkup(p) +
      "</div>" +

      '<div class="prow__actions">' +
      '<button class="btn btn--gold btn--sm" type="button" data-product-save>저장</button>' +
      '<button class="btn btn--danger btn--sm" type="button" data-product-delete>삭제</button>' +
      '<button class="btn btn--text btn--xs" type="button" data-edit-toggle>닫기</button>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  /* ── 상품 관리 필터 (종목 · 유형) ─────────────────────── */
  var productGameFilter = "all";
  var productTypeFilter = "all";

  function typeKeyOf(p) {
    return p.type === "single" ? "etc" : (p.type || "box");
  }

  function renderProducts() {
    var s = window.APOStore;
    if (!s) return;
    var host = $("stockList");
    if (!host) return;
    var all = s.allProducts ? s.allProducts() : s.products();

    /* 건수: 종목·유형 칩은 공개 상품 기준, 숨긴 상품 칩은 숨김 상품 기준 */
    var gCounts = { pokemon: 0, onepiece: 0, other: 0 };
    var tCounts = { box: 0, oripa: 0, etc: 0 };
    var hiddenN = 0;
    all.forEach(function (p) {
      if (p.hidden === true) { hiddenN++; return; }
      if (gCounts[p.game] != null) gCounts[p.game]++;
      if (tCounts[typeKeyOf(p)] != null) tCounts[typeKeyOf(p)]++;
    });
    var visibleN = gCounts.pokemon + gCounts.onepiece + gCounts.other;

    var setN = function (id, n) { var el = $(id); if (el) el.textContent = n; };
    setN("pgAll", visibleN);
    setN("pgPokemon", gCounts.pokemon);
    setN("pgOnepiece", gCounts.onepiece);
    setN("pgOther", gCounts.other);
    setN("ptAll", visibleN);
    setN("ptBox", tCounts.box);
    setN("ptOripa", tCounts.oripa);
    setN("ptEtc", tCounts.etc);
    setN("ptHidden", hiddenN);

    var markChips = function (sel, attr, val) {
      var chips = document.querySelectorAll(sel + " .chip");
      for (var i = 0; i < chips.length; i++) {
        chips[i].setAttribute("aria-pressed", chips[i].getAttribute(attr) === val ? "true" : "false");
      }
    };
    markChips("#productGameFilter", "data-pgame", productGameFilter);
    markChips("#productTypeFilter", "data-ptype", productTypeFilter);

    var list = all.filter(function (p) {
      if (productTypeFilter === "hidden") {
        if (p.hidden !== true) return false;
      } else {
        if (p.hidden === true) return false;
        if (productTypeFilter !== "all" && typeKeyOf(p) !== productTypeFilter) return false;
      }
      if (productGameFilter !== "all" && p.game !== productGameFilter) return false;
      return true;
    });

    host.innerHTML = list.length
      ? list.map(productRow).join("")
      : '<p class="admin-empty__desc">이 필터에 맞는 상품이 없습니다.</p>';
  }

  /* ── 새 상품 추가 ─────────────────────────────────────── */
  function newProductMarkup() {
    return (
      '<div class="np">' +
      '<div class="np__head">' +
      "<b>새 상품 추가</b>" +
      "<p>저장하면 손님 사이트 상품 목록에 바로 나타납니다.</p>" +
      "</div>" +
      '<div class="np__grid">' +
      '<label class="pf pf--wide"><span>상품명 <em>*</em></span>' +
      '<input type="text" id="npName" maxlength="60" placeholder="예: 테라스탈 페스티벌 ex 박스" /></label>' +
      '<div class="pf pf--wide"><span>대표 사진 <em>(썸네일/메인 · 선택)</em></span>' +
      '<div class="pf__photo">' +
      '<input type="file" accept="image/*" id="npPhoto" data-photo-input="new" hidden />' +
      '<label class="btn btn--ghost btn--xs" for="npPhoto">사진 선택</label>' +
      '<input type="text" id="npImageUrl" placeholder="사진 주소 (사진을 고르면 자동 입력)" />' +
      '<span class="pf__busy" id="npBusy" hidden>올리는 중…</span>' +
      '</div>' +
      '<span class="pf__preview" id="npPreview" hidden><img alt="" /></span>' +
      "</div>" +
      '<label class="pf"><span>종목</span>' +
      '<select id="npGame">' + options(GAME, "pokemon") + "</select></label>" +
      '<label class="pf"><span>유형</span>' +
      '<select id="npType">' + options(TYPE, "box") + "</select></label>" +
      '<label class="pf"><span>판본</span>' +
      '<select id="npEdition">' + options(EDITION, "") + "</select></label>" +
      '<label class="pf"><span>가격(원) <em>*</em></span>' +
      '<input type="number" id="npPrice" inputmode="numeric" min="0" placeholder="320000" /></label>' +
      '<label class="pf"><span>재고 <em>*</em></span>' +
      '<input type="number" id="npStock" inputmode="numeric" min="0" max="99999" value="1" /></label>' +
      earnFieldMarkup('id="npEarn" data-earn-toggle', 'id="npRate" data-earn-rate', true, shopRateText()) +
      hiddenFieldMarkup('id="npHidden" data-field="is_hidden"', false) +
      '<label class="pf pf--wide"><span>한줄 설명 <em>(선택)</em></span>' +
      '<input type="text" id="npSubtitle" maxlength="80" placeholder="예: SV8a / 슈링크 O" /></label>' +
      descEditorMarkup("") +
      oripaBoxMarkup({ type: "box", totalSlots: 0, lineup: [] }) +
      "</div>" +
      '<div class="np__actions">' +
      '<button class="btn btn--gold btn--sm" type="button" id="npSave">이 상품 추가</button>' +
      '<button class="btn btn--ghost btn--sm" type="button" id="npCancel">취소</button>' +
      "</div>" +
      "</div>"
    );
  }

  function openNewProduct() {
    var host = $("newProductForm");
    if (!host) return;
    host.innerHTML = newProductMarkup();
    host.hidden = false;
    $("newProductBtn").hidden = true;
    var name = $("npName");
    if (name) name.focus();
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeNewProduct() {
    var host = $("newProductForm");
    if (host) {
      host.hidden = true;
      host.innerHTML = "";
    }
    var btn = $("newProductBtn");
    if (btn) btn.hidden = false;
  }

  function saveNewProduct() {
    var s = window.APOStore;
    if (!s) return;
    var rate = readRate($("npRate"));
    if (typeof rate === "string") {
      toast(rate, "warn");
      if ($("npRate")) $("npRate").focus();
      return;
    }
    var host = $("newProductForm");
    var type = $("npType").value;
    var data = {
      name: ($("npName").value || "").trim(),
      type: type,
      game: $("npGame").value,
      edition: $("npEdition").value || null,
      price: Number($("npPrice").value) || 0,
      stock: Number($("npStock").value) || 0,
      subtitle: ($("npSubtitle").value || "").trim(),
      image_url: ($("npImageUrl").value || "").trim(),
      earn_points: $("npEarn") ? !!$("npEarn").checked : true,
      point_rate: rate,
      is_hidden: $("npHidden") ? !!$("npHidden").checked : false,
    };

    if (!data.name) {
      toast("상품명을 입력해 주세요.", "warn");
      $("npName").focus();
      return;
    }
    if (!data.price || data.price < 0) {
      toast("가격을 입력해 주세요.", "warn");
      $("npPrice").focus();
      return;
    }

    var isOripa = type === "oripa";
    var slotsEl = host ? host.querySelector('[data-field="total_slots"]') : null;
    var slots = slotsEl ? Math.floor(Number(slotsEl.value) || 0) : 0;
    if (isOripa && slotsEl && (slots < 1 || slots > 500)) {
      toast("오리파는 총 구수를 1 ~ 500 사이로 입력해 주세요.", "warn");
      if (slotsEl) slotsEl.focus();
      return;
    }
    data.description = serializeDescBlocks(host);

    setBusy($("npSave"), true, "저장 중…");
    s.saveProduct(data)
      .then(function (p) {
        setBusy($("npSave"), false);
        closeNewProduct();
        renderProducts();
        toast(
          (p ? p.name : "상품") + "을(를) 추가했습니다. " +
            (isOripa ? "번호판 1~" + slots + "번이 준비되었습니다. " : "") +
            (data.is_hidden ? "숨김 상태라 손님 화면에는 보이지 않습니다." : "손님 사이트에 바로 보입니다."),
          "ok"
        );
      })
      .catch(function (err) {
        setBusy($("npSave"), false);
        toast((err && err.message) || "상품을 추가하지 못했습니다.", "warn");
      });
  }

  function setBusy(el, on, label) {
    if (!el) return;
    el.disabled = !!on;
    if (on) {
      el.dataset.label = el.textContent;
      el.textContent = label || "처리 중…";
    } else if (el.dataset.label) {
      el.textContent = el.dataset.label;
    }
  }

  /* ── 기존 상품 저장·삭제 ────────────────────────────── */
  function rowValues(row) {
    function v(name) {
      var el = row.querySelector('[data-field="' + name + '"]');
      return el ? el.value : "";
    }
    return {
      name: String(v("name") || "").trim(),
      type: String(v("type") || ""),
      game: String(v("game") || ""),
      edition: String(v("edition") || ""),
      price: Number(v("price")) || 0,
      stock: Number(v("stock")) || 0,
      subtitle: String(v("subtitle") || "").trim(),
      image_url: String(v("image_url") || "").trim(),
      earn_points: (function () {
        var box = row.querySelector('[data-field="earn_points"]');
        return box ? !!box.checked : true;
      })(),
      point_rate: readRate(row.querySelector('[data-field="point_rate"]')),
      is_hidden: (function () {
        var box = row.querySelector('[data-field="is_hidden"]');
        return box ? !!box.checked : false;
      })(),
    };
  }

  function saveProductRow(row) {
    var s = window.APOStore;
    if (!s) return;
    var id = row.getAttribute("data-id");
    var values = rowValues(row);
    if (!values.name) {
      toast("상품명을 비울 수 없습니다.", "warn");
      return;
    }
    if (typeof values.point_rate === "string") {
      toast(values.point_rate, "warn");
      var rateInput = row.querySelector('[data-field="point_rate"]');
      if (rateInput) rateInput.focus();
      return;
    }

    /* 오리파: 총 구수 */
    var isOripa = values.type === "oripa";
    var slotsEl = row.querySelector('[data-field="total_slots"]');
    var slots = slotsEl ? Math.floor(Number(slotsEl.value) || 0) : 0;
    if (isOripa && slotsEl && (slots < 1 || slots > 500)) {
      toast("총 구수는 1 ~ 500 사이로 입력해 주세요.", "warn");
      if (slotsEl) slotsEl.focus();
      return;
    }
    var payload = {
      id: id,
      name: values.name,
      type: values.type || undefined,
      game: values.game || undefined,
      edition: values.edition || null,
      price: values.price,
      stock: values.stock,
      subtitle: values.subtitle,
      image_url: values.image_url,
      earn_points: values.earn_points,
      point_rate: values.point_rate,
      is_hidden: values.is_hidden,
    };
    var desc = serializeDescBlocks(row);
    if (desc !== undefined) payload.description = desc;

    var btn = row.querySelector("[data-product-save]");
    setBusy(btn, true, "저장 중…");

    s.saveProduct(payload)
      .then(function (p) {
        setBusy(btn, false);
        renderProducts();
        toast(
          (p ? p.name : "상품") + " 저장했습니다. " +
            (values.is_hidden ? "(숨김 — 손님 화면에는 보이지 않습니다)" : ""),
          "ok"
        );
      })
      .catch(function (err) {
        setBusy(btn, false);
        toast((err && err.message) || "저장하지 못했습니다.", "warn");
      });
  }

  function deleteProductRow(row) {
    var s = window.APOStore;
    if (!s) return;
    var id = row.getAttribute("data-id");
    var name = row.getAttribute("data-name") || id;
    var titleEl = row.querySelector("[data-title]");
    if (titleEl) name = titleEl.textContent;

    if (!window.confirm("[" + name + "] 상품을 목록에서 완전히 삭제할까요?\n기존 주문 내역과 영수증 기록(상품명·금액·수량)은 그대로 남습니다.")) return;

    s.deleteProduct(id)
      .then(function () {
        renderProducts();
        toast("상품을 삭제했습니다. 기존 주문 내역은 그대로 남습니다.", "ok");
      })
      .catch(function (err) {
        toast((err && err.message) || "삭제하지 못했습니다.", "warn");
      });
  }

  /* ── 사진 고르기 → 업로드 → 미리보기 ──────────────── */
  function handlePhoto(input) {
    var s = window.APOStore;
    if (!s || !input || !input.files || !input.files[0]) return;
    var file = input.files[0];
    var isNew = input.getAttribute("data-photo-input") === "new";
    var idHint = isNew ? "new" : input.getAttribute("data-photo-input");

    var wrap = isNew
      ? $("newProductForm")
      : input.closest(".prow");
    if (!wrap) return;

    var busy = isNew ? $("npBusy") : wrap.querySelector(".pf__busy");
    var urlInput = isNew ? $("npImageUrl") : wrap.querySelector('[data-field="image_url"]');
    var preview = isNew ? $("npPreview") : wrap.querySelector("[data-preview]");

    if (busy) busy.hidden = false;

    s.uploadProductImage(file, idHint)
      .then(function (res) {
        if (busy) busy.hidden = true;
        if (urlInput) urlInput.value = res.url;
        if (preview) {
          preview.innerHTML = '<img src="' + esc(res.url) + '" alt="" />';
          preview.hidden = false;
        }
        if (res.warning) toast(res.warning, "warn");
        else toast("사진을 올렸습니다. [저장]을 누르면 상품에 적용됩니다.", "ok");
      })
      .catch(function (err) {
        if (busy) busy.hidden = true;
        toast((err && err.message) || "사진을 올리지 못했습니다.", "warn");
      });
  }

  /* ── 주문 설정: 비로그인 주문 허용 ──────────────────── */
  function renderSettings() {
    var s = window.APOStore;
    if (!s) return;
    var sw = $("requireLoginSwitch");
    var title = $("requireLoginTitle");
    var desc = $("requireLoginDesc");
    var state = $("requireLoginState");
    var hint = $("requireLoginHint");
    if (!sw) return;

    var requireLogin = s.requireLogin();
    var ready = s.settingsReady();
    var demo = s.isDemo();

    sw.setAttribute("aria-checked", requireLogin ? "true" : "false");
    sw.disabled = demo || !ready;
    if (state) state.textContent = requireLogin ? "ON · 회원만" : "OFF · 누구나";

    if (title) title.textContent = requireLogin ? "회원 로그인 필수" : "비로그인(게스트) 주문 허용";
    if (desc) {
      desc.textContent = requireLogin
        ? "지금은 로그인한 회원만 주문할 수 있습니다. 스위치를 끄면 비회원도 주문할 수 있습니다."
        : "지금은 누구나 로그인 없이 주문할 수 있습니다. 회원만 주문하게 하려면 스위치를 켜 주세요.";
    }

    var msg = "";
    if (demo) msg = "DB 연동 전 테스트 모드에서는 이 설정을 바꿀 수 없습니다.";
    else if (!ready) msg = "설정 표가 아직 없습니다. Supabase SQL Editor 에서 supabase-upgrade-v3.sql 을 한 번 실행해 주세요.";
    if (hint) {
      hint.textContent = msg;
      hint.hidden = !msg;
    }

    /* 기본 적립률(%) */
    var rateInput = $("pointRateInput");
    var rateSave = $("pointRateSave");
    var rateHint = $("pointRateHint");
    if (rateInput) {
      var rate = s.pointRate ? s.pointRate() : 0;
      if (document.activeElement !== rateInput) rateInput.value = String(rate);
      rateInput.disabled = demo || !ready;
      if (rateSave) rateSave.disabled = demo || !ready;
      var rmsg = "";
      if (demo) rmsg = "DB 연동 전 테스트 모드에서는 적립률을 바꿀 수 없습니다.";
      else if (!ready) rmsg = "적립률 설정은 supabase-upgrade-v3.sql 을 실행한 뒤에 쓸 수 있습니다.";
      else rmsg = "지금 설정: " + rate + "% · 49,900원 주문 시 " +
        (s.calcEarnPoints ? pts(s.calcEarnPoints(49900, rate)) : "-") + " 적립";
      if (rateHint) { rateHint.textContent = rmsg; rateHint.hidden = !rmsg; }
    }
  }

  function savePointRate() {
    var s = window.APOStore;
    if (!s || !s.setPointRate) return;
    var input = $("pointRateInput");
    var v = Number(input ? input.value : NaN);
    if (!isFinite(v) || v < 0 || v > 50) {
      toast("적립률은 0 ~ 50 사이로 입력해 주세요.", "warn");
      if (input) input.focus();
      return;
    }
    var btn = $("pointRateSave");
    setBusy(btn, true, "저장 중…");
    s.setPointRate(v)
      .then(function (rate) {
        setBusy(btn, false);
        renderSettings();
        toast("기본 적립률을 " + rate + "% 로 저장했습니다.", "ok");
      })
      .catch(function (err) {
        setBusy(btn, false);
        toast((err && err.message) || "적립률을 저장하지 못했습니다.", "warn");
      });
  }

  function toggleRequireLogin() {
    var s = window.APOStore;
    if (!s) return;
    var next = !s.requireLogin();
    var ask = next
      ? "회원만 주문하도록 바꿀까요?\n로그인하지 않은 손님은 주문할 수 없게 됩니다. (회원가입은 누구나 가능)"
      : "비회원도 주문할 수 있게 바꿀까요?\n로그인 없이도 주문이 접수됩니다.";
    if (!window.confirm(ask)) return;

    var sw = $("requireLoginSwitch");
    if (sw) sw.disabled = true;
    s.setRequireLogin(next)
      .then(function (val) {
        renderSettings();
        toast(val ? "회원 로그인 필수로 바꿨습니다." : "비로그인 주문을 허용합니다.", "ok");
      })
      .catch(function (err) {
        renderSettings();
        toast((err && err.message) || "설정을 바꾸지 못했습니다.", "warn");
      });
  }

  /* ── 회원 적립금 관리 ──────────────────────────────── */
  var memberQuery = "";
  var memberBusy = false;

  function memberRow(m) {
    var sub = [
      m.name && m.username ? m.name : "",
      m.phone ? phoneText(m.phone) : "",
      m.joined_at ? stamp(m.joined_at) + " 가입" : "",
    ].filter(Boolean).join(" · ");

    return (
      '<article class="memprow" data-user="' + esc(m.user_id) + '" data-name="' + esc(m.username || m.name || "") + '">' +
      '<div class="memprow__top">' +
      '<div class="memprow__who">' +
      '<b>' + esc(m.username || m.name || "회원") + "</b>" +
      '<span>' + esc(sub || "-") + "</span>" +
      "</div>" +
      '<div class="memprow__bal"><span>보유</span><b data-balance>' + pts(m.balance) + "</b></div>" +
      '<button class="btn btn--ghost btn--xs" type="button" data-point-toggle>적립금 조정</button>' +
      "</div>" +
      '<div class="memprow__edit" hidden>' +
      '<div class="memprow__fields">' +
      '<label class="pf"><span>지급(+) / 차감(-) P</span>' +
      '<input type="number" inputmode="numeric" step="100" data-pt-amount placeholder="예: 1000 / -500" /></label>' +
      '<label class="pf pf--wide"><span>사유 <em>(선택)</em></span>' +
      '<input type="text" maxlength="60" data-pt-memo placeholder="예: 이벤트 적립" /></label>' +
      "</div>" +
      '<div class="memprow__actions">' +
      '<button class="btn btn--gold btn--sm" type="button" data-pt-apply>적용</button>' +
      '<button class="btn btn--text btn--xs" type="button" data-point-toggle>닫기</button>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function renderMembers(list) {
    var host = $("memberList");
    var empty = $("memberEmpty");
    if (!host) return;
    if (!list || !list.length) {
      host.innerHTML = "";
      if (empty) {
        empty.textContent = memberQuery
          ? "‘" + memberQuery + "’ 와 맞는 회원이 없습니다."
          : "아직 가입한 회원이 없습니다.";
        empty.hidden = false;
      }
      return;
    }
    if (empty) empty.hidden = true;
    host.innerHTML = list.map(memberRow).join("");
  }

  function loadMembers() {
    var s = window.APOStore;
    if (!s || !s.listMemberPoints) return Promise.resolve([]);
    if (s.isDemo()) { renderMembers([]); return Promise.resolve([]); }
    var empty = $("memberEmpty");
    if (empty) empty.hidden = true;
    return s.listMemberPoints(memberQuery)
      .then(function (list) { renderMembers(list); return list; })
      .catch(function (err) {
        renderMembers([]);
        var empty2 = $("memberEmpty");
        if (empty2) {
          empty2.textContent = (err && err.code === "NEED_UPGRADE")
            ? "회원 적립금은 supabase-upgrade-v3.sql 을 실행한 뒤에 쓸 수 있습니다."
            : ((err && err.message) || "회원 목록을 불러오지 못했습니다.");
          empty2.hidden = false;
        }
        return [];
      });
  }

  function applyMemberPoints(row) {
    var s = window.APOStore;
    if (!s || !s.adjustPoints || memberBusy) return;
    var userId = row.getAttribute("data-user");
    var name = row.getAttribute("data-name") || "회원";
    var amountEl = row.querySelector("[data-pt-amount]");
    var memoEl = row.querySelector("[data-pt-memo]");
    var amount = Math.trunc(Number(amountEl ? amountEl.value : 0) || 0);
    if (!amount) {
      toast("지급(+) 또는 차감(-)할 적립금을 입력해 주세요.", "warn");
      if (amountEl) amountEl.focus();
      return;
    }

    var label = amount > 0 ? pts(amount) + " 지급" : pts(-amount) + " 차감";
    if (!window.confirm("[" + name + "] 님에게 " + label + "할까요?")) return;

    var btn = row.querySelector("[data-pt-apply]");
    memberBusy = true;
    setBusy(btn, true, "적용 중…");
    s.adjustPoints(userId, amount, memoEl ? memoEl.value : "")
      .then(function (res) {
        memberBusy = false;
        setBusy(btn, false);
        var bal = row.querySelector("[data-balance]");
        if (bal) bal.textContent = pts(res.balance);
        if (amountEl) amountEl.value = "";
        if (memoEl) memoEl.value = "";
        toast(name + " 님 " + label + " 완료 · 보유 " + pts(res.balance), "ok");
      })
      .catch(function (err) {
        memberBusy = false;
        setBusy(btn, false);
        toast((err && err.message) || "적립금을 적용하지 못했습니다.", "warn");
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
    /* ── 탭 (주문 관리 · 상품 관리 · 회원 적립금 · 입금 로그) ── */
    document.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-admin-tab]");
      if (!tab) return;
      e.preventDefault();
      setAdminTab(tab.getAttribute("data-admin-tab"));
    });

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
      renderProducts();
      renderSettings();
      loadEvents();
      toast("새로고침했습니다.", "ok");
    });

    $("eventReloadBtn").addEventListener("click", function () {
      loadEvents();
      toast("자동 입금 로그를 다시 불러왔습니다.", "ok");
    });

    $("stockReloadBtn").addEventListener("click", function () {
      window.APOStore.reload().then(function () { renderProducts(); renderSettings(); loadOrders(); });
      toast("상품을 다시 불러왔습니다.", "ok");
    });

    /* ── 기본 적립률 저장 ── */
    $("pointRateSave").addEventListener("click", savePointRate);
    $("pointRateInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); savePointRate(); }
    });

    /* ── 회원 적립금 ── */
    $("memberReloadBtn").addEventListener("click", function () {
      loadMembers().then(function () { toast("회원 적립금을 다시 불러왔습니다.", "ok"); });
    });
    $("memberSearchBtn").addEventListener("click", function () {
      memberQuery = ($("memberSearch").value || "").trim();
      loadMembers();
    });
    $("memberSearch").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      memberQuery = ($("memberSearch").value || "").trim();
      loadMembers();
    });
    $("memberList").addEventListener("click", function (e) {
      var row = e.target.closest(".memprow");
      if (!row) return;
      if (e.target.closest("[data-point-toggle]")) {
        var box = row.querySelector(".memprow__edit");
        var open = box.hidden;
        box.hidden = !open;
        if (open) {
          var amt = box.querySelector("[data-pt-amount]");
          if (amt) amt.focus();
        }
        return;
      }
      if (e.target.closest("[data-pt-apply]")) { applyMemberPoints(row); return; }
    });
    $("memberList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var input = e.target.closest("[data-pt-amount], [data-pt-memo]");
      if (!input) return;
      e.preventDefault();
      var row = input.closest(".memprow");
      if (row) applyMemberPoints(row);
    });

    /* ── 주문 설정 토글 ── */
    $("requireLoginSwitch").addEventListener("click", toggleRequireLogin);

    /* ── 새 상품 추가 ── */
    $("newProductBtn").addEventListener("click", openNewProduct);
    $("newProductForm").addEventListener("click", function (e) {
      if (e.target.closest("#npCancel")) { closeNewProduct(); return; }
      if (e.target.closest("#npSave")) { saveNewProduct(); return; }
    });

    /* ── 상품 행: 수정 열기 · 저장 · 삭제 ── */
    $("stockList").addEventListener("click", function (e) {
      var row = e.target.closest(".prow");
      if (!row) return;

      if (e.target.closest("[data-edit-toggle]")) {
        var box = row.querySelector(".prow__edit");
        var open = box.hidden;
        box.hidden = !open;
        if (open) {
          var first = box.querySelector('[data-field="name"]');
          if (first) first.focus();
          /* 오리파만: 번호판 현황 불러오기 */
          var typeSel = box.querySelector('[data-field="type"]');
          if (!typeSel || typeSel.value === "oripa") {
            if (typeSel) typeSel.value = typeSel.value || "oripa";
            loadSeatMap(box, row.getAttribute("data-id"));
          }
        }
        return;
      }
      if (e.target.closest("[data-product-save]")) { saveProductRow(row); return; }
      if (e.target.closest("[data-product-delete]")) { deleteProductRow(row); return; }
    });

    /* 사진 선택(input type=file) — 목록이 다시 그려저도 듣도록 문서에 위임 */
    document.addEventListener("change", function (e) {
      var input = e.target.closest("[data-photo-input]");
      if (!input) return;
      handlePhoto(input);
    });

    /* 적립금 지급 ON/OFF → 바로 옆 적립률(%) 입력칸 켜고 끄기 */
    document.addEventListener("change", function (e) {
      var box = e.target.closest("[data-earn-toggle]");
      if (box) syncEarnRate(box);
    });

    /* 유형을 바꾸면 오리파 번호판 설정칸을 보이고 감춥니다. */
    document.addEventListener("change", function (e) {
      var sel = e.target.closest('[data-field="type"], #npType');
      if (!sel) return;
      var scope = sel.closest(".prow__edit") || e.target.closest("#newProductForm") || document;
      toggleOripaBox(scope, sel.value === "oripa");
      if (sel.value === "oripa" && scope !== document) {
        var id = scope.getAttribute ? scope.getAttribute("data-id") : "";
        if (id) loadSeatMap(scope, id);
      }
    });

    $("orderList").addEventListener("click", function (e) {
      var delBtn = e.target.closest("[data-del-order]");
      if (delBtn) {
        askDeleteOrder(delBtn.getAttribute("data-del-order"));
        return;
      }
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      var no = btn.getAttribute("data-no");
      if (act === "hide") { toggleOrderHidden(no, true); return; }
      if (act === "unhide") { toggleOrderHidden(no, false); return; }
      changeStatus(no, act);
    });

    /* ── 상품 필터 칩 (종목 · 유형) ── */
    $("productGameFilter").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-pgame]");
      if (!chip) return;
      productGameFilter = chip.getAttribute("data-pgame") || "all";
      renderProducts();
    });
    $("productTypeFilter").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-ptype]");
      if (!chip) return;
      productTypeFilter = chip.getAttribute("data-ptype") || "all";
      renderProducts();
    });

    /* ── 상세 설명 블록 에디터 (추가 · 이동 · 삭제 · 사진) ── */
    document.addEventListener("click", function (e) {
      var add = e.target.closest("[data-desc-add]");
      if (add) {
        addDescBlock(add.closest("[data-desc-editor]"), add.getAttribute("data-desc-add"));
        return;
      }
      var editor = e.target.closest("[data-desc-editor]");
      if (!editor) return;
      var pick = e.target.closest("[data-block-pick]");
      if (pick) {
        var blk = pick.closest("[data-block]");
        var fileIn = blk ? blk.querySelector("[data-block-file]") : null;
        if (fileIn) fileIn.click();
        return;
      }
      var move = e.target.closest("[data-desc-move]");
      if (move) {
        moveDescBlock(editor, move.closest("[data-block]"), Number(move.getAttribute("data-desc-move")) || 0);
        return;
      }
      if (e.target.closest("[data-desc-del]")) {
        var delBlock = e.target.closest("[data-block]");
        if (delBlock && delBlock.parentNode) {
          delBlock.parentNode.removeChild(delBlock);
          refreshDescEmpty(editor);
        }
      }
    });
    document.addEventListener("change", function (e) {
      var fileIn = e.target.closest("[data-block-file]");
      if (fileIn) { uploadDescPhoto(fileIn); return; }
      var urlIn = e.target.closest("[data-block-url]");
      if (urlIn) renderDescPhotoPreview(urlIn.closest("[data-block]"));
    });

    $("stockList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var input = e.target.closest("[data-field]");
      if (!input) return;
      e.preventDefault();
      var row = input.closest(".prow");
      if (row) saveProductRow(row);
    });

    window.addEventListener("apo:products", renderProducts);
    window.addEventListener("apo:settings", renderSettings);
    window.addEventListener("apo:points", loadMembers);

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
    renderTabs();
    loadOrders();
    renderProducts();
    renderSettings();
    loadEvents();
    loadMembers();
  }

  function boot() {
    var s = window.APOStore;
    if (!s) {
      var loading = $("adminLoading");
      if (loading) loading.hidden = true;
      var lock = $("adminLock");
      if (lock) lock.hidden = false;
      return;
    }
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

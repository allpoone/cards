/* ============================================================
   ALL PO ONE — app.js
   cards.js 의 SITE_CONFIG / PRODUCTS 를 읽어 화면을 그립니다.
   이 파일은 수정하지 않아도 됩니다.
   ============================================================ */

(function () {
  "use strict";

  /* ── 상태 ─────────────────────────────────────────────── */
  var state = { game: "all", type: "all", edition: "all", q: "" };

  var STATUS = {
    available: { label: "판매중", order: 0 },
    low: { label: "마감임박", order: 1 },
    soldout: { label: "완판", order: 2 },
  };

  var TYPE = {
    box: { label: "미개봉 박스", short: "박스" },
    oripa: { label: "오리파", short: "오리파" },
    etc: { label: "기타", short: "기타" },
    single: { label: "기타", short: "기타" },   // 예전 분류 호환
  };

  var LANG = { JP: "일판", KR: "한판", EN: "영판" };
  var GAME_LABEL = { pokemon: "POKÉMON", onepiece: "ONE PIECE", other: "기타" };

  var SHRINK = { O: "슈링크 O", X: "슈링크 X", CARTON: "카톤" };

  /* 판본(edition) 줄은 [미개봉 박스]를 골랐을 때만 보입니다. */
  var filterDefs = {
    game: [
      { key: "all", label: "전체" },
      { key: "pokemon", label: "포켓몬" },
      { key: "onepiece", label: "원피스" },
      { key: "other", label: "기타" },
    ],
    type: [
      { key: "all", label: "전체" },
      { key: "box", label: "미개봉 박스" },
      { key: "oripa", label: "오리파" },
      { key: "etc", label: "기타" },
    ],
    edition: [
      { key: "all", label: "전체" },
      { key: "KR", label: "한판(KR)" },
      { key: "JP", label: "일판(JP)" },
      { key: "EN", label: "영판(EN)" },
    ],
  };

  /* ── DOM ──────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  var grid, emptyState, searchInput, searchClear, resultCount, lastFocused = null;

  /* ── 유틸 ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function won(n) {
    return "₩" + (Number(n) || 0).toLocaleString("ko-KR");
  }

  function kakaoUrl() {
    return (SITE_CONFIG.openKakaoUrl || "").trim();
  }

  function typeOf(p) {
    return TYPE[p.type] || TYPE.box;
  }

  /* 판본: DB edition 우선, 없으면 cards.js language */
  function editionOf(p) {
    return p.edition || p.language || "";
  }

  function langOf(p) {
    var e = editionOf(p);
    return e ? (LANG[e] || e) : "";
  }

  /* 실시간 재고가 반영된 상품 목록 (store.js 가 없으면 cards.js 값 그대로) */
  function productList() {
    return window.APOStore ? APOStore.products() : PRODUCTS;
  }

  /* 수량/가격 단위 */
  function unitWord(p) {
    if (p.type === "oripa") return "구";
    if (p.type === "etc" || p.type === "single") return "개";
    return p.shrink === "CARTON" ? "카톤" : "박스";
  }

  function stockText(p) {
    if (p.type === "oripa") {
      var left = Number(p.remainingUnits) || 0;
      var total = Math.max(Number(p.totalUnits) || 0, left);
      return "총 " + total + "구 · " + left + "구 남음";
    }
    var n = Number(p.remaining) || 0;
    var w = unitWord(p);
    return n > 0 ? "잔여 " + n + w : "잔여 0" + w;
  }

  function specText(p) {
    var parts = [langOf(p)];
    if (p.type === "oripa") {
      parts.push("1구 " + won(p.price));
      parts.push(stockText(p));
    } else {
      if (p.shrink) parts.push(SHRINK[p.shrink] || "");
      parts.push(stockText(p));
    }
    return parts.filter(Boolean).join(" · ");
  }

  function mainPrize(p) {
    if (!p.prizes || !p.prizes.length) return null;
    for (var i = 0; i < p.prizes.length; i++) {
      if (p.prizes[i].label.indexOf("메인") === 0) return p.prizes[i];
    }
    return p.prizes[0];
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return fallbackCopy(text); }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
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

  function productInfoText(p) {
    var lines = [];
    var isOripa = p.type === "oripa";
    lines.push("[" + SITE_CONFIG.shopName + (isOripa ? " 오리파 참여 문의]" : " 구매 문의]"));
    lines.push("상품: " + p.name);
    lines.push("구분: " + typeOf(p).label);
    var setLine = p.series || "";
    if (p.setCode) setLine += " (" + p.setCode + ")";
    if (setLine) lines.push("시리즈: " + setLine);
    if (langOf(p)) lines.push("판본: " + langOf(p));
    if (isOripa) {
      lines.push("가격: " + won(p.price) + " / 1구");
      lines.push("구성: " + stockText(p));
      if (mainPrize(p)) lines.push(mainPrize(p).label + ": " + mainPrize(p).name);
    } else {
      if (p.shrink) lines.push("상태: " + (SHRINK[p.shrink] || ""));
      lines.push("가격: " + won(p.price) + " / " + unitWord(p));
      lines.push("수량: " + stockText(p));
      if (p.unitNote) lines.push("비고: " + p.unitNote);
    }
    lines.push("판매 상태: " + (STATUS[p.status] || STATUS.available).label);
    return lines.join("\n");
  }

  /* ── 토스트 ───────────────────────────────────────────── */
  function toast(message, kind) {
    var stack = $("toastStack");
    if (!stack) return;
    var el = document.createElement("div");
    el.className = "toast toast--" + (kind || "info");
    el.setAttribute("role", kind === "warn" ? "alert" : "status");
    var icon = kind === "ok" ? "✅" : kind === "warn" ? "⚠️" : "💬";
    el.innerHTML =
      '<span class="toast__icon" aria-hidden="true">' + icon + "</span>" +
      '<span class="toast__msg">' + esc(message) + "</span>";
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add("toast--out");
      setTimeout(function () { el.remove(); }, 260);
    }, kind === "warn" ? 4600 : 3000);
  }

  /* ── 아트 마크업 ──────────────────────────────────────── */
  function artMarkup(p) {
    var style =
      "--c1:" + (p.c1 || "#1b2233") + ";--c2:" + (p.c2 || "#3b4a63") +
      ";--accent:" + (p.accent || "#ffffff") + ";";
    var img = p.image
      ? '<img class="art__img" src="' + esc(p.image) + '" alt="' + esc(p.name) + ' 사진" loading="lazy" />'
      : "";
    return (
      '<div class="art" style="' + style + '">' +
      img +
      '<span class="art__noise"></span>' +
      '<span class="art__holo"></span>' +
      '<span class="art__sheen"></span>' +
      '<span class="art__frame"></span>' +
      '<span class="art__glyph" aria-hidden="true">' + esc(p.glyph || "📦") + "</span>" +
      '<span class="art__label">' + esc(p.name) + "</span>" +
      '<span class="art__tags">' +
      '<span class="art__game" data-game="' + esc(p.game) + '">' + esc(GAME_LABEL[p.game] || "") + "</span>" +
      (p.sample ? '<span class="art__sample">SAMPLE</span>' : "") +
      "</span>" +
      "</div>"
    );
  }

  /* ── 필터 칩 ──────────────────────────────────────────── */
  function countFor(kind, key) {
    return productList().filter(function (p) {
      if (key === "all") return true;
      if (kind === "edition") return editionOf(p) === key;
      return p[kind] === key;
    }).length;
  }

  function buildChips() {
    Object.keys(filterDefs).forEach(function (kind) {
      var host = document.querySelector('[data-filter="' + kind + '"]');
      if (!host) return;
      host.innerHTML = filterDefs[kind]
        .map(function (f) {
          var pressed = state[kind] === f.key ? "true" : "false";
          return (
            '<button class="chip" type="button" aria-pressed="' + pressed +
            '" data-key="' + esc(f.key) + '">' + esc(f.label) +
            '<span class="chip__n">' + countFor(kind, f.key) + "</span></button>"
          );
        })
        .join("");
    });
  }

  /* ── 필터링 ───────────────────────────────────────────── */
  function normalize(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }

  function matches(p) {
    if (state.game !== "all" && p.game !== state.game) return false;
    if (state.type !== "all" && p.type !== state.type) return false;
    if (state.type === "box" && state.edition !== "all" && editionOf(p) !== state.edition) return false;
    if (state.q) {
      var prizeNames = (p.prizes || []).map(function (x) { return x.name + " " + x.label; }).join(" ");
      var pool = normalize(
        [p.name, p.nameEn, p.series, p.setCode, langOf(p), typeOf(p).label, GAME_LABEL[p.game], prizeNames].join(" ")
      );
      var terms = normalize(state.q).split(",").filter(Boolean);
      for (var i = 0; i < terms.length; i++) {
        if (pool.indexOf(terms[i]) === -1) return false;
      }
    }
    return true;
  }

  /* ── 카드 렌더 ────────────────────────────────────────── */
  function cardMarkup(p, index) {
    var st = STATUS[p.status] || STATUS.available;
    var sold = p.status === "soldout";
    var isOripa = p.type === "oripa";
    var mp = mainPrize(p);

    var cartBtn = sold
      ? '<button class="btn btn--gold btn--cart" type="button" disabled>품절 · 담기 불가</button>'
      : '<button class="btn btn--gold btn--cart" type="button" data-action="cart">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 4h2.2l2.3 11.2h10.3L20.5 7H6.2M9.5 19.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM17.5 19.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z"/></svg>' +
        "장바구니 담기</button>";

    var actions = cartBtn +
      (isOripa
        ? '<button class="btn btn--ghost" type="button" data-action="detail">당첨 라인업</button>' +
          (sold
            ? '<button class="btn btn--kakao" type="button" disabled>완판</button>'
            : '<button class="btn btn--kakao" type="button" data-action="inquire">오픈톡 참여 문의</button>')
        : '<button class="btn btn--ghost" type="button" data-action="detail">상세</button>' +
          (sold
            ? '<button class="btn btn--kakao" type="button" disabled>완판</button>'
            : '<button class="btn btn--kakao" type="button" data-action="inquire">오픈톡 문의</button>'));

    return (
      '<article class="card" data-status="' + esc(p.status) + '" data-type="' + esc(p.type) +
      '" data-id="' + esc(p.id) + '" style="animation-delay:' + Math.min(index * 45, 360) + 'ms">' +
      '<div class="card__media">' +
      artMarkup(p) +
      '<span class="type-badge" data-type="' + esc(p.type) + '">' + esc(typeOf(p).label) + "</span>" +
      '<span class="status-badge" data-status="' + esc(p.status) + '">' + esc(st.label) + "</span>" +
      "</div>" +
      '<div class="card__body">' +
      '<h3 class="card__name">' + esc(p.name) + "</h3>" +
      '<p class="card__set">' + esc(p.series || "") + (p.setCode ? " · " + esc(p.setCode) : "") + "</p>" +
      '<p class="card__spec">' + esc(specText(p)) + "</p>" +
      (isOripa && mp
        ? '<p class="card__prize">🏆 <b>' + esc(mp.label) + "</b> " + esc(mp.name) + "</p>"
        : "") +
      '<div class="card__price-row">' +
      '<span class="card__price">' + won(p.price) + "</span>" +
      '<span class="card__unit">/ ' + esc(unitWord(p)) + "</span>" +
      "</div>" +
      '<div class="card__actions">' + actions + "</div>" +
      "</div>" +
      "</article>"
    );
  }

  /* 판본 줄은 [미개봉 박스]를 골랐을 때만 보입니다. */
  function syncFilterRows() {
    var rows = document.querySelectorAll("[data-filter-row]");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-filter-row") === "edition") {
        rows[i].hidden = state.type !== "box";
      }
    }
  }

  function render() {
    syncFilterRows();
    var list = productList().filter(matches);
    list.sort(function (a, b) {
      return (STATUS[a.status] || STATUS.available).order - (STATUS[b.status] || STATUS.available).order;
    });

    grid.innerHTML = list.map(cardMarkup).join("");
    grid.hidden = list.length === 0;
    emptyState.hidden = list.length !== 0;
    resultCount.innerHTML = '<b>' + list.length + "</b> / " + productList().length + "개";
    searchClear.hidden = !state.q;
    syncGameBadges();
  }

  /* 헤더 종목 버튼 상태 동기화 */
  function syncGameBadges() {
    var badges = document.querySelectorAll("[data-game-filter]");
    for (var i = 0; i < badges.length; i++) {
      var g = badges[i].getAttribute("data-game-filter");
      badges[i].setAttribute("aria-pressed", state.game === g ? "true" : "false");
    }
  }

  function updateStats() {
    var list = productList();
    $("statTotal").textContent = list.length;
    $("statAvailable").textContent = list.filter(function (p) {
      return p.status === "available" || p.status === "low";
    }).length;
    $("statOripa").textContent = list.filter(function (p) { return p.type === "oripa"; }).length;
  }

  /* ── 상세 모달 ────────────────────────────────────────── */
  function detailMarkup(p) {
    var st = STATUS[p.status] || STATUS.available;
    var isOripa = p.type === "oripa";
    var hasUrl = !!kakaoUrl();
    var rows = [];

    rows.push(["종목", p.game === "onepiece" ? "원피스 카드 게임" : "포켓몬 카드"]);
    rows.push(["구분", typeOf(p).label]);
    rows.push(["시리즈", (p.series || "-") + (p.setCode ? " (" + p.setCode + ")" : "")]);
    if (editionOf(p)) rows.push(["판본", langOf(p)]);

    if (isOripa) {
      rows.push(["1구 가격", won(p.price)]);
      rows.push(["구성", stockText(p)]);
    } else {
      if (p.shrink) rows.push(["포장 상태", SHRINK[p.shrink] || "-"]);
      rows.push(["수량", stockText(p)]);
      if (p.unitNote) rows.push(["단위", p.unitNote]);
      rows.push([unitWord(p) + "당 가격", won(p.price)]);
    }
    rows.push(["상태", '<span class="status-badge" data-status="' + esc(p.status) +
      '" style="position:static;display:inline-flex">' + esc(st.label) + "</span>"]);

    var lineup = "";
    if (isOripa && p.prizes && p.prizes.length) {
      lineup =
        '<div class="lineup">' +
        '<h3 class="lineup__title">당첨 라인업</h3>' +
        '<ul class="lineup__list">' +
        p.prizes.map(function (x) {
          var main = x.label.indexOf("메인") === 0;
          return '<li class="lineup__item' + (main ? " is-main" : "") + '">' +
            '<span class="lineup__label">' + esc(x.label) + "</span>" +
            '<span class="lineup__name">' + esc(x.name) + "</span></li>";
        }).join("") +
        "</ul>" +
        (p.lineupNote ? '<p class="lineup__note">' + esc(p.lineupNote) + "</p>" : "") +
        "</div>";
    }

    return (
      '<div class="detail">' +
      '<div class="detail__art-wrap"><div class="detail__art" style="--c1:' +
      esc(p.c1 || "#1b2233") + ";--c2:" + esc(p.c2 || "#3b4a63") + ";--accent:" + esc(p.accent || "#fff") + '">' +
      (p.image
        ? '<img class="art__img" src="' + esc(p.image) + '" alt="' + esc(p.name) + ' 사진" />'
        : '<span class="art__noise"></span><span class="art__holo" style="opacity:.7"></span><span class="art__frame"></span>') +
      '<span class="art__glyph" aria-hidden="true">' + esc(p.glyph || "📦") + "</span>" +
      "</div></div>" +
      '<div class="detail__info">' +
      '<div class="detail__kind">' +
      '<span class="badge badge--' + (p.game === "onepiece" ? "one" : "poke") + '">' +
      esc(GAME_LABEL[p.game] || "") + "</span>" +
      '<span class="type-badge" data-type="' + esc(p.type) + '" style="position:static">' + esc(typeOf(p).label) + "</span>" +
      (p.sample ? '<span class="art__sample" style="position:static">SAMPLE</span>' : "") +
      "</div>" +
      '<h2 class="detail__name" id="modalTitle">' + esc(p.name) + "</h2>" +
      (p.nameEn ? '<p class="detail__name-en">' + esc(p.nameEn) + "</p>" : "") +
      '<div class="detail__price"><strong>' + won(p.price) + "</strong><span>/ " + esc(unitWord(p)) + " · KRW</span></div>" +
      "<dl>" + rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>" +
      lineup +
      (p.note ? '<p class="detail__note">' + esc(p.note) + "</p>" : "") +
      (p.soldOut
        ? '<p class="detail__sold">품절된 상품입니다. 재입고는 오픈톡으로 문의해 주세요.</p>'
        : '<div class="detail__buy">' +
          '<div class="qty" role="group" aria-label="수량">' +
          '<button class="qty__btn" type="button" data-detail-step="-1" aria-label="수량 줄이기">−</button>' +
          '<input class="qty__input" id="detailQty" type="number" inputmode="numeric" min="1" max="' +
          p.stock + '" value="1" aria-label="수량" />' +
          '<button class="qty__btn" type="button" data-detail-step="1" aria-label="수량 늘리기">+</button>' +
          "</div>" +
          '<button class="btn btn--gold btn--buy" type="button" data-cart-add="' + esc(p.id) + '">장바구니 담기</button>' +
          '<span class="detail__stock">남은 수량 ' + p.stock + esc(unitWord(p)) + "</span>" +
          "</div>") +
      '<div class="detail__actions">' +
      '<button class="btn btn--ghost" type="button" data-copy="' + esc(p.id) + '">정보 복사하기</button>' +
      '<button class="btn btn--kakao" type="button" data-inquire="' + esc(p.id) + '">' +
      (isOripa ? "오픈톡 참여 문의" : "오픈톡 구매 문의") + "</button>" +
      "</div>" +
      '<p class="detail__hint">복사한 정보를 오픈톡에 붙여넣으면 확인이 빠릅니다.</p>' +
      (hasUrl
        ? ""
        : '<p class="detail__warn">오픈톡 링크가 아직 연결되지 않았습니다. 링크가 연결되면 이 버튼으로 바로 문의할 수 있습니다.</p>') +
      "</div></div>"
    );
  }

  function openModal(p) {
    var modal = $("detailModal");
    $("modalBody").innerHTML = detailMarkup(p);
    modal.hidden = false;
    document.body.classList.add("modal-open");
    lastFocused = document.activeElement;
    var closeBtn = modal.querySelector(".modal__close");
    if (closeBtn) closeBtn.focus();
    if (history.replaceState) history.replaceState(null, "", "#" + p.id);
  }

  function closeModal() {
    var modal = $("detailModal");
    if (modal.hidden) return;
    modal.hidden = true;
    $("modalBody").innerHTML = "";
    document.body.classList.remove("modal-open");
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function findProduct(id) {
    if (window.APOStore) {
      var live = APOStore.getProduct(id);
      if (live) return live;
    }
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i];
    return null;
  }

  /* ── 문의 동작 ────────────────────────────────────────── */
  function inquire(p) {
    var url = kakaoUrl();
    if (!url) {
      toast(
        "오픈톡 링크가 아직 연결되지 않았습니다. 판매자에게 문의 링크 연결을 요청해 주세요.",
        "warn"
      );
      return;
    }
    if (p) {
      copyText(productInfoText(p));
      toast("상품 정보를 복사했습니다. 오픈톡에 붙여넣어 주세요.", "ok");
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /* ── 이벤트 연결 ──────────────────────────────────────── */
  function wire() {
    ["game", "type", "edition"].forEach(function (kind) {
      var host = document.querySelector('[data-filter="' + kind + '"]');
      if (!host) return;
      host.addEventListener("click", function (e) {
        var chip = e.target.closest(".chip");
        if (!chip) return;
        state[kind] = chip.getAttribute("data-key");
        /* 박스가 아니면 판본 필터는 의미가 없습니다 → 전체로 초기화 */
        if (kind === "type" && state.type !== "box") state.edition = "all";
        buildChips();
        render();
      });
    });

    /* 헤더 종목 버튼: 누르면 해당 종목만, 다시 누르면 전체 */
    var badges = document.querySelectorAll("[data-game-filter]");
    for (var i = 0; i < badges.length; i++) {
      badges[i].addEventListener("click", function () {
        var g = this.getAttribute("data-game-filter");
        state.game = state.game === g ? "all" : g;
        buildChips();
        render();
        var target = $("products");
        if (target && target.scrollIntoView) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    var t = null;
    searchInput.addEventListener("input", function () {
      var v = searchInput.value;
      clearTimeout(t);
      t = setTimeout(function () {
        state.q = v.trim();
        render();
      }, 90);
    });
    searchClear.addEventListener("click", function () {
      searchInput.value = "";
      state.q = "";
      render();
      searchInput.focus();
    });

    function reset() {
      state = { game: "all", type: "all", edition: "all", q: "" };
      searchInput.value = "";
      buildChips();
      render();
    }
    $("resetFilters").addEventListener("click", reset);
    $("emptyReset").addEventListener("click", reset);

    grid.addEventListener("click", function (e) {
      var cardEl = e.target.closest(".card");
      if (!cardEl) return;
      var p = findProduct(cardEl.getAttribute("data-id"));
      if (!p) return;
      var btn = e.target.closest("[data-action]");
      if (btn) {
        var action = btn.getAttribute("data-action");
        if (action === "detail") { openModal(p); return; }
        if (action === "cart") {
          e.stopPropagation();
          var res = window.APOStore
            ? APOStore.addToCart(p.id, 1)
            : { ok: false, message: "장바구니를 사용할 수 없습니다." };
          toast(res.message, res.ok && !res.clamped ? "ok" : "warn");
          if (!res.ok && (res.reason === "stock" || res.reason === "soldout")) render();
          return;
        }
        if (action === "inquire") { e.stopPropagation(); inquire(p); return; }
      }
      if (!e.target.closest("button")) openModal(p);
    });

    grid.addEventListener("pointermove", function (e) {
      var art = e.target.closest(".art");
      if (!art) return;
      var r = art.getBoundingClientRect();
      art.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      art.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    });

    $("modalBody").addEventListener("click", function (e) {
      var stepBtn = e.target.closest("[data-detail-step]");
      if (stepBtn) {
        var input = $("detailQty");
        if (input) {
          var max = Number(input.max) || 1;
          var v = (Number(input.value) || 1) + Number(stepBtn.getAttribute("data-detail-step"));
          input.value = Math.min(max, Math.max(1, v));
        }
        return;
      }

      var addBtn = e.target.closest("[data-cart-add]");
      if (addBtn) {
        var pid = addBtn.getAttribute("data-cart-add");
        var qtyEl = $("detailQty");
        var q = qtyEl ? Math.max(1, Number(qtyEl.value) || 1) : 1;
        var res = window.APOStore
          ? APOStore.addToCart(pid, q)
          : { ok: false, message: "장바구니를 사용할 수 없습니다." };
        toast(res.message, res.ok && !res.clamped ? "ok" : "warn");
        if (res.ok) {
          closeModal();
          if (window.APOShop) APOShop.openCart();
        } else if (res.reason === "stock" || res.reason === "soldout") {
          render();
        }
        return;
      }

      var copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) {
        var c = findProduct(copyBtn.getAttribute("data-copy"));
        if (!c) return;
        copyText(productInfoText(c)).then(function (ok) {
          toast(ok ? "상품 정보를 복사했습니다." : "복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.", ok ? "ok" : "warn");
        });
        return;
      }
      var inqBtn = e.target.closest("[data-inquire]");
      if (inqBtn) {
        var attr = inqBtn.getAttribute("data-inquire");
        inquire(attr ? findProduct(attr) : null);
      }
    });

    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-inquire]");
      if (!b) return;
      if (b.closest("#modalBody")) return;
      var id = b.getAttribute("data-inquire");
      inquire(id ? findProduct(id) : null);
    });

    $("detailModal").addEventListener("click", function (e) {
      if (e.target.closest("[data-close]") || e.target.classList.contains("modal__backdrop")) {
        closeModal();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    var controls = document.querySelector(".controls");
    if (controls) {
      var onScroll = function () {
        controls.classList.toggle("is-stuck", window.scrollY > 80);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  /* ── 초기 렌더 ────────────────────────────────────────── */
  function applyConfig() {
    var c = SITE_CONFIG;
    document.title = c.shopName + " — " + (c.tagline || "");
    $("shopName").textContent = c.shopName;
    $("shopNameKo").textContent = c.shopNameKo || "";
    $("intro").textContent = c.intro || "";
    $("guideTitle").textContent = c.guideTitle || "진행 안내";
    $("guideIntro").textContent = c.guideIntro || "";
    $("guideNotice").textContent = c.guideNotice || "";
    $("footerShop").textContent = c.shopName;
    $("footerNote").textContent = c.footerNote || "";

    $("guideGrid").innerHTML = (c.guideItems || [])
      .map(function (g) {
        return (
          '<div class="guide-card">' +
          '<div class="guide-card__icon" aria-hidden="true">' + esc(g.icon || "•") + "</div>" +
          "<h3>" + esc(g.title) + "</h3>" +
          "<p>" + esc(g.body) + "</p>" +
          "</div>"
        );
      })
      .join("");

    var banner = $("sampleBanner");
    if (c.showSampleBanner && productList().some(function (x) { return x.sample; })) {
      banner.hidden = false;
      $("sampleBannerText").textContent = c.sampleBannerText || "샘플 데이터입니다.";
    } else {
      banner.hidden = true;
    }

    /* 유튜브 라이브 버튼 (링크가 있을 때만) */
    var yt = $("ytLink");
    if (yt) {
      if ((c.youtubeUrl || "").trim()) {
        yt.href = c.youtubeUrl.trim();
        yt.hidden = false;
      } else {
        yt.hidden = true;
      }
    }

    /* 헤더 오픈톡 바로가기 (cards.js 의 openKakaoUrl 을 그대로 사용) */
    var kakao = $("headerKakao");
    if (kakao) {
      var url = (c.openKakaoUrl || "").trim();
      if (url) {
        kakao.href = url;
        kakao.hidden = false;
      } else {
        kakao.hidden = true;
      }
    }
  }

  function boot() {
    grid = $("cardGrid");
    emptyState = $("emptyState");
    searchInput = $("searchInput");
    searchClear = $("searchClear");
    resultCount = $("resultCount");

    applyConfig();

    /* 재고를 먼저 읽은 뒤(테스트 모드: 즉시, DB 연결: 조회 후) 화면을 그립니다. */
    var start = window.APOStore ? APOStore.init() : Promise.resolve();
    start.then(function () {
      updateStats();
      buildChips();
      render();
      wire();

      if (location.hash && location.hash.length > 1) {
        var p = findProduct(location.hash.slice(1));
        if (p) setTimeout(function () { openModal(p); }, 120);
      }
    });

    /* 주문·재고·관리자 수정으로 수치가 바뀌면 다시 그립니다. */
    window.addEventListener("apo:products", function () {
      updateStats();
      buildChips();
      render();
    });

    /* shop.js 등에서 재고 갱신 시 사용 */
    window.APO = {
      render: function () { updateStats(); buildChips(); render(); },
      toast: toast,
      openDetail: openModal,
      closeDetail: closeModal,
      productList: productList,
      unitWord: unitWord,
      won: won,
      esc: esc,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

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

  /* ── 당첨 라인업 5등급 ────────────────────────────────── */
  var TIERS = [
    { key: "dia", label: "다이아", cls: "prize--dia" },
    { key: "gold", label: "골드", cls: "prize--gold" },
    { key: "silver", label: "실버", cls: "prize--silver" },
    { key: "bronze", label: "브론즈", cls: "prize--bronze" },
    { key: "last", label: "라스트원상", cls: "prize--last" },
  ];
  var TIER_BY_KEY = {};
  var TIER_ORDER = {};
  TIERS.forEach(function (t, i) { TIER_BY_KEY[t.key] = t; TIER_ORDER[t.key] = i; });

  /* 예전 라벨(메인 어타리 / 어타리)도 5등급으로 옮겨 줍니다. */
  function tierKeyOf(item) {
    if (item && item.tier && TIER_BY_KEY[item.tier]) return item.tier;
    var s = String((item && item.label) || "");
    if (/다이아|메인/.test(s)) return "dia";
    if (/실버/.test(s)) return "silver";
    if (/브론즈/.test(s)) return "bronze";
    if (/라스트/.test(s)) return "last";
    if (/골드|어타리/.test(s)) return "gold";
    return "gold";
  }

  /* 상품의 라인업을 5등급 순서로 정리 */
  function lineupOf(p) {
    var raw = (p && p.lineup && p.lineup.length ? p.lineup : (p && p.prizes)) || [];
    var rows = [];
    raw.forEach(function (x) {
      if (!x || !x.name) return;
      var key = tierKeyOf(x);
      rows.push({
        key: key,
        label: (TIER_BY_KEY[key] || {}).label || "",
        name: String(x.name),
        qty: (x.qty == null || x.qty === "") ? null : Number(x.qty) || 0,
      });
    });
    rows.sort(function (a, b) { return (TIER_ORDER[a.key] || 0) - (TIER_ORDER[b.key] || 0); });
    return rows;
  }

  function lineupMarkup(rows, note) {
    if (!rows || !rows.length) return "";
    return (
      '<div class="lineup">' +
      '<h3 class="lineup__title">당첨 라인업</h3>' +
      '<ul class="lineup__list">' +
      rows.map(function (x) {
        var cls = (TIER_BY_KEY[x.key] || {}).cls || "prize--gold";
        return '<li class="prize ' + cls + '">' +
          '<span class="prize__rank">' + esc(x.label) + "</span>" +
          '<span class="prize__name">' + esc(x.name) + "</span>" +
          (x.qty === null ? "" : '<span class="prize__qty">' + x.qty + "</span>") +
          "</li>";
      }).join("") +
      "</ul>" +
      (note ? '<p class="lineup__note">' + esc(note) + "</p>" : "") +
      "</div>"
    );
  }

  /* 상세 설명 (글 · 사진 블록 — 사장님이 순서대로 저장한 값) */
  function parseDescBlocks(raw) {
    var TAG = "APO_BLOCKS_V1::";
    var s = String(raw == null ? "" : raw);
    if (s.indexOf(TAG) !== 0) {
      return s.trim() ? [{ type: "text", text: s }] : [];
    }
    try {
      var arr = JSON.parse(s.slice(TAG.length));
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

  function descBlocksMarkup(raw) {
    var blocks = parseDescBlocks(raw);
    if (!blocks.length) return "";
    var html = "";
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].type === "photo") {
        if (blocks[i].url) html += '<img class="detail__desc-img" src="' + esc(blocks[i].url) + '" alt="" loading="lazy" />';
      } else {
        html += '<p class="detail__desc-p">' + esc(blocks[i].text) + "</p>";
      }
    }
    return html ? '<div class="detail__desc">' + html + "</div>" : "";
  }

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

  /* ============================================================
     화면 히스토리 — 휴대폰 뒤로가기 지원
     상품 상세(#product=ID) · 마이페이지(#mypage)는 전체 화면 페이지,
     장바구니 · 주문서 · 로그인 · 주문완료 · 주문조회는 창입니다.
     뒤로가기를 누르면 사이트 밖으로 나가지 않고 지금 열린 화면만 닫힙니다.
     shop.js 도 window.APONav 를 함께 사용합니다.
     ============================================================ */
  var Nav = (function () {
    var baseUrl = location.pathname + location.search;
    var regs = {};

    function ours(st) { return !!(st && st.apo === 1 && st.view); }
    function current() { return ours(history.state) ? history.state : null; }

    function hashFor(view, id) {
      if (view === "product") return "#product=" + encodeURIComponent(id || "");
      return "#" + view;
    }

    function save(mode, view, id, extra) {
      var st = { apo: 1, view: view };
      var k;
      if (id) st.id = id;
      if (extra) {
        for (k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) st[k] = extra[k];
        }
      }
      try {
        if (mode === "replace") history.replaceState(st, "", hashFor(view, id));
        else history.pushState(st, "", hashFor(view, id));
      } catch (e) { /* 히스토리를 쓸 수 없는 환경 — 화면만 동작합니다. */ }
    }

    function reset() {
      try { history.replaceState(null, "", baseUrl); } catch (e) { /* 무시 */ }
    }

    function register(view, handlers) {
      if (view && handlers) regs[view] = handlers;
    }

    function isOpen(view) {
      return !!(regs[view] && regs[view].isOpen && regs[view].isOpen());
    }

    function hide(view) {
      if (regs[view] && regs[view].hide) regs[view].hide();
    }

    function refreshLock() {
      var any = false, v;
      for (v in regs) {
        if (Object.prototype.hasOwnProperty.call(regs, v) && isOpen(v)) any = true;
      }
      if (document.body && document.body.classList) {
        document.body.classList.toggle("modal-open", any);
      }
    }

    /* 화면 열기
       mode: "push"(기본 — 한 칸 추가) · "replace"(지금 칸을 갈아끼움)
             · "fresh"(처음으로 되돌리고 새 칸 — 주문 완료처럼 흐름이 끝난 화면) */
    function show(view, id, mode) {
      if (!view) return;
      if (mode === "fresh") { reset(); save("push", view, id); return; }
      if (mode === "replace") { save("replace", view, id); return; }
      var st = current();
      if (!st) { save("push", view, id); return; }
      if (st.view === view && String(st.id || "") === String(id || "")) {
        save("replace", view, id, st.base ? { base: true } : null);
        return;
      }
      /* 지금 칸의 창이 이미 닫혀 있으면 다음 화면으로 갈아끼우는 중입니다. */
      if (st.view !== view && !isOpen(st.view)) { save("replace", view, id); return; }
      save("push", view, id);
    }

    /* 지금 칸의 이름표만 바꿉니다 (마이페이지 탭 전환 등) — 히스토리는 늘지 않습니다. */
    function relabel(view, extra) {
      var st = current();
      if (!st || st.view !== view) return;
      var next = { apo: 1, view: view }, k;
      if (st.id) next.id = st.id;
      if (st.base) next.base = true;
      if (extra) {
        for (k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) next[k] = extra[k];
        }
      }
      try { history.replaceState(next, "", location.hash || hashFor(view, st.id)); } catch (e) { /* 무시 */ }
    }

    /* 사용자가 화면을 닫을 때 — 화면을 먼저 숨기고 지금 칸을 깨끗한 메인으로 되돌립니다.
       (history.back 을 쓰지 않아 뒤이어 열리는 다른 화면과 겹치지 않습니다.
        폰 뒤로가기는 popstate → apply 로 처리됩니다.) */
    function close(view) {
      var st = current();
      hide(view);
      if (st && st.view === view) reset();
    }

    /* 공유 링크(#product=…, #mypage)로 바로 들어왔을 때의 첫 칸 */
    function seed(view, id) {
      try {
        history.replaceState({ apo: 1, view: view, id: id || "", base: true }, "", hashFor(view, id));
      } catch (e) { /* 무시 */ }
    }

    /* 지금 히스토리에 맞춰 모든 화면을 다시 맞춥니다 */
    function apply(st) {
      var view = (st && st.view) || "", v;
      for (v in regs) {
        if (!Object.prototype.hasOwnProperty.call(regs, v)) continue;
        if (v === view) {
          if (!isOpen(v)) regs[v].show((st && st.id) || "", st || {});
        } else if (isOpen(v)) {
          regs[v].hide();
        }
      }
      refreshLock();
    }

    window.addEventListener("popstate", function () { apply(current()); });

    return {
      register: register,
      show: show,
      close: close,
      relabel: relabel,
      seed: seed,
      apply: apply,
      hide: hide,
      isOpen: isOpen,
      refreshLock: refreshLock,
      current: current,
    };
  })();
  window.APONav = Nav;

  /* ── 유틸 ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function won(n) {
    return "₩" + (Number(n) || 0).toLocaleString("ko-KR");
  }

  /* ── 적립금 배지 ─────────────────────────────────────── */
  function pointRate() {
    var s = window.APOStore;
    return s && s.pointRate ? s.pointRate() : 0;
  }

  /* DB 에 적립금 설정이 준비된 뒤에만 배지를 보입니다. */
  function pointsReady() {
    var s = window.APOStore;
    return !!(s && s.pointsReady && s.pointsReady());
  }

  /* 이 상품에 적용되는 적립률(%) — 상품 설정이 없으면 상점 기본 적립률 */
  function earnRateOf(p) {
    var s = window.APOStore;
    if (!p || p.earnPoints === false) return 0;
    if (s && s.productRate) return s.productRate(p);
    return pointRate();
  }

  /* 이 상품을 1개(1구) 살 때 적립 예정 포인트. 적립 제외 상품은 0 */
  function earnPointsOf(p) {
    var s = window.APOStore;
    if (!p || p.earnPoints === false || !s || !s.calcEarnPoints) return 0;
    return s.calcEarnPoints(p.price, earnRateOf(p));
  }

  function earnBadgeMarkup(p) {
    if (!pointsReady() || p.earnPoints === false) return "";
    var rate = earnRateOf(p);
    if (rate <= 0) return "";
    var pnt = earnPointsOf(p);
    return '<span class="earn-badge" title="입금 확인 시 적립">🎁 ' +
      (pnt > 0 ? (pnt.toLocaleString("ko-KR") + "P 적립") : (rate + "% 적립")) + "</span>";
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
    var rows = lineupOf(p);
    return rows.length ? rows[0] : null;
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
    var list = productList();
    /* 판본은 미개봉 박스 안에서만 세어 줍니다. */
    if (kind === "edition") list = list.filter(function (p) { return p.type === "box"; });
    return list.filter(function (p) {
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
    /* DB 에서는 완판 상품 상태가 sold(또는 soldout)로 들어옵니다. */
    var sold = p.status === "soldout" || p.status === "sold";
    var statusKey = sold ? "soldout" : p.status;
    var st = STATUS[statusKey] || STATUS.available;
    var mp = mainPrize(p);

    /* 카드 하단은 [장바구니 담기] + [구매하기] 두 개만 — 나머지는 카드/제목을 누르면 상세 모달에서 */
    var cartBtn = sold
      ? '<button class="btn btn--ghost btn--cart" type="button" disabled>담기 불가</button>'
      : '<button class="btn btn--ghost btn--cart" type="button" data-action="cart">장바구니 담기</button>';

    var buyBtn = sold
      ? '<button class="btn btn--gold btn--buy" type="button" disabled>품절</button>'
      : '<button class="btn btn--gold btn--buy" type="button" data-action="buy">구매하기</button>';

    var actions = cartBtn + buyBtn;

    return (
      '<article class="card" data-status="' + esc(statusKey) + '" data-sold="' + (sold ? "true" : "false") +
      '" data-type="' + esc(p.type) +
      '" data-id="' + esc(p.id) + '" style="animation-delay:' + Math.min(index * 45, 360) + 'ms">' +
      '<div class="card__media">' +
      artMarkup(p) +
      '<span class="type-badge" data-type="' + esc(p.type) + '">' + esc(typeOf(p).label) + "</span>" +
      '<span class="status-badge" data-status="' + esc(statusKey) + '">' + esc(st.label) + "</span>" +
      (sold ? '<div class="card__sold" aria-hidden="true"><b>SOLD OUT</b></div>' : "") +
      "</div>" +
      '<div class="card__body">' +
      '<h3 class="card__name">' + esc(p.name) + "</h3>" +
      '<p class="card__set">' + esc(p.series || "") + (p.setCode ? " · " + esc(p.setCode) : "") + "</p>" +
      '<p class="card__spec">' + esc(specText(p)) + "</p>" +
      (p.type === "oripa" && mp
        ? '<p class="card__prize">🏆 <b>' + esc(mp.label) + "</b> " + esc(mp.name) + "</p>"
        : "") +
      '<div class="card__price-row">' +
      '<span class="card__price">' + won(p.price) + "</span>" +
      '<span class="card__unit">/ ' + esc(unitWord(p)) + "</span>" +
      "</div>" +
      earnBadgeMarkup(p) +
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
    var total = $("statTotal");
    var avail = $("statAvailable");
    var oripa = $("statOripa");
    /* 히어로 통계 박스가 없는 화면에서는 아무것도 하지 않습니다. */
    if (!total || !avail || !oripa) return;
    var list = productList();
    total.textContent = list.length;
    avail.textContent = list.filter(function (p) {
      return p.status === "available" || p.status === "low";
    }).length;
    oripa.textContent = list.filter(function (p) { return p.type === "oripa"; }).length;
  }

  /* ── 상세 모달 ────────────────────────────────────────── */
  function detailMarkup(p) {
    var st = STATUS[p.status] || STATUS.available;
    var isOripa = p.type === "oripa";
    var rows = [];

    rows.push(["종목", p.game === "onepiece" ? "원피스 카드 게임" : "포켓몬 카드"]);
    rows.push(["구분", typeOf(p).label]);
    /* 시리즈는 실제 시리즈명이 있을 때만 표시 (한줄 설명을 시리즈에 섞지 않습니다) */
    if (p.series) rows.push(["시리즈", p.series + (p.setCode ? " (" + p.setCode + ")" : "")]);
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

    /* 적립금 */
    if (pointsReady() && p.earnPoints === false) {
      rows.push(["적립금", '<span class="detail__earn is-off">적립 제외 상품</span>']);
    } else if (pointsReady() && earnRateOf(p) > 0) {
      var pnt = earnPointsOf(p);
      rows.push(["적립금", '<span class="detail__earn">' + esc(unitWord(p)) + "당 " +
        (pnt > 0 ? pnt.toLocaleString("ko-KR") + "P" : "-") +
        " <em>(" + earnRateOf(p) + "% · 입금 확인 시)" + "</em></span>"]);
    }

    var lineup = "";

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
      descBlocksMarkup(p.description) +
      (isOripa ? seatSectionMarkup(p) : "") +
    /* 한줄 설명(사장님 입력)은 이 자리에 그대로 표시합니다 — 샘플 note 는 더 이상 쓰지 않습니다 */
    (p.subtitle ? '<p class="detail__note">' + esc(p.subtitle) + "</p>" : "") +
      (p.soldOut
        ? '<p class="detail__sold">품절된 상품입니다. 재입고는 오픈톡으로 문의해 주세요.</p>'
        : buyMarkup(p, isOripa)) +
      "</div></div>"
    );
  }

  /* 수량 스테퍼 (일반 상품 · 번호판이 없는 오리파) */
  function stepperMarkup(p, hidden) {
    return (
      '<div class="qty" role="group" aria-label="수량"' + (hidden ? " hidden" : "") + ">" +
      '<button class="qty__btn" type="button" data-detail-step="-1" aria-label="수량 줄이기">−</button>' +
      '<input class="qty__input" id="detailQty" type="number" inputmode="numeric" min="1" max="' +
      p.stock + '" value="1" aria-label="수량" />' +
      '<button class="qty__btn" type="button" data-detail-step="1" aria-label="수량 늘리기">+</button>' +
      "</div>"
    );
  }

  function buyMarkup(p, isOripa) {
    return (
      '<div class="detail__buy">' +
      stepperMarkup(p, isOripa) +
      '<div class="detail__buy-actions">' +
      '<button class="btn btn--ghost btn--buy" type="button" data-cart-add="' + esc(p.id) + '">장바구니 담기</button>' +
      '<button class="btn btn--gold btn--buy' + (isOripa ? " seat__buy" : "") + '" type="button" data-buy-now="' + esc(p.id) + '">바로구매' +
      (isOripa ? "<span data-seat-buy-label>번호를 선택해 주세요</span>" : "") +
      "</button>" +
      "</div>" +
      '<span class="detail__stock">남은 수량 ' + p.stock + esc(unitWord(p)) + "</span>" +
      (isOripa
        ? '<p class="seat__note" data-seat-buy-note hidden>선택한 번호는 주문 후 10분간 잠기고, 입금이 확인되지 않으면 다시 열립니다.</p>'
        : "") +
      "</div>"
    );
  }

  /* 번호 선택판 (오리파) — 실제 번호 상태는 불러온 뒤 채웁니다. */
  function seatSectionMarkup(p) {
    return (
      '<section class="seat" data-seat="' + esc(p.id) + '">' +
      '<div class="seat__head">' +
      '<h3 class="seat__title">번호 선택</h3>' +
      '<p class="seat__meta" data-seat-meta>불러오는 중…</p>' +
      "</div>" +
      /* 50개씩 넘겨 보기 — 총 구수가 51구 이상일 때만 채웁니다. */
      '<div class="seat__pager" data-seat-pager hidden></div>' +
      '<p class="seat__loading" data-seat-loading>번호를 불러오는 중…</p>' +
      '<div class="seat__grid" data-seat-grid hidden></div>' +
      '<ul class="seat__legend" data-seat-legend hidden>' +
      '<li><span class="seat__dot seat__dot--on"></span>선택 가능</li>' +
      '<li><span class="seat__dot seat__dot--picked"></span>내가 선택</li>' +
      '<li><span class="seat__dot seat__dot--off"></span>팔림</li>' +
      '<li><span class="seat__dot seat__dot--off seat__dot--lock"></span>입금대기</li>' +
      "</ul>" +
      '<div class="seat__sum" data-seat-sum hidden></div>' +
      "</section>"
    );
  }

  /* ── 번호 선택 상태 ───────────────────────────────────── */
  var SEAT_PAGE_SIZE = 50;   /* 한 페이지에 보여줄 번호 개수 */
  var seat = { id: "", total: 0, price: 0, status: {}, picked: [], page: 0, open: false };
  var modalId = "";

  function resetSeat() {
    seat = { id: "", total: 0, price: 0, status: {}, picked: [], page: 0, open: false };
  }

  function seatCounts() {
    var avail = 0, held = 0, sold = 0;
    for (var n = 1; n <= seat.total; n++) {
      var s = seat.status[n] || "available";
      if (s === "held") held++;
      else if (s === "sold") sold++;
      else avail++;
    }
    return { avail: avail, held: held, sold: sold };
  }

  /* 50개씩 페이지 나누기 */
  function seatPageCount() {
    return Math.max(1, Math.ceil((seat.total || 0) / SEAT_PAGE_SIZE));
  }

  function seatPageRange(idx) {
    var from = idx * SEAT_PAGE_SIZE + 1;
    var to = Math.min(seat.total || 0, (idx + 1) * SEAT_PAGE_SIZE);
    return { from: from, to: Math.max(from, to) };
  }

  /* 그 페이지에서 아직 고를 수 있는 구수 (내가 고른 번호는 제외) */
  function seatPageRemain(idx) {
    var r = seatPageRange(idx);
    var mine = {};
    seat.picked.forEach(function (n) { mine[n] = true; });
    var n = 0;
    for (var i = r.from; i <= r.to; i++) {
      if ((seat.status[i] || "available") === "available" && mine[i] !== true) n++;
    }
    return n;
  }

  function seatPageHasPick(idx) {
    var r = seatPageRange(idx);
    for (var i = 0; i < seat.picked.length; i++) {
      if (seat.picked[i] >= r.from && seat.picked[i] <= r.to) return true;
    }
    return false;
  }

  /* 페이지 바 (51구 이상일 때만) */
  function paintSeatPager() {
    var box = document.querySelector("[data-seat-pager]");
    if (!box) return;
    var pages = seatPageCount();
    if (pages <= 1) {
      box.innerHTML = "";
      box.hidden = true;
      return;
    }
    var html =
      '<button class="seat__pgbtn" type="button" data-seat-page="' + (seat.page - 1) + '"' +
      ' aria-label="이전 50개"' + (seat.page <= 0 ? " disabled" : "") + ">◀</button>" +
      '<div class="seat__pgrange">';
    for (var i = 0; i < pages; i++) {
      var r = seatPageRange(i);
      var on = i === seat.page;
      html +=
        '<button class="seat__pgchip' + (on ? " is-on" : "") +
        (seatPageHasPick(i) ? " is-pick" : "") + '" type="button" data-seat-page="' + i + '"' +
        ' aria-pressed="' + (on ? "true" : "false") + '">' +
        r.from + "~" + r.to +
        '<span class="seat__pgchip-left">(' + seatPageRemain(i) + ")</span></button>";
    }
    html += "</div>" +
      '<button class="seat__pgbtn" type="button" data-seat-page="' + (seat.page + 1) + '"' +
      ' aria-label="다음 50개"' + (seat.page >= pages - 1 ? " disabled" : "") + ">▶</button>";
    box.innerHTML = html;
    box.hidden = false;
  }

  function paintSeatGrid() {
    var host = document.querySelector("[data-seat-grid]");
    if (!host) return;
    var pages = seatPageCount();
    if (seat.page > pages - 1) seat.page = pages - 1;
    if (seat.page < 0) seat.page = 0;
    var picked = {};
    seat.picked.forEach(function (n) { picked[n] = true; });
    var range = seatPageRange(seat.page);
    var html = "";
    for (var n = range.from; n <= range.to; n++) {
      var st = seat.status[n] || "available";
      if (st === "available") {
        var on = picked[n] === true;
        html +=
          '<button class="seat__btn' + (on ? " is-picked" : "") + '" type="button" data-seat-num="' + n + '"' +
          ' aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + n + "번" +
          (on ? " 선택됨" : "") + '">' + n + "</button>";
      } else {
        var lock = st === "held";
        html +=
          '<button class="seat__btn is-off' + (lock ? " is-lock" : "") + '" type="button" data-seat-num="' + n +
          '" disabled aria-label="' + n + "번 " + (lock ? "입금대기" : "팔림") + '">' + n + "</button>";
      }
    }
    host.innerHTML = html;
    host.hidden = false;
    paintSeatPager();
    var legend = document.querySelector("[data-seat-legend]");
    if (legend) legend.hidden = false;
  }

  function seatWon(n) {
    return "₩" + (Number(n) || 0).toLocaleString("ko-KR");
  }

  function paintSeatSum() {
    var box = document.querySelector("[data-seat-sum]");
    if (!box) return;
    var picked = seat.picked.slice().sort(function (a, b) { return a - b; });
    var nums = picked.length
      ? picked.map(function (n) { return "<b>#" + n + "</b>"; }).join("")
      : '<span class="seat__sum-none">번호를 선택해 주세요</span>';
    box.innerHTML =
      '<span class="seat__sum-label">선택 번호</span>' +
      '<span class="seat__sum-nums">' + nums + "</span>" +
      '<span class="seat__sum-total">' + picked.length + "구 · " + seatWon(picked.length * seat.price) + "</span>";
    box.hidden = false;

    var counts = seatCounts();
    var meta = document.querySelector("[data-seat-meta]");
    if (meta) {
      meta.innerHTML = "총 <b>" + seat.total + "구</b> · 잔여 <b class=\"seat__meta-left\">" +
        Math.max(0, counts.avail - picked.length) + "구</b>";
    }

    var label = document.querySelector("[data-seat-buy-label]");
    if (label) {
      label.textContent = picked.length
        ? picked.length + "구 · " + seatWon(picked.length * seat.price)
        : "번호를 선택해 주세요";
    }
    var buyBtn = document.querySelector("#modalBody [data-buy-now]");
    var cartBtn = document.querySelector("#modalBody [data-cart-add]");
    if (buyBtn) buyBtn.disabled = picked.length === 0;
    if (cartBtn) cartBtn.disabled = picked.length === 0;
  }

  /* 번호판 데이터를 화면에 적용 (없으면 기존 수량 스테퍼로 대체) */
  function applyBoard(p, board) {
    resetSeat();
    var loading = document.querySelector("[data-seat-loading]");
    var total = Number(board && board.total_slots) || 0;
    var stepper = document.querySelector("#modalBody .detail__buy .qty");
    var buyBtn = document.querySelector("#modalBody [data-buy-now]");

    if (!total) {
      var sec = document.querySelector("[data-seat]");
      if (sec) sec.hidden = true;
      if (stepper) stepper.hidden = false;
      if (buyBtn) {
        buyBtn.classList.remove("seat__buy");
        var sub = buyBtn.querySelector("[data-seat-buy-label]");
        if (sub) sub.parentNode.removeChild(sub);
      }
      return;
    }

    seat = {
      id: p.id,
      total: total,
      price: Number(p.price) || 0,
      status: {},
      picked: [],
      page: 0,
      open: true,
    };
    (board.seats || []).forEach(function (x) {
      if (x && x.n) seat.status[x.n] = x.s || "available";
    });

    if (loading) loading.hidden = true;
    if (stepper) stepper.hidden = true;
    var note = document.querySelector("[data-seat-buy-note]");
    if (note) note.hidden = false;
    paintSeatGrid();
    paintSeatSum();
  }

  function pickedSeats(pid) {
    if (!seat.open || seat.id !== pid || seat.total <= 0) return null;
    return seat.picked.slice().sort(function (a, b) { return a - b; });
  }

  function openModal(p, silent) {
    var modal = $("detailModal");
    if (!modal) return;
    resetSeat();
    modalId = p.id;
    var body = $("modalBody");
    body.innerHTML = detailMarkup(p);
    var wasHidden = modal.hidden;
    modal.hidden = false;
    body.scrollTop = 0;
    if (wasHidden) lastFocused = document.activeElement;
    var headTitle = $("detailPageTitle");
    if (headTitle) headTitle.textContent = p.name;
    document.title = p.name + " · " + ((SITE_CONFIG && SITE_CONFIG.shopName) || "ALL PO ONE");
    Nav.refreshLock();
    if (wasHidden) {
      var backBtn = modal.querySelector(".pagehead__back") || modal.querySelector(".modal__close");
      if (backBtn) { try { backBtn.focus({ preventScroll: true }); } catch (e) { try { backBtn.focus(); } catch (e2) {} } }
    }
    if (!silent) Nav.show("product", p.id);

    /* 오리파: 1~N번 번호 상태를 불러와 번호 선택판을 채웁니다. */
    if (p.type === "oripa" && window.APOStore && APOStore.getOripaBoard) {
      APOStore.getOripaBoard(p.id).then(function (board) {
        if (modalId !== p.id || modal.hidden) return;
        var live = findProduct(p.id) || p;
        applyBoard(live, board || {});
      });
    }
  }

  /* 화면만 숨기기 (히스토리는 손대지 않음 — 다음 화면으로 갈아끼울 때) */
  function hideDetail() {
    var modal = $("detailModal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    $("modalBody").innerHTML = "";
    resetSeat();
    modalId = "";
    var c = SITE_CONFIG || {};
    document.title = (c.shopName || "ALL PO ONE") + (c.tagline ? " — " + c.tagline : "");
    Nav.refreshLock();
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    }
    lastFocused = null;
  }

  /* 사용자가 닫기 — 뒤로가기 한 칸으로 정리 */
  function closeModal() {
    var modal = $("detailModal");
    if (!modal || modal.hidden) return;
    Nav.close("product");
  }

  function findProduct(id) {
    if (window.APOStore) {
      var live = APOStore.getProduct(id);
      /* 숨김(비공개) 상품은 손님 화면에서 열지 않습니다. */
      if (live) return live.hidden ? null : live;
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
        /* 오리파는 번호를 골라야 하므로 상세(번호판)로 안내 */
        if ((action === "cart" || action === "buy") && p.type === "oripa") {
          e.stopPropagation();
          openModal(p);
          return;
        }
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
        if (action === "buy") {
          e.stopPropagation();
          /* 1개 담고 바로 주문서로 — 품절/잔여수량은 addToCart 가, 회원필수는 openCheckout 이 막습니다 */
          var buyRes = window.APOStore
            ? APOStore.addToCart(p.id, 1)
            : { ok: false, message: "장바구니를 사용할 수 없습니다." };
          if (!buyRes.ok) {
            toast(buyRes.message, "warn");
            if (buyRes.reason === "stock" || buyRes.reason === "soldout") render();
            return;
          }
          if (window.APOShop && APOShop.openCheckout) APOShop.openCheckout();
          else if (window.APOShop) APOShop.openCart();
          return;
        }
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
      /* ── 번호 선택판 ── */
      var seatBtn = e.target.closest("[data-seat-num]");
      if (seatBtn) {
        if (seatBtn.disabled) return;
        var num = Number(seatBtn.getAttribute("data-seat-num"));
        var at = seat.picked.indexOf(num);
        if (at >= 0) {
          seat.picked.splice(at, 1);
        } else {
          var counts = seatCounts();
          if (seat.picked.length >= counts.avail) {
            toast("남은 " + counts.avail + "구까지만 선택할 수 있습니다.", "warn");
            return;
          }
          seat.picked.push(num);
        }
        var on = seat.picked.indexOf(num) >= 0;
        seatBtn.classList.toggle("is-picked", on);
        seatBtn.setAttribute("aria-pressed", on ? "true" : "false");
        seatBtn.setAttribute("aria-label", num + "번" + (on ? " 선택됨" : ""));
        paintSeatSum();
        paintSeatPager();
        return;
      }

      /* ── 50개씩 페이지 이동 ── */
      var pageBtn = e.target.closest("[data-seat-page]");
      if (pageBtn) {
        if (pageBtn.disabled) return;
        var want = Number(pageBtn.getAttribute("data-seat-page"));
        var last = seatPageCount() - 1;
        if (!isFinite(want)) return;
        want = Math.min(last, Math.max(0, want));
        if (want === seat.page) return;
        seat.page = want;
        paintSeatGrid();
        var host = document.querySelector("[data-seat-grid]");
        if (host) {
          try { host.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (err) { /* 무시 */ }
        }
        return;
      }

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
        var picks = pickedSeats(pid);
        if (picks && !picks.length) {
          toast("번호를 먼저 선택해 주세요.", "warn");
          return;
        }
        var res = window.APOStore
          ? (picks ? APOStore.addToCart(pid, picks.length, picks) : APOStore.addToCart(pid, q))
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

      var buyBtn = e.target.closest("[data-buy-now]");
      if (buyBtn) {
        var buyId = buyBtn.getAttribute("data-buy-now");
        var qEl = $("detailQty");
        var buyQty = qEl ? Math.max(1, Number(qEl.value) || 1) : 1;
        var buyPicks = pickedSeats(buyId);
        if (buyPicks && !buyPicks.length) {
          toast("번호를 먼저 선택해 주세요.", "warn");
          return;
        }
        var buyRes = window.APOStore
          ? (buyPicks ? APOStore.addToCart(buyId, buyPicks.length, buyPicks) : APOStore.addToCart(buyId, buyQty))
          : { ok: false, message: "장바구니를 사용할 수 없습니다." };
        if (!buyRes.ok) {
          toast(buyRes.message, "warn");
          if (buyRes.reason === "stock" || buyRes.reason === "soldout") render();
          return;
        }
        closeModal();
        /* 주문서로 바로 (로그인 필수 설정이면 openCheckout 이 로그인 모달을 띄웁니다) */
        if (window.APOShop && APOShop.openCheckout) APOShop.openCheckout();
        else if (window.APOShop) APOShop.openCart();
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

      /* 히스토리 등록 — 상품 상세는 app.js 가 담당 */
      Nav.register("product", {
        isOpen: function () { var m = $("detailModal"); return !!m && !m.hidden; },
        show: function (id) {
          var p = findProduct(id);
          if (p) openModal(p, true);
        },
        hide: hideDetail,
      });

      /* 공유 링크로 바로 열기 — #product=… (옛 링크 #상품ID 도 지원) */
      var mh = location.hash.match(/^#product=([^&]+)$/);
      var pid = "";
      if (mh) {
        pid = decodeURIComponent(mh[1]);
      } else {
        var legacy = location.hash.replace(/^#/, "");
        if (legacy && !/^(mypage|top|products|guide)$/.test(legacy) && findProduct(legacy)) pid = legacy;
      }
      if (pid) {
        var p0 = findProduct(pid);
        Nav.seed("product", pid);
        if (p0) setTimeout(function () { openModal(p0, true); }, 120);
        else history.replaceState(null, "", location.pathname + location.search);
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
      openDetail: function (p) { openModal(p, false); },
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

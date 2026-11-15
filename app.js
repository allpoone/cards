/* ============================================================
   JUN's CARD VAULT — app.js
   cards.js 의 SITE_CONFIG / CARDS 를 읽어 화면을 그립니다.
   이 파일은 수정하지 않아도 됩니다.
   ============================================================ */

(function () {
  "use strict";

  /* ── 상태 ─────────────────────────────────────────────── */
  var state = { game: "all", grade: "all", status: "all", q: "" };

  var STATUS = {
    available: { label: "판매중", order: 0 },
    reserved: { label: "예약중", order: 1 },
    sold: { label: "판매완료", order: 2 },
  };

  var GAME_LABEL = { pokemon: "POKÉMON", onepiece: "ONE PIECE" };

  var filterDefs = {
    game: [
      { key: "all", label: "전체" },
      { key: "pokemon", label: "포켓몬" },
      { key: "onepiece", label: "원피스" },
    ],
    grade: [
      { key: "all", label: "전체" },
      { key: "PSA", label: "PSA" },
      { key: "BGS", label: "BGS" },
      { key: "RAWSEALED", label: "미개봉·싱글" },
    ],
    status: [
      { key: "all", label: "전체" },
      { key: "available", label: "판매중" },
      { key: "reserved", label: "예약중" },
      { key: "sold", label: "판매완료" },
    ],
  };

  /* ── DOM ──────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  var grid, emptyState, searchInput, searchClear, resultCount;

  var lastFocused = null;

  /* ── 유틸 ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function won(n) {
    var num = Number(n) || 0;
    return "₩" + num.toLocaleString("ko-KR");
  }

  function kakaoUrl() {
    var u = (SITE_CONFIG.openKakaoUrl || "").trim();
    return u;
  }

  function lookupUrl(card) {
    if (!card.cert) return "";
    var body = card.gradeBody || (card.grade || "").split(" ")[0];
    var tpl = (SITE_CONFIG.gradeLookup || {})[body];
    if (!tpl) return "";
    return tpl.replace("{cert}", encodeURIComponent(card.cert));
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

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return fallbackCopy(text); }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function cardInfoText(card) {
    var lines = [];
    lines.push("[" + (SITE_CONFIG.shopName || "CARD VAULT") + " 구매 문의]");
    lines.push("카드: " + card.name + (card.nameEn ? " (" + card.nameEn + ")" : ""));
    var setLine = card.setName || "";
    if (card.setCode || card.cardNumber) {
      setLine += " · " + [card.setCode, card.cardNumber].filter(Boolean).join(" ");
    }
    if (setLine.trim()) lines.push("세트: " + setLine.trim());
    if (card.language) lines.push("언어: " + card.language);
    lines.push("등급: " + (card.grade || "-"));
    if (card.cert) lines.push("인증번호: " + card.cert);
    lines.push("가격: " + won(card.price));
    lines.push("상태: " + ((STATUS[card.status] || {}).label || "판매중"));
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
    var ms = kind === "warn" ? 4600 : 3000;
    setTimeout(function () {
      el.classList.add("toast--out");
      setTimeout(function () { el.remove(); }, 260);
    }, ms);
  }

  /* ── 아트 마크업 ──────────────────────────────────────── */
  function artMarkup(card, opts) {
    opts = opts || {};
    var c1 = card.c1 || "#1b2233";
    var c2 = card.c2 || "#3b4a63";
    var accent = card.accent || "#ffffff";
    var style =
      "--c1:" + c1 + ";--c2:" + c2 + ";--accent:" + accent + ";";
    var img = card.image
      ? '<img class="art__img" src="' + esc(card.image) + '" alt="' + esc(card.name) + ' 카드 사진" loading="lazy" />'
      : "";
    var inner = opts.simple
      ? img +
        '<span class="art__glyph" aria-hidden="true">' + esc(card.glyph || "🃏") + "</span>"
      : img +
        '<span class="art__noise"></span>' +
        '<span class="art__holo"></span>' +
        '<span class="art__sheen"></span>' +
        '<span class="art__frame"></span>' +
        '<span class="art__glyph" aria-hidden="true">' + esc(card.glyph || "🃏") + "</span>" +
        '<span class="art__label">' + esc(card.name) + "</span>" +
        '<span class="art__tags">' +
        '<span class="art__game" data-game="' + esc(card.game) + '">' +
        esc(GAME_LABEL[card.game] || "") +
        "</span>" +
        (card.sample ? '<span class="art__sample">SAMPLE</span>' : "") +
        "</span>";
    return '<div class="art" style="' + style + '">' + inner + "</div>";
  }

  /* ── 필터 칩 ──────────────────────────────────────────── */
  function countFor(kind, key) {
    return CARDS.filter(function (c) {
      if (kind === "game") return key === "all" || c.game === key;
      if (kind === "grade") {
        if (key === "all") return true;
        if (key === "RAWSEALED") return c.gradeBody === "RAW" || c.gradeBody === "SEALED";
        return c.gradeBody === key;
      }
      if (kind === "status") return key === "all" || c.status === key;
      return true;
    }).length;
  }

  function buildChips() {
    Object.keys(filterDefs).forEach(function (kind) {
      var host = document.querySelector('[data-filter="' + kind + '"]');
      if (!host) return;
      host.innerHTML = filterDefs[kind]
        .map(function (f) {
          var pressed = state[kind] === f.key ? "true" : "false";
          var n = countFor(kind, f.key);
          return (
            '<button class="chip" type="button" role="button" aria-pressed="' +
            pressed +
            '" data-key="' +
            esc(f.key) +
            '">' +
            esc(f.label) +
            '<span class="chip__n">' + n + "</span></button>"
          );
        })
        .join("");
    });
  }

  /* ── 필터링 ───────────────────────────────────────────── */
  function normalize(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }

  function matches(card) {
    if (state.game !== "all" && card.game !== state.game) return false;
    if (state.grade !== "all") {
      if (state.grade === "RAWSEALED") {
        if (card.gradeBody !== "RAW" && card.gradeBody !== "SEALED") return false;
      } else if (card.gradeBody !== state.grade) return false;
    }
    if (state.status !== "all" && card.status !== state.status) return false;
    if (state.q) {
      var hay = normalize(
        [
          card.name,
          card.nameEn,
          card.setName,
          card.setCode,
          card.cardNumber,
          card.grade,
          card.cert,
          card.language,
          GAME_LABEL[card.game],
        ].join(" ")
      );
      var terms = normalize(state.q).split(/[,]/).filter(Boolean);
      var pool = hay + " ";
      for (var i = 0; i < terms.length; i++) {
        if (pool.indexOf(terms[i]) === -1) return false;
      }
    }
    return true;
  }

  /* ── 카드 렌더 ────────────────────────────────────────── */
  function cardMarkup(card, index) {
    var st = STATUS[card.status] || STATUS.available;
    var sold = card.status === "sold";
    return (
      '<article class="card" data-status="' +
      esc(card.status) +
      '" data-id="' +
      esc(card.id) +
      '" style="animation-delay:' +
      Math.min(index * 45, 360) +
      'ms">' +
      '<div class="card__media">' +
      artMarkup(card) +
      '<span class="grade-badge" data-body="' + esc(card.gradeBody || "RAW") + '">' +
      esc(card.grade || "-") +
      "</span>" +
      '<span class="status-badge" data-status="' + esc(card.status) + '">' +
      esc(st.label) +
      "</span>" +
      "</div>" +
      '<div class="card__body">' +
      '<h3 class="card__name">' + esc(card.name) + "</h3>" +
      '<p class="card__set">' +
      esc(card.setName || "") +
      (card.cardNumber ? " · " + esc(card.cardNumber) : "") +
      "</p>" +
      '<div class="card__price-row">' +
      '<span class="card__price">' + won(card.price) + "</span>" +
      (card.cert ? '<span class="card__cert">#' + esc(card.cert) + "</span>" : "") +
      "</div>" +
      '<div class="card__actions">' +
      '<button class="btn btn--ghost" type="button" data-action="detail">상세</button>' +
      '<button class="btn btn--kakao" type="button" data-action="inquire"' +
      (sold ? ' aria-disabled="true"' : "") +
      ">오픈톡 문의</button>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function render() {
    var list = CARDS.filter(matches);
    list.sort(function (a, b) {
      var sa = (STATUS[a.status] || STATUS.available).order;
      var sb = (STATUS[b.status] || STATUS.available).order;
      if (sa !== sb) return sa - sb;
      return 0;
    });

    grid.innerHTML = list.map(cardMarkup).join("");
    grid.hidden = list.length === 0;
    emptyState.hidden = list.length !== 0;

    resultCount.innerHTML =
      list.length === 0
        ? "검색 결과 <b>0</b>장"
        : '<b>' + list.length + "</b> / " + CARDS.length + "장";

    searchClear.hidden = !state.q;
  }

  function updateStats() {
    $("statTotal").textContent = CARDS.length;
    $("statAvailable").textContent = CARDS.filter(function (c) {
      return c.status === "available";
    }).length;
  }

  /* ── 상세 모달 ────────────────────────────────────────── */
  function detailMarkup(card) {
    var st = STATUS[card.status] || STATUS.available;
    var url = kakaoUrl();
    var cert = card.cert || "";
    var certUrl = lookupUrl(card);

    var rows = [];
    rows.push(['<dt>종목</dt>', "<dd>" + esc(card.game === "onepiece" ? "원피스 카드 게임" : "포켓몬 카드") + "</dd>"]);
    rows.push(['<dt>세트</dt>', "<dd>" + esc(card.setName || "-") + (card.setCode ? " (" + esc(card.setCode) + ")" : "") + "</dd>"]);
    if (card.cardNumber) rows.push(["<dt>카드 번호</dt>", "<dd>" + esc(card.cardNumber) + "</dd>"]);
    if (card.language) rows.push(["<dt>언어</dt>", "<dd>" + esc(card.language) + "</dd>"]);
    rows.push(["<dt>등급</dt>", "<dd>" + esc(card.grade || "-") + "</dd>"]);
    if (cert) {
      rows.push([
        "<dt>인증번호</dt>",
        "<dd>" +
          (certUrl
            ? '<a href="' + esc(certUrl) + '" target="_blank" rel="noopener noreferrer">' +
              esc(cert) + " <span aria-hidden='true'>↗</span> 인증 조회</a>"
            : esc(cert)) +
          "</dd>",
      ]);
    }
    rows.push(["<dt>상태</dt>", '<dd><span class="status-badge" data-status="' + esc(card.status) + '" style="position:static;display:inline-flex">' + esc(st.label) + "</span></dd>"]);

    return (
      '<div class="detail">' +
      '<div class="detail__art-wrap"><div class="detail__art" style="--c1:' +
      esc(card.c1 || "#1b2233") +
      ";--c2:" +
      esc(card.c2 || "#3b4a63") +
      ";--accent:" +
      esc(card.accent || "#fff") +
      '">' +
      (card.image
        ? '<img class="art__img" src="' + esc(card.image) + '" alt="' + esc(card.name) + ' 카드 사진" />'
        : '<span class="art__noise"></span><span class="art__holo" style="opacity:.7"></span><span class="art__frame"></span>') +
      '<span class="art__glyph" aria-hidden="true">' + esc(card.glyph || "🃏") + "</span>" +
      "</div></div>" +
      '<div class="detail__info">' +
      '<div class="detail__kind">' +
      '<span class="badge badge--' + (card.game === "onepiece" ? "one" : "poke") + '">' +
      esc(GAME_LABEL[card.game] || "") +
      "</span>" +
      '<span class="grade-badge" data-body="' + esc(card.gradeBody || "RAW") + '" style="position:static">' + esc(card.grade || "-") + "</span>" +
      (card.sample ? '<span class="art__sample" style="position:static">SAMPLE</span>' : "") +
      "</div>" +
      '<h2 class="detail__name" id="modalTitle">' + esc(card.name) + "</h2>" +
      (card.nameEn ? '<p class="detail__name-en">' + esc(card.nameEn) + "</p>" : "") +
      '<div class="detail__price"><strong>' + won(card.price) + "</strong><span>KRW</span></div>" +
      "<dl>" + rows.map(function (r) { return r[0] + r[1]; }).join("") + "</dl>" +
      (card.note ? '<p class="detail__note">' + esc(card.note) + "</p>" : "") +
      '<div class="detail__actions">' +
      '<button class="btn btn--ghost" type="button" data-copy="' + esc(card.id) + '">카드 정보 복사하기</button>' +
      '<button class="btn btn--kakao" type="button" data-inquire="' + esc(card.id) + '">오픈톡으로 구매 문의</button>' +
      "</div>" +
      '<p class="detail__hint">복사한 카드 정보를 오픈톡에 붙여넣으면 문의가 빠릅니다.</p>' +
      (url
        ? ""
        : '<p class="detail__warn">오픈톡 링크가 아직 연결되지 않았습니다. 문의 링크가 연결되면 이 버튼으로 바로 문의할 수 있습니다.</p>') +
      "</div></div>"
    );
  }

  function openModal(card) {
    var modal = $("detailModal");
    $("modalBody").innerHTML = detailMarkup(card);
    modal.hidden = false;
    document.body.classList.add("modal-open");
    lastFocused = document.activeElement;
    var closeBtn = modal.querySelector(".modal__close");
    if (closeBtn) closeBtn.focus();
    if (history.replaceState) {
      history.replaceState(null, "", "#" + card.id);
    }
  }

  function closeModal() {
    var modal = $("detailModal");
    if (modal.hidden) return;
    modal.hidden = true;
    modal.querySelector(".modal__body").innerHTML = "";
    document.body.classList.remove("modal-open");
    if (history.replaceState) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function findCard(id) {
    for (var i = 0; i < CARDS.length; i++) if (CARDS[i].id === id) return CARDS[i];
    return null;
  }

  /* ── 문의 동작 ────────────────────────────────────────── */
  function inquire(card) {
    var url = kakaoUrl();
    if (!url) {
      toast(
        "오픈톡 링크가 아직 연결되지 않았습니다. 판매자에게 문의 링크 연결을 요청해 주세요.",
        "warn"
      );
      return;
    }
    if (card) {
      // 카드 정보를 복사해 두면 붙여넣기만 하면 됩니다.
      copyText(cardInfoText(card));
      toast("카드 정보를 복사했습니다. 오픈톡에 붙여넣어 주세요.", "ok");
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /* ── 이벤트 연결 ──────────────────────────────────────── */
  function wire() {
    /* 필터 칩 */
    ["game", "grade", "status"].forEach(function (kind) {
      var host = document.querySelector('[data-filter="' + kind + '"]');
      if (!host) return;
      host.addEventListener("click", function (e) {
        var chip = e.target.closest(".chip");
        if (!chip) return;
        state[kind] = chip.getAttribute("data-key");
        buildChips();
        render();
      });
    });

    /* 검색 */
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

    /* 초기화 */
    function reset() {
      state = { game: "all", grade: "all", status: "all", q: "" };
      searchInput.value = "";
      buildChips();
      render();
    }
    $("resetFilters").addEventListener("click", reset);
    $("emptyReset").addEventListener("click", reset);

    /* 그리드 클릭 위임 */
    grid.addEventListener("click", function (e) {
      var cardEl = e.target.closest(".card");
      if (!cardEl) return;
      var card = findCard(cardEl.getAttribute("data-id"));
      if (!card) return;
      var btn = e.target.closest("[data-action]");
      if (btn) {
        var action = btn.getAttribute("data-action");
        if (action === "detail") { openModal(card); return; }
        if (action === "inquire") { e.stopPropagation(); inquire(card); return; }
      }
      /* 카드 아트/본문 클릭 → 상세 */
      if (!e.target.closest("button")) openModal(card);
    });

    /* 아트 마우스 추적 (홀로그램 시인) */
    grid.addEventListener("pointermove", function (e) {
      var art = e.target.closest(".art");
      if (!art) return;
      var r = art.getBoundingClientRect();
      art.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      art.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
    });

    /* 상세 모달 내부 버튼 */
    $("modalBody").addEventListener("click", function (e) {
      var copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) {
        var c = findCard(copyBtn.getAttribute("data-copy"));
        if (!c) return;
        copyText(cardInfoText(c)).then(function (ok) {
          toast(ok ? "카드 정보를 복사했습니다." : "복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.", ok ? "ok" : "warn");
        });
        return;
      }
      var inqBtn = e.target.closest("[data-inquire]");
      if (inqBtn) {
        var attr = inqBtn.getAttribute("data-inquire");
        inquire(attr ? findCard(attr) : null);
      }
    });

    /* 헤더/푸터/히어로 문의 버튼 */
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-inquire]");
      if (!b) return;
      if (b.closest("#modalBody")) return; // 모달 내부는 위에서 처리
      var id = b.getAttribute("data-inquire");
      inquire(id ? findCard(id) : null);
    });

    /* 모달 닫기 */
    $("detailModal").addEventListener("click", function (e) {
      if (e.target.closest("[data-close]") || e.target.classList.contains("modal__backdrop")) {
        closeModal();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  /* ── 초기 렌더 ────────────────────────────────────────── */
  function applyConfig() {
    var c = SITE_CONFIG;
    document.title = c.shopName + " — " + (c.tagline || "카드 컬렉션");
    $("shopName").textContent = c.shopName;
    $("shopNameKo").textContent = c.shopNameKo || "";
    $("intro").textContent = c.intro || "";
    $("guideTitle").textContent = c.guideTitle || "거래 안내";
    $("guideIntro").textContent = c.guideIntro || "";
    $("guideNotice").textContent = c.guideNotice || "";
    $("guideNotice").hidden = !c.guideNotice;
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
    if (c.showSampleBanner && CARDS.some(function (x) { return x.sample; })) {
      banner.hidden = false;
      $("sampleBannerText").textContent = c.sampleBannerText || "샘플 데이터입니다.";
    } else {
      banner.hidden = true;
    }
  }

  function boot() {
    grid = $("cardGrid");
    emptyState = $("emptyState");
    searchInput = $("searchInput");
    searchClear = $("searchClear");
    resultCount = $("resultCount");

    applyConfig();
    updateStats();
    buildChips();
    render();
    wire();

    /* #card-id 로 들어오면 상세를 바로 연다 */
    if (location.hash && location.hash.length > 1) {
      var c = findCard(location.hash.slice(1));
      if (c) setTimeout(function () { openModal(c); }, 120);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* ============================================================
   ALL PO ONE — store.js
   ------------------------------------------------------------
   상품 재고 · 장바구니 · 주문 데이터 계층입니다.

   · SITE_CONFIG.supabaseUrl / supabaseAnonKey 가 채워져 있으면
     실제 Supabase DB(place_order / update_order_status RPC)를 씁니다.
   · 비어 있으면 "DB 연동 전 테스트 모드"로 이 브라우저(localStorage)에
     똑같이 주문 생성 · 재고 차감 · 주문 저장을 합니다.

   ── 관리자 인증 ─────────────────────────────────────────
   · DB 모드: 사장님 페이지는 Supabase Auth(이메일 + 비밀번호)로만 열립니다.
     로그인한 계정의 app_metadata.role === 'admin' 만 관리자로 인정합니다.
     (공개 코드에는 어떤 비밀번호·PIN 도 두지 않습니다.)
   · 테스트 모드: 화면 잠금만 하고, 같은 브라우저 안에서만 열립니다.

   ── 상품 ───────────────────────────────────────────────
   · DB 모드: products 테이블이 기준입니다. 이름·가격·재고·상태·설명·사진은 DB 값이
     우선하고, cards.js 는 카드 아트(색·아이콘) 같은 디자인 값만 보탭니다.
     그래서 cards.js 에 없는 "DB에만 있는 상품"도 그대로 카드로 나옵니다.
   · 테스트 모드: cards.js + 이 브라우저(localStorage)에 저장한 수정값.

   ── 손님 회원 ─────────────────────────────────────────
   · Supabase Auth(이메일 + 비밀번호) 회원가입·로그인. 주문에 user_id 가 자동 저장됩니다.
   · 사장님 설정(shop_public_settings)으로 비로그인 주문 허용 / 로그인 필수 전환.
   ============================================================ */

(function () {
  "use strict";

  var LS_CART = "apo.cart.v1";
  var LS_PRODUCTS = "apo.products.v1";
  var LS_ORDERS = "apo.orders.v1";
  var LS_ADMIN = "apo.admin.v1";

  var LOW_STOCK = 2;                 // 이 수량 이하면 "마감임박"
  var NO_ORDER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 O·0·I·1 제외

  var cfg = typeof SITE_CONFIG !== "undefined" ? SITE_CONFIG : {};
  var BASE = (typeof PRODUCTS !== "undefined" ? PRODUCTS : []).slice();

  var dbUrl = String(cfg.supabaseUrl || "").trim();
  var dbKey = String(cfg.supabaseAnonKey || "").trim();
  var wantDb = !!(dbUrl && dbKey);

  var db = null;          // supabase client
  var mode = "demo";      // "demo" | "db"
  var dbError = "";
  var productState = {};   // id -> { name?, price?, stock, status }  (테스트 모드 로컬 수정값)
  var dbRows = [];         // DB products 행 (DB 모드 기준)
  var dbRowById = {};
  var extraProducts = [];  // 테스트 모드에서 추가한 상품
  var extraById = {};
  var dbColumns = "none";  // "full" | "v1" | "min" | "none"
  var settings = { requireLogin: false, ready: false };  // 사장님 공개 설정
  var readyPromise = null;

  var IMAGE_BUCKET = "product-images";

  /* ── 작은 유틸 ────────────────────────────────────────── */
  function won(n) {
    return "₩" + (Number(n) || 0).toLocaleString("ko-KR");
  }

  function clampInt(v, min, max) {
    var n = Math.floor(Number(v) || 0);
    if (n < min) n = min;
    if (typeof max === "number" && n > max) n = max;
    return n;
  }

  function digits(s) {
    return String(s == null ? "" : s).replace(/[^0-9]/g, "");
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function emit(kind) {
    try {
      window.dispatchEvent(new CustomEvent("apo:" + kind));
    } catch (e) {
      /* 구형 브라우저는 무시 */
    }
  }

  function statusFromStock(stock, previous) {
    if (stock <= 0) return "soldout";
    if (previous === "sold" || previous === "soldout") {
      return stock <= LOW_STOCK ? "low" : "available";
    }
    return previous || (stock <= LOW_STOCK ? "low" : "available");
  }

  /* ── 상품 ─────────────────────────────────────────────── */
  function initialStock(p) {
    if (p && typeof p.stock === "number" && isFinite(p.stock)) {
      return Math.max(0, Math.floor(p.stock));
    }
    if (p && p.type === "oripa") return Math.max(0, Number(p.remainingUnits) || 0);
    return Math.max(0, Number(p && p.remaining) || 0);
  }

  function baseSeed() {
    return BASE.map(function (p) { return p.id + "=" + initialStock(p); }).join("|");
  }

  function seedState() {
    var next = {};
    BASE.forEach(function (p) {
      next[p.id] = {
        stock: initialStock(p),
        status: p.status || "available",
      };
    });
    return next;
  }

  function saveProductState() {
    writeJson(LS_PRODUCTS, { seed: baseSeed(), products: productState, extra: extraProducts });
  }

  function loadProductState() {
    var saved = readJson(LS_PRODUCTS, null);
    if (saved && saved.seed === baseSeed() && saved.products) {
      productState = saved.products;
    } else {
      /* cards.js 의 재고를 손봤거나 처음 방문 → 카드 값으로 다시 시작 */
      productState = seedState();
    }
    /* 테스트 모드에서 사장님이 추가한 상품 */
    extraProducts = saved && Array.isArray(saved.extra) ? saved.extra : [];
    extraById = {};
    extraProducts.forEach(function (r) { if (r && r.id) extraById[r.id] = r; });

    /* cards.js 에 새로 추가된 상품 보충 */
    var seeded = false;
    BASE.forEach(function (p) {
      if (!productState[p.id] || typeof productState[p.id].stock !== "number") {
        productState[p.id] = { stock: initialStock(p), status: p.status || "available" };
        seeded = true;
      }
    });
    if (seeded) saveProductState();
  }

  function findBase(id) {
    for (var i = 0; i < BASE.length; i++) if (BASE[i].id === id) return BASE[i];
    return null;
  }

  function copyObj(o) {
    var out = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  /* DB에만 있는 상품의 기본 카드 아트 (종목·유형으로 색을 정합니다) */
  function glyphFor(type) {
    if (type === "oripa") return "🎰";
    if (type === "etc") return "🎁";
    return "📦";
  }

  function defaultArt(type, game) {
    var glyph = glyphFor(type);
    if (game === "onepiece") {
      return { c1: "#2a0b10", c2: "#b3232f", accent: "#ffb3ba", glyph: glyph };
    }
    return { c1: "#150d33", c2: "#7c3aed", accent: "#d5c8ff", glyph: glyph };
  }

  /* 상품 한 건의 원본(카드 디자인 + DB 최신값) */
  function descriptor(id) {
    var base = findBase(id);
    var row = mode === "db" ? dbRowById[id] : (dbRowById[id] || extraById[id]);
    if (mode === "db" && !row) return null;   // DB에 없으면 진열하지 않습니다
    if (!base && !row) return null;

    var out = base ? copyObj(base) : {};
    out.id = id;

    if (row) {
      if (row.name) out.name = row.name;
      if (row.type) out.type = row.type;
      if (row.game) out.game = row.game;
      /* DB 판본(edition)이 있으면 카드 값보다 우선 — 필터도 이 값을 씁니다 */
      if (row.edition) { out.edition = row.edition; out.language = row.edition; }
      else if (!out.edition) out.edition = out.language || "";
      if (typeof row.price === "number") out.price = row.price;
      out.dbStock = row.stock;
      out.dbStatus = row.status;
      if (row.subtitle) { out.series = row.subtitle; out.subtitle = row.subtitle; }
      if (row.image_url) out.image = row.image_url;
      out.imageUrl = row.image_url || "";
    }

    if (!out.type) out.type = "box";
    if (!out.game) out.game = "pokemon";
    if (!out.name) out.name = "(이름 없음)";
    if (typeof out.price !== "number") out.price = Number(out.price) || 0;

    if (!out.edition) out.edition = out.language || "";
    if (!base) {
      var art = defaultArt(out.type, out.game);
      for (var k in art) if (!out[k]) out[k] = art[k];
      out.dbOnly = true;
    }
    return out;
  }

  /* 화면에 보여줄 상품 (원본 + 실시간 재고/상태) */
  function view(d) {
    if (!d) return null;
    var row = mode === "db" ? dbRowById[d.id] : (dbRowById[d.id] || extraById[d.id]);
    var local = productState[d.id] || {};

    var stock;
    if (row) {
      stock = row.stock;
    } else if (typeof local.stock === "number") {
      stock = Math.max(0, Math.floor(local.stock));
    } else {
      stock = typeof d.stock === "number" ? Math.max(0, Math.floor(d.stock)) : initialStock(d);
    }

    var prev = row ? row.status : (local.status || d.status || "available");
    var status = statusFromStock(stock, prev);

    var out = copyObj(d);
    /* 테스트 모드에서 고친 이름·가격은 로컬 값이 우선 (DB 모드에서는 DB 값) */
    if (!row) {
      if (local.name) out.name = local.name;
      if (typeof local.price === "number") out.price = local.price;
    }
    out.stock = stock;
    out.status = status;
    out.soldOut = stock <= 0;
    /* 기존 화면 함수들이 쓰는 잔여 수량 필드도 같이 맞춰 줍니다. */
    if (out.type === "oripa") out.remainingUnits = stock;
    else out.remaining = stock;
    return out;
  }

  /* 카드 순서
     · DB 모드: products 테이블이 전부입니다 (sort_order 순). 사장님이 지운 상품은 안 나옵니다.
     · 테스트 모드: cards.js 순서 → 사장님이 추가한 상품 순 */
  function productIds() {
    if (mode === "db") {
      return dbRows
        .slice()
        .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
        .map(function (r) { return r.id; });
    }

    var ids = BASE.map(function (p) { return p.id; }).filter(function (id) {
      var st = productState[id];
      return !(st && st.deleted);
    });
    var seen = {};
    ids.forEach(function (id) { seen[id] = true; });

    extraProducts.forEach(function (r) {
      if (!r || !r.id || seen[r.id]) return;
      seen[r.id] = true;
      ids.push(r.id);
    });

    return ids;
  }

  function products() {
    return productIds()
      .map(function (id) { return view(descriptor(id)); })
      .filter(Boolean);
  }

  function getProduct(id) {
    var d = descriptor(id);
    return d ? view(d) : null;
  }

  function unitOf(p) {
    if (!p) return "개";
    if (p.type === "oripa") return "구";
    if (p.type === "etc" || p.type === "single") return "개";
    return p.shrink === "CARTON" ? "카톤" : "박스";
  }

  /* ── 장바구니 ─────────────────────────────────────────── */
  function rawCart() {
    var list = readJson(LS_CART, []);
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (x) { return x && typeof x.id === "string"; })
      .map(function (x) { return { id: x.id, qty: clampInt(x.qty, 1, 999) }; });
  }

  function saveCart(list) {
    writeJson(LS_CART, list);
    emit("cart");
  }

  /* 재고가 줄었거나 상품이 사라졌으면 장바구니를 정리합니다. */
  function syncCart() {
    var list = rawCart();
    var next = [];
    var changed = false;
    list.forEach(function (line) {
      var p = getProduct(line.id);
      if (!p) { changed = true; return; }
      var qty = Math.min(line.qty, p.stock);
      if (qty <= 0) { changed = true; return; }
      if (qty !== line.qty) changed = true;
      next.push({ id: line.id, qty: qty });
    });
    if (changed) saveCart(next);
    return next;
  }

  function cartLines() {
    return syncCart().map(function (line) {
      var p = getProduct(line.id);
      return {
        product: p,
        id: line.id,
        qty: line.qty,
        unitPrice: Number(p.price) || 0,
        lineTotal: (Number(p.price) || 0) * line.qty,
      };
    }).filter(function (l) { return !!l.product; });
  }

  function cartCount() {
    return cartLines().reduce(function (n, l) { return n + l.qty; }, 0);
  }

  function cartTotal() {
    return cartLines().reduce(function (n, l) { return n + l.lineTotal; }, 0);
  }

  function addToCart(id, qty) {
    var p = getProduct(id);
    if (!p) return { ok: false, reason: "not_found", message: "상품을 찾을 수 없습니다." };
    if (p.soldOut) return { ok: false, reason: "soldout", message: "품절된 상품입니다." };

    var add = clampInt(qty, 1, p.stock);
    var list = syncCart();
    var line = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) line = list[i];

    var already = line ? line.qty : 0;
    if (already >= p.stock) {
      return {
        ok: false,
        reason: "stock",
        message: "남은 재고(" + p.stock + unitOf(p) + ")까지 담겨 있습니다.",
      };
    }
    var nextQty = Math.min(already + add, p.stock);
    var clamped = already + add > p.stock;

    if (line) line.qty = nextQty;
    else list.push({ id: id, qty: nextQty });

    saveCart(list);
    return {
      ok: true,
      clamped: clamped,
      qty: nextQty,
      message: clamped
        ? "남은 재고가 " + p.stock + unitOf(p) + "이라 " + p.stock + unitOf(p) + "까지만 담았습니다."
        : p.name + " " + (nextQty - already) + unitOf(p) + "를 장바구니에 담았습니다.",
    };
  }

  function setQty(id, qty) {
    var p = getProduct(id);
    if (!p) return { ok: false, message: "상품을 찾을 수 없습니다." };
    var list = syncCart();
    var line = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) line = list[i];
    if (!line) return { ok: false, message: "장바구니에 없는 상품입니다." };

    var want = clampInt(qty, 0, p.stock);
    if (want <= 0) {
      removeFromCart(id);
      return { ok: true, qty: 0, removed: true };
    }
    line.qty = want;
    saveCart(list);
    return { ok: true, qty: want, clamped: want < clampInt(qty, 0, 9999) };
  }

  function removeFromCart(id) {
    var list = syncCart().filter(function (x) { return x.id !== id; });
    saveCart(list);
    return list;
  }

  function clearCart() {
    saveCart([]);
  }

  /* ── 주문번호 ─────────────────────────────────────────── */
  function ymdSeoul() {
    try {
      var s = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, "");
    } catch (e) { /* fallthrough */ }
    var d = new Date();
    return String(d.getFullYear()) +
      ("0" + (d.getMonth() + 1)).slice(-2) +
      ("0" + d.getDate()).slice(-2);
  }

  function randomBlock(n) {
    var out = "";
    var buf = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buf);
      for (var i = 0; i < n; i++) out += NO_ORDER_CHARS[buf[i] % NO_ORDER_CHARS.length];
    } else {
      for (var j = 0; j < n; j++) {
        out += NO_ORDER_CHARS[Math.floor(Math.random() * NO_ORDER_CHARS.length)];
      }
    }
    return out;
  }

  function newOrderNo(taken) {
    for (var i = 0; i < 40; i++) {
      var no = "APO-" + ymdSeoul() + "-" + randomBlock(4);
      if (!taken || !taken[no]) return no;
    }
    return "APO-" + ymdSeoul() + "-" + randomBlock(4) + randomBlock(2);
  }

  /* ── 주문 (테스트 모드) ───────────────────────────────── */
  function readOrders() {
    var list = readJson(LS_ORDERS, []);
    return Array.isArray(list) ? list : [];
  }

  function saveOrders(list) {
    writeJson(LS_ORDERS, list);
    emit("orders");
  }

  function localPlaceOrder(form) {
    var lines = cartLines();
    if (!lines.length) {
      var err0 = new Error("장바구니가 비어 있습니다.");
      err0.code = "EMPTY_CART";
      throw err0;
    }
    /* 주문 시점 재고를 한 번 더 확인 (원자적 차감) */
    for (var i = 0; i < lines.length; i++) {
      var cur = getProduct(lines[i].id);
      if (!cur || cur.stock < lines[i].qty) {
        var err = new Error(
          (cur ? cur.name : "상품") + "의 남은 재고가 " +
          (cur ? cur.stock : 0) + unitOf(cur) + "입니다. 수량을 조정해 주세요."
        );
        err.code = "OUT_OF_STOCK";
        throw err;
      }
    }

    var orders = readOrders();
    var taken = {};
    orders.forEach(function (o) { taken[o.order_no] = true; });
    var orderNo = newOrderNo(taken);

    var items = lines.map(function (l) {
      return {
        product_id: l.id,
        product_name: l.product.name,
        product_type: l.product.type,
        unit: unitOf(l.product),
        unit_price: l.unitPrice,
        qty: l.qty,
        line_total: l.lineTotal,
      };
    });
    var total = items.reduce(function (n, x) { return n + x.line_total; }, 0);

    /* 재고 차감 + 0 이 되면 자동 품절 */
    items.forEach(function (it) {
      var st = productState[it.product_id] || { stock: initialStock(findBase(it.product_id) || {}) };
      var nextStock = Math.max(0, (Number(st.stock) || 0) - it.qty);
      productState[it.product_id] = {
        stock: nextStock,
        status: nextStock <= 0 ? "sold" : statusFromStock(nextStock, st.status),
      };
    });
    saveProductState();

    var now = new Date().toISOString();
    var order = {
      order_no: orderNo,
      status: "pending_payment",
      mode: "demo",
      created_at: now,
      updated_at: now,
      paid_at: null,
      shipped_at: null,
      cancelled_at: null,
      total_amount: total,
      customer_name: form.name,
      depositor_name: form.depositor || form.name,
      user_id: null,
      is_member: false,
      phone: digits(form.phone),
      postcode: form.postcode || "",
      address: form.address || "",
      address_detail: form.address_detail || "",
      memo: form.memo || "",
      items: items,
    };
    orders.unshift(order);
    saveOrders(orders);

    clearCart();
    emit("products");
    return order;
  }

  /* ── Supabase 연결 ────────────────────────────────────── */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("스크립트를 불러오지 못했습니다: " + src)); };
      document.head.appendChild(s);
    });
  }

  /* 공개 키 형식 확인
     · sb_publishable_... : Supabase 신형 공개 키 (JWT 아님)
     · eyJ...            : 예전 anon 키 (JWT) */
  function isJwtKey(key) {
    return /^ey[A-Za-z0-9_-]+\./.test(String(key || ""));
  }

  /* supabase-js 는 기본적으로 `apikey` 와 `Authorization: Bearer <key>` 를
     같이 보냅니다. 하지만 sb_publishable_ 키는 JWT 가 아니라서
     Authorization 헤더에 넣으면 PostgREST 가 거절할 수 있습니다.
     → Authorization 이 "Bearer <공개키 그대로>" 일 때만 지우고 apikey 만 남깁니다.
       (로그인 세션 토큰 등 다른 Authorization 값은 그대로 둡니다.) */
  function dbFetch(input, init) {
    if (init && init.headers && !isJwtKey(dbKey)) {
      try {
        var h = new Headers(init.headers);
        if (h.get("Authorization") === "Bearer " + dbKey) h.delete("Authorization");
        var next = {};
        for (var k in init) {
          if (Object.prototype.hasOwnProperty.call(init, k)) next[k] = init[k];
        }
        next.headers = h;
        return window.fetch(input, next);
      } catch (e) {
        /* Headers 를 못 다루는 환경이면 그대로 진행 */
      }
    }
    return window.fetch(input, init);
  }

  function makeClient() {
    var client = window.supabase.createClient(dbUrl, dbKey, {
      global: { fetch: dbFetch },
    });
    /* 세션 만료·갱신·로그아웃을 캐시에 반영 (관리자 로그인 상태 유지) */
    try {
      client.auth.onAuthStateChange(function (event, session) {
        if (event === "SIGNED_OUT") rememberSession(null);
        else if (session) rememberSession(session);
        emit("auth");
      });
    } catch (e) {
      /* onAuthStateChange 를 지원하지 않는 버전이면 무시 */
    }
    return client;
  }

  function connectDb() {
    if (db) return Promise.resolve(db);
    if (window.supabase && window.supabase.createClient) {
      db = makeClient();
      return Promise.resolve(db);
    }
    return loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js")
      .then(function () {
        if (!window.supabase || !window.supabase.createClient) {
          throw new Error("Supabase 클라이언트를 초기화하지 못했습니다.");
        }
        db = makeClient();
        return db;
      });
  }

  function rpc(name, args) {
    return connectDb()
      .then(function (c) { return c.rpc(name, args); })
      .then(function (res) {
        if (res.error) {
          var e = new Error(res.error.message || "요청이 처리되지 않았습니다.");
          e.code = res.error.code;
          e.detail = res.error.details || res.error.hint || "";
          throw e;
        }
        return res.data;
      });
  }

  var PRODUCT_FIELDS = {
    full: "id, name, type, game, edition, price, stock, status, subtitle, image_url, sort_order",
    v1:   "id, name, type, game, price, stock, status",
    min:  "id, name, price, stock, status",
  };

  function normalizeRow(r) {
    return {
      id: String(r.id),
      name: r.name || "",
      /* 예전 'single' 분류는 'etc'(기타)로 보여 줍니다. (업그레이드 SQL이 DB도 바꿉니다) */
      type: (r.type === "single" ? "etc" : r.type) || "box",
      game: r.game || "pokemon",
      edition: r.edition || "",
      price: Number(r.price) || 0,
      stock: Math.max(0, Math.floor(Number(r.stock) || 0)),
      status: r.status || "available",
      subtitle: r.subtitle || "",
      image_url: r.image_url || "",
      sort_order: Number(r.sort_order) || 0,
    };
  }

  function applyRows(rows) {
    dbRows = [];
    dbRowById = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.id) return;
      var row = normalizeRow(r);
      dbRows.push(row);
      dbRowById[row.id] = row;
    });
    /* DB에 아직 없는 cards.js 상품은 카드 재고를 그대로 사용 */
    BASE.forEach(function (p) {
      if (!productState[p.id]) {
        productState[p.id] = { stock: initialStock(p), status: p.status || "available" };
      }
    });
  }

  /* 새 열(subtitle·image_url)이 아직 없는 DB에서도 동작하도록 단계적으로 줄여 조회합니다. */
  function fetchDbProducts() {
    return connectDb().then(function (c) {
      var order = ["full", "v1", "min"];
      function attempt(i) {
        return c.from("products").select(PRODUCT_FIELDS[order[i]]).then(function (res) {
          if (res.error) {
            if (i + 1 < order.length) return attempt(i + 1);
            throw new Error(res.error.message || "상품을 불러오지 못했습니다.");
          }
          dbColumns = order[i];
          applyRows(res.data || []);
          return dbRows.length;
        });
      }
      return attempt(0);
    });
  }

  /* 사장님 공개 설정 (비로그인 주문 허용 여부). 표가 없으면 게스트 주문 허용으로 봅니다. */
  function fetchSettings() {
    if (mode === "demo" && !wantDb) {
      settings.ready = false;
      settings.requireLogin = false;
      return Promise.resolve(false);
    }
    return connectDb()
      .then(function (c) {
        return c.from("shop_public_settings").select("require_login_to_order").eq("id", 1);
      })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message || "설정을 불러오지 못했습니다.");
        var row = (res.data || [])[0];
        settings.ready = !!row;
        settings.requireLogin = !!(row && row.require_login_to_order);
        return settings.ready;
      })
      .catch(function (err) {
        settings.ready = false;
        settings.requireLogin = false;
        if (window.console && console.warn) console.warn("[ALL PO ONE] 설정 조회 실패:", err);
        return false;
      });
  }

  function normalizeDbOrder(o) {
    var items = (o.items || o.order_items || []).map(function (it) {
      return {
        product_id: it.product_id,
        product_name: it.product_name,
        unit_price: Number(it.unit_price) || 0,
        qty: Number(it.qty) || 0,
        line_total: Number(it.line_total) || (Number(it.unit_price) || 0) * (Number(it.qty) || 0),
      };
    });
    return {
      order_no: o.order_no,
      status: o.status,
      mode: "db",
      user_id: o.user_id || null,
      is_member: o.user_id ? true : !!o.is_member,
      created_at: o.created_at,
      updated_at: o.updated_at,
      paid_at: o.paid_at,
      shipped_at: o.shipped_at,
      cancelled_at: o.cancelled_at,
      expires_at: o.expires_at || null,
      total_amount: Number(o.total_amount) || 0,
      customer_name: o.customer_name,
      depositor_name: o.depositor_name,
      phone: o.phone,
      postcode: o.postcode,
      address: o.address,
      address_detail: o.address_detail,
      memo: o.memo,
      items: items,
    };
  }

  /* ── 주문 넣기 ────────────────────────────────────────── */
  function placeOrder(form) {
    var lines = cartLines();
    if (!lines.length) {
      var e = new Error("장바구니가 비어 있습니다.");
      e.code = "EMPTY_CART";
      return Promise.reject(e);
    }

    if (mode !== "db") {
      try {
        return Promise.resolve(localPlaceOrder(form));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    var payload = {
      name: form.name,
      depositor: form.depositor || form.name,
      phone: digits(form.phone),
      postcode: form.postcode || "",
      address: form.address || "",
      address_detail: form.address_detail || "",
      memo: form.memo || "",
    };
    var items = lines.map(function (l) { return { product_id: l.id, qty: l.qty }; });

    return rpc("place_order", { p_customer: payload, p_items: items }).then(function (data) {
      var raw = Array.isArray(data) ? data[0] : data;
      var order = normalizeDbOrder(raw && raw.order ? raw.order : raw);
      clearCart();
      return fetchDbProducts().then(function () {
        emit("products");
        emit("orders");
        return order;
      });
    });
  }

  /* ── 주문 조회 (손님) ─────────────────────────────────── */
  function localLookup(q) {
    var list = readOrders();
    var no = String(q.orderNo || "").trim().toUpperCase();
    var name = String(q.name || "").trim();
    var phone = digits(q.phone);

    return list.filter(function (o) {
      if (no) return String(o.order_no).toUpperCase() === no;
      if (!name || !phone) return false;
      return String(o.customer_name).trim() === name && digits(o.phone) === phone;
    });
  }

  function lookupOrders(q) {
    var no = String(q.orderNo || "").trim();
    var name = String(q.name || "").trim();
    var phone = digits(q.phone);

    if (!no && (!name || phone.length < 9)) {
      var err = new Error("주문번호 또는 주문자명 + 연락처를 입력해 주세요.");
      err.code = "BAD_QUERY";
      return Promise.reject(err);
    }

    if (mode !== "db") return Promise.resolve(localLookup(q));

    return rpc("lookup_orders", {
      p_order_no: no || null,
      p_name: name || null,
      p_phone: phone || null,
    }).then(function (data) {
      var list = Array.isArray(data) ? data : (data ? [data] : []);
      return list.map(normalizeDbOrder);
    });
  }

  /* ── 주문 상태 변경 (관리자) ──────────────────────────── */
  var STATUS_ORDER = ["pending_payment", "paid", "shipped", "cancelled"];

  function localSetStatus(orderNo, status) {
    var orders = readOrders();
    var target = null;
    for (var i = 0; i < orders.length; i++) {
      if (orders[i].order_no === orderNo) target = orders[i];
    }
    if (!target) {
      var e2 = new Error("주문을 찾을 수 없습니다.");
      e2.code = "NOT_FOUND";
      throw e2;
    }
    if (STATUS_ORDER.indexOf(status) === -1) {
      var e3 = new Error("알 수 없는 상태입니다.");
      e3.code = "BAD_STATUS";
      throw e3;
    }

    var wasCancelled = target.status === "cancelled";
    var now = new Date().toISOString();

    if (status === "cancelled" && !wasCancelled) {
      /* 취소 → 차감했던 재고 복구 + 품절 해제 */
      target.items.forEach(function (it) {
        var st = productState[it.product_id] || { stock: 0, status: "soldout" };
        var next = (Number(st.stock) || 0) + (Number(it.qty) || 0);
        productState[it.product_id] = { stock: next, status: statusFromStock(next, "soldout") };
      });
      saveProductState();
      target.cancelled_at = now;
      emit("products");
    }
    if (wasCancelled && status !== "cancelled") {
      var e4 = new Error("취소된 주문은 되돌릴 수 없습니다. 재고를 다시 확인해 주세요.");
      e4.code = "CANCELLED";
      throw e4;
    }

    target.status = status;
    target.updated_at = now;
    if (status === "paid") target.paid_at = target.paid_at || now;
    if (status === "shipped") {
      target.paid_at = target.paid_at || now;
      target.shipped_at = target.shipped_at || now;
    }
    saveOrders(orders);
    return target;
  }

  function setOrderStatus(orderNo, status) {
    if (mode !== "db") {
      try {
        return Promise.resolve(localSetStatus(orderNo, status));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    /* p_pin 은 null — 서버가 JWT(app_metadata.role = 'admin')로 관리자를 확인합니다. */
    return rpc("update_order_status", {
      p_order_no: orderNo,
      p_status: status,
      p_pin: null,
    }).then(function (data) {
      var raw = Array.isArray(data) ? data[0] : data;
      var order = normalizeDbOrder(raw && raw.order ? raw.order : raw);
      return fetchDbProducts().then(function () {
        emit("products");
        emit("orders");
        return order;
      });
    });
  }

  /* ── 관리자: 주문 목록 ────────────────────────────────── */
  function listOrders() {
    if (mode !== "db") {
      if (!demoUnlocked()) return Promise.reject(needLogin());
      return Promise.resolve(readOrders().slice());
    }
    return rpc("admin_list_orders", { p_pin: null }).then(function (data) {
      var list = Array.isArray(data) ? data : (data ? [data] : []);
      return list.map(normalizeDbOrder);
    });
  }

  /* ── 관리자: 자동 입금 확인 로그 ─────────────────────── */
  function listDepositEvents(limit) {
    if (mode !== "db") {
      if (!demoUnlocked()) return Promise.reject(needLogin());
      return Promise.resolve([]);
    }
    return rpc("admin_deposit_events", {
      p_pin: null,
      p_limit: clampInt(limit || 30, 1, 100),
    }).then(function (data) {
      return Array.isArray(data) ? data : (data ? [data] : []);
    });
  }

  /* ── 관리자: 상품 추가·수정·삭제 ──────────────────────── */
  function newProductId() {
    var id = "";
    var buf = new Uint8Array(5);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    for (var i = 0; i < 5; i++) id += "0123456789abcdef"[(buf[i] || Math.floor(Math.random() * 16)) % 16];
    return "db-" + id;
  }

  function localSaveProduct(data) {
    var id = data.id || newProductId();
    var base = findBase(id);
    var prev = extraById[id] || {};
    var name = String(data.name || "").trim();
    var price = clampInt(data.price, 0, 100000000);
    var stock = clampInt(data.stock, 0, 99999);
    var subtitle = String(data.subtitle == null ? (prev.subtitle || "") : data.subtitle).trim();
    var image = String(data.image_url == null ? (prev.image_url || "") : data.image_url).trim();
    var status = statusFromStock(stock, prev.status || (base && base.status) || "available");

    if (!name) {
      var e1 = new Error("상품명을 입력해 주세요.");
      e1.code = "BAD_INPUT";
      throw e1;
    }

    if (base && !prev.id) {
      /* cards.js 상품: 로컬 수정값만 덮어쓰기 */
      productState[id] = { name: name, price: price, stock: stock, status: status };
    } else {
      var row = {
        id: id,
        name: name,
        type: data.type || prev.type || (base && base.type) || "box",
        game: data.game || prev.game || (base && base.game) || "pokemon",
        edition: data.edition === undefined
          ? (prev.edition || (base && base.language) || "")
          : String(data.edition || "").trim(),
        price: price,
        stock: stock,
        status: status,
        subtitle: subtitle,
        image_url: image,
        sort_order: prev.sort_order || (1000 + extraProducts.length * 10),
      };
      var found = false;
      extraProducts = extraProducts.map(function (r) {
        if (r.id !== id) return r;
        found = true;
        return row;
      });
      if (!found) extraProducts.push(row);
      extraById[id] = row;
      productState[id] = { stock: stock, status: status };
    }

    saveProductState();
    syncCart();
    emit("products");
    return getProduct(id);
  }

  function localDeleteProduct(id) {
    if (findBase(id) && !extraById[id]) {
      /* cards.js 상품은 숨김 처리 (파일은 그대로 둡니다) */
      productState[id] = { stock: 0, status: "soldout", deleted: true };
    } else {
      extraProducts = extraProducts.filter(function (r) { return r.id !== id; });
      delete extraById[id];
      delete productState[id];
    }
    saveProductState();
    syncCart();
    emit("products");
    return true;
  }

  function rpcMissing(err) {
    var msg = String((err && err.message) || "");
    var code = String((err && err.code) || "");
    return code === "PGRST202" || /could not find the function|schema cache/i.test(msg);
  }

  function upgradeNeeded() {
    var e = new Error(
      "새 기능(상품 추가·사진·회원 주문)은 DB 업그레이드가 필요합니다. " +
      "Supabase SQL Editor 에서 supabase-upgrade-v2.sql 을 한 번 실행해 주세요."
    );
    e.code = "NEED_UPGRADE";
    return e;
  }

  /* 상품 저장: 새 상품(id 없음)도, 기존 상품 수정도 같은 함수로 처리합니다. */
  function saveProduct(data) {
    var id = data.id ? String(data.id) : "";

    if (mode !== "db") {
      try {
        return Promise.resolve(localSaveProduct(data));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    var prev = id ? dbRowById[id] : null;
    var payload = {
      p_id: id || null,
      p_name: String(data.name || "").trim(),
      p_type: data.type || (prev && prev.type) || "box",
      p_game: data.game || (prev && prev.game) || "pokemon",
      p_edition: data.edition === undefined
        ? ((prev && prev.edition) || null)
        : (String(data.edition || "").trim() || null),
      p_price: clampInt(data.price, 0, 100000000),
      p_stock: clampInt(data.stock, 0, 99999),
      p_subtitle: data.subtitle == null ? (prev ? prev.subtitle : null) : String(data.subtitle).trim(),
      p_image_url: data.image_url == null ? (prev ? prev.image_url : null) : String(data.image_url).trim(),
      p_pin: null,
    };

    function done(res) {
      var row = res || {};
      return fetchDbProducts().then(function () {
        emit("products");
        return getProduct(row.id || id);
      });
    }

    /* 이름·가격·재고만 바뀌었으면 좁은 RPC(admin_update_product)를 씁니다. */
    var onlyBasic = prev &&
      payload.p_type === prev.type && payload.p_game === prev.game &&
      (payload.p_edition || "") === (prev.edition || "") &&
      payload.p_subtitle === prev.subtitle && payload.p_image_url === prev.image_url;

    if (onlyBasic) {
      return rpc("admin_update_product", {
        p_product_id: id,
        p_name: payload.p_name,
        p_price: payload.p_price,
        p_stock: payload.p_stock,
        p_pin: null,
      }).then(done).catch(function (err) {
        if (rpcMissing(err)) throw upgradeNeeded();
        throw err;
      });
    }

    return rpc("admin_upsert_product", payload)
      .then(done)
      .catch(function (err) {
        if (rpcMissing(err)) throw upgradeNeeded();
        throw err;
      });
  }

  function deleteProduct(id) {
    if (mode !== "db") {
      return Promise.resolve(localDeleteProduct(id));
    }
    return rpc("admin_delete_product", { p_id: id, p_pin: null })
      .then(function () {
        return fetchDbProducts();
      })
      .then(function () {
        syncCart();
        emit("products");
        return true;
      })
      .catch(function (err) {
        if (rpcMissing(err)) throw upgradeNeeded();
        throw err;
      });
  }

  function setStock(id, stock) {
    return saveProduct({ id: id, name: (getProduct(id) || {}).name, price: (getProduct(id) || {}).price, stock: stock });
  }

  /* ── 관리자: 사진 올리기 (Supabase Storage) ──────────── */
  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("사진을 읽지 못했습니다.")); };
      reader.readAsDataURL(file);
    });
  }

  function shrinkImage(file, maxSide, quality, wantDataUrl) {
    return Promise.resolve()
      .then(function () {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          var url = URL.createObjectURL(file);
          img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("사진을 읽지 못했습니다.")); };
          img.src = url;
        });
      })
      .then(function (img) {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));

        var canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);

        if (wantDataUrl) {
          return { dataUrl: canvas.toDataURL("image/jpeg", quality), width: cw, height: ch };
        }
        return new Promise(function (resolve) {
          canvas.toBlob(
            function (blob) {
              resolve({ blob: blob, width: cw, height: ch });
            },
            "image/jpeg",
            quality
          );
        });
      });
  }

  /* 파일 → { url, via: "storage" | "dataurl", warning }
     Storage 버킷이 없거나 업로드가 거부되면 작은 사진(data URL)으로 대신 저장합니다. */
  function uploadProductImage(file, idHint) {
    if (!file) return Promise.reject(new Error("사진 파일을 선택해 주세요."));
    if (!/^image\//.test(String(file.type || ""))) {
      return Promise.reject(new Error("사진 파일(jpg·png·webp)만 올릴 수 있습니다."));
    }

    function fallback(err) {
      return shrinkImage(file, 640, 0.72, true).then(function (small) {
        return {
          url: small.dataUrl,
          via: "dataurl",
          warning:
            "사진 저장소(Storage)에 올리지 못해 작은 사진으로 저장합니다. " +
            "supabase-upgrade-v2.sql 을 실행하면 원본 화질로 올릴 수 있습니다." +
            " (" + ((err && err.message) || "업로드 실패") + ")",
        };
      });
    }

    if (mode !== "db") {
      return shrinkImage(file, 640, 0.72, true).then(function (small) {
        return {
          url: small.dataUrl,
          via: "dataurl",
          warning: "테스트 모드에서는 사진이 이 브라우저에만 저장됩니다.",
        };
      });
    }

    var path = "products/" + String(idHint || "new") + "-" + Date.now() + ".jpg";

    return shrinkImage(file, 1200, 0.82, false)
      .then(function (out) {
        if (!out.blob) throw new Error("사진을 변환하지 못했습니다.");
        return connectDb().then(function (c) {
          return c.storage
            .from(IMAGE_BUCKET)
            .upload(path, out.blob, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" })
            .then(function (res) {
              if (res.error) throw new Error(res.error.message || "사진 업로드에 실패했습니다.");
              var pub = c.storage.from(IMAGE_BUCKET).getPublicUrl(path);
              var url = pub && pub.data ? pub.data.publicUrl : "";
              if (!url) throw new Error("사진 주소를 얻지 못했습니다.");
              return { url: url, via: "storage", warning: "" };
            });
        });
      })
      .catch(fallback);
  }

  /* ============================================================
     관리자 인증 — Supabase Auth (이메일 + 비밀번호)
     ------------------------------------------------------------
     · DB 모드: supabase.auth.signInWithPassword / signOut
       로그인한 계정의 app_metadata.role === 'admin' 만 관리자로 인정합니다.
     · 테스트 모드: 화면 잠금만(같은 브라우저 로컬 데이터). PIN 은 쓰지 않습니다.
     ============================================================ */

  var sessionCache = null;      // 현재 로그인 세션 (없으면 null)
  var sessionPromise = null;    // getSession() 결과 캐시

  function needLogin(msg) {
    var e = new Error(msg || "관리자 계정으로 로그인해 주세요.");
    e.code = "NOT_ADMIN";
    return e;
  }

  function rememberSession(session) {
    sessionCache = session || null;
    sessionPromise = Promise.resolve(sessionCache);
    return sessionCache;
  }

  function sessionUser(session) {
    return (session && session.user) || null;
  }

  /* app_metadata 는 서버(대시보드·SQL)만 바꿀 수 있어 위조할 수 없습니다. */
  function isAdminUser(user) {
    var meta = user && user.app_metadata;
    return !!(meta && meta.role === "admin");
  }

  function loadSession() {
    if (mode !== "db") return Promise.resolve(null);
    if (sessionPromise) return sessionPromise;
    sessionPromise = connectDb()
      .then(function (c) { return c.auth.getSession(); })
      .then(function (res) {
        return rememberSession(res && res.data ? res.data.session : null);
      })
      .catch(function (err) {
        if (window.console && console.warn) console.warn("[ALL PO ONE] 세션 확인 실패:", err);
        sessionCache = null;
        sessionPromise = null;      // 다음 호출에서 다시 시도
        return null;
      });
    return sessionPromise;
  }

  function currentUser() {
    return sessionUser(sessionCache);
  }

  function isAdminSession() {
    return isAdminUser(currentUser());
  }

  /* 로그인 오류를 화면에 보여줄 한국어 문장으로 바꿉니다.
     accountWord: 손님은 "아이디", 사장님(admin.html)은 "이메일" */
  function authMessage(err, accountWord) {
    var word = accountWord || "아이디";
    var raw = String((err && (err.message || err.msg || err.error_description)) || "");
    var code = String((err && err.code) || "");
    var status = Number(err && err.status) || 0;
    if (/email not confirmed/i.test(raw)) {
      if (word === "아이디") {
        return "아이디 가입 계정은 이메일 인증이 꺼져 있어야 로그인할 수 있습니다. 사장님께 오픈톡으로 문의해 주세요.";
      }
      return "이메일 인증이 완료되지 않은 계정입니다. 받은 메일의 인증 링크를 먼저 눌러 주세요.";
    }
    if (/invalid login credentials|invalid_credentials|invalid_grant/i.test(raw) ||
        code === "invalid_credentials") {
      return word + " 또는 비밀번호가 맞지 않습니다.";
    }
    if (/too many requests|rate limit|over_email_send_rate_limit/i.test(raw) || status === 429) {
      return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (/user not found/i.test(raw)) {
      return "등록되지 않은 " + word + "입니다.";
    }
    if (/already registered|already been registered|user already exists/i.test(raw)) {
      return word === "이메일"
        ? "이미 가입된 이메일입니다. [로그인] 탭에서 로그인해 주세요."
        : "이미 가입된 아이디입니다. [로그인] 탭에서 로그인해 주세요.";
    }
    if (/password should be at least|weak password|password.*too short/i.test(raw)) {
      return "비밀번호가 너무 짧습니다. 6자 이상으로 입력해 주세요.";
    }
    if (/signups? not allowed|signup is disabled|signups are disabled/i.test(raw)) {
      return "지금은 회원가입이 꺼져 있습니다. 사장님께 오픈톡으로 문의해 주세요.";
    }
    if (/invalid email|email address .* invalid|unable to validate email/i.test(raw)) {
      return "이메일 형식을 확인해 주세요.";
    }
    if (/failed to fetch|network/i.test(raw)) {
      return "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.";
    }
    return raw || "로그인하지 못했습니다.";
  }

  function signIn(email, password) {
    var mail = String(email == null ? "" : email).trim();
    var pw = String(password == null ? "" : password);
    if (!mail) return Promise.reject(new Error("관리자 이메일을 입력해 주세요."));
    if (!pw) return Promise.reject(new Error("비밀번호를 입력해 주세요."));

    if (mode !== "db") {
      demoUnlock();
      return Promise.resolve({ demo: true, user: null, isAdmin: true });
    }

    return connectDb()
      .then(function (c) {
        return c.auth.signInWithPassword({ email: mail, password: pw });
      })
      .then(function (res) {
        if (res && res.error) {
          var e = new Error(authMessage(res.error, "이메일"));
          e.code = res.error.code || res.error.status || "AUTH";
          throw e;
        }
        var session = (res && res.data && res.data.session) || null;
        var user = (res && res.data && res.data.user) || sessionUser(session);
        rememberSession(session);
        return { session: session, user: user, isAdmin: isAdminUser(user) };
      });
  }

  function signOut() {
    if (mode !== "db") {
      lock();
      return Promise.resolve();
    }
    return connectDb()
      .then(function (c) {
        /* scope: "local" — 이 브라우저의 세션만 해제합니다. (다른 기기 로그인은 유지) */
        return c.auth.signOut({ scope: "local" });
      })
      .catch(function (err) {
        if (window.console && console.warn) console.warn("[ALL PO ONE] 로그아웃 실패:", err);
      })
      .then(function () {
        rememberSession(null);
        lock();
      });
  }

  /* ============================================================
     손님 회원 — 회원가입 · 로그인 · 내 주문
     ------------------------------------------------------------
     사장님 로그인(signIn)과 같은 Supabase Auth 를 쓰지만,
     손님은 app_metadata.role 이 없어도 됩니다.
     ============================================================ */

  function demoAuthError() {
    var e = new Error(
      "지금은 DB 연동 전 테스트 모드입니다. 회원가입·로그인은 Supabase 연동 후에 쓸 수 있습니다. " +
      "비회원 주문으로 진행해 주세요."
    );
    e.code = "DEMO";
    return e;
  }

  /* ── 아이디 로그인 규칙 ───────────────────────────────────
     손님은 이메일 없이 아이디만 씁니다. 내부적으로
     <아이디>@member.allpoone.local 을 Supabase Auth 이메일로 씁니다.
     입력값에 @ 가 있으면(사장님 관리자 이메일 등) 변환 없이 그대로 씁니다. */
  var MEMBER_DOMAIN = "member.allpoone.local";

  function loginEmail(raw) {
    var v = String(raw == null ? "" : raw).trim();
    if (!v) return "";
    if (v.indexOf("@") >= 0) return v;
    return v.toLowerCase() + "@" + MEMBER_DOMAIN;
  }

  function isMemberEmail(mail) {
    return new RegExp("@" + MEMBER_DOMAIN.replace(/\./g, "\\.") + "$", "i").test(String(mail || ""));
  }

  /* 화면에 보여줄 아이디 — 내부 이메일(@member.allpoone.local)은 숨깁니다. */
  function displayId(user) {
    var u = user || currentUser();
    if (!u) return "";
    var meta = u.user_metadata || {};
    if (meta.username) return String(meta.username);
    var mail = String(u.email || "");
    if (isMemberEmail(mail)) return mail.split("@")[0];
    return "";
  }

  function signInUser(login, password) {
    var raw = String(login == null ? "" : login).trim();
    var mail = loginEmail(raw);
    var pw = String(password == null ? "" : password);
    if (!raw) return Promise.reject(new Error("아이디를 입력해 주세요."));
    if (!pw) return Promise.reject(new Error("비밀번호를 입력해 주세요."));
    if (mode !== "db") return Promise.reject(demoAuthError());

    return connectDb()
      .then(function (c) { return c.auth.signInWithPassword({ email: mail, password: pw }); })
      .then(function (res) {
        if (res && res.error) throw new Error(authMessage(res.error));
        var session = (res && res.data && res.data.session) || null;
        var user = (res && res.data && res.data.user) || sessionUser(session);
        if (!session) throw new Error("로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        rememberSession(session);
        emit("auth");
        return { session: session, user: user };
      });
  }

  function signUpUser(login, password, meta) {
    var raw = String(login == null ? "" : login).trim();
    var pw = String(password == null ? "" : password);
    var info = meta || {};
    if (!raw) return Promise.reject(new Error("아이디를 입력해 주세요."));
    if (!pw || pw.length < 6) return Promise.reject(new Error("비밀번호는 6자 이상으로 입력해 주세요."));
    if (mode !== "db") return Promise.reject(demoAuthError());

    /* 아이디(아이디만) 또는 이메일(기존 방식) 둘 다 받습니다. */
    var isEmail = raw.indexOf("@") >= 0;
    var username = isEmail ? "" : raw.toLowerCase();
    if (!isEmail && !/^[a-z0-9_-]{4,20}$/.test(username)) {
      return Promise.reject(new Error("아이디는 영문 소문자·숫자·_·- 4~20자로 입력해 주세요."));
    }
    var mail = loginEmail(raw);

    var data = {};
    if (username) data.username = username;
    if (info.name) data.name = String(info.name).trim();
    if (info.phone) data.phone = digits(info.phone);

    return connectDb()
      .then(function (c) {
        return c.auth.signUp({ email: mail, password: pw, options: { data: data } });
      })
      .then(function (res) {
        if (res && res.error) throw new Error(authMessage(res.error));
        var payload = (res && res.data) || {};
        var session = payload.session || null;
        var user = payload.user || null;

        /* 이메일 확인이 켜져 있으면 세션이 바로 나오지 않습니다. */
        if (!session) {
          var exists = user && user.identities && user.identities.length === 0;
          return {
            needsConfirm: true,
            alreadyRegistered: !!exists,
            user: user,
            message: exists
              ? "이미 가입된 아이디입니다. [로그인] 탭에서 로그인해 주세요."
              : (isMemberEmail(mail)
                  ? "아이디 회원가입을 사용하려면 관리자 설정(Supabase 이메일 인증 끄기)이 필요합니다. 사장님께 오픈톡으로 알려 주세요."
                  : "가입한 이메일로 인증 링크를 보냈습니다. 메일함에서 인증 링크를 눌러 주세요."),
          };
        }

        rememberSession(session);
        emit("auth");
        return { needsConfirm: false, session: session, user: user || sessionUser(session) };
      });
  }

  function signOutUser() {
    if (mode !== "db") {
      rememberSession(null);
      emit("auth");
      return Promise.resolve();
    }
    return connectDb()
      .then(function (c) { return c.auth.signOut({ scope: "local" }); })
      .catch(function (err) {
        if (window.console && console.warn) console.warn("[ALL PO ONE] 로그아웃 실패:", err);
      })
      .then(function () {
        rememberSession(null);
        emit("auth");
      });
  }

  function userMeta() {
    var u = currentUser();
    return (u && u.user_metadata) || {};
  }

  /* 주문 완료 시 최근 배송지를 계정에 저장 → 다음 주문 때 자동 채움 */
  function saveShipping(form) {
    if (mode !== "db" || !currentUser()) return Promise.resolve(false);
    var data = {
      name: String(form.name || "").trim(),
      phone: digits(form.phone),
      shipping: {
        postcode: String(form.postcode || "").trim(),
        address: String(form.address || "").trim(),
        address_detail: String(form.address_detail || "").trim(),
      },
    };
    return connectDb()
      .then(function (c) { return c.auth.updateUser({ data: data }); })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error.message || "저장하지 못했습니다.");
        /* 세션은 onAuthStateChange(USER_UPDATED) 로 갱신됩니다. */
        return true;
      })
      .catch(function (err) {
        if (window.console && console.warn) console.warn("[ALL PO ONE] 배송지 저장 실패:", err);
        return false;
      });
  }

  function myOrders() {
    if (mode !== "db") return Promise.reject(demoAuthError());
    if (!currentUser()) {
      var e = new Error("로그인 후 이용해 주세요.");
      e.code = "NOT_LOGGED_IN";
      return Promise.reject(e);
    }
    return rpc("my_orders", {})
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data ? [data] : []);
        return list.map(normalizeDbOrder);
      })
      .catch(function (err) {
        if (rpcMissing(err)) throw upgradeNeeded();
        throw err;
      });
  }

  /* ── 주문 취소 · 10분 만료 ───────────────────────────────── */
  var TTL_MS = 10 * 60 * 1000;

  function expiresAtOf(order) {
    if (!order) return 0;
    if (order.expires_at) {
      var t = Date.parse(order.expires_at);
      if (!isNaN(t)) return t;
    }
    var c = Date.parse(order.created_at || "");
    return isNaN(c) ? 0 : c + TTL_MS;
  }

  /* 지난 미입금 주문을 지금 정리합니다. (사이트·주문·조회를 열 때 호출) */
  function expireNow() {
    if (mode !== "db") {
      var t = Date.now();
      var changed = 0;
      readOrders().forEach(function (o) {
        if (o.status !== "pending_payment") return;
        if (expiresAtOf(o) > t) return;
        try {
          localSetStatus(o.order_no, "cancelled");
          changed++;
        } catch (e) { /* 무시 */ }
      });
      if (changed) emit("orders");
      return Promise.resolve({ expired: changed });
    }

    return rpc("expire_unpaid_orders", {})
      .then(function (data) {
        var raw = Array.isArray(data) ? data[0] : data;
        var n = Number(raw && raw.expired) || 0;
        if (n > 0) {
          return fetchDbProducts().then(function () {
            emit("products");
            emit("orders");
            return { expired: n };
          });
        }
        return { expired: 0 };
      })
      .catch(function () {
        /* 업그레이드 전이거나 일시 오류 → 화면은 그대로 진행 */
        return { expired: 0 };
      });
  }

  function localCancelOrder(orderNo) {
    var list = readOrders();
    var target = null;
    list.forEach(function (o) { if (o.order_no === orderNo) target = o; });
    if (!target) {
      var e = new Error("주문을 찾을 수 없습니다.");
      e.code = "NOT_FOUND";
      throw e;
    }
    if (target.status === "cancelled") {
      var e2 = new Error("이미 취소된 주문입니다.");
      e2.code = "CANCELLED";
      throw e2;
    }
    if (target.status !== "pending_payment") {
      var e3 = new Error("입금이 확인된 주문은 직접 취소할 수 없습니다.");
      e3.code = "NOT_CANCELLABLE";
      throw e3;
    }
    return localSetStatus(orderNo, "cancelled");
  }

  /* 손님 직접 취소 (입금대기만). 비회원은 주문자명 + 연락처로 본인 확인. */
  function cancelMyOrder(orderNo, name, phone) {
    var no = String(orderNo || "").trim();
    if (!no) return Promise.reject(new Error("주문번호를 확인해 주세요."));

    if (mode !== "db") {
      try {
        var out = localCancelOrder(no);
        syncCart();
        emit("products");
        emit("orders");
        return Promise.resolve(out);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return rpc("cancel_my_order", {
      p_order_no: no,
      p_name: name ? String(name).trim() : null,
      p_phone: phone ? digits(phone) : null,
    })
      .then(function (data) {
        var raw = Array.isArray(data) ? data[0] : data;
        var order = normalizeDbOrder(raw && raw.order ? raw.order : raw);
        return fetchDbProducts().then(function () {
          emit("products");
          emit("orders");
          return order;
        });
      })
      .catch(function (err) {
        if (rpcMissing(err)) throw upgradeNeeded();
        throw err;
      });
  }

  /* 사장님 설정: 비로그인 주문 허용 여부 */
  function requireLogin() {
    return !!settings.requireLogin;
  }

  function settingsReady() {
    return !!settings.ready;
  }

  function setRequireLogin(flag) {
    if (mode !== "db") {
      var e = new Error("이 설정은 DB 연동 후에 바꿀 수 있습니다.");
      e.code = "DEMO";
      return Promise.reject(e);
    }
    return rpc("admin_set_require_login", { p_require: !!flag, p_pin: null })
      .then(function (data) {
        var raw = Array.isArray(data) ? data[0] : data;
        settings.requireLogin = !!(raw && raw.require_login_to_order);
        settings.ready = true;
        emit("settings");
        return settings.requireLogin;
      })
      .catch(function (err) {
        if (rpcMissing(err)) throw upgradeNeeded();
        throw err;
      });
  }


  /* 테스트 모드 화면 잠금 (비밀번호 없음 — 같은 브라우저 로컬 데이터 전용) */
  function demoUnlocked() {
    try { return sessionStorage.getItem(LS_ADMIN) === "1"; } catch (e) { return false; }
  }

  function demoUnlock() {
    try { sessionStorage.setItem(LS_ADMIN, "1"); } catch (e) { /* 무시 */ }
    return true;
  }

  function lock() {
    try { sessionStorage.removeItem(LS_ADMIN); } catch (e) { /* 무시 */ }
  }

  /* ── 초기화 ───────────────────────────────────────────── */
  function init() {
    if (readyPromise) return readyPromise;
    loadProductState();
    syncCart();

    if (!wantDb) {
      mode = "demo";
      readyPromise = Promise.resolve("demo");
      return readyPromise;
    }

    readyPromise = Promise.all([fetchDbProducts(), fetchSettings()])
      .then(function () {
        mode = "db";
        dbError = "";
        emit("products");
        emit("settings");
      })
      /* 사이트를 여는 순간 10분 지난 미입금 주문을 정리합니다. */
      .then(function () { return expireNow(); })
      .then(function () { return "db"; })
      .catch(function (err) {
        /* DB에 닿지 못하면 화면이 멈추지 않도록 테스트 모드로 계속 진행 */
        mode = "demo";
        dbError = (err && err.message) || "DB에 연결하지 못했습니다.";
        if (window.console && console.warn) console.warn("[ALL PO ONE] DB 연결 실패:", err);
        emit("products");
        return "demo";
      });
    return readyPromise;
  }

  function reload() {
    if (mode !== "db") {
      loadProductState();
      syncCart();
      emit("products");
      emit("orders");
      emit("settings");
      return Promise.resolve("demo");
    }
    return Promise.all([fetchDbProducts(), fetchSettings()]).then(function () {
      syncCart();
      emit("products");
      emit("settings");
      return "db";
    });
  }

  /* ── 공개 API ─────────────────────────────────────────── */
  window.APOStore = {
    init: init,
    reload: reload,
    mode: function () { return mode; },
    dbError: function () { return dbError; },
    isDemo: function () { return mode !== "db"; },
    configured: wantDb,

    products: products,
    getProduct: getProduct,
    unitOf: unitOf,
    won: won,

    cart: cartLines,
    cartCount: cartCount,
    cartTotal: cartTotal,
    addToCart: addToCart,
    setQty: setQty,
    removeFromCart: removeFromCart,
    clearCart: clearCart,

    placeOrder: placeOrder,
    lookupOrders: lookupOrders,
    listOrders: listOrders,
    setOrderStatus: setOrderStatus,
    setStock: setStock,
    saveProduct: saveProduct,
    deleteProduct: deleteProduct,
    uploadProductImage: uploadProductImage,
    listDepositEvents: listDepositEvents,
    dbColumns: function () { return dbColumns; },

    /* 사장님 설정 · 손님 회원 */
    requireLogin: requireLogin,
    settingsReady: settingsReady,
    setRequireLogin: setRequireLogin,
    user: currentUser,
    userMeta: userMeta,
    displayId: displayId,
    isMemberEmail: isMemberEmail,
    signInUser: signInUser,
    signUpUser: signUpUser,
    signOutUser: signOutUser,
    saveShipping: saveShipping,
    myOrders: myOrders,
    cancelMyOrder: cancelMyOrder,
    expireNow: expireNow,
    expiresAtOf: expiresAtOf,
    TTL_MS: TTL_MS,

    /* 관리자 인증 (Supabase Auth) */
    signIn: signIn,
    signOut: signOut,
    loadSession: loadSession,
    currentUser: currentUser,
    isAdminUser: isAdminUser,
    isAdminSession: isAdminSession,

    /* 테스트 모드 화면 잠금 */
    unlock: demoUnlock,
    isUnlocked: demoUnlocked,
    lock: lock,

    dateBlock: ymdSeoul,
  };
})();

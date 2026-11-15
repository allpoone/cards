/* ============================================================
   ALL PO ONE — store.js
   ------------------------------------------------------------
   상품 재고 · 장바구니 · 주문 데이터 계층입니다.

   · SITE_CONFIG.supabaseUrl / supabaseAnonKey 가 채워져 있으면
     실제 Supabase DB(place_order / update_order_status RPC)를 씁니다.
   · 비어 있으면 "DB 연동 전 테스트 모드"로 이 브라우저(localStorage)에
     똑같이 주문 생성 · 재고 차감 · 주문 저장을 합니다.
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
  var productState = {};   // id -> { stock, status }
  var readyPromise = null;

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
    writeJson(LS_PRODUCTS, { seed: baseSeed(), products: productState });
  }

  function loadProductState() {
    var saved = readJson(LS_PRODUCTS, null);
    if (saved && saved.seed === baseSeed() && saved.products) {
      productState = saved.products;
    } else {
      /* cards.js 의 재고를 손봤거나 처음 방문 → 카드 값으로 다시 시작 */
      productState = seedState();
    }
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

  /* 화면에 보여줄 상품 (카드 디자인 값 + 실시간 재고) */
  function view(p) {
    if (!p) return null;
    var st = productState[p.id] || { stock: initialStock(p), status: p.status || "available" };
    var stock = Math.max(0, Math.floor(Number(st.stock) || 0));
    var status = statusFromStock(stock, st.status || p.status);
    var out = {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
    out.stock = stock;
    out.status = status;
    out.soldOut = stock <= 0;
    /* 기존 화면 함수들이 쓰는 잔여 수량 필드도 같이 맞춰 줍니다. */
    if (p.type === "oripa") out.remainingUnits = stock;
    else out.remaining = stock;
    return out;
  }

  function products() {
    return BASE.map(view).filter(Boolean);
  }

  function findBase(id) {
    for (var i = 0; i < BASE.length; i++) if (BASE[i].id === id) return BASE[i];
    return null;
  }

  function getProduct(id) {
    var p = findBase(id);
    return p ? view(p) : null;
  }

  function unitOf(p) {
    if (!p) return "개";
    if (p.type === "oripa") return "구";
    if (p.type === "single") return "팩";
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
    return window.supabase.createClient(dbUrl, dbKey, {
      global: { fetch: dbFetch },
    });
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

  function fetchDbProducts() {
    return connectDb().then(function (c) {
      return c.from("products").select("id, stock, status");
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      var rows = res.data || [];
      var found = {};
      rows.forEach(function (row) {
        if (!findBase(row.id)) return;
        found[row.id] = true;
        productState[row.id] = {
          stock: Math.max(0, Math.floor(Number(row.stock) || 0)),
          status: row.status || "available",
        };
      });
      /* DB에 아직 없는 상품은 cards.js 재고를 그대로 사용 */
      var missing = BASE.filter(function (p) { return !found[p.id]; });
      missing.forEach(function (p) {
        if (!productState[p.id]) {
          productState[p.id] = { stock: initialStock(p), status: p.status || "available" };
        }
      });
      return rows.length;
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
      created_at: o.created_at,
      updated_at: o.updated_at,
      paid_at: o.paid_at,
      shipped_at: o.shipped_at,
      cancelled_at: o.cancelled_at,
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

  function localSetStatus(orderNo, status, pin) {
    if (!checkPin(pin)) {
      var e = new Error("관리자 PIN이 올바르지 않습니다.");
      e.code = "BAD_PIN";
      throw e;
    }
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

  function setOrderStatus(orderNo, status, pin) {
    if (mode !== "db") {
      try {
        return Promise.resolve(localSetStatus(orderNo, status, pin));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return rpc("update_order_status", {
      p_order_no: orderNo,
      p_status: status,
      p_pin: String(pin || ""),
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
  function listOrders(pin) {
    if (mode !== "db") {
      if (!checkPin(pin)) return Promise.reject(new Error("관리자 PIN이 올바르지 않습니다."));
      return Promise.resolve(readOrders().slice());
    }
    return rpc("admin_list_orders", { p_pin: String(pin || "") }).then(function (data) {
      var list = Array.isArray(data) ? data : (data ? [data] : []);
      return list.map(normalizeDbOrder);
    });
  }

  /* ── 관리자: 자동 입금 확인 로그 ─────────────────────── */
  function listDepositEvents(pin, limit) {
    if (mode !== "db") {
      if (!checkPin(pin)) return Promise.reject(new Error("관리자 PIN이 올바르지 않습니다."));
      return Promise.resolve([]);
    }
    return rpc("admin_deposit_events", {
      p_pin: String(pin || ""),
      p_limit: clampInt(limit || 30, 1, 100),
    }).then(function (data) {
      return Array.isArray(data) ? data : (data ? [data] : []);
    });
  }

  /* ── 관리자: 재고 수정 ────────────────────────────────── */
  function localSetStock(id, stock, pin) {
    if (!checkPin(pin)) {
      var e = new Error("관리자 PIN이 올바르지 않습니다.");
      e.code = "BAD_PIN";
      throw e;
    }
    var base = findBase(id);
    if (!base) {
      var e2 = new Error("상품을 찾을 수 없습니다.");
      e2.code = "NOT_FOUND";
      throw e2;
    }
    var next = clampInt(stock, 0, 9999);
    productState[id] = {
      stock: next,
      status: statusFromStock(next, productState[id] ? productState[id].status : base.status),
    };
    saveProductState();
    syncCart();
    emit("products");
    return getProduct(id);
  }

  function setStock(id, stock, pin) {
    if (mode !== "db") {
      try {
        return Promise.resolve(localSetStock(id, stock, pin));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return rpc("admin_set_stock", {
      p_pin: String(pin || ""),
      p_product_id: id,
      p_stock: clampInt(stock, 0, 9999),
    }).then(function () {
      return fetchDbProducts();
    }).then(function () {
      emit("products");
      return getProduct(id);
    });
  }

  /* ── 관리자 PIN ───────────────────────────────────────── */
  function adminPin() {
    var pin = String(cfg.adminPin == null ? "" : cfg.adminPin).trim();
    return pin || "0000";
  }

  function checkPin(pin) {
    return String(pin == null ? "" : pin).trim() === adminPin();
  }

  function unlock(pin) {
    if (!checkPin(pin)) return false;
    try { sessionStorage.setItem(LS_ADMIN, "1"); } catch (e) { /* 무시 */ }
    return true;
  }

  function isUnlocked() {
    try { return sessionStorage.getItem(LS_ADMIN) === "1"; } catch (e) { return false; }
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

    readyPromise = fetchDbProducts()
      .then(function () {
        mode = "db";
        dbError = "";
        emit("products");
        return "db";
      })
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
      return Promise.resolve("demo");
    }
    return fetchDbProducts().then(function () {
      syncCart();
      emit("products");
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
    listDepositEvents: listDepositEvents,

    adminPin: adminPin,
    checkPin: checkPin,
    unlock: unlock,
    isUnlocked: isUnlocked,
    lock: lock,

    dateBlock: ymdSeoul,
  };
})();

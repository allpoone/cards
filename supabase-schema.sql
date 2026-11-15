-- ============================================================
-- ALL PO ONE (올포원) — Supabase 스키마
-- ------------------------------------------------------------
-- 장바구니 · 계좌이체 주문 · 재고 관리를 실제 DB로 옮길 때 쓰는 파일입니다.
--
-- ▶ 적용 순서
--   1) supabase.com 에서 새 프로젝트를 만듭니다. (무료 플랜으로 충분)
--   2) Dashboard → SQL Editor 에 이 파일 전체를 붙여넣고 [Run].
--   3) 아래 '관리자 PIN' 값을 기본 0000 에서 원하는 숫자로 바꿔 한 번 더 실행합니다.
--        update private.shop_settings set admin_pin = '1234' where id = 1;
--      자동 입금확인 시크릿도 확인해 둡니다. (MacroDroid 연동에 사용)
--        select deposit_secret from private.shop_settings;
--   4) Dashboard → Project Settings → API 에서
--        Project URL  → cards.js 의 SITE_CONFIG.supabaseUrl
--        anon public  → cards.js 의 SITE_CONFIG.supabaseAnonKey
--      에 넣고 배포하면 사이트가 자동으로 DB 모드로 바뀝니다.
--
-- ▶ 구조
--   products        상품 재고·상태 (사이트의 카드 디자인은 cards.js 가 담당)
--   orders          주문 (상태: pending_payment 입금대기 / paid 입금완료 /
--                          shipped 발송완료 / cancelled 취소)
--   order_items     주문 상품 줄
--   deposit_events  은행 알림 자동 입금확인 처리 로그 (관리자만 조회)
--   private.shop_settings  관리자 PIN · 자동 입금확인 시크릿 (anon 접근 차단)
--
-- ▶ 보안 요약
--   · 상품은 누구나 읽기만 가능하고, 재고 수정은 서버 함수(RPC)로만 됩니다.
--   · 주문은 anon 이 직접 읽거나 쓸 수 없습니다. place_order / lookup_orders /
--     update_order_status 함수(SECURITY DEFINER)를 통해서만 접근합니다.
--   · 손님 조회는 주문번호 또는 (주문자명 + 연락처)가 정확히 일치해야 합니다.
--   · PIN 은 화면 잠금 + 서버 함수 검증용입니다. 여러 명이 관리해야 한다면
--     Supabase Auth 사용자에 app_metadata.role = 'admin' 을 주고
--     아래 private.is_admin() 경로를 쓰세요. (PIN 없이도 관리자 권한 인정)
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. 관리자 설정 (private 스키마 — anon 접근 불가)
-- ============================================================
create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.shop_settings (
  id         int primary key default 1 check (id = 1),
  admin_pin  text not null default '0000',
  updated_at timestamptz not null default now()
);

insert into private.shop_settings (id, admin_pin)
values (1, '0000')
on conflict (id) do nothing;

-- 은행 입금 알림(MacroDroid 등) 자동 확인용 시크릿
-- 설치할 때 무작위로 만들어집니다. 확인/변경 방법은 README 의 '자동 입금 확인' 참고.
alter table private.shop_settings
  add column if not exists deposit_secret text not null
  default encode(gen_random_bytes(16), 'hex');

revoke all on private.shop_settings from public;

-- Supabase Auth 관리자 여부 (JWT app_metadata.role = 'admin')
create or replace function private.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- 관리자 확인: Supabase Auth 관리자이거나 PIN이 맞아야 통과
create or replace function private.assert_admin(p_pin text)
returns void
language plpgsql
stable
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_pin text;
begin
  if private.is_admin() then
    return;
  end if;

  select admin_pin into v_pin from private.shop_settings where id = 1;
  if p_pin is not null and btrim(p_pin) = v_pin then
    return;
  end if;

  raise exception '관리자 PIN이 올바르지 않습니다.'
    using errcode = '28000';
end;
$$;

revoke all on function private.is_admin() from public;
revoke all on function private.assert_admin(text) from public;

-- ============================================================
-- 2. 테이블
-- ============================================================
create table if not exists public.products (
  id          text primary key,
  name        text not null,
  type        text not null check (type in ('box', 'oripa', 'single')),
  game        text not null check (game in ('pokemon', 'onepiece')),
  price       integer not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  status      text not null default 'available'
              check (status in ('available', 'low', 'soldout', 'sold')),
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists products_status_idx on public.products (status);

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        text not null unique,
  status          text not null default 'pending_payment'
                  check (status in ('pending_payment', 'paid', 'shipped', 'cancelled')),
  customer_name   text not null,
  depositor_name  text,
  phone           text not null,
  postcode        text,
  address         text,
  address_detail  text,
  memo            text,
  total_amount    integer not null default 0 check (total_amount >= 0),
  paid_at         timestamptz,
  shipped_at      timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_lookup_idx on public.orders (customer_name, phone);

create table if not exists public.order_items (
  id            bigserial primary key,
  order_id      uuid not null references public.orders (id) on delete cascade,
  product_id    text not null references public.products (id),
  product_name  text not null,
  unit_price    integer not null check (unit_price >= 0),
  qty           integer not null check (qty > 0),
  line_total    integer not null check (line_total >= 0)
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

-- 자동 입금 확인(은행 알림) 처리 기록 — 관리자만 볼 수 있음
create table if not exists public.deposit_events (
  id          bigserial primary key,
  raw_text    text not null,
  amount      integer,
  status      text not null check (status in ('matched', 'unmatched', 'ambiguous', 'error')),
  reason      text,
  order_no    text,
  candidates  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists deposit_events_created_idx on public.deposit_events (created_at desc);

-- ============================================================
-- 3. 행 수준 보안 (RLS)
-- ============================================================
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- 상품: 누구나 진열 내용을 읽을 수 있음
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select to anon, authenticated
  using (true);

-- 상품: 관리자만 직접 수정 (사이트는 RPC 를 쓰므로 보통 필요 없음)
drop policy if exists products_admin on public.products;
create policy products_admin on public.products
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- 주문: anon 은 직접 접근 불가. 관리자(Supabase Auth)만 전체 접근.
drop policy if exists orders_admin on public.orders;
create policy orders_admin on public.orders
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists order_items_admin on public.order_items;
create policy order_items_admin on public.order_items
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

alter table public.deposit_events enable row level security;

drop policy if exists deposit_events_admin on public.deposit_events;
create policy deposit_events_admin on public.deposit_events
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- ============================================================
-- 4. 주문 JSON 헬퍼
-- ============================================================
create or replace function public.order_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'order_no',       o.order_no,
    'status',         o.status,
    'created_at',     o.created_at,
    'updated_at',     o.updated_at,
    'paid_at',        o.paid_at,
    'shipped_at',     o.shipped_at,
    'cancelled_at',   o.cancelled_at,
    'total_amount',   o.total_amount,
    'customer_name',  o.customer_name,
    'depositor_name', o.depositor_name,
    'phone',          o.phone,
    'postcode',       o.postcode,
    'address',        o.address,
    'address_detail', o.address_detail,
    'memo',           o.memo,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',   i.product_id,
        'product_name', i.product_name,
        'unit_price',   i.unit_price,
        'qty',          i.qty,
        'line_total',   i.line_total
      ) order by i.id)
      from public.order_items i
      where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_id;
$$;

revoke all on function public.order_json(uuid) from public;

-- ============================================================
-- 5. 주문 넣기 — 원자적 재고 차감
-- ============================================================
create or replace function public.place_order(
  p_customer jsonb,
  p_items    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item      record;
  v_stock     int;
  v_price     int;
  v_order_id  uuid;
  v_order_no  text;
  v_suffix    text;
  v_total     int := 0;
  v_created   timestamptz := now();
  v_name      text := nullif(btrim(coalesce(p_customer ->> 'name', '')), '');
  v_depositor text := nullif(btrim(coalesce(p_customer ->> 'depositor', '')), '');
  v_phone     text := regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9]', '', 'g');
  v_attempt   int := 0;
  v_ok        boolean := false;
begin
  /* --- 입력 검증 ------------------------------------------- */
  if v_name is null then
    raise exception '주문자명을 입력해 주세요.' using errcode = '22023';
  end if;
  if length(v_phone) < 9 or length(v_phone) > 11 then
    raise exception '연락처를 정확히 입력해 주세요.' using errcode = '22023';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception '주문할 상품이 없습니다.' using errcode = '22023';
  end if;

  /* --- 재고 차감 (같은 상품은 합산, id 순서로 잠가 교착 방지) --- */
  for v_item in
    select a.product_id, sum(a.qty)::int as qty
    from (
      select e ->> 'product_id' as product_id,
             coalesce((e ->> 'qty')::int, 0) as qty
      from jsonb_array_elements(p_items) e
    ) a
    group by a.product_id
    order by a.product_id
  loop
    if v_item.qty is null or v_item.qty <= 0 then
      raise exception '수량이 올바르지 않습니다: %', v_item.product_id
        using errcode = '22023';
    end if;

    select price, stock
      into v_price, v_stock
      from public.products
     where id = v_item.product_id
       for update;

    if not found then
      raise exception '상품을 찾을 수 없습니다: %', v_item.product_id
        using errcode = '22023';
    end if;

    if v_stock < v_item.qty then
      raise exception '% 의 남은 재고가 %개입니다. 수량을 조정해 주세요.',
        v_item.product_id, v_stock
        using errcode = '22023';
    end if;

    update public.products
       set stock = stock - v_item.qty,
           status = case when stock - v_item.qty <= 0 then 'sold' else status end,
           updated_at = now()
     where id = v_item.product_id;
  end loop;

  /* --- 주문번호 생성 + 주문 저장 --------------------------- */
  while not v_ok and v_attempt < 20 loop
    v_attempt := v_attempt + 1;

    select string_agg(
             substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                    1 + floor(random() * 32)::int, 1), '')
      into v_suffix
      from generate_series(1, 4);

    v_order_no := 'APO-' || to_char(v_created at time zone 'Asia/Seoul', 'YYYYMMDD')
                  || '-' || v_suffix;

    begin
      insert into public.orders (
        order_no, status, customer_name, depositor_name, phone,
        postcode, address, address_detail, memo, total_amount,
        created_at, updated_at
      ) values (
        v_order_no, 'pending_payment', v_name, coalesce(v_depositor, v_name), v_phone,
        nullif(btrim(coalesce(p_customer ->> 'postcode', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'address', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'address_detail', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'memo', '')), ''),
        0, v_created, v_created
      )
      returning id into v_order_id;

      v_ok := true;
    exception when unique_violation then
      v_ok := false;
    end;
  end loop;

  if not v_ok then
    raise exception '주문번호를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
  end if;

  /* --- 주문 상품 줄 저장 ---------------------------------- */
  insert into public.order_items (
    order_id, product_id, product_name, unit_price, qty, line_total
  )
  select v_order_id, p.id, p.name, p.price, a.qty, p.price * a.qty
  from (
    select e ->> 'product_id' as product_id,
           sum(coalesce((e ->> 'qty')::int, 0))::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
  ) a
  join public.products p on p.id = a.product_id;

  select coalesce(sum(line_total), 0)
    into v_total
    from public.order_items
   where order_id = v_order_id;

  update public.orders
     set total_amount = v_total
   where id = v_order_id;

  return public.order_json(v_order_id);
end;
$$;

comment on function public.place_order(jsonb, jsonb) is
  '장바구니 주문 생성. 재고를 원자적으로 차감하고 0이면 자동 품절 처리.';

-- ============================================================
-- 6. 주문 상태 변경 — 취소 시 재고 복구
-- ============================================================
create or replace function public.update_order_status(
  p_order_no text,
  p_status   text,
  p_pin      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders;
  v_item    record;
begin
  perform private.assert_admin(p_pin);

  if p_status not in ('pending_payment', 'paid', 'shipped', 'cancelled') then
    raise exception '알 수 없는 주문 상태입니다: %', p_status
      using errcode = '22023';
  end if;

  select * into v_order
    from public.orders
   where order_no = btrim(p_order_no)
     for update;

  if not found then
    raise exception '주문을 찾을 수 없습니다: %', p_order_no
      using errcode = '22023';
  end if;

  if v_order.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception '취소된 주문은 되돌릴 수 없습니다. 재고를 확인 후 새 주문으로 받아 주세요.'
      using errcode = '22023';
  end if;

  /* 취소 → 차감했던 재고 복구 + 품절 해제 */
  if p_status = 'cancelled' and v_order.status <> 'cancelled' then
    for v_item in
      select product_id, sum(qty)::int as qty
        from public.order_items
       where order_id = v_order.id
       group by product_id
       order by product_id
    loop
      update public.products
         set stock = stock + v_item.qty,
             status = case
                        when stock + v_item.qty > 0 and status in ('sold', 'soldout')
                          then 'available'
                        else status
                      end,
             updated_at = now()
       where id = v_item.product_id;
    end loop;
  end if;

  update public.orders
     set status = p_status,
         paid_at = case
                     when p_status in ('paid', 'shipped') then coalesce(paid_at, now())
                     else paid_at
                   end,
         shipped_at = case
                        when p_status = 'shipped' then coalesce(shipped_at, now())
                        else shipped_at
                      end,
         cancelled_at = case
                          when p_status = 'cancelled' then coalesce(cancelled_at, now())
                          else cancelled_at
                        end,
         updated_at = now()
   where id = v_order.id;

  return public.order_json(v_order.id);
end;
$$;

comment on function public.update_order_status(text, text, text) is
  '관리자용 주문 상태 변경. cancelled 로 바꾸면 재고를 복구합니다.';

-- ============================================================
-- 7. 손님용 주문 조회
-- ============================================================
create or replace function public.lookup_orders(
  p_order_no text default null,
  p_name     text default null,
  p_phone    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_no    text := nullif(upper(btrim(coalesce(p_order_no, ''))), '');
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_result jsonb;
begin
  if v_no is null and (v_name is null or length(v_phone) < 9) then
    raise exception '주문번호 또는 주문자명 + 연락처를 입력해 주세요.'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(public.order_json(o.id) order by o.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select o.id, o.created_at
        from public.orders o
       where (v_no is not null and upper(o.order_no) = v_no)
          or (
            v_no is null
            and v_name is not null
            and o.customer_name = v_name
            and regexp_replace(o.phone, '[^0-9]', '', 'g') = v_phone
          )
       order by o.created_at desc
       limit 20
    ) o;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- ============================================================
-- 8. 관리자용: 주문 목록 · 재고 수정
-- ============================================================
create or replace function public.admin_list_orders(
  p_pin text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform private.assert_admin(p_pin);

  select coalesce(jsonb_agg(public.order_json(o.id) order by o.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select o.id, o.created_at
        from public.orders o
       where p_status is null or p_status = '' or o.status = p_status
       order by o.created_at desc
       limit 300
    ) o;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_stock(
  p_pin        text,
  p_product_id text,
  p_stock      integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.products;
begin
  perform private.assert_admin(p_pin);

  if p_stock is null or p_stock < 0 then
    raise exception '재고는 0 이상이어야 합니다.' using errcode = '22023';
  end if;

  update public.products
     set stock = p_stock,
         status = case
                    when p_stock <= 0 then 'sold'
                    when status in ('sold', 'soldout') then 'available'
                    else status
                  end,
         updated_at = now()
   where id = p_product_id
  returning * into v_row;

  if not found then
    raise exception '상품을 찾을 수 없습니다: %', p_product_id
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'stock', v_row.stock,
    'status', v_row.status
  );
end;
$$;

-- ============================================================
-- 9. 자동 입금 확인 (은행 알림 → 입금완료)
-- ------------------------------------------------------------
-- 안드로이드 MacroDroid 등에서 은행 입금 푸시 알림을 받으면
-- 아래 HTTP 요청 한 번을 보내면 1초 만에 [입금완료]로 바뀝니다.
--
--   POST https://<project>.supabase.co/rest/v1/rpc/auto_confirm_deposit
--   headers: apikey: <anon key>, Authorization: Bearer <anon key>,
--            Content-Type: application/json
--   body:    {"p_notification_text": "{{notification_text}}", "p_secret": "<deposit_secret>"}
--
-- 동작
--   1) p_secret 이 private.shop_settings.deposit_secret 과 같은지 확인
--   2) 알림 텍스트에서 첫 번째 '금액 + 원' 을 꺼냄 (예: "홍길동 50,000원 입금" → 50000)
--   3) 입금대기 주문 중 (총 입금액 = 그 금액) + (입금자명이 알림에 포함) 인 주문을 찾음
--   4) 후보가 정확히 1건일 때만 [입금완료]로 바꿈
--      · 0건 → {"status":"unmatched"}
--      · 2건 이상(동명이인·같은 금액) → {"status":"ambiguous"} + 후보 주문번호
--      두 경우 모두 확정하지 않고 public.deposit_events 에 남겨 관리자 페이지에서 확인
--
-- 시크릿 확인/변경 (SQL Editor)
--   select deposit_secret from private.shop_settings;
--   update private.shop_settings set deposit_secret = '원하는-길고-복잡한-값' where id = 1;
-- ============================================================
create or replace function public.auto_confirm_deposit(
  p_notification_text text,
  p_secret            text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret     text;
  v_text       text := btrim(coalesce(p_notification_text, ''));
  v_amount     int;
  v_ids        uuid[];
  v_count      int;
  v_candidates jsonb;
  v_order      public.orders;
begin
  /* --- 1) 시크릿 검증 ------------------------------------- */
  select deposit_secret into v_secret from private.shop_settings where id = 1;

  if v_secret is null
     or p_secret is null
     or btrim(p_secret) = ''
     or btrim(p_secret) <> v_secret then
    raise exception '자동 입금 확인 시크릿이 올바르지 않습니다.'
      using errcode = '28000';
  end if;

  /* --- 2) 금액 추출 -------------------------------------- */
  if v_text = '' then
    insert into public.deposit_events (raw_text, status, reason)
    values (v_text, 'unmatched', 'empty_text');
    return jsonb_build_object('status', 'unmatched', 'reason', 'empty_text',
                              'message', '알림 내용이 비어 있습니다.');
  end if;

  select replace(m[1], ',', '')::int
    into v_amount
    from regexp_matches(v_text, '([0-9][0-9,]{0,12})\s*원', 'g') as m
   limit 1;

  if v_amount is null or v_amount <= 0 then
    insert into public.deposit_events (raw_text, status, reason)
    values (v_text, 'unmatched', 'no_amount');
    return jsonb_build_object('status', 'unmatched', 'reason', 'no_amount',
                              'message', '알림에서 입금 금액을 찾지 못했습니다.');
  end if;

  /* --- 3) 후보 주문 찾기 (입금액 일치 + 입금자명 포함) ----- */
  select array_agg(o.id order by o.created_at)
    into v_ids
    from public.orders o
   where o.status = 'pending_payment'
     and o.total_amount = v_amount
     and length(btrim(coalesce(o.depositor_name, o.customer_name, ''))) >= 1
     and v_text ilike '%' || btrim(coalesce(o.depositor_name, o.customer_name)) || '%';

  v_count := coalesce(array_length(v_ids, 1), 0);

  if v_count = 0 then
    insert into public.deposit_events (raw_text, amount, status, reason)
    values (v_text, v_amount, 'unmatched', 'no_candidate');
    return jsonb_build_object(
      'status', 'unmatched',
      'reason', 'no_candidate',
      'amount', v_amount,
      'message', '입금액과 입금자명이 맞는 입금대기 주문이 없습니다.'
    );
  end if;

  if v_count > 1 then
    select jsonb_agg(o.order_no order by o.created_at)
      into v_candidates
      from public.orders o
     where o.id = any(v_ids);

    insert into public.deposit_events (raw_text, amount, status, reason, candidates)
    values (v_text, v_amount, 'ambiguous', 'multiple_candidates', coalesce(v_candidates, '[]'::jsonb));

    return jsonb_build_object(
      'status', 'ambiguous',
      'reason', 'multiple_candidates',
      'amount', v_amount,
      'candidates', coalesce(v_candidates, '[]'::jsonb),
      'message', '같은 금액·입금자명의 입금대기 주문이 2건 이상이라 자동 확정하지 않았습니다. 관리자 페이지에서 확인해 주세요.'
    );
  end if;

  /* --- 4) 단일 후보 → 잠그고 상태 재확인 후 입금완료 ------ */
  select * into v_order
    from public.orders
   where id = v_ids[1]
     for update;

  if v_order.status <> 'pending_payment' then
    insert into public.deposit_events (raw_text, amount, status, reason, order_no)
    values (v_text, v_amount, 'unmatched', 'already_processed', v_order.order_no);
    return jsonb_build_object(
      'status', 'unmatched',
      'reason', 'already_processed',
      'amount', v_amount,
      'order_no', v_order.order_no,
      'message', '이미 처리된 주문입니다. (' || v_order.status || ')'
    );
  end if;

  update public.orders
     set status = 'paid',
         paid_at = coalesce(paid_at, now()),
         updated_at = now()
   where id = v_order.id;

  insert into public.deposit_events (raw_text, amount, status, reason, order_no)
  values (v_text, v_amount, 'matched', 'auto', v_order.order_no);

  return jsonb_build_object(
    'status', 'matched',
    'amount', v_amount,
    'order_no', v_order.order_no,
    'total_amount', v_order.total_amount,
    'customer_name', v_order.customer_name,
    'depositor_name', v_order.depositor_name,
    'paid_at', now()
  );
end;
$$;

comment on function public.auto_confirm_deposit(text, text) is
  '은행 입금 알림 텍스트로 입금대기 주문을 자동 [입금완료] 처리. 애매하면 ambiguous 로 남기고 확정하지 않음.';

-- 자동 입금 확인 로그 (관리자 페이지용)
create or replace function public.admin_deposit_events(
  p_pin   text default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform private.assert_admin(p_pin);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'raw_text', e.raw_text,
           'amount', e.amount,
           'status', e.status,
           'reason', e.reason,
           'order_no', e.order_no,
           'candidates', e.candidates,
           'created_at', e.created_at
         ) order by e.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select *
        from public.deposit_events
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 30), 200))
    ) e;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- ============================================================
-- 10. 실행 권한
-- ============================================================
grant execute on function public.place_order(jsonb, jsonb)          to anon, authenticated;
grant execute on function public.lookup_orders(text, text, text)    to anon, authenticated;
grant execute on function public.update_order_status(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_orders(text, text)      to anon, authenticated;
grant execute on function public.admin_set_stock(text, text, integer) to anon, authenticated;
grant execute on function public.auto_confirm_deposit(text, text)    to anon, authenticated;
grant execute on function public.admin_deposit_events(text, integer) to anon, authenticated;

-- ============================================================
-- 11. 상품 재고 초기값 (cards.js 와 같은 id)
--     이미 있는 상품은 건드리지 않습니다. (재고 보존)
-- ============================================================
insert into public.products (id, name, type, game, price, stock, status, sort_order)
values
  ('box-terastal-festival-jp', '테라스탈 페스티벌 ex 박스',        'box',    'pokemon',  320000, 4,  'available', 10),
  ('box-pokemon-151-kr',       '포켓몬 카드 151 박스',             'box',    'pokemon',  130000, 2,  'low',       20),
  ('box-op09-jp',              'OP-09 신세계 박스',                'box',    'onepiece', 165000, 3,  'available', 30),
  ('box-op07-en-carton',       'OP-07 500년 후의 미래 카톤',       'box',    'onepiece',1050000, 1,  'available', 40),
  ('oripa-eevee-heroes-kr',    '이브이 히어로즈 오리파',           'oripa',  'pokemon',   9900, 18, 'low',       50),
  ('oripa-op05-jp',            'OP-05 오리파',                     'oripa',  'onepiece', 19900, 7,  'low',       60),
  ('oripa-pokemon-151-kr',     '포켓몬 151 오리파',                'oripa',  'pokemon',   6900, 0,  'soldout',   70),
  ('single-terastal-pack-jp',  '테라스탈 페스티벌 ex 낱팩',        'single', 'pokemon',   4500, 24, 'available', 80)
on conflict (id) do nothing;

-- ============================================================
-- 확인용 쿼리 (필요할 때만 실행)
-- ------------------------------------------------------------
-- select id, name, stock, status from public.products order by sort_order;
-- select order_no, status, total_amount, customer_name, created_at from public.orders order by created_at desc limit 20;
-- select * from private.shop_settings;
-- select status, amount, order_no, raw_text, created_at from public.deposit_events order by created_at desc limit 20;
-- ============================================================

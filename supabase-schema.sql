-- ============================================================
-- ALL PO ONE (올포원) — Supabase 스키마
-- ------------------------------------------------------------
-- 장바구니 · 계좌이체 주문 · 재고 관리를 실제 DB로 옮길 때 쓰는 파일입니다.
--
-- ▶ 적용 순서
--   1) supabase.com 에서 새 프로젝트를 만듭니다. (무료 플랜으로 충분)
--   2) Dashboard → SQL Editor 에 이 파일 전체를 붙여넣고 [Run].
--   3) 사장님(관리자) 계정을 만듭니다.
--      Dashboard → Authentication → Users → [Add user] 에서
--        이메일: acac020241@naver.com  / 비밀번호: 본인이 정하는 값
--        Auto Confirm User 체크
--      로 계정을 만든 뒤, 이 파일 맨 아래(13번) '관리자 권한 부여' SQL 을 실행합니다.
--      자동 입금확인 시크릿도 확인해 둡니다. (MacroDroid 연동에 사용)
--        select deposit_secret from private.shop_settings;
--   4) Dashboard → Project Settings → API 에서
--        Project URL  → cards.js 의 SITE_CONFIG.supabaseUrl
--        anon public  → cards.js 의 SITE_CONFIG.supabaseAnonKey
--      에 넣고 배포하면 사이트가 자동으로 DB 모드로 바뀝니다.
--
-- ▶ 구조
--   products        상품 이름·가격·재고·상태·적립금 지급 여부 (카드 디자인은 cards.js 가 담당)
--   orders          주문 (상태: pending_payment 입금대기 / paid 입금완료 /
--                          shipped 발송완료 / cancelled 취소)
--                   user_id = 주문한 회원(auth.users). 비회원 주문이면 null
--                   used_points / earned_points / points_awarded = 적립금 사용·적립 기록
--   order_items     주문 상품 줄
--   point_wallets   회원별 보유 적립금
--   point_transactions  적립·사용·환불·사장님 조정 내역
--   deposit_events  은행 알림 자동 입금확인 처리 로그 (관리자만 조회)
--   shop_public_settings  손님 화면 공개 설정 (비로그인 주문 허용 여부 · 기본 적립률)
--   private.shop_settings  자동 입금확인 시크릿 (anon 접근 차단)
--
-- ▶ 이미 1차 스키마를 실행한 프로젝트
--   파일 전체를 다시 실행해도 안전합니다(있는 것은 그대로).
--   SQL Editor 에 붙여넣기만 하면 되는 짧은 증분 파일:
--     · supabase-upgrade-v2.sql (상품 관리·회원 주문·자동취소·사진)
--     · supabase-upgrade-v3.sql (적립금/포인트)  ← 최신
--
-- ▶ 보안 요약
--   · 상품은 누구나 읽기만 가능하고, 재고 수정은 서버 함수(RPC)로만 됩니다.
--   · 주문은 anon 이 직접 읽거나 쓸 수 없습니다. place_order / lookup_orders /
--     my_orders / update_order_status 함수(SECURITY DEFINER)를 통해서만 접근합니다.
--   · 손님 조회는 주문번호 또는 (주문자명 + 연락처)가 정확히 일치해야 합니다.
--   · 회원은 my_orders() 로 본인 주문(user_id = auth.uid())만 볼 수 있습니다.
--   · 상품 이름·가격·재고 수정은 관리자만 admin_update_product() 로 합니다.
--   · 관리자 권한은 Supabase Auth 계정의 app_metadata.role = 'admin' 하나로만 결정됩니다.
--     이 값은 서버가 서명한 JWT 안에 들어 있어 브라우저에서 위조할 수 없습니다.
--     사이트 코드에는 어떤 비밀번호·PIN 도 두지 않습니다.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. 관리자 설정 (private 스키마 — anon 접근 불가)
-- ============================================================
create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.shop_settings (
  id         int primary key default 1 check (id = 1),
  updated_at timestamptz not null default now()
);

insert into private.shop_settings (id)
values (1)
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

-- 관리자 확인: Supabase Auth 로그인 계정의 app_metadata.role = 'admin' 만 인정
-- (p_pin 은 예전 PIN 방식과의 호출 호환용 인자입니다. 값이 있어도 쓰지 않습니다.)
create or replace function private.assert_admin(p_pin text default null)
returns void
language plpgsql
stable
security definer
set search_path = private, public, pg_temp
as $$
begin
  if private.is_admin() then
    return;
  end if;

  raise exception '관리자 권한이 없습니다. 관리자 계정으로 로그인해 주세요.'
    using errcode = '28000';
end;
$$;

revoke all on function private.is_admin() from public;
revoke all on function private.assert_admin(text) from public;

-- RLS 정책(products_admin 등)은 요청한 사용자(authenticated) 권한으로 실행되므로
-- private 스키마 사용권한과 is_admin() 실행권한이 필요합니다.
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- ============================================================
-- 2. 테이블
-- ============================================================
create table if not exists public.products (
  id          text primary key,
  name        text not null,
  type        text not null check (type in ('box', 'oripa', 'etc')),
  game        text not null check (game in ('pokemon', 'onepiece', 'other')),
  price       integer not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  status      text not null default 'available'
              check (status in ('available', 'low', 'soldout', 'sold')),
  subtitle    text,
  image_url   text,
  edition     text check (edition in ('KR', 'JP', 'EN')),
  sort_order  integer not null default 0,
  earn_points boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- 1차 스키마로 이미 만든 products 테이블에도 새 열을 붙입니다.
alter table public.products add column if not exists subtitle  text;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists edition   text;
-- 상품별 적립금 지급 여부 (기본 ON)
alter table public.products add column if not exists earn_points boolean not null default true;

-- 분류·종목 값 확장 (기존 제약을 지우고 → 값 옮기고 → 새 제약을 답니다)
alter table public.products drop constraint if exists products_type_check;
update public.products set type = 'etc' where type = 'single';

alter table public.products
  add constraint products_type_check check (type in ('box', 'oripa', 'etc'));
alter table public.products drop constraint if exists products_game_check;
alter table public.products
  add constraint products_game_check check (game in ('pokemon', 'onepiece', 'other'));
alter table public.products drop constraint if exists products_edition_check;
alter table public.products
  add constraint products_edition_check check (edition is null or edition in ('KR', 'JP', 'EN'));

create index if not exists products_status_idx on public.products (status);

-- 손님 화면에 공개되는 설정 (비로그인 주문 허용 여부 · 기본 적립률)
create table if not exists public.shop_public_settings (
  id                     int primary key default 1 check (id = 1),
  require_login_to_order boolean not null default false,
  point_rate             numeric(5,2) not null default 2,
  updated_at             timestamptz not null default now()
);

-- 기본 적립률(%) — 0 ~ 50 사이, 기본 2%
alter table public.shop_public_settings
  add column if not exists point_rate numeric(5,2) not null default 2;

alter table public.shop_public_settings
  drop constraint if exists shop_public_settings_point_rate_check;
alter table public.shop_public_settings
  add constraint shop_public_settings_point_rate_check
  check (point_rate >= 0 and point_rate <= 50);

insert into public.shop_public_settings (id)
values (1)
on conflict (id) do nothing;

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
  user_id         uuid references auth.users (id) on delete set null,
  total_amount    integer not null default 0 check (total_amount >= 0),
  used_points     integer not null default 0,
  earned_points   integer not null default 0,
  points_awarded  boolean not null default false,
  paid_at         timestamptz,
  shipped_at      timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_idx on public.orders (created_at desc);
-- 1차 스키마로 이미 만든 orders 테이블에도 회원 컬럼을 붙입니다.
alter table public.orders
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- 적립금: 사용한 포인트 / 적립 예정(또는 완료) 포인트 / 실제 지급 여부
alter table public.orders add column if not exists used_points    integer not null default 0;
alter table public.orders add column if not exists earned_points  integer not null default 0;
alter table public.orders add column if not exists points_awarded boolean not null default false;

create index if not exists orders_lookup_idx on public.orders (customer_name, phone);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

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

-- 적립금 지갑 · 적립/사용 내역 — 손님 브라우저에서는 직접 접근 불가
create table if not exists public.point_wallets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.point_transactions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  amount     integer not null,
  kind       text not null check (kind in ('earn', 'use', 'refund', 'admin')),
  order_no   text,
  memo       text,
  created_at timestamptz not null default now()
);

create index if not exists point_transactions_user_idx
  on public.point_transactions (user_id, created_at desc);
create index if not exists point_transactions_order_idx
  on public.point_transactions (order_no);

-- ============================================================
-- 3. 행 수준 보안 (RLS)
-- ============================================================
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.shop_public_settings enable row level security;

-- 공개 설정: 누구나 읽기만 가능, 수정은 admin_set_require_login() 으로만
grant select on public.shop_public_settings to anon, authenticated;

drop policy if exists shop_public_settings_read on public.shop_public_settings;
create policy shop_public_settings_read on public.shop_public_settings
  for select to anon, authenticated
  using (true);

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

-- 적립금 표: 정책을 두지 않습니다(전부 거부). 조회·변경은 아래 RPC 함수로만.
alter table public.point_wallets      enable row level security;
alter table public.point_transactions enable row level security;
revoke all on public.point_wallets      from anon, authenticated;
revoke all on public.point_transactions from anon, authenticated;
revoke all on sequence public.point_transactions_id_seq from anon, authenticated;

-- ============================================================
-- 3-1. 주문 취소 · 재고 복구 공통 도우미
-- ------------------------------------------------------------
-- 취소(손님 직접 취소 · 10분 미입금 자동 취소 · 사장님 취소)에서 모두 씁니다.
-- 차감했던 재고를 되돌리고, 품절이었으면 다시 판매중으로 바꿉니다.
-- ============================================================
create or replace function private.restore_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_item record;
begin
  for v_item in
    select product_id, sum(qty)::int as qty
      from public.order_items
     where order_id = p_order_id
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
end;
$$;

revoke all on function private.restore_order_stock(uuid) from public;

-- ============================================================
-- 3-2. 적립금 계산 · 지급 · 회수 · 환불 도우미
-- ------------------------------------------------------------
-- 적립금 계산: 1의 자리 반올림 → 10의 자리 반올림(100원 단위)
--   845 → 850 → 900 / 844 → 840 → 800 / 998 → 1,000 → 1,000
-- ============================================================
create or replace function private.calc_earn_points(
  p_eligible_amount integer,
  p_rate            numeric
)
returns integer
language plpgsql
immutable
as $$
declare
  raw_val numeric;
  step1   numeric;
  step2   numeric;
begin
  if p_eligible_amount is null or p_eligible_amount <= 0 then
    return 0;
  end if;

  raw_val := p_eligible_amount::numeric * (coalesce(p_rate, 0)::numeric / 100.0);

  step1 := round(raw_val / 10.0) * 10;    -- 1의 자리 반올림
  step2 := round(step1 / 100.0) * 100;    -- 10의 자리 반올림 → 100원 단위

  return greatest(0, step2)::int;
end;
$$;

revoke all on function private.calc_earn_points(integer, numeric) from public;
grant execute on function private.calc_earn_points(integer, numeric) to authenticated;

-- 입금 확인 시 적립 (같은 주문에 두 번 지급하지 않음)
create or replace function private.award_order_points(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_order public.orders;
  v_earn  integer := 0;
begin
  select * into v_order
    from public.orders
   where id = p_order_id
     for update;

  if not found then
    return 0;
  end if;

  if v_order.points_awarded then
    return 0;
  end if;

  v_earn := greatest(0, coalesce(v_order.earned_points, 0));

  if v_order.user_id is null or v_earn = 0 then
    update public.orders
       set points_awarded = true,
           updated_at = now()
     where id = p_order_id
       and points_awarded = false;
    return 0;
  end if;

  insert into public.point_wallets (user_id, balance, updated_at)
  values (v_order.user_id, v_earn, now())
  on conflict (user_id) do update
     set balance    = public.point_wallets.balance + excluded.balance,
         updated_at = now();

  insert into public.point_transactions (user_id, amount, kind, order_no, memo)
  values (v_order.user_id, v_earn, 'earn', v_order.order_no, '입금 확인 적립');

  update public.orders
     set points_awarded = true,
         updated_at = now()
   where id = p_order_id;

  return v_earn;
end;
$$;

revoke all on function private.award_order_points(uuid) from public;

-- 이미 적립된 주문을 취소할 때 회수 (잔액이 모자라면 0까지만 차감)
create or replace function private.revoke_order_points(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_order public.orders;
  v_earn  integer := 0;
  v_take  integer := 0;
begin
  select * into v_order
    from public.orders
   where id = p_order_id
     for update;

  if not found then
    return 0;
  end if;

  if v_order.user_id is null or v_order.points_awarded = false then
    return 0;
  end if;

  v_earn := greatest(0, coalesce(v_order.earned_points, 0));

  update public.orders
     set points_awarded = false,
         updated_at = now()
   where id = p_order_id;

  if v_earn = 0 then
    return 0;
  end if;

  select least(coalesce(balance, 0), v_earn)
    into v_take
    from public.point_wallets
   where user_id = v_order.user_id
     for update;

  if v_take is null or v_take <= 0 then
    return 0;
  end if;

  update public.point_wallets
     set balance    = greatest(0, balance - v_take),
         updated_at = now()
   where user_id = v_order.user_id;

  insert into public.point_transactions (user_id, amount, kind, order_no, memo)
  values (v_order.user_id, -v_take, 'admin', v_order.order_no, '주문 취소로 적립 회수');

  return v_take;
end;
$$;

revoke all on function private.revoke_order_points(uuid) from public;

-- 주문 취소 시 사용한 적립금 환불 (같은 주문에서 한 번만)
create or replace function private.refund_order_points(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_order  public.orders;
  v_refund integer := 0;
begin
  select * into v_order
    from public.orders
   where id = p_order_id
     for update;

  if not found then
    return 0;
  end if;

  if v_order.user_id is null or coalesce(v_order.used_points, 0) <= 0 then
    return 0;
  end if;

  if exists (
    select 1
      from public.point_transactions t
     where t.order_no = v_order.order_no
       and t.kind = 'refund'
  ) then
    return 0;
  end if;

  v_refund := v_order.used_points;

  insert into public.point_wallets (user_id, balance, updated_at)
  values (v_order.user_id, v_refund, now())
  on conflict (user_id) do update
     set balance    = public.point_wallets.balance + excluded.balance,
         updated_at = now();

  insert into public.point_transactions (user_id, amount, kind, order_no, memo)
  values (v_order.user_id, v_refund, 'refund', v_order.order_no, '주문 취소 적립금 환불');

  return v_refund;
end;
$$;

revoke all on function private.refund_order_points(uuid) from public;

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
    'used_points',    o.used_points,
    'earned_points',  o.earned_points,
    'points_awarded', o.points_awarded,
    'customer_name',  o.customer_name,
    'depositor_name', o.depositor_name,
    'phone',          o.phone,
    'postcode',       o.postcode,
    'address',        o.address,
    'address_detail', o.address_detail,
    'memo',           o.memo,
    'user_id',        o.user_id,
    'is_member',      (o.user_id is not null),
    'expires_at',     case when o.status = 'pending_payment'
                           then o.created_at + interval '10 minutes'
                           else null end,
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
  p_customer   jsonb,
  p_items      jsonb,
  p_use_points integer default 0
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
  v_subtotal  int := 0;
  v_eligible  int := 0;
  v_use       int := greatest(0, coalesce(p_use_points, 0));
  v_balance   int := 0;
  v_rate      numeric(5,2) := 2;
  v_earn      int := 0;
  v_created   timestamptz := now();
  v_name      text := nullif(btrim(coalesce(p_customer ->> 'name', '')), '');
  v_depositor text := nullif(btrim(coalesce(p_customer ->> 'depositor', '')), '');
  v_phone     text := regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9]', '', 'g');
  v_attempt   int := 0;
  v_ok        boolean := false;
  v_uid       uuid := auth.uid();
  v_require   boolean := false;
begin
  /* 10분 지난 미입금 주문을 먼저 정리 (재고·적립금 복구) */
  perform public.expire_unpaid_orders();

  /* --- 회원 전용 설정 확인 --------------------------------- */
  select require_login_to_order, coalesce(point_rate, 2)
    into v_require, v_rate
    from public.shop_public_settings
   where id = 1;

  if coalesce(v_require, false) and v_uid is null then
    raise exception '이 쇼핑몰은 회원만 주문할 수 있습니다. 로그인 또는 회원가입 후 주문해 주세요.'
      using errcode = '42501';
  end if;

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

  /* --- 적립금은 로그인 회원만 사용할 수 있습니다 ------------ */
  if v_use > 0 and v_uid is null then
    raise exception '적립금은 로그인한 회원만 사용할 수 있습니다.'
      using errcode = '42501';
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
        postcode, address, address_detail, memo, user_id, total_amount,
        created_at, updated_at
      ) values (
        v_order_no, 'pending_payment', v_name, coalesce(v_depositor, v_name), v_phone,
        nullif(btrim(coalesce(p_customer ->> 'postcode', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'address', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'address_detail', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'memo', '')), ''),
        v_uid,
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

  /* 상품 합계 / 적립 대상(적립 ON 상품) 합계 */
  select coalesce(sum(i.line_total), 0),
         coalesce(sum(case when p.earn_points then i.line_total else 0 end), 0)
    into v_subtotal, v_eligible
    from public.order_items i
    join public.products p on p.id = i.product_id
   where i.order_id = v_order_id;

  /* --- 적립금 사용 검증 + 차감 ---------------------------- */
  if v_use > 0 then
    if v_use > v_subtotal then
      raise exception '적립금은 주문 금액(%)보다 많이 사용할 수 없습니다.', v_subtotal
        using errcode = '22023';
    end if;

    select balance
      into v_balance
      from public.point_wallets
     where user_id = v_uid
       for update;

    if v_balance is null or v_balance < v_use then
      raise exception '보유 적립금이 부족합니다. (보유 %P)', coalesce(v_balance, 0)
        using errcode = '22023';
    end if;

    /* 실결제 비율만큼 적립 대상 금액에서 빼고 적립금을 계산합니다. */
    if v_subtotal > 0 then
      v_eligible := greatest(0,
        round(v_eligible::numeric * (v_subtotal - v_use)::numeric / v_subtotal::numeric)::int);
    else
      v_eligible := 0;
    end if;
  end if;

  v_earn := private.calc_earn_points(v_eligible, v_rate);
  v_total := v_subtotal - v_use;

  update public.orders
     set total_amount  = v_total,
         used_points   = v_use,
         earned_points = v_earn,
         updated_at    = now()
   where id = v_order_id;

  if v_use > 0 then
    update public.point_wallets
       set balance    = balance - v_use,
           updated_at = now()
     where user_id = v_uid;

    insert into public.point_transactions (user_id, amount, kind, order_no, memo)
    values (v_uid, -v_use, 'use', v_order_no, '주문 적립금 사용');
  end if;

  return public.order_json(v_order_id);
end;
$$;

comment on function public.place_order(jsonb, jsonb, integer) is
  '장바구니 주문 생성. 재고를 원자적으로 차감하고 0이면 자동 품절 처리. 적립금 사용·적립 예정 계산. 로그인 회원이면 user_id 저장.';

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
  v_order public.orders;
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
    perform private.restore_order_stock(v_order.id);
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

  /* 입금확인 → 적립금 지급 (두 번 지급되지 않게 서버가 확인) */
  if p_status in ('paid', 'shipped') then
    perform private.award_order_points(v_order.id);
  end if;

  /* 취소 → 사용 적립금 환불 + 이미 지급한 적립금 회수 */
  if p_status = 'cancelled' and v_order.status <> 'cancelled' then
    perform private.refund_order_points(v_order.id);
    perform private.revoke_order_points(v_order.id);
  end if;

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

  perform public.expire_unpaid_orders();

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
-- 7-1. 회원용: 내 주문 조회 (로그인한 본인 주문만)
-- ------------------------------------------------------------
-- orders 는 anon·일반회원이 직접 읽을 수 없습니다.
-- 이 함수가 auth.uid() 와 일치하는 주문만 골라 돌려줍니다.
-- ============================================================
create or replace function public.my_orders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception '로그인 후 이용해 주세요.' using errcode = '28000';
  end if;

  perform public.expire_unpaid_orders();

  select coalesce(jsonb_agg(public.order_json(o.id) order by o.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select o.id, o.created_at
        from public.orders o
       where o.user_id = v_uid
       order by o.created_at desc
       limit 50
    ) o;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

comment on function public.my_orders() is
  '로그인한 회원 본인의 주문 목록 (최근 50건). user_id = auth.uid()';

-- ============================================================
-- 7-2. 입금대기 10분 만료 — 자동 취소 + 재고 복구
-- ------------------------------------------------------------
-- 주문은 created_at 부터 10분 안에 입금해야 합니다.
-- 손님이 사이트를 열거나, 주문·조회·관리자 화면을 여는 순간
-- 만료된 입금대기 주문을 한 번에 취소하고 재고를 되돌립니다.
-- ============================================================
create or replace function public.expire_unpaid_orders()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_count int := 0;
begin
  for v_id in
    select id
      from public.orders
     where status = 'pending_payment'
       and created_at < now() - interval '10 minutes'
     order by created_at
     for update skip locked
  loop
    perform private.restore_order_stock(v_id);
    perform private.refund_order_points(v_id);

    update public.orders
       set status = 'cancelled',
           cancelled_at = coalesce(cancelled_at, now()),
           updated_at = now()
     where id = v_id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('expired', v_count);
end;
$$;

comment on function public.expire_unpaid_orders() is
  '10분 넘게 입금되지 않은 입금대기 주문을 자동 취소하고 재고를 복구합니다.';

-- ============================================================
-- 7-3. 손님 직접 주문 취소 (입금대기 상태만)
-- ------------------------------------------------------------
-- · 로그인 회원: 본인 주문(user_id = auth.uid())만
-- · 비회원: 주문번호 + 주문자명 + 연락처가 모두 맞아야
-- ============================================================
create or replace function public.cancel_my_order(
  p_order_no text,
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
  v_uid   uuid := auth.uid();
  v_order public.orders;
begin
  perform public.expire_unpaid_orders();

  if v_no is null then
    raise exception '주문번호를 입력해 주세요.' using errcode = '22023';
  end if;

  select * into v_order
    from public.orders
   where upper(order_no) = v_no
     for update;

  if not found then
    raise exception '주문을 찾을 수 없습니다: %', p_order_no using errcode = '22023';
  end if;

  if v_order.status = 'cancelled' then
    raise exception '이미 취소된 주문입니다.' using errcode = '22023';
  end if;
  if v_order.status in ('paid', 'shipped') then
    raise exception '입금이 확인된 주문은 직접 취소할 수 없습니다. 오픈톡으로 문의해 주세요.'
      using errcode = '22023';
  end if;

  /* 본인 확인: 로그인 회원이거나, 주문자명 + 연락처가 맞아야 합니다. */
  if v_uid is null or v_order.user_id is distinct from v_uid then
    if v_name is null
       or v_order.customer_name <> v_name
       or regexp_replace(v_order.phone, '[^0-9]', '', 'g') <> v_phone
       or length(v_phone) < 9 then
      raise exception '주문자명과 연락처가 맞지 않아 취소할 수 없습니다.' using errcode = '28000';
    end if;
  end if;

  perform private.restore_order_stock(v_order.id);
  perform private.refund_order_points(v_order.id);

  update public.orders
     set status = 'cancelled',
         cancelled_at = coalesce(cancelled_at, now()),
         updated_at = now()
   where id = v_order.id;

  return public.order_json(v_order.id);
end;
$$;

comment on function public.cancel_my_order(text, text, text) is
  '손님 직접 주문 취소. 입금대기 상태만 가능하고, 취소하면 재고가 복구됩니다.';

-- ============================================================
-- 8. 관리자용: 주문 목록 · 상품(이름·가격·재고) 관리
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

  perform public.expire_unpaid_orders();

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

-- ── 상품 이름 · 가격 · 재고 수정 (한 번에 저장) ────────────
-- p_pin 은 예전 PIN 방식과의 호출 호환용입니다. (실제 권한은 Auth 관리자 계정으로 확인)
create or replace function public.admin_update_product(
  p_product_id text,
  p_name       text,
  p_price      integer,
  p_stock      integer,
  p_pin        text default null
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

  select * into v_row
    from public.products
   where id = p_product_id;

  if not found then
    raise exception '상품을 찾을 수 없습니다: %', p_product_id
      using errcode = '22023';
  end if;

  /* 분류·종목·설명·사진·적립 여부는 그대로 두고 이름·가격·재고만 바꿉니다. */
  return public.admin_upsert_product(
    p_product_id, p_name, v_row.type, v_row.game, p_price, p_stock,
    v_row.edition, v_row.subtitle, v_row.image_url, v_row.earn_points, p_pin
  );
end;
$$;

comment on function public.admin_update_product(text, text, integer, integer, text) is
  '관리자용 상품명·가격·재고 동시 수정. stock 0이면 sold, 품절이었다가 재고가 생기면 available.';

-- ── 새 상품 추가 / 상품 정보 전체 수정 (upsert) ────────────
-- p_id 가 없으면 서버가 새 id 를 만듭니다. (db-xxxxxxxxxx)
drop function if exists public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text);
drop function if exists public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, text);

create or replace function public.admin_upsert_product(
  p_id         text,
  p_name       text,
  p_type       text,
  p_game       text,
  p_price      integer,
  p_stock      integer,
  p_edition    text default null,
  p_subtitle   text default null,
  p_image_url  text default null,
  p_earn_points boolean default true,
  p_pin        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      text := nullif(btrim(coalesce(p_id, '')), '');
  v_row     public.products;
  v_sort    integer;
  v_new     boolean := false;
  v_edition text;
  v_earn    boolean := coalesce(p_earn_points, true);
begin
  perform private.assert_admin(p_pin);

  if p_name is null or btrim(p_name) = '' then
    raise exception '상품명을 입력해 주세요.' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('box', 'oripa', 'etc') then
    raise exception '상품 유형은 box / oripa / etc 중 하나여야 합니다.' using errcode = '22023';
  end if;
  if p_game is null or p_game not in ('pokemon', 'onepiece', 'other') then
    raise exception '종목은 pokemon / onepiece / other 중 하나여야 합니다.' using errcode = '22023';
  end if;
  if p_edition is not null and btrim(p_edition) <> ''
     and btrim(p_edition) not in ('KR', 'JP', 'EN') then
    raise exception '판본은 KR / JP / EN 중 하나이거나 비워 두어야 합니다.' using errcode = '22023';
  end if;

  v_edition := nullif(upper(btrim(coalesce(p_edition, ''))), '');
  if p_price is null or p_price < 0 then
    raise exception '가격은 0원 이상이어야 합니다.' using errcode = '22023';
  end if;
  if p_price > 100000000 then
    raise exception '가격이 너무 큽니다. (1억 원 이하로 입력해 주세요)' using errcode = '22023';
  end if;
  if p_stock is null or p_stock < 0 then
    raise exception '재고는 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  if p_stock > 99999 then
    raise exception '재고는 99,999개 이하로 입력해 주세요.' using errcode = '22023';
  end if;

  if v_id is null then
    v_id := 'db-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  end if;

  if v_id !~ '^[a-z0-9][a-z0-9-]{1,60}$' then
    raise exception '상품 ID는 영문 소문자·숫자·-(붙임표)로 2~61자여야 합니다: %', v_id
      using errcode = '22023';
  end if;

  select * into v_row
    from public.products
   where id = v_id
     for update;

  if not found then
    select coalesce(max(sort_order), 0) + 10 into v_sort from public.products;

    insert into public.products (
      id, name, type, game, edition, price, stock, status, sort_order,
      subtitle, image_url, earn_points, updated_at
    ) values (
      v_id, btrim(p_name), p_type, p_game, v_edition, p_price, p_stock,
      case when p_stock <= 0 then 'sold' else 'available' end,
      v_sort,
      nullif(btrim(coalesce(p_subtitle, '')), ''),
      nullif(btrim(coalesce(p_image_url, '')), ''),
      v_earn,
      now()
    )
    returning * into v_row;

    v_new := true;
  else
    update public.products
       set name      = btrim(p_name),
           type      = p_type,
           game      = p_game,
           edition   = v_edition,
           price     = p_price,
           stock     = p_stock,
           status    = case
                         when p_stock <= 0 then 'sold'
                         when status in ('sold', 'soldout') then 'available'
                         else status
                       end,
           subtitle  = nullif(btrim(coalesce(p_subtitle, '')), ''),
           image_url = nullif(btrim(coalesce(p_image_url, '')), ''),
           earn_points = v_earn,
           updated_at = now()
     where id = v_id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id',       v_row.id,
    'name',     v_row.name,
    'type',     v_row.type,
    'game',     v_row.game,
    'price',    v_row.price,
    'stock',    v_row.stock,
    'status',   v_row.status,
    'edition',  v_row.edition,
    'subtitle', v_row.subtitle,
    'image_url', v_row.image_url,
    'earn_points', v_row.earn_points,
    'created',  v_new
  );
end;
$$;

comment on function public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, boolean, text) is
  '관리자용 상품 추가/수정. 적립금 지급 여부(p_earn_points)까지 함께 저장.';

-- ── 상품 삭제 (주문 이력이 있으면 거절) ──────────────
create or replace function public.admin_delete_product(
  p_id  text,
  p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  perform private.assert_admin(p_pin);

  select count(*) into v_used
    from public.order_items
   where product_id = p_id;

  if v_used > 0 then
    raise exception '주문 내역이 있어 삭제할 수 없습니다. 재고를 0(품절)으로 바꿔 주세요.'
      using errcode = '23503';
  end if;

  delete from public.products where id = p_id;

  if not found then
    raise exception '상품을 찾을 수 없습니다: %', p_id
      using errcode = '22023';
  end if;

  return jsonb_build_object('deleted', true, 'id', p_id);
end;
$$;

comment on function public.admin_delete_product(text, text) is
  '관리자용 상품 삭제. order_items 에 묶인 상품은 삭제하지 않고 안내 메시지를 돌려줍니다.';

-- ── 사장님 설정: 주문에 로그인 필수 여부 ───────────────────
create or replace function public.admin_set_require_login(
  p_require boolean,
  p_pin     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.shop_public_settings;
begin
  perform private.assert_admin(p_pin);

  if p_require is null then
    raise exception '설정 값을 확인해 주세요.' using errcode = '22023';
  end if;

  insert into public.shop_public_settings (id, require_login_to_order, updated_at)
  values (1, p_require, now())
  on conflict (id) do update
     set require_login_to_order = excluded.require_login_to_order,
         updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'require_login_to_order', v_row.require_login_to_order,
    'updated_at', v_row.updated_at
  );
end;
$$;

comment on function public.admin_set_require_login(boolean, text) is
  '사장님 설정: 비로그인(게스트) 주문 허용 / 회원 로그인 필수 전환.';

-- ── 사장님 설정: 기본 적립률(%) ───────────────────────────
create or replace function public.admin_set_point_rate(
  p_rate numeric,
  p_pin  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate numeric(5,2);
begin
  perform private.assert_admin(p_pin);

  if p_rate is null or p_rate < 0 or p_rate > 50 then
    raise exception '적립률은 0 ~ 50 사이로 입력해 주세요.' using errcode = '22023';
  end if;

  v_rate := round(p_rate::numeric, 2);

  insert into public.shop_public_settings (id, point_rate, updated_at)
  values (1, v_rate, now())
  on conflict (id) do update
     set point_rate = excluded.point_rate,
         updated_at = now();

  return jsonb_build_object('point_rate', v_rate, 'updated_at', now());
end;
$$;

comment on function public.admin_set_point_rate(numeric, text) is
  '사장님 설정: 기본 적립률(%) 저장. 0~50 사이, 소수 둘째 자리까지.';

-- ── 손님: 내 적립금 + 적립/사용 내역 ─────────────────────
create or replace function public.my_points(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance int := 0;
  v_rate    numeric := 2;
  v_list    jsonb;
begin
  if v_uid is null then
    raise exception '로그인 후 이용해 주세요.' using errcode = '28000';
  end if;

  select coalesce(balance, 0) into v_balance
    from public.point_wallets
   where user_id = v_uid;

  select coalesce(point_rate, 2) into v_rate
    from public.shop_public_settings
   where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         t.id,
           'amount',     t.amount,
           'kind',       t.kind,
           'order_no',   t.order_no,
           'memo',       t.memo,
           'created_at', t.created_at
         ) order by t.created_at desc, t.id desc), '[]'::jsonb)
    into v_list
    from (
      select *
        from public.point_transactions
       where user_id = v_uid
       order by created_at desc, id desc
       limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) t;

  return jsonb_build_object(
    'balance',      coalesce(v_balance, 0),
    'rate',         coalesce(v_rate, 2),
    'transactions', coalesce(v_list, '[]'::jsonb)
  );
end;
$$;

comment on function public.my_points(integer) is
  '로그인 회원 본인의 적립금 잔액 + 최근 적립/사용 내역.';

-- ── 사장님: 회원 적립금 조회 · 지급/차감 ───────────────
create or replace function public.admin_list_member_points(
  p_query text default null,
  p_limit integer default 100,
  p_pin   text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_list   jsonb;
begin
  perform private.assert_admin(p_pin);

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',   x.id,
           'username',  x.username,
           'name',      x.name,
           'phone',     x.phone,
           'balance',   x.balance,
           'joined_at', x.created_at
         ) order by x.created_at desc), '[]'::jsonb)
    into v_list
    from (
      select u.id,
             coalesce(
               nullif(u.raw_user_meta_data ->> 'username', ''),
               split_part(coalesce(u.email, ''), '@', 1)
             ) as username,
             u.raw_user_meta_data ->> 'name'  as name,
             u.raw_user_meta_data ->> 'phone' as phone,
             coalesce(w.balance, 0) as balance,
             u.created_at
        from auth.users u
        left join public.point_wallets w on w.user_id = u.id
       where v_q is null
          or coalesce(u.email, '') ilike '%' || v_q || '%'
          or coalesce(u.raw_user_meta_data ->> 'username', '') ilike '%' || v_q || '%'
          or coalesce(u.raw_user_meta_data ->> 'name', '') ilike '%' || v_q || '%'
          or (length(v_digits) >= 3
              and regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g')
                  like '%' || v_digits || '%')
          or regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g')
             = v_digits
       order by u.created_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) x;

  return coalesce(v_list, '[]'::jsonb);
end;
$$;

comment on function public.admin_list_member_points(text, integer, text) is
  '관리자용 회원 목록 + 보유 적립금. 아이디·이름·휴대폰 번호로 검색.';

create or replace function public.admin_adjust_points(
  p_user_id uuid,
  p_amount  integer,
  p_memo    text default null,
  p_pin     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_balance int := 0;
  v_new     int := 0;
  v_memo    text;
begin
  perform private.assert_admin(p_pin);

  if p_user_id is null then
    raise exception '적립금을 지급할 회원을 골라 주세요.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception '지급(+) 또는 차감(-)할 적립금을 입력해 주세요.' using errcode = '22023';
  end if;
  if p_amount > 100000000 or p_amount < -100000000 then
    raise exception '한 번에 1억 P 이하로 입력해 주세요.' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception '회원을 찾을 수 없습니다.' using errcode = '22023';
  end if;

  insert into public.point_wallets (user_id, balance, updated_at)
  values (p_user_id, 0, now())
  on conflict (user_id) do nothing;

  select balance into v_balance
    from public.point_wallets
   where user_id = p_user_id
     for update;

  v_balance := coalesce(v_balance, 0);

  if p_amount < 0 and v_balance + p_amount < 0 then
    raise exception '보유 적립금(%P)보다 많이 차감할 수 없습니다.', v_balance
      using errcode = '22023';
  end if;

  update public.point_wallets
     set balance    = balance + p_amount,
         updated_at = now()
   where user_id = p_user_id
  returning balance into v_new;

  v_memo := nullif(btrim(coalesce(p_memo, '')), '');
  if v_memo is null then
    v_memo := case when p_amount > 0 then '사장님 지급' else '사장님 차감' end;
  end if;

  insert into public.point_transactions (user_id, amount, kind, memo)
  values (p_user_id, p_amount, 'admin', v_memo);

  return jsonb_build_object(
    'user_id', p_user_id,
    'amount',  p_amount,
    'balance', v_new
  );
end;
$$;

comment on function public.admin_adjust_points(uuid, integer, text, text) is
  '관리자용 적립금 지급(+)/차감(-). 보유 적립금보다 많이 차감하지는 않습니다.';

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
--   2) 알림 텍스트에서 입금 금액을 꺼냄 (예: "홍길동 50,000원 입금" → 50000)
--      '잔액/잔고' 뒤에 오는 숫자는 잔액으로 보고 건너뜀
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
  v_earned     int := 0;
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

  select replace(m[2], ',', '')::int
    into v_amount
    from regexp_matches(
           v_text,
           '(잔액|잔고)?[[:space:]:]*([0-9][0-9,]{0,12})[[:space:]]*원',
           'g'
         ) as m
   where m[1] is null   -- '잔액 1,234,567원' 처럼 잔액 숫자는 건너뜀
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

  if not found then
    insert into public.deposit_events (raw_text, amount, status, reason)
    values (v_text, v_amount, 'unmatched', 'order_missing');
    return jsonb_build_object(
      'status', 'unmatched',
      'reason', 'order_missing',
      'amount', v_amount,
      'message', '주문을 찾지 못했습니다.'
    );
  end if;

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

  /* 입금확인 → 적립금 지급 */
  v_earned := private.award_order_points(v_order.id);

  insert into public.deposit_events (raw_text, amount, status, reason, order_no)
  values (v_text, v_amount, 'matched', 'auto', v_order.order_no);

  return jsonb_build_object(
    'status', 'matched',
    'amount', v_amount,
    'order_no', v_order.order_no,
    'total_amount', v_order.total_amount,
    'customer_name', v_order.customer_name,
    'depositor_name', v_order.depositor_name,
    'earned_points', v_earned,
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
-- 9-1. 손님 휴대폰 번호 중복 확인
-- ------------------------------------------------------------
-- 회원가입 전에 같은 번호로 이미 가입된 계정이 있는지 확인합니다.
-- (auth.users 의 user_metadata.phone 을 숫자만 비교)
-- ============================================================
create or replace function public.check_phone_available(p_phone text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select not exists (
    select 1
      from auth.users u
     where regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g')
         = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
       and regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') <> ''
  );
$$;

-- ============================================================
-- 10. 실행 권한
-- ============================================================
grant execute on function public.place_order(jsonb, jsonb, integer)  to anon, authenticated;
grant execute on function public.lookup_orders(text, text, text)    to anon, authenticated;
grant execute on function public.order_json(uuid)                    to anon, authenticated;
grant execute on function public.update_order_status(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_orders(text, text)      to anon, authenticated;
grant execute on function public.admin_set_stock(text, text, integer) to anon, authenticated;
grant execute on function public.admin_update_product(text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.admin_delete_product(text, text)   to anon, authenticated;
grant execute on function public.admin_set_require_login(boolean, text) to anon, authenticated;
grant execute on function public.admin_set_point_rate(numeric, text) to anon, authenticated;
grant execute on function public.admin_list_member_points(text, integer, text) to anon, authenticated;
grant execute on function public.admin_adjust_points(uuid, integer, text, text) to anon, authenticated;
grant execute on function public.auto_confirm_deposit(text, text)    to anon, authenticated;
grant execute on function public.admin_deposit_events(text, integer) to anon, authenticated;
grant execute on function public.check_phone_available(text)         to anon, authenticated;

-- 회원 본인 주문은 로그인한 사용자만 (anon 에는 주지 않습니다)
revoke all on function public.my_orders() from public;
grant execute on function public.my_orders() to authenticated;

-- 회원 본인 적립금도 로그인한 사용자만
revoke all on function public.my_points(integer) from public;
grant execute on function public.my_points(integer) to authenticated;

grant execute on function public.expire_unpaid_orders()           to anon, authenticated;
grant execute on function public.cancel_my_order(text, text, text) to anon, authenticated;

-- ============================================================
-- 10-1. 상품 사진 저장소 (Supabase Storage)
-- ------------------------------------------------------------
-- 사장님 페이지에서 폰 사진을 고르면 이 버킷(product-images)에 올라가고
-- 그 주소가 products.image_url 에 저장되어 손님 화면 카드에 바로 보입니다.
--   · 버켓은 공개(public = true) — 손님에게 사진을 보여주기 위해서만
--   · 올리기·바꾸기·지우기는 관리자 계정(app_metadata.role = 'admin')만
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public            = true,
       file_size_limit   = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists product_images_admin_write on storage.objects;
create policy product_images_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'product-images' and private.is_admin())
  with check (bucket_id = 'product-images' and private.is_admin());

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
  ('single-terastal-pack-jp',  '테라스탈 페스티벌 ex 낱팩',        'etc',    'pokemon',   4500, 24, 'available', 80)
on conflict (id) do nothing;

-- ============================================================
-- 확인용 쿼리 (필요할 때만 실행)
-- ------------------------------------------------------------
-- select id, name, price, stock, status, subtitle, image_url, earn_points from public.products order by sort_order;
-- select * from public.shop_public_settings;
-- select order_no, status, total_amount, used_points, earned_points, points_awarded, customer_name, (user_id is not null) as 회원, created_at from public.orders order by created_at desc limit 20;
-- select * from private.shop_settings;
-- select status, amount, order_no, raw_text, created_at from public.deposit_events order by created_at desc limit 20;
-- select p.username, w.balance from public.point_wallets w join auth.users p on p.id = w.user_id order by w.balance desc;
-- select * from public.point_transactions order by created_at desc limit 30;
-- ============================================================

-- ============================================================
-- 12. 관리자 권한 (Supabase Auth)
-- ------------------------------------------------------------
-- 사장님 페이지는 Supabase Auth 로그인 계정 중 app_metadata.role = 'admin'
-- 인 계정만 열립니다. 아래 순서로 관리자 계정을 준비하세요.
--
--   1) Dashboard → Authentication → Users → [Add user]
--        이메일 acac020241@naver.com · 비밀번호는 본인이 정함 · Auto Confirm User 체크
--   2) 아래 update 실행 (계정이 아직 없으면 아무 일도 일어나지 않습니다)
--   3) 확인: select email, raw_app_meta_data from auth.users where email = 'acac020241@naver.com';
--
-- ※ 비밀번호를 잊으면 Dashboard → Authentication → Users 에서
--   해당 계정의 [Reset password] / 비밀번호 변경으로 다시 정하면 됩니다.
-- ============================================================
update auth.users
   set raw_app_meta_data =
         coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin'),
       updated_at = now()
 where email = 'acac020241@naver.com';

-- ============================================================
-- 13. 설치 확인 — 자동 입금 확인 시크릿 + 적립금 설정 (마지막에 실행)
-- ------------------------------------------------------------
-- 이 파일 전체를 [Run] 하면 아래 결과창에 deposit_secret 값이 바로 나옵니다.
-- 그 값을 MacroDroid 의 p_secret 자리에 넣으면 됩니다.
-- (값을 바꾸고 싶으면 update 로 바꾼 뒤 이 select 를 다시 실행하세요.)
-- ============================================================
select
  (select deposit_secret from private.shop_settings)                as "입금확인_시크릿",
  (select point_rate from public.shop_public_settings where id=1)   as "기본적립률",
  (select count(*) from public.point_wallets)                       as "적립금지갑수";

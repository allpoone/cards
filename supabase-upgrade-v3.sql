-- ============================================================
-- ALL PO ONE(올포원) — 3차 업그레이드 SQL (적립금/포인트)
-- ------------------------------------------------------------
-- 이미 1·2차 SQL 을 실행한 프로젝트에서
-- 이 파일 전체를 Supabase SQL Editor 에 붙여넣고 [Run] 한 번만 누르면 됩니다.
-- 여러 번 실행해도 안전합니다. (있는 것은 그대로, 함수는 새 정의로 교체)
--
-- 이 파일에 함께 들어 있는 것
--  · 손님 휴대폰 번호 중복 확인 함수(check_phone_available)  ← 2차에서 빠졌던 부분
--  · 회원 적립금(포인트) 지갑·내역·적립률·상품별 적립 ON/OFF
--
-- 적립 규칙 요약
--  · 기본 적립률 2% (사장님 페이지에서 0~50% 사이로 수정)
--  · 적립 시점: [입금완료]가 확인된 순간 (주문만 넣었을 때는 적립 안 됨)
--  · 사용: 로그인 회원이 주문서에서 보유 적립금을 입력 → 입금 금액에서 차감
--  · 반올림: 1의 자리 반올림 → 다시 10의 자리 반올림(100원 단위)
--      예) 49,900원 × 2% = 998 → 1,000 → 1,000P
--          845 → 850 → 900
--          844 → 840 → 800
--  · 적립 대상 금액: 적립 ON 상품 금액 합계에서, 적립금으로 결제한 비율만큼 빼고 계산
--  · 주문 취소(손님 취소·10분 미입금 자동취소·사장님 취소) 시
--      사용한 적립금은 그대로 환불, 이미 적립된 포인트는 회수
-- ============================================================


-- ============================================================
-- 1. 칸(열) 추가
-- ============================================================

-- 1-1) 사장님이 바꿀 수 있는 기본 적립률(%) — 기본 2%
alter table public.shop_public_settings
  add column if not exists point_rate numeric(5,2) not null default 2;

alter table public.shop_public_settings
  drop constraint if exists shop_public_settings_point_rate_check;
alter table public.shop_public_settings
  add constraint shop_public_settings_point_rate_check
  check (point_rate >= 0 and point_rate <= 50);

-- 1-2) 상품별 적립금 지급 여부 — 기본 ON
alter table public.products
  add column if not exists earn_points boolean not null default true;

-- 1-3) 주문에 적립금 관련 값
--   used_points   : 이 주문에서 사용한 적립금
--   earned_points : 이 주문으로 받을(받은) 적립금
--   points_awarded: 실제로 회원 지갑에 넣었는지 (두 번 적립 방지)
alter table public.orders
  add column if not exists used_points integer not null default 0;
alter table public.orders
  add column if not exists earned_points integer not null default 0;
alter table public.orders
  add column if not exists points_awarded boolean not null default false;

-- 예전 데이터 보정 (음수 방지)
update public.orders set used_points = 0 where used_points < 0;
update public.orders set earned_points = 0 where earned_points < 0;


-- ============================================================
-- 2. 적립금 지갑 · 적립/사용 내역 테이블
-- ------------------------------------------------------------
-- 손님 브라우저에서는 직접 읽거나 쓸 수 없습니다.
-- 아래에서 만드는 서버 함수(SECURITY DEFINER)만 값을 바꿉니다.
-- ============================================================
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

alter table public.point_wallets      enable row level security;
alter table public.point_transactions enable row level security;

-- 표 직접 접근은 전부 막습니다. (조회는 my_points / admin_list_member_points 함수로)
revoke all on public.point_wallets      from anon, authenticated;
revoke all on public.point_transactions from anon, authenticated;
revoke all on sequence public.point_transactions_id_seq from anon, authenticated;


-- ============================================================
-- 3. 적립금 계산 — 2단계 반올림 (1의 자리 → 10의 자리)
-- ------------------------------------------------------------
--   845 → 850 → 900
--   844 → 840 → 800
--   998 → 1,000 → 1,000
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


-- ============================================================
-- 4. 적립 · 회수 · 환불 도우미 (서버 전용)
-- ============================================================

-- 4-1) 입금 확인 시 적립
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

  -- 이미 처리했거나 회원 주문이 아니면 아무것도 하지 않습니다.
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

-- 4-2) 이미 적립된 주문을 취소할 때 회수 (잔액이 모자라면 0까지만 차감)
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

-- 4-3) 주문 취소 시 사용한 적립금 환불 (같은 주문에서 한 번만)
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

  -- 이미 환불한 주문이면 건너뜁니다. (손님 취소 + 자동 만료가 겹쳐도 한 번만)
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
-- 5. 주문 JSON — 적립금 값까지 함께 돌려주기
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
-- 6. 주문 넣기 — 적립금 사용 + 적립 예정 포인트 계산
-- ------------------------------------------------------------
-- 기존 place_order(jsonb, jsonb) 호출도 그대로 동작합니다.
-- (p_use_points 를 보내지 않으면 0 = 적립금 사용 안 함)
-- ============================================================
drop function if exists public.place_order(jsonb, jsonb);

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
  '장바구니 주문 생성. 재고 원자적 차감 + 적립금 사용/적립 예정 계산. 로그인 회원이면 user_id 저장.';


-- ============================================================
-- 7. 주문 상태 변경 — 입금완료 시 적립, 취소 시 환불/회수
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
  '관리자용 주문 상태 변경. cancelled 로 바꾸면 재고 복구 + 사용 적립금 환불 + 적립금 회수.';


-- ============================================================
-- 8. 자동 입금 확인 — 입금완료와 동시에 적립
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
  '은행 입금 알림 텍스트로 입금대기 주문을 자동 [입금완료] 처리하고 적립금을 지급. 애매하면 ambiguous 로 남기고 확정하지 않음.';


-- ============================================================
-- 9. 10분 미입금 자동 취소 — 사용한 적립금 환불
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
  '10분 넘게 입금되지 않은 입금대기 주문을 자동 취소하고 재고·사용 적립금을 복구합니다.';


-- ============================================================
-- 10. 손님 직접 주문 취소 — 사용한 적립금 환불
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
  '손님 직접 주문 취소. 입금대기 상태만 가능하고, 취소하면 재고와 사용한 적립금이 복구됩니다.';


-- ============================================================
-- 11. 사장님: 기본 적립률(%) 저장
-- ============================================================
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


-- ============================================================
-- 12. 상품 추가·수정 — 적립금 지급 ON/OFF 포함
-- ============================================================
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
  '관리자용 상품명·가격·재고 동시 수정. 적립 여부 등 나머지 값은 유지.';


-- ============================================================
-- 13. 손님: 내 적립금 + 적립/사용 내역
-- ============================================================
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


-- ============================================================
-- 14. 사장님: 회원 적립금 조회 · 지급/차감
-- ============================================================
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
-- 15. 손님 휴대폰 번호 중복 확인 (2차에서 빠졌던 함수)
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

comment on function public.check_phone_available(text) is
  '회원가입 전 같은 휴대폰 번호로 이미 가입한 계정이 있는지 확인.';


-- ============================================================
-- 16. 실행 권한
-- ============================================================
grant execute on function public.place_order(jsonb, jsonb, integer)      to anon, authenticated;
grant execute on function public.order_json(uuid)                        to anon, authenticated;
grant execute on function public.update_order_status(text, text, text)   to anon, authenticated;
grant execute on function public.auto_confirm_deposit(text, text)        to anon, authenticated;
grant execute on function public.expire_unpaid_orders()                  to anon, authenticated;
grant execute on function public.cancel_my_order(text, text, text)       to anon, authenticated;
grant execute on function public.admin_set_point_rate(numeric, text)     to anon, authenticated;
grant execute on function public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.admin_update_product(text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.admin_list_member_points(text, integer, text) to anon, authenticated;
grant execute on function public.admin_adjust_points(uuid, integer, text, text) to anon, authenticated;
grant execute on function public.check_phone_available(text)             to anon, authenticated;

-- 내 적립금은 로그인 회원만
revoke all on function public.my_points(integer) from public;
grant execute on function public.my_points(integer) to authenticated;


-- ============================================================
-- 17. 설치 확인 — 결과창에 이 값들이 보이면 정상입니다
-- ============================================================
select
  (select point_rate from public.shop_public_settings where id = 1) as "기본적립률",
  (select count(*) from public.products where earn_points)          as "적립상품수",
  (select count(*) from public.products)                            as "전체상품수",
  (select count(*) from public.point_wallets)                       as "적립금지갑",
  (select count(*) from public.point_transactions)                  as "적립금내역",
  private.calc_earn_points(49900, 2)                                as "49900원_2퍼_적립",
  private.calc_earn_points(42300, 2)                                as "42300원_2퍼_적립";

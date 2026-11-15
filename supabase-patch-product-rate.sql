alter table public.products add column if not exists point_rate numeric(5,2) default null;

alter table public.products drop constraint if exists products_point_rate_check;
alter table public.products add constraint products_point_rate_check
  check (point_rate is null or point_rate between 0 and 50);

drop function if exists public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, boolean, text);
drop function if exists public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, text);

create or replace function public.admin_upsert_product(
  p_id          text,
  p_name        text,
  p_type        text,
  p_game        text,
  p_price       integer,
  p_stock       integer,
  p_edition     text default null,
  p_subtitle    text default null,
  p_image_url   text default null,
  p_earn_points boolean default true,
  p_pin         text default null,
  p_point_rate  numeric default null
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
  v_rate    numeric(5,2);
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
  if p_edition is not null and btrim(p_edition) != ''
     and btrim(p_edition) not in ('KR', 'JP', 'EN') then
    raise exception '판본은 KR / JP / EN 중 하나이거나 비워 두어야 합니다.' using errcode = '22023';
  end if;

  v_edition := nullif(upper(btrim(coalesce(p_edition, ''))), '');
  if p_price is null or greatest(p_price, 0) != p_price then
    raise exception '가격은 0원 이상이어야 합니다.' using errcode = '22023';
  end if;
  if p_price > 100000000 then
    raise exception '가격이 너무 큽니다. (1억 원 이하로 입력해 주세요)' using errcode = '22023';
  end if;
  if p_stock is null or greatest(p_stock, 0) != p_stock then
    raise exception '재고는 0 이상이어야 합니다.' using errcode = '22023';
  end if;
  if p_stock > 99999 then
    raise exception '재고는 99,999개 이하로 입력해 주세요.' using errcode = '22023';
  end if;

  if p_point_rate is null then
    v_rate := null;
  elsif p_point_rate not between 0 and 50 then
    raise exception '상품 적립률은 0 ~ 50 사이로 입력해 주세요.' using errcode = '22023';
  else
    v_rate := round(p_point_rate::numeric, 2);
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
      subtitle, image_url, earn_points, point_rate, updated_at
    ) values (
      v_id, btrim(p_name), p_type, p_game, v_edition, p_price, p_stock,
      case when p_stock = 0 then 'sold' else 'available' end,
      v_sort,
      nullif(btrim(coalesce(p_subtitle, '')), ''),
      nullif(btrim(coalesce(p_image_url, '')), ''),
      v_earn,
      v_rate,
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
                         when p_stock = 0 then 'sold'
                         when status in ('sold', 'soldout') then 'available'
                         else status
                       end,
           subtitle  = nullif(btrim(coalesce(p_subtitle, '')), ''),
           image_url = nullif(btrim(coalesce(p_image_url, '')), ''),
           earn_points = v_earn,
           point_rate  = coalesce(v_rate, point_rate),
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
    'point_rate', v_row.point_rate,
    'created',  v_new
  );
end;
$$;

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

  return public.admin_upsert_product(
    p_id          := p_product_id,
    p_name        := p_name,
    p_type        := v_row.type,
    p_game        := v_row.game,
    p_price       := p_price,
    p_stock       := p_stock,
    p_edition     := v_row.edition,
    p_subtitle    := v_row.subtitle,
    p_image_url   := v_row.image_url,
    p_earn_points := v_row.earn_points,
    p_point_rate  := v_row.point_rate,
    p_pin         := p_pin
  );
end;
$$;

drop function if exists public.place_order(jsonb, jsonb, integer);
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
  v_earn_raw  numeric := 0;
  v_step1     numeric;
  v_step2     numeric;
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
  perform public.expire_unpaid_orders();

  select require_login_to_order, coalesce(point_rate, 2)
    into v_require, v_rate
    from public.shop_public_settings
   where id = 1;

  if coalesce(v_require, false) and v_uid is null then
    raise exception '이 쇼핑몰은 회원만 주문할 수 있습니다. 로그인 또는 회원가입 후 주문해 주세요.'
      using errcode = '42501';
  end if;

  if v_name is null then
    raise exception '주문자명을 입력해 주세요.' using errcode = '22023';
  end if;
  if length(v_phone) not between 9 and 11 then
    raise exception '연락처를 정확히 입력해 주세요.' using errcode = '22023';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) != 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception '주문할 상품이 없습니다.' using errcode = '22023';
  end if;

  if v_use > 0 and v_uid is null then
    raise exception '적립금은 로그인한 회원만 사용할 수 있습니다.'
      using errcode = '42501';
  end if;

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
    if v_item.qty is null or greatest(v_item.qty, 0) = 0 then
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

    if v_item.qty > v_stock then
      raise exception '% 의 남은 재고가 %개입니다. 수량을 조정해 주세요.',
        v_item.product_id, v_stock
        using errcode = '22023';
    end if;

    update public.products
       set stock = stock - v_item.qty,
           status = case when greatest(stock - v_item.qty, 0) = 0 then 'sold' else status end,
           updated_at = now()
     where id = v_item.product_id;
  end loop;

  while not v_ok and v_attempt between 0 and 19 loop
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

  select coalesce(sum(i.line_total), 0),
         coalesce(sum(case when p.earn_points
                           then i.line_total * (coalesce(p.point_rate, v_rate) / 100.0)
                           else 0 end), 0)
    into v_subtotal, v_earn_raw
    from public.order_items i
    join public.products p on p.id = i.product_id
   where i.order_id = v_order_id;

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

    if v_balance is null or v_use > v_balance then
      raise exception '보유 적립금이 부족합니다. (보유 %P)', coalesce(v_balance, 0)
        using errcode = '22023';
    end if;

    if v_subtotal > 0 then
      v_earn_raw := v_earn_raw * (v_subtotal - v_use)::numeric / v_subtotal::numeric;
    else
      v_earn_raw := 0;
    end if;
  end if;

  v_step1 := round(v_earn_raw / 10.0) * 10;
  v_step2 := round(v_step1 / 100.0) * 100;
  v_earn  := greatest(0, v_step2)::int;
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

revoke all on function public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, boolean, text, numeric) from public;
grant execute on function public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, boolean, text, numeric) to anon, authenticated;

revoke all on function public.admin_update_product(text, text, integer, integer, text) from public;
grant execute on function public.admin_update_product(text, text, integer, integer, text) to anon, authenticated;

revoke all on function public.place_order(jsonb, jsonb, integer) from public;
grant execute on function public.place_order(jsonb, jsonb, integer) to anon, authenticated;

notify pgrst, 'reload schema';

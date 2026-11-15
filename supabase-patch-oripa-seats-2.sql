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
  v_pname     text;
  v_stock     int;
  v_price     int;
  v_type      text;
  v_hidden    boolean;
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
  v_qty       int := 0;
  v_free      int[] := '{}'::int[];
  v_bad       int[] := null;
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
  if p_items is null or jsonb_typeof(p_items) != 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '주문할 상품이 없습니다.' using errcode = '22023';
  end if;
  if v_use > 0 and v_uid is null then
    raise exception '적립금은 로그인한 회원만 사용할 수 있습니다.' using errcode = '42501';
  end if;

  while not v_ok and v_attempt between 0 and 19 loop
    v_attempt := v_attempt + 1;
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
      into v_suffix
      from generate_series(1, 4);
    v_order_no := 'APO-' || to_char(v_created at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' || v_suffix;
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
        v_uid, 0, v_created, v_created
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

  for v_item in
    with raw as (
      select e ->> 'product_id' as pid,
             coalesce((e ->> 'qty')::int, 0) as qty,
             coalesce(e -> 'seat_numbers', '[]'::jsonb) as seats
        from jsonb_array_elements(p_items) e
    )
    select r.pid as product_id,
           case when coalesce(array_length(s.seats, 1), 0) > 0
                then array_length(s.seats, 1)
                else coalesce(sum(r.qty), 0)::int end as qty,
           s.seats as seats
      from raw r
      left join lateral (
        select array_agg(distinct (x.value)::int order by (x.value)::int) as seats
          from jsonb_array_elements_text(r.seats) x
      ) s on true
     group by r.pid, s.seats
     order by r.pid
  loop
    v_qty := coalesce(v_item.qty, 0);
    if v_qty = 0 then
      raise exception '수량이 올바르지 않습니다: %', v_item.product_id using errcode = '22023';
    end if;

    select p.name, p.price, p.stock, p.type, p.is_hidden
      into v_pname, v_price, v_stock, v_type, v_hidden
      from public.products p
     where p.id = v_item.product_id
       for update;

    if not found then
      raise exception '상품을 찾을 수 없습니다: %', v_item.product_id using errcode = '22023';
    end if;
    if v_hidden then
      raise exception '현재 판매 중이지 않은 상품입니다: %', v_item.product_id using errcode = '22023';
    end if;

    if v_item.seats is not null then
      if v_type != 'oripa' then
        raise exception '번호 선택은 오리파 상품에서만 쓸 수 있습니다: %', v_item.product_id
          using errcode = '22023';
      end if;

      perform 1
        from public.oripa_tickets t
       where t.product_id = v_item.product_id
         and t.seat_no = any(v_item.seats)
         for update;

      select coalesce(array_agg(t.seat_no order by t.seat_no), '{}'::int[])
        into v_free
        from public.oripa_tickets t
       where t.product_id = v_item.product_id
         and t.seat_no = any(v_item.seats)
         and t.status = 'available';

      if coalesce(array_length(v_free, 1), 0) != v_qty then
        select array_agg(s order by s)
          into v_bad
          from unnest(v_item.seats) s
         where not (s = any(v_free));
        raise exception '이미 선택된 번호가 있습니다: #%',
          array_to_string(coalesce(v_bad, v_item.seats), ', #')
          using errcode = '22023';
      end if;

      update public.oripa_tickets
         set status = 'held',
             order_id = v_order_id,
             held_until = v_created + interval '10 minutes',
             updated_at = now()
       where product_id = v_item.product_id
         and seat_no = any(v_item.seats)
         and status = 'available';
    else
      if v_qty > v_stock then
        raise exception '% 의 남은 재고가 %개입니다. 수량을 조정해 주세요.',
          v_item.product_id, v_stock
          using errcode = '22023';
      end if;

      update public.products
         set stock = stock - v_qty,
             status = case when greatest(stock - v_qty, 0) = 0 then 'sold' else status end,
             updated_at = now()
       where id = v_item.product_id;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, unit_price, qty, line_total, seat_numbers
    ) values (
      v_order_id, v_item.product_id, v_pname, v_price, v_qty, v_price * v_qty, v_item.seats
    );
  end loop;

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
notify pgrst, 'reload schema';

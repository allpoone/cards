alter table public.orders
  add column if not exists admin_hidden boolean not null default false;

alter table public.products
  add column if not exists description text;

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
    'admin_hidden',   coalesce(o.admin_hidden, false),
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

create or replace function public.admin_list_orders(
  p_pin    text default null,
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
       where (p_status is null or p_status = '' or o.status = p_status)
       order by o.created_at desc
       limit 300
    ) o;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_order_hidden(
  p_order_no text,
  p_hidden   boolean default true,
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

  select *
    into v_order
    from public.orders
   where order_no = btrim(p_order_no)
     for update;

  if not found then
    raise exception '주문을 찾을 수 없습니다: %', p_order_no
      using errcode = '22023';
  end if;

  if v_order.status not in ('cancelled', 'shipped') then
    raise exception '취소되거나 발송 완료된 주문만 숨길 수 있습니다.'
      using errcode = '22023';
  end if;

  update public.orders
     set admin_hidden = coalesce(p_hidden, true),
         updated_at   = now()
   where id = v_order.id;

  return jsonb_build_object(
    'order_no',     v_order.order_no,
    'admin_hidden', coalesce(p_hidden, true)
  );
end;
$$;

create or replace function public.admin_delete_order(
  p_order_no text,
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

  select *
    into v_order
    from public.orders
   where order_no = btrim(p_order_no)
     for update;

  if not found then
    raise exception '주문을 찾을 수 없습니다: %', p_order_no
      using errcode = '22023';
  end if;

  if v_order.status = 'cancelled' then
    delete from public.orders where id = v_order.id;
    return jsonb_build_object('action', 'deleted', 'order_no', v_order.order_no);
  elsif v_order.status = 'shipped' then
    update public.orders
       set admin_hidden = true,
           updated_at   = now()
     where id = v_order.id;
    return jsonb_build_object('action', 'hidden', 'order_no', v_order.order_no);
  else
    raise exception '취소되거나 발송 완료된 주문만 정리할 수 있습니다.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.admin_set_product_description(
  p_product_id  text,
  p_description text default null,
  p_pin         text default null
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

  update public.products
     set description = nullif(btrim(coalesce(p_description, '')), ''),
         updated_at  = now()
   where id = btrim(p_product_id)
  returning * into v_row;

  if not found then
    raise exception '상품을 찾을 수 없습니다: %', p_product_id
      using errcode = '22023';
  end if;

  return jsonb_build_object('id', v_row.id, 'description', v_row.description);
end;
$$;

grant execute on function public.admin_list_orders(text, text) to anon, authenticated;
grant execute on function public.admin_delete_order(text, text) to anon, authenticated;
grant execute on function public.admin_set_order_hidden(text, boolean, text) to anon, authenticated;
grant execute on function public.admin_set_product_description(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

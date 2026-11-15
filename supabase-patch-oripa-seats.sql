alter table public.products add column if not exists total_slots integer;
alter table public.order_items add column if not exists seat_numbers integer[];
create table if not exists public.oripa_tickets (
  product_id text not null references public.products (id) on delete cascade,
  seat_no    integer not null,
  status     text not null default 'available',
  order_id   uuid references public.orders (id) on delete set null,
  held_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (product_id, seat_no)
);
alter table public.oripa_tickets drop constraint if exists oripa_tickets_status_check;
alter table public.oripa_tickets add constraint oripa_tickets_status_check
  check (status in ('available', 'held', 'sold'));
create index if not exists oripa_tickets_order_idx on public.oripa_tickets (order_id);
create table if not exists public.oripa_lineup (
  product_id text not null references public.products (id) on delete cascade,
  tier       text not null,
  name       text not null default '',
  qty        integer not null default 1,
  primary key (product_id, tier)
);
alter table public.oripa_lineup drop constraint if exists oripa_lineup_tier_check;
alter table public.oripa_lineup add constraint oripa_lineup_tier_check
  check (tier in ('dia', 'gold', 'silver', 'bronze', 'last'));
alter table public.oripa_tickets enable row level security;
alter table public.oripa_lineup  enable row level security;
revoke all on public.oripa_tickets from anon, authenticated;
revoke all on public.oripa_lineup  from anon, authenticated;
create or replace function private.sync_oripa_stock(p_product_id text)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_left int := 0;
begin
  select count(*)::int into v_left
    from public.oripa_tickets
   where product_id = p_product_id and status = 'available';
  update public.products
     set stock = v_left,
         status = case
                    when v_left = 0 then 'sold'
                    when v_left > 2 then 'available'
                    else 'low'
                  end,
         updated_at = now()
   where id = p_product_id and type = 'oripa';
end;
$$;
revoke all on function private.sync_oripa_stock(text) from public;
create or replace function private.trg_oripa_tickets_stock()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform private.sync_oripa_stock(old.product_id);
    return old;
  end if;
  perform private.sync_oripa_stock(new.product_id);
  return new;
end;
$$;
drop trigger if exists oripa_tickets_stock on public.oripa_tickets;
create trigger oripa_tickets_stock
after insert or update or delete on public.oripa_tickets
for each row execute function private.trg_oripa_tickets_stock();
create or replace function private.trg_orders_oripa_seats()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  if new.status in ('paid', 'shipped') and old.status = 'pending_payment' then
    update public.oripa_tickets
       set status = 'sold', held_until = null, updated_at = now()
     where order_id = new.id and status = 'held';
  elsif new.status = 'cancelled' and old.status in ('pending_payment', 'paid', 'shipped') then
    update public.oripa_tickets
       set status = 'available', order_id = null, held_until = null, updated_at = now()
     where order_id = new.id and status in ('held', 'sold');
  end if;
  return new;
end;
$$;
drop trigger if exists orders_oripa_seats on public.orders;
create trigger orders_oripa_seats
after update of status on public.orders
for each row execute function private.trg_orders_oripa_seats();
create or replace function public.sync_oripa_tickets(p_product_id text, p_total_slots integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    text := nullif(btrim(coalesce(p_product_id, '')), '');
  v_total int := greatest(0, coalesce(p_total_slots, 0));
  v_type  text;
  v_avail int := 0;
  v_held  int := 0;
  v_sold  int := 0;
  v_max   int := 0;
begin
  perform private.assert_admin(null);
  select type into v_type from public.products where id = v_id;
  if v_type is null then
    raise exception '상품을 찾을 수 없습니다: %', p_product_id using errcode = '22023';
  end if;
  if v_type != 'oripa' then
    raise exception '오리파 상품에만 번호판을 만들 수 있습니다.' using errcode = '22023';
  end if;
  if v_total > 500 then
    raise exception '총 구수는 500까지 입력할 수 있습니다.' using errcode = '22023';
  end if;
  delete from public.oripa_tickets
   where product_id = v_id and seat_no > v_total and status = 'available';
  insert into public.oripa_tickets (product_id, seat_no)
  select v_id, g from generate_series(1, v_total) g
  on conflict (product_id, seat_no) do nothing;
  update public.products set total_slots = v_total, updated_at = now() where id = v_id;
  perform private.sync_oripa_stock(v_id);
  select count(*) filter (where status = 'available')::int,
         count(*) filter (where status = 'held')::int,
         count(*) filter (where status = 'sold')::int,
         coalesce(max(seat_no), 0)::int
    into v_avail, v_held, v_sold, v_max
    from public.oripa_tickets where product_id = v_id;
  return jsonb_build_object(
    'product_id', v_id,
    'total_slots', v_total,
    'seats', coalesce(v_max, 0),
    'available', coalesce(v_avail, 0),
    'held', coalesce(v_held, 0),
    'sold', coalesce(v_sold, 0)
  );
end;
$$;
grant execute on function public.sync_oripa_tickets(text, integer) to authenticated;
create or replace function public.get_oripa_seats(p_product_id text)
returns table (seat_no integer, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.expire_unpaid_orders();
  return query
    select t.seat_no as seat_no, t.status as status
      from public.oripa_tickets t
     where t.product_id = btrim(coalesce(p_product_id, ''))
     order by t.seat_no;
end;
$$;
grant execute on function public.get_oripa_seats(text) to anon, authenticated;
create or replace function public.get_oripa_board(p_product_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     text := btrim(coalesce(p_product_id, ''));
  v_total  int := 0;
  v_max    int := 0;
  v_avail  int := 0;
  v_held   int := 0;
  v_sold   int := 0;
  v_seats  jsonb := '[]'::jsonb;
  v_lineup jsonb := '[]'::jsonb;
begin
  perform public.expire_unpaid_orders();
  select coalesce(total_slots, 0) into v_total from public.products where id = v_id;
  v_total := coalesce(v_total, 0);
  select coalesce(max(seat_no), 0) into v_max
    from public.oripa_tickets where product_id = v_id;
  if v_max > v_total then
    v_total := v_max;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('n', t.seat_no, 's', t.status) order by t.seat_no), '[]'::jsonb)
    into v_seats
    from public.oripa_tickets t
   where t.product_id = v_id;
  select coalesce(jsonb_agg(jsonb_build_object('tier', l.tier, 'name', l.name, 'qty', l.qty)
                            order by case l.tier
                                       when 'dia' then 1 when 'gold' then 2 when 'silver' then 3
                                       when 'bronze' then 4 else 5 end), '[]'::jsonb)
    into v_lineup
    from public.oripa_lineup l
   where l.product_id = v_id;
  select count(*) filter (where status = 'available')::int,
         count(*) filter (where status = 'held')::int,
         count(*) filter (where status = 'sold')::int
    into v_avail, v_held, v_sold
    from public.oripa_tickets where product_id = v_id;
  return jsonb_build_object(
    'product_id', v_id,
    'total_slots', v_total,
    'seats', v_seats,
    'lineup', v_lineup,
    'available', coalesce(v_avail, 0),
    'held', coalesce(v_held, 0),
    'sold', coalesce(v_sold, 0)
  );
end;
$$;
grant execute on function public.get_oripa_board(text) to anon, authenticated;
create or replace function public.admin_save_oripa_lineup(p_product_id text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := nullif(btrim(coalesce(p_product_id, '')), '');
begin
  perform private.assert_admin(null);
  if v_id is null or not exists (select 1 from public.products where id = v_id) then
    raise exception '상품을 찾을 수 없습니다: %', p_product_id using errcode = '22023';
  end if;
  delete from public.oripa_lineup where product_id = v_id;
  insert into public.oripa_lineup (product_id, tier, name, qty)
  select v_id, e ->> 'tier', btrim(coalesce(e ->> 'name', '')), greatest(0, coalesce((e ->> 'qty')::int, 0))
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
   where e ->> 'tier' in ('dia', 'gold', 'silver', 'bronze', 'last')
     and btrim(coalesce(e ->> 'name', '')) != ''
  on conflict (product_id, tier) do update
     set name = excluded.name, qty = excluded.qty;
  return public.get_oripa_board(v_id);
end;
$$;
grant execute on function public.admin_save_oripa_lineup(text, jsonb) to authenticated;
create or replace function private.trg_orders_discord()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_items text;
begin
  if tg_op = 'UPDATE' then
    if OLD.status = 'pending_payment'
       and NEW.status = 'pending_payment'
       and OLD.total_amount = 0
       and (NEW.total_amount != 0 or NEW.used_points != 0) then
      select string_agg(
               i.product_name || ' x' || i.qty ||
               case when coalesce(array_length(i.seat_numbers, 1), 0) > 0
                    then ' (#' || array_to_string(i.seat_numbers, ', #') || ')'
                    else '' end,
               ' / ' order by i.id)
        into v_items
        from public.order_items i
       where i.order_id = NEW.id;
      perform private.notify_discord(
        '🛒 **[새 주문]** ' || NEW.order_no || E'\n' ||
        '• 상품: ' || coalesce(v_items, '-') || E'\n' ||
        '• 주문자: ' || NEW.customer_name || ' (입금자: ' || coalesce(NEW.depositor_name, NEW.customer_name) || ')' || E'\n' ||
        '• 입금액: ' || to_char(NEW.total_amount, 'FM999,999,999') || '원'
      );
    elsif OLD.status = 'pending_payment' and NEW.status = 'paid' then
      perform private.notify_discord(
        '💰 **[입금완료]** ' || NEW.order_no || E'\n' ||
        '• 주문자: ' || NEW.customer_name || ' · ' || to_char(NEW.total_amount, 'FM999,999,999') || '원' ||
        case when coalesce(NEW.earned_points, 0) != 0
             then ' (적립 ' || NEW.earned_points || 'P)'
             else '' end
      );
    elsif OLD.status != 'cancelled' and NEW.status = 'cancelled' then
      perform private.notify_discord(
        '❌ **[주문취소]** ' || NEW.order_no || ' (' || NEW.customer_name || ')'
      );
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists orders_discord_notify on public.orders;
create trigger orders_discord_notify
after update on public.orders
for each row execute function private.trg_orders_discord();
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
        'line_total',   i.line_total,
        'seat_numbers', coalesce(i.seat_numbers, '{}'::int[])
      ) order by i.id)
      from public.order_items i
      where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_id;
$$;
revoke all on function public.order_json(uuid) from public;
notify pgrst, 'reload schema';

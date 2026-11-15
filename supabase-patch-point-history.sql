create or replace function public.admin_member_point_history(
  p_user_id uuid,
  p_pin     text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_list jsonb;
begin
  perform private.assert_admin(p_pin);

  if p_user_id is null then
    raise exception '회원을 선택해 주세요.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         x.id,
           'amount',     x.amount,
           'kind',       x.kind,
           'order_no',   x.order_no,
           'note',       x.memo,
           'created_at', x.created_at
         ) order by x.created_at desc, x.id desc), '[]'::jsonb)
    into v_list
    from (
      select t.id, t.amount, t.kind, t.order_no, t.memo, t.created_at
        from public.point_transactions t
       where t.user_id = p_user_id
       order by t.created_at desc, t.id desc
       limit 100
    ) x;

  return coalesce(v_list, '[]'::jsonb);
end;
$$;

grant execute on function public.admin_member_point_history(uuid, text) to anon, authenticated;

create or replace function private.trg_orders_discord()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_items text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'paid' then
      select string_agg(
               i.product_name || ' x' || i.qty ||
               case when coalesce(array_length(i.seat_numbers, 1), 0) > 0
                    then ' (#' || array_to_string(i.seat_numbers, ', #') || ')'
                    else '' end,
               ' / ' order by i.id)
        into v_items
        from public.order_items i
       where i.order_id = new.id;
      perform private.oripa_notify(
        '💰 **[적립금 전액 결제 · 입금완료]** ' || new.order_no || E'\n' ||
        '• 상품: ' || coalesce(v_items, '-') || E'\n' ||
        '• 주문자: ' || new.customer_name || E'\n' ||
        '• 사용 적립금: ' || to_char(coalesce(new.used_points, 0), 'FM999,999,999') || 'P' || E'\n' ||
        '• 입금액: 0원'
      );
    end if;
    return new;
  end if;

  if old.status = 'pending_payment'
     and new.status = 'pending_payment'
     and old.total_amount = 0
     and (new.total_amount != 0 or new.used_points != 0) then
    select string_agg(
             i.product_name || ' x' || i.qty ||
             case when coalesce(array_length(i.seat_numbers, 1), 0) > 0
                  then ' (#' || array_to_string(i.seat_numbers, ', #') || ')'
                  else '' end,
             ' / ' order by i.id)
      into v_items
      from public.order_items i
     where i.order_id = new.id;
    perform private.oripa_notify(
      '🛒 **[새 주문]** ' || new.order_no || E'\n' ||
      '• 상품: ' || coalesce(v_items, '-') || E'\n' ||
      '• 주문자: ' || new.customer_name || ' (입금자: ' || coalesce(new.depositor_name, new.customer_name) || ')' || E'\n' ||
      '• 입금액: ' || to_char(new.total_amount, 'FM999,999,999') || '원'
    );
  elsif old.status = 'pending_payment' and new.status = 'paid' then
    if coalesce(new.total_amount, 0) = 0 and coalesce(new.used_points, 0) != 0 then
      select string_agg(
               i.product_name || ' x' || i.qty ||
               case when coalesce(array_length(i.seat_numbers, 1), 0) > 0
                    then ' (#' || array_to_string(i.seat_numbers, ', #') || ')'
                    else '' end,
               ' / ' order by i.id)
        into v_items
        from public.order_items i
       where i.order_id = new.id;
      perform private.oripa_notify(
        '💰 **[적립금 전액 결제 · 입금완료]** ' || new.order_no || E'\n' ||
        '• 상품: ' || coalesce(v_items, '-') || E'\n' ||
        '• 주문자: ' || new.customer_name || E'\n' ||
        '• 사용 적립금: ' || to_char(coalesce(new.used_points, 0), 'FM999,999,999') || 'P' || E'\n' ||
        '• 입금액: 0원'
      );
    else
      perform private.oripa_notify(
        '💰 **[입금완료]** ' || new.order_no || E'\n' ||
        '• 주문자: ' || new.customer_name || ' · ' || to_char(new.total_amount, 'FM999,999,999') || '원' ||
        case when coalesce(new.earned_points, 0) != 0
             then ' (적립 ' || new.earned_points || 'P)'
             else '' end
      );
    end if;
  elsif old.status != 'cancelled' and new.status = 'cancelled' then
    perform private.oripa_notify(
      '❌ **[주문취소]** ' || new.order_no || ' (' || new.customer_name || ')'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_discord_notify on public.orders;
create trigger orders_discord_notify
after insert or update on public.orders
for each row execute function private.trg_orders_discord();

notify pgrst, 'reload schema';

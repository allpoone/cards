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

  if v_order.status not in ('cancelled', 'shipped') then
    raise exception '취소되거나 발송 완료된 주문만 삭제할 수 있습니다.'
      using errcode = '22023';
  end if;

  delete from public.orders where id = v_order.id;

  return jsonb_build_object('deleted', true, 'order_no', v_order.order_no);
end;
$$;

grant execute on function public.admin_delete_order(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

create or replace function public.admin_list_blocked_phones(p_pin text default null)
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'phone_digits', b.phone_digits,
           'reason',       b.reason,
           'created_at',   b.created_at
         ) order by b.created_at desc), '[]'::jsonb)
    into v_list
    from public.blocked_phones b;

  return coalesce(v_list, '[]'::jsonb);
end;
$$;

create or replace function public.admin_block_phone(
  p_phone  text,
  p_reason text default null,
  p_pin    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_admin(p_pin);

  if length(v_digits) not between 9 and 11 then
    raise exception '휴대폰 번호를 정확히 입력해 주세요.' using errcode = '22023';
  end if;

  insert into public.blocked_phones (phone_digits, reason)
  values (v_digits, v_reason)
  on conflict (phone_digits) do update
     set reason = coalesce(excluded.reason, public.blocked_phones.reason);

  return jsonb_build_object(
    'phone_digits', v_digits,
    'reason',       v_reason,
    'blocked',      true
  );
end;
$$;

create or replace function public.admin_unblock_phone(
  p_phone text,
  p_pin   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  perform private.assert_admin(p_pin);

  if v_digits = '' then
    raise exception '해제할 휴대폰 번호를 입력해 주세요.' using errcode = '22023';
  end if;

  delete from public.blocked_phones b where b.phone_digits = v_digits;

  return jsonb_build_object(
    'phone_digits', v_digits,
    'blocked',      false
  );
end;
$$;

create or replace function public.admin_list_blocked_kakao(p_pin text default null)
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'kakao_id',   b.kakao_id,
           'label',      b.label,
           'reason',     b.reason,
           'created_at', b.created_at
         ) order by b.created_at desc), '[]'::jsonb)
    into v_list
    from public.blocked_kakao b;

  return coalesce(v_list, '[]'::jsonb);
end;
$$;

create or replace function public.admin_unblock_kakao(
  p_kakao_id text,
  p_pin      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := nullif(btrim(coalesce(p_kakao_id, '')), '');
begin
  perform private.assert_admin(p_pin);

  if v_id is null then
    raise exception '해제할 카카오 계정을 골라 주세요.' using errcode = '22023';
  end if;

  delete from public.blocked_kakao b where b.kakao_id = v_id;

  return jsonb_build_object('kakao_id', v_id, 'blocked', false);
end;
$$;

create or replace function public.admin_delete_member(
  p_user_id          uuid,
  p_also_block_phone boolean default true,
  p_reason           text default null,
  p_pin              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_digits  text;
  v_name    text;
  v_block   boolean := false;
  v_kakao   int := 0;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_admin(p_pin);

  if p_user_id is null then
    raise exception '삭제할 회원을 골라 주세요.' using errcode = '22023';
  end if;

  if v_me = p_user_id then
    raise exception '지금 로그인한 사장님 계정은 삭제할 수 없습니다.' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception '회원을 찾을 수 없습니다.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(coalesce(p.name, '')), ''),
                  nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), '')),
         coalesce(nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), ''),
                  nullif(regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), ''))
    into v_name, v_digits
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = p_user_id;

  if coalesce(p_also_block_phone, true) and v_digits is not null then
    insert into public.blocked_phones (phone_digits, reason)
    values (v_digits, coalesce(v_reason, '계정 삭제'))
    on conflict (phone_digits) do update
       set reason = coalesce(excluded.reason, public.blocked_phones.reason);
    v_block := true;
  end if;

  insert into public.blocked_kakao (kakao_id, label, reason)
  select coalesce(to_jsonb(i) ->> 'provider_id', i.identity_data ->> 'sub'),
         nullif(btrim(coalesce(v_name, '') || ' ' || coalesce(v_digits, '')), ''),
         coalesce(v_reason, '계정 삭제')
    from auth.identities i
   where i.user_id = p_user_id
     and i.provider = 'kakao'
     and coalesce(to_jsonb(i) ->> 'provider_id', i.identity_data ->> 'sub') is not null
  on conflict (kakao_id) do update
     set reason = coalesce(excluded.reason, public.blocked_kakao.reason);

  get diagnostics v_kakao = row_count;

  update public.orders
     set user_id    = null,
         updated_at = now()
   where user_id = p_user_id;

  delete from public.point_transactions where user_id = p_user_id;
  delete from public.point_wallets      where user_id = p_user_id;
  delete from public.profiles           where id      = p_user_id;
  delete from auth.users                where id      = p_user_id;

  return jsonb_build_object(
    'user_id',      p_user_id,
    'name',         coalesce(v_name, ''),
    'phone_digits', coalesce(v_digits, ''),
    'blocked',      v_block,
    'kakao_blocked', v_kakao
  );
end;
$$;

grant execute on function public.admin_list_blocked_phones(text)                 to anon, authenticated;
grant execute on function public.admin_block_phone(text, text, text)             to anon, authenticated;
grant execute on function public.admin_unblock_phone(text, text)                 to anon, authenticated;
grant execute on function public.admin_list_blocked_kakao(text)                  to anon, authenticated;
grant execute on function public.admin_unblock_kakao(text, text)                 to anon, authenticated;
grant execute on function public.admin_delete_member(uuid, boolean, text, text)  to anon, authenticated;

notify pgrst, 'reload schema';

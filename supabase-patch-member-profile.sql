create or replace function public.admin_update_member_phone(
  p_user_id   uuid,
  p_new_phone text,
  p_pin       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(p_new_phone, ''), '\D', '', 'g');
  v_old    text;
begin
  perform private.assert_admin(p_pin);

  if p_user_id is null then
    raise exception '번호를 바꿀 회원을 골라 주세요.' using errcode = '22023';
  end if;

  if v_digits !~ '^01[016789][0-9]{7,8}$' then
    raise exception '휴대폰 번호를 정확히 입력해 주세요. (예: 010-0000-0000)'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.blocked_phones b where b.phone_digits = v_digits) then
    raise exception '차단된 번호입니다. 차단을 먼저 해제해 주세요.' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception '회원을 찾을 수 없습니다.' using errcode = '22023';
  end if;

  if exists (
       select 1
         from auth.users u
        where u.id != p_user_id
          and regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g') = v_digits
     )
     or exists (
       select 1
         from public.profiles p
        where p.id != p_user_id
          and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_digits
     ) then
    raise exception '이미 다른 회원이 쓰는 번호입니다.' using errcode = '22023';
  end if;

  select nullif(regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), '')
    into v_old
    from auth.users u
   where u.id = p_user_id;

  insert into public.profiles (id, name, phone, updated_at)
  values (
    p_user_id,
    (select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), '')
       from auth.users u where u.id = p_user_id),
    v_digits,
    now()
  )
  on conflict (id) do update
     set phone      = excluded.phone,
         updated_at = now();

  update auth.users
     set raw_user_meta_data =
           coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('phone', v_digits),
         updated_at = now()
   where id = p_user_id;

  return jsonb_build_object(
    'user_id',   p_user_id,
    'phone',     v_digits,
    'old_phone', coalesce(v_old, '')
  );
end;
$$;

create or replace function public.my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_phone  text;
  v_reason text;
begin
  if v_uid is null then
    return jsonb_build_object(
      'user_id', null, 'name', '', 'phone', '',
      'needs_phone', true, 'blocked', false, 'block_reason', ''
    );
  end if;

  v_reason := private.identity_blocked_reason(v_uid);

  select nullif(btrim(coalesce(p.name, '')), ''),
         nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '')
    into v_name, v_phone
    from public.profiles p
   where p.id = v_uid;

  if v_phone is null then
    select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
           nullif(regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), '')
      into v_name, v_phone
      from auth.users u
     where u.id = v_uid;
  end if;

  return jsonb_build_object(
    'user_id',      v_uid,
    'name',         coalesce(v_name, ''),
    'phone',        coalesce(v_phone, ''),
    'needs_phone',  v_phone is null,
    'blocked',      v_reason is not null,
    'block_reason', coalesce(v_reason, '')
  );
end;
$$;

create or replace function public.update_my_profile(
  p_name  text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_digits   text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_reason   text;
  v_cur      text;
  v_name     text := nullif(btrim(coalesce(p_name, '')), '');
  v_cur_name text;
begin
  if v_uid is null then
    raise exception '로그인 후 이용해 주세요.' using errcode = '42501';
  end if;

  v_reason := private.identity_blocked_reason(v_uid);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = '42501';
  end if;

  select nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), ''),
         nullif(btrim(coalesce(p.name, '')), '')
    into v_cur, v_cur_name
    from public.profiles p
   where p.id = v_uid;

  if v_digits != '' then
    if v_cur is not null and v_cur != v_digits then
      raise exception '휴대폰 번호는 직접 바꿀 수 없습니다. 오픈톡으로 문의해 주세요.'
        using errcode = '42501';
    end if;

    if v_digits !~ '^01[016789][0-9]{7,8}$' then
      raise exception '휴대폰 번호를 정확히 입력해 주세요. (예: 010-0000-0000)'
        using errcode = '22023';
    end if;

    if exists (select 1 from public.blocked_phones b where b.phone_digits = v_digits) then
      raise exception '이용이 제한된 휴대폰 번호입니다. 오픈톡으로 문의해 주세요.'
        using errcode = '42501';
    end if;

    if exists (
         select 1
           from auth.users u
          where u.id != v_uid
            and regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g') = v_digits
       )
       or exists (
         select 1
           from public.profiles p
          where p.id != v_uid
            and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_digits
       ) then
      raise exception '이미 가입된 휴대폰 번호입니다.' using errcode = '22023';
    end if;
  end if;

  insert into public.profiles (id, name, phone, updated_at)
  values (v_uid, coalesce(v_name, v_cur_name), nullif(v_digits, ''), now())
  on conflict (id) do update
     set name       = coalesce(v_name, public.profiles.name),
         phone      = coalesce(nullif(v_digits, ''), public.profiles.phone),
         updated_at = now();

  update auth.users
     set raw_user_meta_data =
           coalesce(raw_user_meta_data, '{}'::jsonb)
           || jsonb_build_object('name', coalesce(v_name, v_cur_name, ''))
           || case when v_digits != ''
                   then jsonb_build_object('phone', v_digits)
                   else '{}'::jsonb end,
         updated_at = now()
   where id = v_uid;

  return public.my_profile();
end;
$$;

revoke all on function public.admin_update_member_phone(uuid, text, text) from public;
revoke all on function public.my_profile() from public;
revoke all on function public.update_my_profile(text, text) from public;
revoke all on function public.my_profile() from anon;
revoke all on function public.update_my_profile(text, text) from anon;

grant execute on function public.admin_update_member_phone(uuid, text, text) to anon, authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.update_my_profile(text, text) to authenticated;

notify pgrst, 'reload schema';

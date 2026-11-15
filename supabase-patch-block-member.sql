create table if not exists public.blocked_phones (
  phone_digits text primary key,
  reason       text,
  created_at   timestamptz not null default now()
);

alter table public.blocked_phones enable row level security;
revoke all on table public.blocked_phones from anon, authenticated;

create table if not exists public.blocked_kakao (
  kakao_id   text primary key,
  label      text,
  reason     text,
  created_at timestamptz not null default now()
);

alter table public.blocked_kakao enable row level security;
revoke all on table public.blocked_kakao from anon, authenticated;

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

insert into public.profiles (id, name, phone)
select u.id,
       nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), ''),
       nullif(regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), '')
  from auth.users u
on conflict (id) do nothing;

create or replace function private.trg_ensure_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, name, phone)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.trg_ensure_profile() from public;

drop trigger if exists ensure_profile on auth.users;
create trigger ensure_profile
  after insert on auth.users
  for each row execute function private.trg_ensure_profile();

create or replace function private.identity_blocked_reason(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(nullif(btrim(coalesce(b.reason, '')), ''),
                  '이용이 제한된 카카오 계정입니다. 오픈톡으로 문의해 주세요.')
    from auth.identities i
    join public.blocked_kakao b
      on b.kakao_id = coalesce(to_jsonb(i) ->> 'provider_id', i.identity_data ->> 'sub')
   where i.user_id = p_uid
     and i.provider = 'kakao'
   limit 1;
$$;

revoke all on function private.identity_blocked_reason(uuid) from public;

create or replace function private.trg_block_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.provider = 'kakao' and exists (
       select 1
         from public.blocked_kakao b
        where b.kakao_id = coalesce(to_jsonb(new) ->> 'provider_id', new.identity_data ->> 'sub')
     ) then
    raise exception '이용이 제한된 카카오 계정입니다. 오픈톡으로 문의해 주세요.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.trg_block_identity() from public;

drop trigger if exists block_identity on auth.identities;
create trigger block_identity
  after insert on auth.identities
  for each row execute function private.trg_block_identity();

create or replace function public.check_phone_available(p_phone text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  with d as (
    select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as v
  )
  select case
    when (select v from d) = '' then true
    else not exists (
           select 1
             from auth.users u
            where regexp_replace(coalesce(u.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g')
                = (select v from d)
         )
         and not exists (
           select 1
             from public.profiles p
            where regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = (select v from d)
         )
         and not exists (
           select 1
             from public.blocked_phones b
            where b.phone_digits = (select v from d)
         )
  end;
$$;

create or replace function private.trg_orders_block_phone()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  v_name   text;
  v_phone  text;
  v_reason text;
begin
  if v_digits != '' and exists (
       select 1 from public.blocked_phones b where b.phone_digits = v_digits
     ) then
    raise exception '이용이 제한된 휴대폰 번호입니다. 오픈톡으로 문의해 주세요.'
      using errcode = '42501';
  end if;

  if new.user_id is not null then
    if not exists (select 1 from auth.users u where u.id = new.user_id) then
      raise exception '회원 정보를 확인할 수 없습니다. 다시 로그인해 주세요.'
        using errcode = '42501';
    end if;

    v_reason := private.identity_blocked_reason(new.user_id);
    if v_reason is not null then
      raise exception '%', v_reason using errcode = '42501';
    end if;

    select nullif(btrim(coalesce(p.name, '')), ''),
           nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '')
      into v_name, v_phone
      from public.profiles p
     where p.id = new.user_id;

    if v_phone is null then
      raise exception '휴대폰 번호 등록이 필요합니다. 마이페이지에서 번호를 등록해 주세요.'
        using errcode = '42501';
    end if;

    new.phone := v_phone;
    if v_name is not null then
      new.customer_name  := v_name;
      new.depositor_name := v_name;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.trg_orders_block_phone() from public;

drop trigger if exists orders_block_phone on public.orders;
create trigger orders_block_phone
  before insert on public.orders
  for each row execute function private.trg_orders_block_phone();

grant execute on function public.check_phone_available(text) to anon, authenticated;

notify pgrst, 'reload schema';

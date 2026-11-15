-- ============================================================
-- ALL PO ONE(올포원) — 2차 업그레이드 SQL
-- 1차(supabase-schema.sql)를 이미 실행한 프로젝트에서
-- 이 파일 전체를 SQL Editor 에 붙여넣고 [Run] 한 번만 누르면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- 새로 생기는 것
--  · 상품: 이름·가격·재고 수정 / 새 상품 추가 / 삭제 / 한줄설명 / 사진(Storage)
--  · 회원가입·로그인 주문 (orders.user_id, my_orders)
--  · 사장님 설정: 비로그인(게스트) 주문 허용 ↔ 회원 로그인 필수
--  · 손님 직접 주문 취소, 10분 미입금 자동 취소 + 재고 복구
-- ============================================================

-- 1) 상품 열 추가 + 분류/종목/판본 값 확장
alter table public.products add column if not exists subtitle  text;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists edition   text;

-- 예전 'single'(싱글·기타) 분류는 'etc'(기타)로 먼저 옮깁니다.
alter table public.products drop constraint if exists products_type_check;
update public.products set type = 'etc' where type = 'single';

alter table public.products
  add constraint products_type_check check (type in ('box', 'oripa', 'etc'));
alter table public.products drop constraint if exists products_game_check;
alter table public.products
  add constraint products_game_check check (game in ('pokemon', 'onepiece', 'other'));
alter table public.products drop constraint if exists products_edition_check;
alter table public.products
  add constraint products_edition_check check (edition is null or edition in ('KR', 'JP', 'EN'));

-- 2) 공개 설정 (비로그인 주문 허용 여부)
create table if not exists public.shop_public_settings (
  id                     int primary key default 1 check (id = 1),
  require_login_to_order boolean not null default false,
  updated_at             timestamptz not null default now()
);
insert into public.shop_public_settings (id) values (1) on conflict (id) do nothing;
alter table public.shop_public_settings enable row level security;
grant select on public.shop_public_settings to anon, authenticated;
drop policy if exists shop_public_settings_read on public.shop_public_settings;
create policy shop_public_settings_read on public.shop_public_settings
  for select to anon, authenticated using (true);

-- 3) 주문에 회원 id
alter table public.orders
  add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

-- 4) 취소 시 재고 복구 공통 도우미
create or replace function private.restore_order_stock(p_order_id uuid)
returns void language plpgsql security definer
set search_path = private, public, pg_temp as $$
declare v_item record;
begin
  for v_item in
    select product_id, sum(qty)::int as qty from public.order_items
     where order_id = p_order_id group by product_id order by product_id
  loop
    update public.products
       set stock = stock + v_item.qty,
           status = case when stock + v_item.qty > 0 and status in ('sold','soldout')
                         then 'available' else status end,
           updated_at = now()
     where id = v_item.product_id;
  end loop;
end $$;
revoke all on function private.restore_order_stock(uuid) from public;

-- 5) 주문 JSON (회원 여부 + 입금 마감 시각)
create or replace function public.order_json(p_id uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'order_no', o.order_no, 'status', o.status,
    'created_at', o.created_at, 'updated_at', o.updated_at,
    'paid_at', o.paid_at, 'shipped_at', o.shipped_at, 'cancelled_at', o.cancelled_at,
    'expires_at', case when o.status = 'pending_payment'
                       then o.created_at + interval '10 minutes' else null end,
    'total_amount', o.total_amount,
    'customer_name', o.customer_name, 'depositor_name', o.depositor_name,
    'phone', o.phone, 'postcode', o.postcode, 'address', o.address,
    'address_detail', o.address_detail, 'memo', o.memo,
    'user_id', o.user_id, 'is_member', (o.user_id is not null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', i.product_id, 'product_name', i.product_name,
        'unit_price', i.unit_price, 'qty', i.qty, 'line_total', i.line_total
      ) order by i.id) from public.order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  ) from public.orders o where o.id = p_id;
$$;
revoke all on function public.order_json(uuid) from public;

-- 6) 주문 넣기 (10분 만료 정리 → 로그인 필수 확인 → 재고 차감 → user_id 저장)
create or replace function public.place_order(p_customer jsonb, p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_item record; v_stock int; v_price int; v_order_id uuid; v_order_no text; v_suffix text;
  v_total int := 0; v_created timestamptz := now();
  v_name text := nullif(btrim(coalesce(p_customer ->> 'name','')),'');
  v_depositor text := nullif(btrim(coalesce(p_customer ->> 'depositor','')),'');
  v_phone text := regexp_replace(coalesce(p_customer ->> 'phone',''),'[^0-9]','','g');
  v_attempt int := 0; v_ok boolean := false;
  v_uid uuid := auth.uid(); v_require boolean := false;
begin
  perform public.expire_unpaid_orders();

  select require_login_to_order into v_require from public.shop_public_settings where id = 1;
  if coalesce(v_require, false) and v_uid is null then
    raise exception '이 쇼핑몰은 회원만 주문할 수 있습니다. 로그인 또는 회원가입 후 주문해 주세요.'
      using errcode = '42501';
  end if;

  if v_name is null then
    raise exception '주문자명을 입력해 주세요.' using errcode = '22023';
  end if;
  if length(v_phone) < 9 or length(v_phone) > 11 then
    raise exception '연락처를 정확히 입력해 주세요.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '주문할 상품이 없습니다.' using errcode = '22023';
  end if;

  for v_item in
    select a.product_id, sum(a.qty)::int as qty from (
      select e ->> 'product_id' as product_id, coalesce((e ->> 'qty')::int, 0) as qty
        from jsonb_array_elements(p_items) e
    ) a group by a.product_id order by a.product_id
  loop
    select price, stock into v_price, v_stock
      from public.products where id = v_item.product_id for update;
    if not found then
      raise exception '상품을 찾을 수 없습니다: %', v_item.product_id using errcode = '22023';
    end if;
    if v_stock < v_item.qty then
      raise exception '% 의 남은 재고가 %개입니다. 수량을 조정해 주세요.',
        v_item.product_id, v_stock using errcode = '22023';
    end if;
    update public.products
       set stock = stock - v_item.qty,
           status = case when stock - v_item.qty <= 0 then 'sold' else status end,
           updated_at = now()
     where id = v_item.product_id;
  end loop;

  while not v_ok and v_attempt < 20 loop
    v_attempt := v_attempt + 1;
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                             1 + floor(random() * 32)::int, 1), '')
      into v_suffix from generate_series(1, 4);
    v_order_no := 'APO-' || to_char(v_created at time zone 'Asia/Seoul','YYYYMMDD') || '-' || v_suffix;
    begin
      insert into public.orders (
        order_no, status, customer_name, depositor_name, phone, postcode,
        address, address_detail, memo, user_id, total_amount, created_at, updated_at
      ) values (
        v_order_no, 'pending_payment', v_name, coalesce(v_depositor, v_name), v_phone,
        nullif(btrim(coalesce(p_customer ->> 'postcode','')),''),
        nullif(btrim(coalesce(p_customer ->> 'address','')),''),
        nullif(btrim(coalesce(p_customer ->> 'address_detail','')),''),
        nullif(btrim(coalesce(p_customer ->> 'memo','')),''),
        v_uid, 0, v_created, v_created
      ) returning id into v_order_id;
      v_ok := true;
    exception when unique_violation then v_ok := false;
    end;
  end loop;

  if not v_ok then
    raise exception '주문번호를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
  end if;

  insert into public.order_items (order_id, product_id, product_name, unit_price, qty, line_total)
  select v_order_id, p.id, p.name, p.price, a.qty, p.price * a.qty from (
    select e ->> 'product_id' as product_id, sum(coalesce((e ->> 'qty')::int,0))::int as qty
      from jsonb_array_elements(p_items) e group by 1
  ) a join public.products p on p.id = a.product_id;

  select coalesce(sum(line_total), 0) into v_total
    from public.order_items where order_id = v_order_id;
  update public.orders set total_amount = v_total where id = v_order_id;

  return public.order_json(v_order_id);
end $$;

-- 7) 손님 주문 조회 / 회원 내 주문 / 관리자 주문 목록 (열 때마다 10분 만료 정리)
create or replace function public.lookup_orders(
  p_order_no text default null, p_name text default null, p_phone text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_no text := nullif(upper(btrim(coalesce(p_order_no,''))),'');
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_result jsonb;
begin
  if v_no is null and (v_name is null or length(v_phone) < 9) then
    raise exception '주문번호 또는 주문자명 + 연락처를 입력해 주세요.' using errcode = '22023';
  end if;
  perform public.expire_unpaid_orders();
  select coalesce(jsonb_agg(public.order_json(o.id) order by o.created_at desc),'[]'::jsonb)
    into v_result
    from (select o.id, o.created_at from public.orders o
           where (v_no is not null and upper(o.order_no) = v_no)
              or (v_no is null and v_name is not null and o.customer_name = v_name
                  and regexp_replace(o.phone,'[^0-9]','','g') = v_phone)
           order by o.created_at desc limit 20) o;
  return coalesce(v_result,'[]'::jsonb);
end $$;

create or replace function public.my_orders()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then
    raise exception '로그인 후 이용해 주세요.' using errcode = '28000';
  end if;
  perform public.expire_unpaid_orders();
  select coalesce(jsonb_agg(public.order_json(o.id) order by o.created_at desc),'[]'::jsonb)
    into v_result
    from (select id, created_at from public.orders
           where user_id = v_uid order by created_at desc limit 50) o;
  return coalesce(v_result,'[]'::jsonb);
end $$;
revoke all on function public.my_orders() from public;
grant execute on function public.my_orders() to authenticated;

create or replace function public.admin_list_orders(p_pin text default null, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  perform private.assert_admin(p_pin);
  perform public.expire_unpaid_orders();
  select coalesce(jsonb_agg(public.order_json(o.id) order by o.created_at desc),'[]'::jsonb)
    into v_result
    from (select o.id, o.created_at from public.orders o
           where p_status is null or p_status = '' or o.status = p_status
           order by o.created_at desc limit 300) o;
  return coalesce(v_result,'[]'::jsonb);
end $$;

-- 8) 10분 미입금 자동 취소 + 재고 복구
create or replace function public.expire_unpaid_orders()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid; v_count int := 0;
begin
  for v_id in
    select id from public.orders
     where status = 'pending_payment' and created_at < now() - interval '10 minutes'
     order by created_at
     for update skip locked
  loop
    perform private.restore_order_stock(v_id);
    update public.orders
       set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
     where id = v_id;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('expired', v_count);
end $$;

-- 9) 손님 직접 주문 취소 (입금대기만)
create or replace function public.cancel_my_order(
  p_order_no text, p_name text default null, p_phone text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_no text := nullif(upper(btrim(coalesce(p_order_no,''))),'');
  v_name text := nullif(btrim(coalesce(p_name,'')),'');
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_uid uuid := auth.uid(); v_order public.orders;
begin
  perform public.expire_unpaid_orders();
  if v_no is null then
    raise exception '주문번호를 입력해 주세요.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where upper(order_no) = v_no for update;
  if not found then
    raise exception '주문을 찾을 수 없습니다: %', p_order_no using errcode = '22023';
  end if;
  if v_order.status = 'cancelled' then
    raise exception '이미 취소된 주문입니다.' using errcode = '22023';
  end if;
  if v_order.status in ('paid','shipped') then
    raise exception '입금이 확인된 주문은 직접 취소할 수 없습니다. 오픈톡으로 문의해 주세요.'
      using errcode = '22023';
  end if;

  if v_uid is null or v_order.user_id is distinct from v_uid then
    if v_name is null or v_order.customer_name <> v_name
       or regexp_replace(v_order.phone,'[^0-9]','','g') <> v_phone
       or length(v_phone) < 9 then
      raise exception '주문자명과 연락처가 맞지 않아 취소할 수 없습니다.' using errcode = '28000';
    end if;
  end if;

  perform private.restore_order_stock(v_order.id);
  update public.orders
     set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
   where id = v_order.id;

  return public.order_json(v_order.id);
end $$;

-- 10) 관리자: 상품 추가/수정 (id 가 없으면 새 상품)
drop function if exists public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text);

create or replace function public.admin_upsert_product(
  p_id text, p_name text, p_type text, p_game text, p_price integer, p_stock integer,
  p_edition text default null, p_subtitle text default null, p_image_url text default null,
  p_pin text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id text := nullif(btrim(coalesce(p_id,'')),'');
  v_row public.products; v_sort integer; v_new boolean := false; v_edition text;
begin
  perform private.assert_admin(p_pin);

  if p_name is null or btrim(p_name) = '' then
    raise exception '상품명을 입력해 주세요.' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('box','oripa','etc') then
    raise exception '상품 유형은 box / oripa / etc 중 하나여야 합니다.' using errcode = '22023';
  end if;
  if p_game is null or p_game not in ('pokemon','onepiece','other') then
    raise exception '종목은 pokemon / onepiece / other 중 하나여야 합니다.' using errcode = '22023';
  end if;
  if p_edition is not null and btrim(p_edition) <> ''
     and btrim(p_edition) not in ('KR','JP','EN') then
    raise exception '판본은 KR / JP / EN 중 하나이거나 비워 두어야 합니다.' using errcode = '22023';
  end if;
  v_edition := nullif(upper(btrim(coalesce(p_edition,''))), '');

  if p_price is null or p_price < 0 or p_price > 100000000 then
    raise exception '가격은 0원 이상 1억 원 이하로 입력해 주세요.' using errcode = '22023';
  end if;
  if p_stock is null or p_stock < 0 or p_stock > 99999 then
    raise exception '재고는 0 ~ 99,999 사이로 입력해 주세요.' using errcode = '22023';
  end if;

  if v_id is null then
    v_id := 'db-' || lower(substr(replace(gen_random_uuid()::text,'-',''), 1, 10));
  end if;
  if v_id !~ '^[a-z0-9][a-z0-9-]{1,60}$' then
    raise exception '상품 ID는 영문 소문자·숫자·-(붙임표)로 2~61자여야 합니다: %', v_id
      using errcode = '22023';
  end if;

  select * into v_row from public.products where id = v_id for update;

  if not found then
    select coalesce(max(sort_order), 0) + 10 into v_sort from public.products;
    insert into public.products (
      id, name, type, game, edition, price, stock, status, sort_order, subtitle, image_url, updated_at
    ) values (
      v_id, btrim(p_name), p_type, p_game, v_edition, p_price, p_stock,
      case when p_stock <= 0 then 'sold' else 'available' end, v_sort,
      nullif(btrim(coalesce(p_subtitle,'')),''),
      nullif(btrim(coalesce(p_image_url,'')),''), now()
    ) returning * into v_row;
    v_new := true;
  else
    update public.products
       set name = btrim(p_name), type = p_type, game = p_game, edition = v_edition,
           price = p_price, stock = p_stock,
           status = case when p_stock <= 0 then 'sold'
                         when status in ('sold','soldout') then 'available' else status end,
           subtitle = nullif(btrim(coalesce(p_subtitle,'')),''),
           image_url = nullif(btrim(coalesce(p_image_url,'')),''),
           updated_at = now()
     where id = v_id returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'type', v_row.type, 'game', v_row.game,
    'edition', v_row.edition, 'price', v_row.price, 'stock', v_row.stock,
    'status', v_row.status, 'subtitle', v_row.subtitle, 'image_url', v_row.image_url,
    'created', v_new
  );
end $$;

-- 11) 관리자: 이름·가격·재고만 수정
create or replace function public.admin_update_product(
  p_product_id text, p_name text, p_price integer, p_stock integer, p_pin text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_row public.products;
begin
  perform private.assert_admin(p_pin);
  select * into v_row from public.products where id = p_product_id;
  if not found then
    raise exception '상품을 찾을 수 없습니다: %', p_product_id using errcode = '22023';
  end if;
  return public.admin_upsert_product(
    p_product_id, p_name, v_row.type, v_row.game, p_price, p_stock,
    v_row.edition, v_row.subtitle, v_row.image_url, p_pin
  );
end $$;

-- 12) 관리자: 상품 삭제 (주문 이력 있으면 거절)
create or replace function public.admin_delete_product(p_id text, p_pin text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_used integer;
begin
  perform private.assert_admin(p_pin);
  select count(*) into v_used from public.order_items where product_id = p_id;
  if v_used > 0 then
    raise exception '주문 내역이 있어 삭제할 수 없습니다. 재고를 0(품절)으로 바꿔 주세요.'
      using errcode = '23503';
  end if;
  delete from public.products where id = p_id;
  if not found then
    raise exception '상품을 찾을 수 없습니다: %', p_id using errcode = '22023';
  end if;
  return jsonb_build_object('deleted', true, 'id', p_id);
end $$;

-- 13) 관리자: 비로그인 주문 허용 ↔ 회원 로그인 필수
create or replace function public.admin_set_require_login(
  p_require boolean, p_pin text default null
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_row public.shop_public_settings;
begin
  perform private.assert_admin(p_pin);
  if p_require is null then
    raise exception '설정 값을 확인해 주세요.' using errcode = '22023';
  end if;
  insert into public.shop_public_settings (id, require_login_to_order, updated_at)
  values (1, p_require, now())
  on conflict (id) do update
     set require_login_to_order = excluded.require_login_to_order, updated_at = now()
  returning * into v_row;
  return jsonb_build_object(
    'require_login_to_order', v_row.require_login_to_order, 'updated_at', v_row.updated_at
  );
end $$;

-- 14) 실행 권한
grant execute on function public.expire_unpaid_orders() to anon, authenticated;
grant execute on function public.cancel_my_order(text, text, text) to anon, authenticated;
grant execute on function public.admin_upsert_product(text, text, text, text, integer, integer, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_update_product(text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.admin_delete_product(text, text) to anon, authenticated;
grant execute on function public.admin_set_require_login(boolean, text) to anon, authenticated;

-- 14-1) 손님 휴대폰 번호 중복 확인 (회원가입 전 중복 가입 차단)
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
grant execute on function public.check_phone_available(text) to anon, authenticated;

-- 15) 상품 사진 저장소 (공개 읽기, 관리자만 올리기)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
   set public = true, file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');

drop policy if exists product_images_admin_write on storage.objects;
create policy product_images_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'product-images' and private.is_admin())
  with check (bucket_id = 'product-images' and private.is_admin());

-- 16) 설치 확인
select
  (select count(*) from public.products) as "상품수",
  (select require_login_to_order from public.shop_public_settings where id = 1) as "로그인필수",
  (select count(*) from storage.buckets where id = 'product-images') as "사진버킷",
  (select count(*) from public.orders where user_id is not null) as "회원주문수";

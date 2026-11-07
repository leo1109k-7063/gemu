
-- 46 / 체스 스킨 상점 활성화 (신규 패치)
-- 26번 파일을 다시 실행하지 마세요.
-- 모노 잉크 기본 지급, 나머지 네 스킨 각 10코인.
-- 기존 구매 이력은 삭제하지 않습니다.
-- 기존 회원·XP·HElo·다른 게임 함수는 변경하지 않습니다.

create table if not exists public.game_chess_skin_catalog (
  id text primary key,
  name text not null,
  price integer not null default 20,
  preview text not null default '#e8edf5',
  is_default boolean not null default false,
  active boolean not null default true
);

create table if not exists public.game_chess_skin_purchases (
  id bigint generated always as identity primary key,
  profile_id uuid not null
    references public.game_profiles (id) on delete cascade,
  skin_id text not null
    references public.game_chess_skin_catalog (id),
  price integer not null,
  purchased_at timestamptz not null default now(),
  unique (profile_id, skin_id)
);

insert into public.game_chess_skin_catalog
  (id, name, price, preview, is_default, active)
values
  ('glass', '블루 글라스', 10, '#8ea7d6', false, true),
  ('wood', '클래식 우드', 10, '#b58863', false, true),
  ('green', '토너먼트 그린', 10, '#769656', false, true),
  ('ink', '모노 잉크', 0, '#c9c9c4', true, true),
  ('neon', '다크 네온', 10, '#202944', false, true)
on conflict (id) do update
set
  name = excluded.name,
  price = excluded.price,
  preview = excluded.preview,
  is_default = excluded.is_default,
  active = excluded.active;

alter table public.game_chess_skin_catalog
  enable row level security;

alter table public.game_chess_skin_purchases
  enable row level security;

drop policy if exists chess_skin_catalog_read
  on public.game_chess_skin_catalog;

create policy chess_skin_catalog_read
on public.game_chess_skin_catalog
for select
to authenticated
using (active = true);

drop policy if exists chess_skin_purchases_read_own
  on public.game_chess_skin_purchases;

create policy chess_skin_purchases_read_own
on public.game_chess_skin_purchases
for select
to authenticated
using (
  profile_id = (select auth.uid())
);

revoke all on public.game_chess_skin_catalog
from anon, authenticated;

grant select on public.game_chess_skin_catalog
to anon, authenticated;

revoke all on public.game_chess_skin_purchases
from anon, authenticated;

grant select on public.game_chess_skin_purchases
to authenticated;

-- 보유 스킨 조회
create or replace function public.get_chess_skins(
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_coins integer;
  v_skins jsonb;
begin
  if p_profile_id is null then
    raise exception 'PROFILE_REQUIRED';
  end if;

  select coins into v_coins
  from public.game_profiles
  where id = p_profile_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'price', c.price,
        'preview', c.preview,
        'owned', (
          c.is_default or exists (
            select 1
            from public.game_chess_skin_purchases p
            where p.profile_id = p_profile_id
              and p.skin_id = c.id
          )
        )
      )
      order by c.is_default desc, c.id
    ),
    '[]'::jsonb
  )
  into v_skins
  from public.game_chess_skin_catalog c
  where c.active = true;

  return jsonb_build_object(
    'ok', true,
    'coins', v_coins,
    'skins', v_skins
  );
end;
$$;

revoke all on function public.get_chess_skins(uuid)
from public, anon;

grant execute on function public.get_chess_skins(uuid)
to anon, authenticated;

-- 체스 스킨 구매
create or replace function public.buy_chess_skin(
  p_profile_id uuid,
  p_skin_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile public.game_profiles%rowtype;
  v_skin public.game_chess_skin_catalog%rowtype;
begin
  if p_profile_id is null then
    raise exception 'PROFILE_REQUIRED';
  end if;

  select *
  into v_profile
  from public.game_profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  select *
  into v_skin
  from public.game_chess_skin_catalog
  where id = p_skin_id
    and active = true
    and is_default = false;

  if not found then
    raise exception 'NOT_FOR_SALE';
  end if;

  if exists (
    select 1
    from public.game_chess_skin_purchases
    where profile_id = p_profile_id
      and skin_id = p_skin_id
  ) then
    raise exception 'OWNED';
  end if;

  if v_profile.coins < v_skin.price then
    raise exception 'NO_COINS';
  end if;

  update public.game_profiles
  set
    coins = coins - v_skin.price,
    updated_at = now()
  where id = p_profile_id
  returning * into v_profile;

  insert into public.game_chess_skin_purchases (
    profile_id, skin_id, price
  )
  values (
    p_profile_id, p_skin_id, v_skin.price
  );

  insert into public.coin_transactions (
    profile_id, amount, reason
  )
  values (
    p_profile_id,
    -v_skin.price,
    'chess_skin:' || p_skin_id
  );

  return jsonb_build_object(
    'ok', true,
    'skin_id', p_skin_id,
    'coins', v_profile.coins
  );
end;
$$;

revoke all on function public.buy_chess_skin(uuid, text)
from public, anon;

grant execute on function public.buy_chess_skin(uuid, text)
to anon, authenticated;

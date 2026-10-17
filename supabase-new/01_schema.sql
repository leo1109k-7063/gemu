-- 게임 놀이터 온라인 배포용 Supabase 초기 스키마
-- Supabase Dashboard > SQL Editor에서 새 프로젝트에 한 번 실행하세요.
-- 중요: 브라우저에는 publishable key만 사용하고 secret/service_role 키는 절대 넣지 마세요.

create extension if not exists pgcrypto;

create table if not exists public.game_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 16),
  coins integer not null default 0 check (coins >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists game_profiles_nickname_lower_uq
  on public.game_profiles (lower(nickname));

create table if not exists public.game_settings (
  id boolean primary key default true check (id),
  omok_enabled boolean not null default true,
  rummikub_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.game_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.game_teachers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.coin_transactions (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.game_profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null default 'teacher_grant',
  created_at timestamptz not null default now()
);

alter table public.game_profiles enable row level security;
alter table public.game_settings enable row level security;
alter table public.game_teachers enable row level security;
alter table public.coin_transactions enable row level security;

-- 사용자 본인은 본인 프로필과 코인 내역만 읽을 수 있습니다.
drop policy if exists "profile_read_own" on public.game_profiles;
create policy "profile_read_own" on public.game_profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "settings_read_authenticated" on public.game_settings;
create policy "settings_read_authenticated" on public.game_settings
  for select to authenticated using (true);

drop policy if exists "coin_history_read_own" on public.coin_transactions;
create policy "coin_history_read_own" on public.coin_transactions
  for select to authenticated using (profile_id = (select auth.uid()));

-- 직접 INSERT/UPDATE/DELETE 권한은 주지 않습니다. 변경은 아래 검증된 RPC만 사용합니다.
revoke all on public.game_profiles from anon, authenticated;
grant select on public.game_profiles to authenticated;
revoke all on public.game_settings from anon, authenticated;
grant select on public.game_settings to authenticated;
revoke all on public.game_teachers from anon, authenticated;
revoke all on public.coin_transactions from anon, authenticated;
grant select on public.coin_transactions to authenticated;

create or replace function public._is_game_teacher()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.game_teachers t where t.user_id = auth.uid()
  );
$$;
revoke all on function public._is_game_teacher() from public, anon, authenticated;

-- 닉네임으로 프로필 생성. Supabase Auth 세션 ID와 연결되므로 닉네임만으로 남을 사칭할 수 없습니다.
create or replace function public.create_game_profile(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_nickname text := btrim(coalesce(p_nickname, ''));
  v_profile public.game_profiles%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_nickname) < 1 or char_length(v_nickname) > 16 then raise exception 'BAD_NICKNAME'; end if;
  if v_nickname !~ '^[가-힣A-Za-z0-9 _-]+$' then raise exception 'BAD_NICKNAME'; end if;

  insert into public.game_profiles (id, nickname)
  values (v_uid, v_nickname)
  on conflict (id) do update set
    nickname = excluded.nickname,
    updated_at = now()
  returning * into v_profile;

  return jsonb_build_object('id', v_profile.id, 'nickname', v_profile.nickname, 'coins', v_profile.coins);
exception when unique_violation then
  raise exception 'NICKNAME_TAKEN';
end;
$$;
revoke all on function public.create_game_profile(text) from public, anon;
grant execute on function public.create_game_profile(text) to authenticated;

create or replace function public.grant_game_coins(p_nickname text, p_amount integer, p_reason text default 'teacher_grant')
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile public.game_profiles%rowtype;
  v_amount integer := p_amount;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_game_teacher() then raise exception 'NOT_TEACHER'; end if;
  if v_amount is null or v_amount < 1 or v_amount > 10000 then raise exception 'BAD_AMOUNT'; end if;

  select * into v_profile from public.game_profiles
  where lower(nickname) = lower(btrim(coalesce(p_nickname, '')))
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  update public.game_profiles
    set coins = coins + v_amount, updated_at = now()
    where id = v_profile.id
    returning * into v_profile;

  insert into public.coin_transactions(profile_id, amount, reason)
    values (v_profile.id, v_amount, left(coalesce(nullif(btrim(p_reason), ''), 'teacher_grant'), 120));

  return jsonb_build_object('ok', true, 'nickname', v_profile.nickname, 'coins', v_profile.coins, 'granted', v_amount);
end;
$$;
revoke all on function public.grant_game_coins(text, integer, text) from public, anon;
grant execute on function public.grant_game_coins(text, integer, text) to authenticated;

create or replace function public.set_game_enabled(p_game text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_game_teacher() then raise exception 'NOT_TEACHER'; end if;
  if p_game = 'omok' then
    update public.game_settings set omok_enabled = p_enabled, updated_at = now() where id = true;
  elsif p_game = 'rummikub' then
    update public.game_settings set rummikub_enabled = p_enabled, updated_at = now() where id = true;
  else
    raise exception 'BAD_GAME';
  end if;
  return jsonb_build_object('ok', true, 'game', p_game, 'enabled', p_enabled);
end;
$$;
revoke all on function public.set_game_enabled(text, boolean) from public, anon;
grant execute on function public.set_game_enabled(text, boolean) to authenticated;

-- 브라우저에서 직접 호출할 수 없는 교사 목록 확인 함수입니다. 교사 등록은 SQL Editor에서만 하세요.

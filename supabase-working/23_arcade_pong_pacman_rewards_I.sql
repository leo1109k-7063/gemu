-- 05_arcade_game_rewards.sql
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행하세요.
-- PONG / 팩맨 보상: 보상 종류별로 한 판에서 한 번만 지급합니다.

alter table public.game_profiles
  add column if not exists xp integer not null default 0;

create table if not exists public.arcade_game_reward_claims (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.game_profiles(id) on delete cascade,
  game_name text not null check (game_name in ('pong', 'pacman')),
  reward_type text not null check (reward_type in ('rally20', 'survive60', 'win')),
  match_id text not null,
  coins_awarded integer not null default 0,
  xp_awarded integer not null default 0,
  created_at timestamptz not null default now(),
  unique (profile_id, game_name, reward_type, match_id)
);

alter table public.arcade_game_reward_claims enable row level security;
revoke all on public.arcade_game_reward_claims from public, anon, authenticated;

create or replace function public.claim_arcade_game_reward(
  p_nickname text,
  p_game text,
  p_reward_type text,
  p_match_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_profile public.game_profiles%rowtype;
  v_coins integer := 0;
  v_xp integer := 0;
  v_claim_id bigint;
  v_reason text;
begin
  if p_game not in ('pong', 'pacman') then
    return jsonb_build_object('ok', false, 'message', '지원하지 않는 게임입니다.');
  end if;
  if p_match_id is null or length(p_match_id) < 8 or length(p_match_id) > 100 then
    return jsonb_build_object('ok', false, 'message', '게임 판 정보가 올바르지 않습니다.');
  end if;

  if p_game = 'pong' and p_reward_type = 'rally20' then
    v_coins := 2;
    v_reason := 'PONG 1972 20랠리 보상';
  elsif p_game = 'pong' and p_reward_type = 'win' then
    v_coins := 5; v_xp := 1;
    v_reason := 'PONG 1972 승리 보상';
  elsif p_game = 'pacman' and p_reward_type = 'survive60' then
    v_coins := 2;
    v_reason := '팩맨 1분 생존 보상';
  elsif p_game = 'pacman' and p_reward_type = 'win' then
    v_coins := 5; v_xp := 1;
    v_reason := '팩맨 스테이지 클리어 보상';
  else
    return jsonb_build_object('ok', false, 'message', '올바르지 않은 보상 종류입니다.');
  end if;

  select * into v_profile
  from public.game_profiles
  where lower(nickname) = lower(btrim(coalesce(p_nickname, '')))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '게임 계정을 찾을 수 없습니다.');
  end if;

  insert into public.arcade_game_reward_claims(
    profile_id, game_name, reward_type, match_id, coins_awarded, xp_awarded
  ) values (
    v_profile.id, p_game, p_reward_type, p_match_id, v_coins, v_xp
  ) on conflict (profile_id, game_name, reward_type, match_id) do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true,
      'coins', v_profile.coins, 'xp', v_profile.xp,
      'granted_coins', 0, 'granted_xp', 0);
  end if;

  update public.game_profiles
  set coins = coins + v_coins,
      xp = xp + v_xp,
      updated_at = now()
  where id = v_profile.id
  returning * into v_profile;

  if v_coins > 0 then
    insert into public.coin_transactions(profile_id, amount, reason)
    values (v_profile.id, v_coins, v_reason);
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'coins', v_profile.coins,
    'xp', v_profile.xp,
    'granted_coins', v_coins,
    'granted_xp', v_xp
  );
end;
$$;

revoke all on function public.claim_arcade_game_reward(text, text, text, text) from public;
grant execute on function public.claim_arcade_game_reward(text, text, text, text) to anon, authenticated;

create or replace function public.get_arcade_game_stats(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_profile public.game_profiles%rowtype;
begin
  select * into v_profile
  from public.game_profiles
  where lower(nickname) = lower(btrim(coalesce(p_nickname, '')));

  if not found then
    return jsonb_build_object('ok', false, 'message', '게임 계정을 찾을 수 없습니다.');
  end if;

  return jsonb_build_object('ok', true, 'coins', v_profile.coins, 'xp', v_profile.xp);
end;
$$;

revoke all on function public.get_arcade_game_stats(text) from public;
grant execute on function public.get_arcade_game_stats(text) to anon, authenticated;

-- 오목 / 루미큐브 승리 보상
-- 코인 5개 + XP 1, 사유: 게임 승리

alter table public.game_profiles
  add column if not exists xp integer not null default 0;

create table if not exists public.game_win_rewards (
  id bigint generated always as identity primary key,
  profile_id uuid not null
    references public.game_profiles(id) on delete cascade,
  game_name text not null
    check (game_name in ('omok', 'rummikub')),
  match_id uuid not null,
  coins_awarded integer not null default 5,
  xp_awarded integer not null default 1,
  created_at timestamptz not null default now(),
  unique (profile_id, game_name, match_id)
);

alter table public.game_win_rewards enable row level security;

revoke all on public.game_win_rewards from public, anon, authenticated;

create or replace function public.award_game_win(
  p_nickname text,
  p_game_name text,
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target public.game_profiles%rowtype;
begin
  if p_nickname is null
     or length(btrim(p_nickname)) = 0
     or p_game_name not in ('omok', 'rummikub')
     or p_match_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '보상 요청 정보가 올바르지 않습니다.'
    );
  end if;

  select *
    into target
  from public.game_profiles
  where lower(nickname) = lower(btrim(p_nickname))
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', '계정을 찾을 수 없습니다.'
    );
  end if;

  -- 같은 판의 보상이 이미 기록되어 있으면 다시 지급하지 않음
  insert into public.game_win_rewards (
    profile_id, game_name, match_id
  )
  values (
    target.id, p_game_name, p_match_id
  )
  on conflict (profile_id, game_name, match_id) do nothing;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'duplicate', true,
      'message', '이 게임의 보상은 이미 지급되었습니다.'
    );
  end if;

  update public.game_profiles
  set coins = coins + 5,
      xp = xp + 1,
      updated_at = now()
  where id = target.id
  returning * into target;

  insert into public.coin_transactions (
    profile_id, amount, reason
  )
  values (
    target.id, 5, '게임 승리'
  );

  return jsonb_build_object(
    'ok', true,
    'coins_awarded', 5,
    'xp_awarded', 1,
    'coins', target.coins,
    'xp', target.xp,
    'message', '승리 보상으로 코인 5개와 XP 1을 받았습니다!'
  );
end;
$$;

revoke all on function public.award_game_win(text, text, uuid)
  from public;

grant execute on function public.award_game_win(text, text, uuid)
  to anon, authenticated;

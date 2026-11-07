-- 게임놀이터 44: 고누 AI 승리 시 난이도별 코인 지급 (신규 독립 SQL)
-- 쉬움 3 / 보통 5 / 어려움 7. 우물·줄·참고누 공통.
-- 기존 01~43 쿼리 재실행, 삭제 또는 수정 불필요.
-- 사용자 신뢰 기반 운영: 브라우저의 승리 보고를 서버가 독립 검증하지 않음.

create table if not exists public.gonu_reward_claims (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.game_profiles(id) on delete cascade,
  match_id text not null,
  game_type text not null check (game_type in ('well', 'line', 'three')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  coins_awarded integer not null check (coins_awarded in (3, 5, 7)),
  created_at timestamptz not null default now(),
  unique(profile_id, match_id)
);

alter table public.gonu_reward_claims enable row level security;
revoke all on public.gonu_reward_claims from public, anon, authenticated;

create or replace function public.claim_gonu_reward(
  p_nickname text,
  p_game_type text,
  p_difficulty text,
  p_match_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.game_profiles%rowtype;
  v_award integer;
  v_claim bigint;
begin
  v_award := case p_difficulty
    when 'easy' then 3
    when 'medium' then 5
    when 'hard' then 7
    else null
  end;
  if v_award is null or p_game_type not in ('well', 'line', 'three') then
    return jsonb_build_object('ok', false, 'message', '고누 종류 또는 난이도가 올바르지 않습니다.');
  end if;
  if p_match_id is null or length(p_match_id) < 16 or length(p_match_id) > 100 then
    return jsonb_build_object('ok', false, 'message', '대국 식별값이 올바르지 않습니다.');
  end if;
  select * into v_profile from public.game_profiles
   where lower(nickname) = lower(btrim(coalesce(p_nickname,''))) for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', '게임 계정을 찾을 수 없습니다.');
  end if;
  insert into public.gonu_reward_claims(profile_id, match_id, game_type, difficulty, coins_awarded)
  values(v_profile.id, p_match_id, p_game_type, p_difficulty, v_award)
  on conflict(profile_id, match_id) do nothing
  returning id into v_claim;
  if v_claim is null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'coins', v_profile.coins, 'granted_coins', 0);
  end if;
  update public.game_profiles
     set coins=coins+v_award, updated_at=now()
   where id=v_profile.id returning * into v_profile;
  insert into public.coin_transactions(profile_id, amount, reason)
  values(v_profile.id, v_award, '고누 AI 승리 (' ||
    case p_game_type when 'well' then '우물고누' when 'line' then '줄고누' else '참고누' end ||
    ', ' || case p_difficulty when 'easy' then '쉬움' when 'medium' then '보통' else '어려움' end || ')');
  return jsonb_build_object('ok', true, 'duplicate', false, 'coins', v_profile.coins, 'granted_coins', v_award);
end;
$$;
revoke all on function public.claim_gonu_reward(text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_gonu_reward(text,text,text,text) to anon, authenticated;

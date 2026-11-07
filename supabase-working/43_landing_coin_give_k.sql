-- 신규 기능 전용: 비행기 착륙 70점 이상 5코인
-- 기존 SQL Editor 쿼리 재실행/삭제 불필요.
-- 주의: 브라우저가 보낸 점수를 독립적으로 검증하지 못합니다.
-- 악의적 사용자는 점수와 닉네임을 위조할 수 있습니다.
-- 운영 보상 활성화 전 서버 측 검증/인증 보강을 권장합니다.

create table if not exists public.landing_reward_claims (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.game_profiles(id) on delete cascade,
  match_id text not null,
  score integer not null check (score between 70 and 100),
  coins_awarded integer not null default 5,
  created_at timestamptz not null default now(),
  unique (profile_id, match_id)
);
alter table public.landing_reward_claims enable row level security;
revoke all on public.landing_reward_claims from public, anon, authenticated;

create or replace function public.claim_landing_reward(
  p_nickname text,
  p_score integer,
  p_match_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.game_profiles%rowtype;
  v_claim bigint;
begin
  if p_score is null or p_score < 70 or p_score > 100 then
    return jsonb_build_object('ok', false, 'message', '70점 이상만 보상을 받을 수 있어요.');
  end if;
  if p_match_id is null or length(p_match_id) < 16 or length(p_match_id) > 100 then
    return jsonb_build_object('ok', false, 'message', '대전 식별값이 올바르지 않습니다.');
  end if;
  select * into v_profile from public.game_profiles
   where lower(nickname) = lower(btrim(coalesce(p_nickname,''))) for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', '게임 계정을 찾을 수 없습니다.');
  end if;
  insert into public.landing_reward_claims(profile_id, match_id, score)
  values(v_profile.id, p_match_id, p_score)
  on conflict(profile_id, match_id) do nothing
  returning id into v_claim;
  if v_claim is null then
    return jsonb_build_object('ok',true,'duplicate',true,'coins',v_profile.coins,'granted_coins',0);
  end if;
  update public.game_profiles
     set coins=coins+5, updated_at=now()
   where id=v_profile.id returning * into v_profile;
  insert into public.coin_transactions(profile_id, amount, reason)
  values(v_profile.id,5,'비행기 착륙 70점 이상');
  return jsonb_build_object('ok',true,'duplicate',false,'coins',v_profile.coins,'granted_coins',5);
end;
$$;
revoke all on function public.claim_landing_reward(text, integer, text) from public, anon, authenticated;
grant execute on function public.claim_landing_reward(text, integer, text) to anon, authenticated;

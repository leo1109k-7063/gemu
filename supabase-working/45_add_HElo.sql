-- 45 / 체스 HElo 계정 저장 (신규 기능 전용)
-- 기존 game_profiles·코인·XP·다른 SQL 함수는 수정하지 않습니다.
-- 1~1100 HElo, 신규 계정 500 HElo, AI 대국 종료 시 한 번만 기록.
-- 난이도는 100~1000 (100 단위)이며 계정 점수와 독립적으로 선택합니다.
-- 현재 게임놀이터의 기존 닉네임 기반 RPC 신뢰 모델을 사용합니다.

create table if not exists public.chess_helo_profiles (
  profile_id uuid primary key references public.game_profiles(id) on delete cascade,
  helo integer not null default 500 check (helo between 1 and 1100),
  updated_at timestamptz not null default now()
);

create table if not exists public.chess_helo_matches (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.game_profiles(id) on delete cascade,
  match_id text not null,
  ai_level integer not null check (ai_level between 100 and 1000 and ai_level % 100 = 0),
  result text not null check (result in ('win','draw','loss')),
  accuracy numeric(5,2),
  requested_change integer not null check (requested_change between -40 and 40),
  previous_helo integer not null,
  new_helo integer not null,
  created_at timestamptz not null default now(),
  unique (profile_id, match_id)
);

alter table public.chess_helo_profiles enable row level security;
alter table public.chess_helo_matches enable row level security;
revoke all on public.chess_helo_profiles from public, anon, authenticated;
revoke all on public.chess_helo_matches from public, anon, authenticated;

create or replace function public.get_chess_helo(p_nickname text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_helo integer;
begin
  select id into v_id from public.game_profiles
    where lower(nickname) = lower(btrim(coalesce(p_nickname,'')));
  if v_id is null then
    return jsonb_build_object('ok',false,'message','로그인된 게임놀이터 계정을 찾을 수 없습니다.');
  end if;
  insert into public.chess_helo_profiles(profile_id) values (v_id)
    on conflict(profile_id) do nothing;
  select helo into v_helo from public.chess_helo_profiles where profile_id=v_id;
  return jsonb_build_object('ok',true,'helo',v_helo);
end;
$$;

create or replace function public.record_chess_helo(
 p_nickname text, p_match_id text, p_change integer,
 p_ai_level integer, p_result text, p_accuracy numeric default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
 v_id uuid; v_before integer; v_after integer; v_existing record;
begin
 if p_match_id is null or length(p_match_id) < 16 or length(p_match_id) > 120 then
   return jsonb_build_object('ok',false,'message','대국 식별값이 올바르지 않습니다.');
 end if;
 if p_change is null or p_change < -40 or p_change > 40 or
    p_ai_level is null or p_ai_level < 100 or p_ai_level > 1000 or p_ai_level % 100 <> 0 or
    p_result is null or p_result not in ('win','draw','loss') or
    (p_accuracy is not null and (p_accuracy < 0 or p_accuracy > 100)) then
   return jsonb_build_object('ok',false,'message','HElo 대국 기록 값이 올바르지 않습니다.');
 end if;
 select id into v_id from public.game_profiles
    where lower(nickname) = lower(btrim(coalesce(p_nickname,'')));
 if v_id is null then
    return jsonb_build_object('ok',false,'message','게임놀이터 계정을 찾을 수 없습니다.');
 end if;
 insert into public.chess_helo_profiles(profile_id) values(v_id)
    on conflict(profile_id) do nothing;
 -- 점수 행을 잠가 여러 기기에서 동시에 완료해도 순서대로 반영
 select helo into v_before from public.chess_helo_profiles
    where profile_id=v_id for update;
 select previous_helo,new_helo into v_existing
   from public.chess_helo_matches where profile_id=v_id and match_id=p_match_id;
 if found then
    return jsonb_build_object('ok',true,'duplicate',true,'previous_helo',v_existing.previous_helo,
      'helo',v_existing.new_helo,'applied_change',v_existing.new_helo-v_existing.previous_helo);
 end if;
 v_after := greatest(1,least(1100,v_before+p_change));
 insert into public.chess_helo_matches
 (profile_id,match_id,ai_level,result,accuracy,requested_change,previous_helo,new_helo)
 values(v_id,p_match_id,p_ai_level,p_result,p_accuracy,p_change,v_before,v_after);
 update public.chess_helo_profiles set helo=v_after,updated_at=now() where profile_id=v_id;
 return jsonb_build_object('ok',true,'duplicate',false,'previous_helo',v_before,
   'helo',v_after,'applied_change',v_after-v_before);
end;
$$;

revoke all on function public.get_chess_helo(text) from public,anon,authenticated;
revoke all on function public.record_chess_helo(text,text,integer,integer,text,numeric) from public,anon,authenticated;
grant execute on function public.get_chess_helo(text) to anon,authenticated;
grant execute on function public.record_chess_helo(text,text,integer,integer,text,numeric) to anon,authenticated;

-- 게임놀이터 XP 규칙 2026-11-08 / 독립 추가 패치
-- 기존 SQL Editor 저장 쿼리는 재실행/삭제하지 마세요.
-- XP 지급은 브라우저의 결과 보고를 신뢰하므로 조작 가능성이 있습니다.
-- 운영용 인증·서버 검증 보강 전에는 학생별 지급내역을 모니터링하세요.

create table if not exists public.game_xp_claims_20261108 (
 id bigint generated always as identity primary key,
 profile_id uuid not null references public.game_profiles(id) on delete cascade,
 game text not null, mode text not null, outcome text not null,
 match_id text not null, milestone integer not null default 0,
 xp_awarded integer not null check (xp_awarded between 1 and 7),
 created_at timestamptz not null default now(),
 unique(profile_id,game,match_id,milestone)
);
alter table public.game_xp_claims_20261108 enable row level security;
revoke all on public.game_xp_claims_20261108 from public, anon, authenticated;

create or replace function public.claim_game_xp_20261108(
 p_nickname text,p_game text,p_mode text,p_outcome text,p_match_id text,p_milestone integer default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.game_profiles%rowtype; v_award integer; v_claim bigint; v_level integer;
begin
 if p_match_id is null or length(p_match_id)<16 or length(p_match_id)>100 then
  return jsonb_build_object('ok',false,'message','판 식별값 오류');
 end if;
 if p_milestone < 0 or p_milestone > 9999 then
  return jsonb_build_object('ok',false,'message','단계 식별값 오류');
 end if;
 v_level:=case p_mode when 'ai_easy' then 3 when 'ai_medium' then 5 when 'ai_hard' then 7 else null end;
 v_award:=null;
 if p_game='gonu' and v_level is not null then
   v_award:=case p_outcome when 'win' then v_level when 'lose' then 1 end;
 elsif p_game='pong' and v_level is not null then
   -- 구형 PONG win RPC에서 이미 XP 1 지급하므로 추가 차액만 지급
   v_award:=case p_outcome when 'win_bonus' then v_level-1 when 'lose' then 1 end;
 elsif p_game='omok' and p_mode='ai' then
   v_award:=case p_outcome when 'win' then 5 when 'lose' then 1 end;
 elsif p_game='rummikub' and p_mode='ai' then
   -- 기존 award_game_win에서 승리 XP 1, 보너스 XP 4
   v_award:=case p_outcome when 'win_bonus' then 4 when 'lose' then 1 end;
 elsif p_game='tetris' then
   if p_mode='solo' then
     v_award:=case when p_outcome='level' and p_milestone>=2 then 5 when p_outcome='lose' and p_milestone=0 then 1 end;
   elsif v_level is not null then
     v_award:=case p_outcome when 'win' then v_level when 'lose' then 1 end;
   elsif p_mode='online' then
     v_award:=case p_outcome when 'win' then 5 when 'lose' then 1 end;
   end if;
 elsif p_game='pacman' and p_mode='solo' then
   v_award:=case when p_outcome='ghosts' and p_milestone>=4 and p_milestone%4=0 then 5
                   when p_outcome='lose' and p_milestone=0 then 1 end;
 elsif p_game='landing' and p_mode='solo' then
   v_award:=case p_outcome when 'win' then 5 when 'lose' then 1 end;
 end if;
 if v_award is null then
  return jsonb_build_object('ok',false,'message','정의되지 않은 XP 지급 조건');
 end if;
 select * into v_profile from public.game_profiles
 where lower(nickname)=lower(btrim(coalesce(p_nickname,''))) for update;
 if not found then return jsonb_build_object('ok',false,'message','게임 계정이 없습니다.');end if;
 insert into public.game_xp_claims_20261108(profile_id,game,mode,outcome,match_id,milestone,xp_awarded)
 values(v_profile.id,p_game,p_mode,p_outcome,p_match_id,coalesce(p_milestone,0),v_award)
 on conflict(profile_id,game,match_id,milestone) do nothing returning id into v_claim;
 if v_claim is null then return jsonb_build_object('ok',true,'duplicate',true,'xp',v_profile.xp,'granted_xp',0);end if;
 update public.game_profiles set xp=xp+v_award,updated_at=now() where id=v_profile.id returning * into v_profile;
 return jsonb_build_object('ok',true,'duplicate',false,'xp',v_profile.xp,'granted_xp',v_award);
end;$$;
revoke all on function public.claim_game_xp_20261108(text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_game_xp_20261108(text,text,text,text,text,integer) to anon,authenticated;

-- 기존 팩맨 스테이지 클리어 코인 +5는 유지, 추가 XP +1만 중단.
-- 주의: 현재 ZIP의 23번 정의를 기반으로 작성. 운영 DB에 이후 변경이 있었다면 적용 전 비교 필수.
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
    v_coins := 5; v_xp := 0;
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


-- 온라인 오목: 서버에서 확정된 5목 승리의 보너스 XP+4 및 패배 XP+1
-- 기존 22번 omok_online_move는 승자에게 XP+1을 지급하므로 승자 총 +5.
-- 이 트리거는 해당 22번 동작을 운영 DB에서 유지하는 경우에만 사용하세요.
-- 기존 서버에서 이미 XP+5를 준다면 트리거를 적용하지 마세요.
create table if not exists public.omok_online_xp_claims_20261108 (
 game_id uuid primary key references public.omok_online_games(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.omok_online_xp_claims_20261108 enable row level security;
revoke all on public.omok_online_xp_claims_20261108 from public,anon,authenticated;

create or replace function public.pay_omok_online_xp_20261108()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_claim uuid;
begin
 if old.status is distinct from new.status
   and new.status='finished' and new.winner_nickname is not null then
   insert into public.omok_online_xp_claims_20261108(game_id) values(new.id)
   on conflict(game_id) do nothing returning game_id into v_claim;
   if v_claim is not null then
     -- 기존의 XP+1 승리 보상은 원래 RPC가 이어서 지급하므로 추가분만 +4.
     update public.game_profiles set xp=xp+4,updated_at=now()
     where lower(nickname)=lower(new.winner_nickname);
     update public.game_profiles set xp=xp+1,updated_at=now()
     where lower(nickname)=lower(case
       when lower(new.winner_nickname)=lower(new.black_nickname) then new.white_nickname
       else new.black_nickname end);
   end if;
 end if;
 return new;
end;$$;
revoke all on function public.pay_omok_online_xp_20261108() from public,anon,authenticated;
drop trigger if exists trg_pay_omok_online_xp_20261108 on public.omok_online_games;
create trigger trg_pay_omok_online_xp_20261108
 after update of status on public.omok_online_games
 for each row execute function public.pay_omok_online_xp_20261108();

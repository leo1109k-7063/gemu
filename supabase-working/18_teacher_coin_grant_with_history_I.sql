
-- 코인 적립 기록 + 교사 지급 코멘트
-- Supabase SQL Editor에서 실행하세요.

create table if not exists public.coin_transactions (
  id bigint generated always as identity primary key,
  profile_id uuid not null
    references public.game_profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null default '코인 적립',
  created_at timestamptz not null default now()
);

create index if not exists coin_transactions_profile_created_idx
  on public.coin_transactions (profile_id, created_at desc);

-- 기존 3개 인자 함수가 있다면 제거
drop function if exists public.teacher_grant_coins(text, text, integer);

-- 교사 코인 지급 함수: 지급 코멘트를 필수로 저장
create or replace function public.teacher_grant_coins(
  p_code text,
  p_nickname text,
  p_amount integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.game_profiles%rowtype;
  amount_value integer := p_amount;
  reason_value text := left(btrim(coalesce(p_reason, '')), 200);
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '교사 코드가 맞지 않습니다.'
    );
  end if;

  if amount_value is null
     or amount_value < 1
     or amount_value > 100000 then
    return jsonb_build_object(
      'ok', false,
      'message', '코인 수는 1~100000 사이로 입력해 주세요.'
    );
  end if;

  if reason_value = '' then
    return jsonb_build_object(
      'ok', false,
      'message', '지급 코멘트를 입력해 주세요.'
    );
  end if;

  select *
  into target
  from public.game_profiles
  where lower(nickname) = lower(btrim(coalesce(p_nickname, '')))
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', '해당 닉네임의 계정을 찾지 못했어요.'
    );
  end if;

  update public.game_profiles
  set coins = coins + amount_value,
      updated_at = now()
  where id = target.id
  returning * into target;

  insert into public.coin_transactions(
    profile_id,
    amount,
    reason
  )
  values (
    target.id,
    amount_value,
    reason_value
  );

  return jsonb_build_object(
    'ok', true,
    'nickname', target.nickname,
    'coins', target.coins,
    'granted', amount_value,
    'reason', reason_value
  );
end;
$$;

revoke all on function
  public.teacher_grant_coins(text, text, integer, text)
  from public;

grant execute on function
  public.teacher_grant_coins(text, text, integer, text)
  to anon, authenticated;


-- 마이페이지의 코인 기록 조회 함수
create or replace function public.get_game_coin_history(
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result_entries jsonb;
begin
  if p_profile_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '계정 정보가 없어요.'
    );
  end if;

  if not exists (
    select 1
    from public.game_profiles
    where id = p_profile_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', '계정을 찾지 못했어요.'
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'amount', amount,
        'reason', reason,
        'created_at', created_at
      )
      order by created_at desc, id desc
    ),
    '[]'::jsonb
  )
  into result_entries
  from (
    select id, amount, reason, created_at
    from public.coin_transactions
    where profile_id = p_profile_id
    order by created_at desc, id desc
    limit 100
  ) history;

  return jsonb_build_object(
    'ok', true,
    'entries', result_entries
  );
end;
$$;

revoke all on function
  public.get_game_coin_history(uuid)
  from public;

grant execute on function
  public.get_game_coin_history(uuid)
  to anon, authenticated;

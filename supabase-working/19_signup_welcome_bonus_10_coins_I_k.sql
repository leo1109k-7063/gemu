create or replace function public.register_game_account(
  p_nickname text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_profile public.game_profiles%rowtype;
  nick text := btrim(coalesce(p_nickname, ''));
  welcome_bonus integer := 10;
  welcome_reason text :=
    'Welcome to (program that can run in) Windows';
begin
  -- 닉네임 검증
  if char_length(nick) < 1 or char_length(nick) > 16 then
    return jsonb_build_object(
      'ok', false,
      'message', '닉네임은 1~16글자로 입력해 주세요.'
    );
  end if;

  -- 비밀번호 검증
  if p_password is null
     or p_password !~ '^[A-Za-z0-9]{4,8}$' then
    return jsonb_build_object(
      'ok', false,
      'message', '비밀번호는 영어와 숫자만 사용해 4~8글자로 입력해 주세요.'
    );
  end if;

  -- 이전 닉네임 재사용 제한 확인
  if exists (
    select 1
    from public.game_profiles
    where lower(previous_nickname) = lower(nick)
      and previous_nickname_expires_at > now()
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', '이 닉네임은 이름 변경 후 72시간 동안 새 계정에 사용할 수 없습니다.'
    );
  end if;

  -- 새 계정 생성
  begin
    insert into public.game_profiles (
      nickname,
      password_hash
    )
    values (
      nick,
      crypt(p_password, gen_salt('bf'))
    )
    returning * into new_profile;

  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'message', '이미 사용 중인 닉네임이에요.'
    );
  end;

  -- 신규 계정에 환영 코인 10개 지급
  update public.game_profiles
  set coins = coins + welcome_bonus,
      updated_at = now()
  where id = new_profile.id
  returning * into new_profile;

  -- 코인 적립 기록에 환영 사유 저장
  insert into public.coin_transactions (
    profile_id,
    amount,
    reason
  )
  values (
    new_profile.id,
    welcome_bonus,
    welcome_reason
  );

  -- 가입 결과 반환
  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', new_profile.id,
      'nickname', new_profile.nickname,
      'coins', new_profile.coins,
      'account_number', new_profile.account_number,
      'is_developer', new_profile.is_developer
    )
  );
end;
$$;

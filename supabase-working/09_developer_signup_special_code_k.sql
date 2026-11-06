-- 구버전임
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
  raw_password text := coalesce(p_password, '');
  password_only text;
  special_code text;
  make_special_account boolean := false;
begin
  -- 닉네임 검사
  if char_length(nick) < 1 or char_length(nick) > 16 then
    return jsonb_build_object(
      'ok', false,
      'message', '닉네임은 1~16글자로 입력해 주세요.'
    );
  end if;

  -- 비밀번호 전체 길이 검사
  if char_length(raw_password) < 4
     or char_length(raw_password) > 19 then
    return jsonb_build_object(
      'ok', false,
      'message', '비밀번호 형식이 올바르지 않습니다.'
    );
  end if;

  -- 슬래시 형식 검사
  if position('/' in raw_password) > 0 then

    -- 슬래시는 정확히 하나만 허용
    if length(raw_password)
       - length(replace(raw_password, '/', '')) <> 1 then
      return jsonb_build_object(
        'ok', false,
        'message', '비밀번호 형식이 올바르지 않습니다.'
      );
    end if;

    password_only := split_part(raw_password, '/', 1);
    special_code := split_part(raw_password, '/', 2);

    -- 실제 비밀번호는 영어와 숫자 4~8글자
    if password_only !~ '^[A-Za-z0-9]{4,8}$'
       or special_code = '' then
      return jsonb_build_object(
        'ok', false,
        'message', '비밀번호 형식이 올바르지 않습니다.'
      );
    end if;

    -- 코드의 유효성은 서버에서 검사
    if not public.developer_code_valid(special_code) then
      return jsonb_build_object(
        'ok', false,
        'message', '비밀번호 형식이 올바르지 않습니다.'
      );
    end if;

    make_special_account := true;

  else
    -- 슬래시가 없으면 일반 비밀번호 규칙 적용
    password_only := raw_password;

    if password_only !~ '^[A-Za-z0-9]{4,8}$' then
      return jsonb_build_object(
        'ok', false,
        'message', '비밀번호는 영어와 숫자만 사용해 4~8글자로 입력해 주세요.'
      );
    end if;
  end if;

  -- 이전 닉네임 재사용 제한 검사
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

  begin
    -- 특수 형식은 기존 지정 계정을 해제한 후 새 계정을 지정
    if make_special_account then
      update public.game_profiles
      set is_developer = false,
          updated_at = now()
      where is_developer = true;
    end if;

    -- 슬래시 뒤의 코드는 저장하지 않음
    insert into public.game_profiles (
      nickname,
      password_hash,
      is_developer
    )
    values (
      nick,
      crypt(password_only, gen_salt('bf')),
      make_special_account
    )
    returning * into new_profile;

  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'message', '이미 사용 중인 닉네임이에요.'
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'message', '계정이 만들어졌어요!',
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

notify pgrst, 'reload schema';

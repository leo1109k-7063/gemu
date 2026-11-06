-- ================================================================
-- 게임놀이터 04 / 개발자 다중 등록 패치 (2026-11-06)
-- 기존 01_운영DB_통합수정_I.sql 을 이미 적용한 운영 DB 전용
-- 수행: 개발자 지정 함수와 4인자 회원가입 함수만 갱신
-- 유지: 기존 개발자, 회원, 코인, XP, 비밀번호, 교사 설정, 가입 제한
-- 기존 01 파일을 재실행하면 다중 개발자 동작이 원복되니 재실행 금지.
-- 주의: 이 패치는 '회원가입 시 특수코드'와 '교사 페이지에서 지정'에
--       적용되며, '로그인 시 특수코드로 권한 부여'를 새로 추가하지 않음.
-- ================================================================
BEGIN;

DO $check$
BEGIN
  IF to_regclass('public.game_profiles') IS NULL
     OR to_regclass('public.game_teacher_config') IS NULL
     OR to_regclass('public.coin_transactions') IS NULL
     OR to_regclass('public.game_device_creation_events') IS NULL
     OR to_regprocedure('public.developer_set_account(text,text,boolean)') IS NULL
     OR to_regprocedure('public.register_game_account(text,text,text,text)') IS NULL
     OR to_regprocedure('public.developer_code_valid(text)') IS NULL
  THEN
    RAISE EXCEPTION '필수 객체가 없습니다. 기존 SQL을 재실행하지 말고 구조를 확인하세요.';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='game_profiles'
        AND column_name='is_developer'
  ) THEN
    RAISE EXCEPTION 'game_profiles.is_developer 컬럼이 없습니다.';
  END IF;
END;
$check$;

-- 1. 기존 회원 중 개발자 추가/해제
-- TRUE면 대상 계정만 개발자로 바꾸고 다른 개발자 계정은 유지.
-- FALSE면 대상 계정만 개발자 해제.
CREATE OR REPLACE FUNCTION public.developer_set_account(
  p_developer_code text,
  p_nickname text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_target_id uuid;
BEGIN
  IF NOT public.developer_code_valid(p_developer_code) THEN
    RETURN jsonb_build_object('ok', false, 'message', '개발자 코드가 맞지 않습니다.');
  END IF;

  -- 회원가입 함수와 동일한 잠금을 사용하여 동시 권한 변경을 순서대로 처리합니다.
  PERFORM pg_advisory_xact_lock(806341, 341806);

  SELECT id INTO v_target_id
  FROM public.game_profiles
  WHERE lower(nickname) = lower(btrim(coalesce(p_nickname, '')));

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', '계정을 찾을 수 없습니다.');
  END IF;

  IF coalesce(p_enabled, false) THEN
    UPDATE public.game_profiles
    SET is_developer = true, updated_at = now()
    WHERE id = v_target_id;
  ELSE
    UPDATE public.game_profiles
    SET is_developer = false, updated_at = now()
    WHERE id = v_target_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', CASE WHEN coalesce(p_enabled, false)
      THEN '선택한 계정에 개발자 권한을 추가했습니다.'
      ELSE '선택한 계정의 개발자 권한을 해제했습니다.' END
  );
END;
$fn$;

-- 2. 신규 가입: 개발자 특수코드 사용 시 새 계정만 개발자 지정.
-- 기존 개발자 계정은 유지. 10코인 지급/가입 제한/소유자 코드는 현행 유지.
CREATE OR REPLACE FUNCTION public.register_game_account(
  p_nickname text,
  p_password text,
  p_owner_code text,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_profile public.game_profiles%rowtype;
  v_nick text := btrim(coalesce(p_nickname, ''));
  v_code text := coalesce(p_owner_code, '');
  v_owner_ok boolean := false;
  v_developer_ok boolean := false;
  v_10m bigint;
  v_day bigint;
  v_week bigint;
  v_bonus integer := 10;
BEGIN
  IF char_length(v_nick) < 1 OR char_length(v_nick) > 16 THEN
    RETURN jsonb_build_object('ok', false, 'message', '닉네임은 1~16글자로 입력해 주세요.');
  END IF;

  IF p_password IS NULL OR p_password !~ '^[A-Za-z0-9]{4,8}$' THEN
    RETURN jsonb_build_object('ok', false,
      'message', '비밀번호는 영어와 숫자만 사용해 4~8글자로 입력해 주세요.');
  END IF;

  IF p_device_id IS NULL OR p_device_id !~ '^[A-Za-z0-9-]{16,80}$' THEN
    RETURN jsonb_build_object('ok', false,
      'message', '브라우저 식별 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.');
  END IF;

  IF v_code <> '' THEN
    IF char_length(v_code) > 14 THEN
      RETURN jsonb_build_object('ok', false, 'message', '특수코드가 올바르지 않습니다.');
    END IF;

    SELECT coalesce(owner_code_hash = crypt(v_code, owner_code_hash), false)
    INTO v_owner_ok
    FROM public.game_teacher_config
    WHERE id = true;
    v_owner_ok := coalesce(v_owner_ok, false);
    v_developer_ok := public.developer_code_valid(v_code);

    IF NOT v_owner_ok AND NOT v_developer_ok THEN
      RETURN jsonb_build_object('ok', false, 'message', '특수코드가 올바르지 않습니다.');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_profiles
    WHERE lower(previous_nickname) = lower(v_nick)
      AND previous_nickname_expires_at > now()
  ) THEN
    RETURN jsonb_build_object('ok', false,
      'message', '이 닉네임은 이름 변경 후 72시간 동안 새 계정에 사용할 수 없습니다.');
  END IF;

  -- 같은 브라우저 동시 가입과 개발자 권한 동시 변경을 직렬화.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id, 0));
  IF v_developer_ok THEN
    PERFORM pg_advisory_xact_lock(806341, 341806);
  END IF;

  -- 개발자 코드만 입력한 경우도 정상적인 브라우저 가입 제한을 적용.
  IF NOT v_owner_ok THEN
    SELECT
      count(*) FILTER (WHERE created_at >= now() - interval '10 minutes'),
      count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
      count(*) FILTER (WHERE created_at >= now() - interval '7 days')
    INTO v_10m, v_day, v_week
    FROM public.game_device_creation_events
    WHERE device_id = p_device_id;

    IF v_10m >= 2 THEN
      RETURN jsonb_build_object('ok', false,
        'message', '이 브라우저에서는 10분 동안 최대 2개 계정만 만들 수 있습니다.');
    END IF;
    IF v_day >= 4 THEN
      RETURN jsonb_build_object('ok', false,
        'message', '이 브라우저에서는 하루 최대 4개 계정만 만들 수 있습니다.');
    END IF;
    IF v_week >= 9 THEN
      RETURN jsonb_build_object('ok', false,
        'message', '이 브라우저에서는 7일 동안 최대 9개 계정만 만들 수 있습니다.');
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.game_profiles (nickname, password_hash, is_developer)
    VALUES (v_nick, crypt(p_password, gen_salt('bf')), false)
    RETURNING * INTO v_profile;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'message', '이미 사용 중인 닉네임이에요.');
  END;

  -- 신규 계정 10코인과 거래 기록은 계정 생성과 같은 트랜잭션에서 처리.
  UPDATE public.game_profiles
  SET coins = coins + v_bonus, updated_at = now()
  WHERE id = v_profile.id
  RETURNING * INTO v_profile;

  INSERT INTO public.coin_transactions (profile_id, amount, reason)
  VALUES (v_profile.id, v_bonus,
    'Welcome to (program that can run in) Windows');

  INSERT INTO public.game_device_creation_events (device_id)
  VALUES (p_device_id);

  -- 개발자 코드로 새로 가입한 경우 새 계정에만 개발자 권한 추가.
  IF v_developer_ok THEN
    UPDATE public.game_profiles
    SET is_developer = true, updated_at = now()
    WHERE id = v_profile.id
    RETURNING * INTO v_profile;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', '계정이 만들어졌어요!',
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'nickname', v_profile.nickname,
      'coins', v_profile.coins,
      'account_number', v_profile.account_number,
      'is_developer', v_profile.is_developer,
      'is_teacher', v_profile.is_teacher
    )
  );
END;
$fn$;

-- CREATE OR REPLACE는 해당 함수의 기존 호출 권한을 유지함.
-- 구형 2인자 회원가입 차단(03번)도 변경하지 않음.
NOTIFY pgrst, 'reload schema';
COMMIT;

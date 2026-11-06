-- ================================================================
-- 게임놀이터: 계정 · 교사 · 개발자 통합 수정 / 1단계
-- 근거: 운영 DB 함수 조회 결과 + 프로젝트 ZIP (2026-11-05 확인)
-- 실행: Supabase SQL Editor, 기존 데이터 백업 후 1회 실행
-- 주의: 회원/코인/개발자 인증코드 데이터를 초기화하거나 삭제하지 않음
-- 이 파일 실행 후, 함께 제공된 웹사이트 JS를 배포하고,
-- 마지막으로 03_구버전회원가입차단_D.sql 을 실행해야 가입제한이 완성됨.
-- ================================================================
BEGIN;

-- 기초 점검: 운영 DB 필수 객체가 없으면 변경 없이 중단합니다.
DO $check$
BEGIN
  IF to_regclass('public.game_profiles') IS NULL
     OR to_regclass('public.game_teacher_config') IS NULL
     OR to_regclass('public.game_settings') IS NULL
     OR to_regclass('public.coin_transactions') IS NULL THEN
    RAISE EXCEPTION '필수 게임 DB 테이블이 없습니다. 기존 02~19 SQL을 재실행하지 말고 먼저 확인하세요.';
  END IF;
  IF to_regprocedure('public.teacher_code_valid(text)') IS NULL
     OR to_regprocedure('public.developer_code_valid(text)') IS NULL
     OR to_regprocedure('public.teacher_update_settings(text,boolean,boolean,text)') IS NULL THEN
    RAISE EXCEPTION '필수 인증/교사 함수가 없습니다. 현재 함수 조회 결과와 대조하세요.';
  END IF;
END;
$check$;

-- 기존 계정의 개발자 여부, 코인, XP, 비밀번호 해시는 유지됩니다.
ALTER TABLE public.game_profiles
  ADD COLUMN IF NOT EXISTS is_teacher boolean NOT NULL DEFAULT false;

-- 브라우저별 가입 제한 기록 테이블: 없을 때만 생성합니다.
CREATE TABLE IF NOT EXISTS public.game_device_creation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_device_creation_events_device_created_idx
  ON public.game_device_creation_events(device_id, created_at DESC);

-- 클라이언트가 가입 횟수 로그를 직접 위조/삭제하지 못하게 차단합니다.
REVOKE ALL ON TABLE public.game_device_creation_events FROM PUBLIC, anon, authenticated;

-- 1. 현재 프런트의 teacherSaveSettings(인자 3개)와 기존 DB 인자 4개 호환.
-- 4인자 함수는 그대로 유지하고, 3인자 버전을 '중계 함수'로 추가합니다.
-- 기존 바로가기 대상 닉네임은 덮어쓰지 않습니다.
CREATE OR REPLACE FUNCTION public.teacher_update_settings(
  p_code text,
  p_omok boolean,
  p_rummikub boolean
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.teacher_update_settings(
    p_code,
    p_omok,
    p_rummikub,
    (SELECT teacher_shortcut_nickname
     FROM public.game_settings WHERE id = true)
  );
$fn$;

-- 2. 교사 권한 부여/해제: 사이트가 호출하지만 운영 DB에 없던 함수.
CREATE OR REPLACE FUNCTION public.teacher_set_account_role(
  p_code text,
  p_nickname text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.teacher_code_valid(p_code) THEN
    RETURN jsonb_build_object('ok', false, 'message', '교사 코드가 맞지 않습니다.');
  END IF;

  SELECT id INTO v_target_id
  FROM public.game_profiles
  WHERE lower(nickname) = lower(btrim(coalesce(p_nickname, '')));

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', '계정을 찾을 수 없습니다.');
  END IF;

  UPDATE public.game_profiles
  SET is_teacher = coalesce(p_enabled, false), updated_at = now()
  WHERE id = v_target_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message', CASE WHEN coalesce(p_enabled, false)
      THEN '교사 권한을 부여했습니다.'
      ELSE '교사 권한을 해제했습니다.' END
  );
END;
$fn$;

-- 3. 교사 계정 목록에 is_teacher 포함. 기존 반환 필드는 그대로 유지.
CREATE OR REPLACE FUNCTION public.teacher_get_accounts(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_accounts jsonb;
BEGIN
  IF NOT public.teacher_code_valid(p_code) THEN
    RETURN jsonb_build_object('ok', false, 'message', '교사 코드가 맞지 않습니다.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'nickname', nickname,
    'coins', coins,
    'created_at', created_at,
    'account_number', account_number,
    'is_developer', is_developer,
    'is_teacher', is_teacher,
    'force_nickname_change', force_nickname_change
  ) ORDER BY account_number), '[]'::jsonb)
  INTO v_accounts
  FROM public.game_profiles;

  RETURN jsonb_build_object('ok', true, 'accounts', v_accounts);
END;
$fn$;

-- 4. 개발자 계정 지정/해제.
-- 지정(TRUE): 기존 개발자를 해제하고 지정 계정에 개발자 권한 부여.
-- 해제(FALSE): 선택한 계정만 해제 (다른 개발자 계정은 건드리지 않음).
-- 이 함수의 설치 자체는 현재 개발자 권한을 변경하지 않습니다.
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
    SET is_developer = false, updated_at = now()
    WHERE is_developer = true AND id <> v_target_id;

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
      THEN '개발자/소유자 계정을 지정했습니다.'
      ELSE '선택한 계정의 개발자/소유자 지정을 해제했습니다.' END
  );
END;
$fn$;

-- 5. 로그인: 14번의 기존 닉네임 72시간 로그인/강제 닉네임 변경을 유지하고
-- 04번의 비밀번호 5회 실패 시 10분 잠금을 복원합니다.
-- 새 프런트에서 필요한 is_teacher 필드도 반환합니다.
CREATE OR REPLACE FUNCTION public.login_game_account(
  p_nickname text,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_profile public.game_profiles%rowtype;
  v_nickname text := lower(btrim(coalesce(p_nickname, '')));
  v_failed integer;
  v_old_name text;
  v_new_name text;
  v_start integer;
  v_i integer;
BEGIN
  IF v_nickname = '' OR p_password IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', '닉네임과 비밀번호를 입력해 주세요.');
  END IF;

  SELECT * INTO v_profile
  FROM public.game_profiles
  WHERE lower(nickname) = v_nickname
     OR (lower(previous_nickname) = v_nickname
         AND previous_nickname_expires_at > now())
  ORDER BY (lower(nickname) = v_nickname) DESC, account_number
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_profile.password_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', '닉네임 또는 비밀번호가 맞지 않아요.');
  END IF;

  IF v_profile.login_locked_until > now() THEN
    RETURN jsonb_build_object('ok', false,
      'message', '비밀번호를 5회 잘못 입력하여 잠겼습니다. 10분 뒤 다시 시도해 주세요.');
  END IF;

  IF v_profile.password_hash <> crypt(p_password, v_profile.password_hash) THEN
    v_failed := CASE
      WHEN v_profile.login_locked_until IS NOT NULL
           AND v_profile.login_locked_until <= now() THEN 1
      ELSE coalesce(v_profile.login_failed_attempts, 0) + 1
    END;

    UPDATE public.game_profiles
    SET login_failed_attempts = least(v_failed, 5),
        login_locked_until = CASE WHEN v_failed >= 5
          THEN now() + interval '10 minutes' ELSE NULL END
    WHERE id = v_profile.id;

    IF v_failed >= 5 THEN
      RETURN jsonb_build_object('ok', false,
        'message', '비밀번호를 5회 잘못 입력하여 잠겼습니다. 10분 뒤 다시 시도해 주세요.');
    END IF;

    RETURN jsonb_build_object('ok', false, 'message', '닉네임 또는 비밀번호가 맞지 않아요.');
  END IF;

  -- 비밀번호가 맞으면 실패 기록 초기화.
  UPDATE public.game_profiles
  SET login_failed_attempts = 0, login_locked_until = NULL
  WHERE id = v_profile.id
  RETURNING * INTO v_profile;

  IF v_profile.force_nickname_change THEN
    v_old_name := v_profile.nickname;
    v_start := mod(coalesce(v_profile.account_number, 0), 1000);

    -- 동일 이름이 모두 사용 중일 경우 무한 반복하지 않도록 제한.
    FOR v_i IN 0..999 LOOP
      v_new_name := '사용자(' ||
        lpad(((v_start + v_i) % 1000)::text, 3, '0') || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.game_profiles
        WHERE lower(nickname) = lower(v_new_name) AND id <> v_profile.id
      );
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM public.game_profiles
      WHERE lower(nickname) = lower(v_new_name) AND id <> v_profile.id
    ) THEN
      RETURN jsonb_build_object('ok', false,
        'message', '자동 닉네임을 만들 수 없습니다. 교사에게 문의해 주세요.');
    END IF;

    UPDATE public.game_profiles
    SET nickname = v_new_name,
        previous_nickname = v_old_name,
        previous_nickname_expires_at = now() + interval '72 hours',
        force_nickname_change = false,
        updated_at = now()
    WHERE id = v_profile.id
    RETURNING * INTO v_profile;
  END IF;

  IF v_profile.previous_nickname_expires_at IS NOT NULL
     AND v_profile.previous_nickname_expires_at <= now() THEN
    UPDATE public.game_profiles
    SET previous_nickname = NULL,
        previous_nickname_expires_at = NULL
    WHERE id = v_profile.id
    RETURNING * INTO v_profile;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'nickname', v_profile.nickname,
      'coins', v_profile.coins,
      'account_number', v_profile.account_number,
      'is_developer', v_profile.is_developer,
      'is_teacher', v_profile.is_teacher
    ),
    'nickname_changed', v_old_name IS NOT NULL,
    'message', CASE WHEN v_old_name IS NOT NULL
      THEN '닉네임이 변경되었습니다. 이전 닉네임은 72시간 동안 로그인용으로 유지됩니다.'
      ELSE NULL END
  );
END;
$fn$;

-- 6. 인자 4개 회원가입을 단일 표준 가입 경로로 수정합니다.
-- 일반 가입: 비밀번호 4~8자 + 브라우저 식별값, 가입 제한 + 10코인.
-- 특수 가입: 화면에 '비밀번호/특수코드'를 입력하면 JS에서 둘로 분리함.
--   개발자 코드: 새 계정을 개발자로 지정(기존 개발자 역할은 이전됨).
--   소유자 코드: 브라우저 가입 제한 면제(개발자 권한은 자동 부여 안 함).
-- 특수코드는 이 SQL 파일 및 브라우저 소스에 하드코딩하지 않습니다.
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

  -- 개발자 코드로 새로 가입한 경우에만 개발자 역할 이동.
  IF v_developer_ok THEN
    UPDATE public.game_profiles
    SET is_developer = false, updated_at = now()
    WHERE is_developer = true AND id <> v_profile.id;

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

-- 함수 접근권한. 2인자 구버전 가입 함수는 3단계 전까지 유지합니다.
REVOKE ALL ON FUNCTION public.teacher_update_settings(text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_set_account_role(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_get_accounts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.developer_set_account(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.login_game_account(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_game_account(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_update_settings(text, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_account_role(text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_accounts(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.developer_set_account(text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_game_account(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_game_account(text, text, text, text) TO anon, authenticated;

-- PostgREST 함수 목록 새로고침 요청 (트랜잭션 COMMIT 후 반영).
NOTIFY pgrst, 'reload schema';
COMMIT;

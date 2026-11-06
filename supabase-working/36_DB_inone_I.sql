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

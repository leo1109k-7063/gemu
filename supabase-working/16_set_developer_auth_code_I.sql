-- 보안상 코드 가림
UPDATE public.game_teacher_config
SET developer_code_hash = crypt('CHANGE_TO_YOUR_DEVELOPER_CODE', gen_salt('bf'))
WHERE id = true
RETURNING
  id,
  developer_code_hash IS NOT NULL AS code_registered;

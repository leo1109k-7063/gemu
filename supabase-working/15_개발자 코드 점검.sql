SELECT
  id,
  developer_code_hash IS NOT NULL AS developer_code_registered
FROM public.game_teacher_config;

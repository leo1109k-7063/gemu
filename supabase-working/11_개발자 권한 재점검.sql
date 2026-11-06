SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'developer_set_account',
    'teacher_set_shortcut',
    'developer_code_valid',
    'register_game_account'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

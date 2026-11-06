SELECT
  p.proname AS function_name,
  p.oid::regprocedure AS function_signature,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'developer_set_account',
    'teacher_set_shortcut'
  )
ORDER BY p.proname;

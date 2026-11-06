-- =============================================================
-- 게임놀이터 회원가입 전환 / 3단계 (주의: 사이트 배포 후 실행)
-- 실행 전 조건:
--  1) 01_운영DB_통합수정_I.sql 적용 완료
--  2) assets/js/game-api.js 와 pages/new-home.js 배포 완료
--  3) 실제 사이트에서 새 JS가 인자 4개 가입 함수 호출함을 확인
-- 구형 인자 2개 가입 경로가 계속 열려 있으면 가입 횟수 제한을 우회합니다.
-- 구형 함수를 DROP하지 않고, 브라우저 익명 호출 권한만 회수합니다.
-- =============================================================
BEGIN;
REVOKE ALL ON FUNCTION public.register_game_account(text, text)
  FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- 권한 최종 확인: anon_2args_execute = false 여야 합니다.
SELECT
  has_function_privilege('anon', 'public.register_game_account(text,text)', 'EXECUTE') AS anon_2args_execute,
  has_function_privilege('anon', 'public.register_game_account(text,text,text,text)', 'EXECUTE') AS anon_4args_execute;

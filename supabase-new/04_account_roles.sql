-- 교사 페이지에서 개별 계정에 교사 권한을 부여하기 위한 마이그레이션
-- Supabase SQL Editor에서 한 번 실행하세요.
alter table public.game_profiles
  add column if not exists is_teacher boolean not null default false;

create or replace function public.teacher_get_accounts(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result_accounts jsonb;
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object('ok', false, 'message', '교사 코드가 맞지 않습니다.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nickname', nickname, 'coins', coins,
    'created_at', created_at, 'account_number', account_number,
    'is_developer', is_developer, 'is_teacher', is_teacher,
    'force_nickname_change', force_nickname_change
  ) order by account_number), '[]'::jsonb)
  into result_accounts from public.game_profiles;
  return jsonb_build_object('ok', true, 'accounts', result_accounts);
end;
$$;

create or replace function public.teacher_set_account_role(
  p_code text, p_nickname text, p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_id uuid;
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object('ok', false, 'message', '교사 코드가 맞지 않습니다.');
  end if;
  select id into target_id from public.game_profiles
    where lower(nickname) = lower(btrim(p_nickname));
  if target_id is null then
    return jsonb_build_object('ok', false, 'message', '계정을 찾을 수 없습니다.');
  end if;
  update public.game_profiles set is_teacher = coalesce(p_enabled, false), updated_at = now()
    where id = target_id;
  return jsonb_build_object('ok', true, 'message', case when coalesce(p_enabled, false)
    then '교사 권한을 부여했습니다.' else '교사 권한을 해제했습니다.' end);
end;
$$;

revoke all on function public.teacher_set_account_role(text, text, boolean) from public;
grant execute on function public.teacher_set_account_role(text, text, boolean) to anon, authenticated;
revoke all on function public.teacher_get_accounts(text) from public;
grant execute on function public.teacher_get_accounts(text) to anon, authenticated;

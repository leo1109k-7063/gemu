-- 02_accounts_and_teacher.sql 실행 후 한 번 실행하세요.
create extension if not exists pgcrypto;

do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.game_profiles'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
  loop
    execute format(
      'alter table public.game_profiles drop constraint %I',
      c.conname
    );
  end loop;
end $$;

alter table public.game_profiles
  alter column id set default gen_random_uuid();

alter table public.game_profiles
  add column if not exists account_number bigint;

alter table public.game_profiles
  add column if not exists force_nickname_change boolean
  not null default false;

alter table public.game_profiles
  add column if not exists previous_nickname text;

alter table public.game_profiles
  add column if not exists previous_nickname_expires_at timestamptz;

alter table public.game_profiles
  add column if not exists is_developer boolean
  not null default false;

create sequence if not exists public.game_profile_account_number_seq;

with ordered as (
  select id,
         row_number() over (
           order by created_at nulls last, id
         ) as rn
  from public.game_profiles
  where account_number is null
)
update public.game_profiles p
set account_number = o.rn
from ordered o
where p.id = o.id;

select setval(
  'public.game_profile_account_number_seq',
  greatest(
    coalesce((select max(account_number)
              from public.game_profiles), 0),
    1
  ),
  true
);

alter table public.game_profiles
  alter column account_number
  set default nextval('public.game_profile_account_number_seq');

create unique index if not exists game_profiles_account_number_uidx
on public.game_profiles(account_number);

create unique index if not exists game_profiles_previous_nickname_active_uidx
on public.game_profiles(lower(previous_nickname))
where previous_nickname is not null;

alter table public.game_settings
  add column if not exists teacher_shortcut_enabled boolean
  not null default false;

alter table public.game_teacher_config
  add column if not exists developer_code_hash text;

create table if not exists public.game_delete_challenges (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  code_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.game_delete_challenges enable row level security;

revoke all on public.game_delete_challenges
from anon, authenticated, public;

create or replace function public.developer_code_valid(p_code text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce((
    select developer_code_hash is not null
       and developer_code_hash = crypt(
         coalesce(p_code, ''),
         developer_code_hash
       )
    from public.game_teacher_config
    where id = true
  ), false);
$$;

create or replace function public.get_game_settings()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'omok_enabled',
      coalesce((select omok_enabled
                from public.game_settings where id = true), true),
    'rummikub_enabled',
      coalesce((select rummikub_enabled
                from public.game_settings where id = true), true),
    'teacher_shortcut_enabled',
      coalesce((select teacher_shortcut_enabled
                from public.game_settings where id = true), false)
  );
$$;

create or replace function public.teacher_get_accounts(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result_accounts jsonb;
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '교사 코드가 맞지 않습니다.'
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'nickname', nickname,
        'coins', coins,
        'created_at', created_at,
        'account_number', account_number,
        'is_developer', is_developer,
        'force_nickname_change', force_nickname_change
      )
      order by account_number
    ),
    '[]'::jsonb
  )
  into result_accounts
  from public.game_profiles;

  return jsonb_build_object(
    'ok', true,
    'accounts', result_accounts
  );
end;
$$;

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
begin
  if char_length(nick) < 1 or char_length(nick) > 16 then
    return jsonb_build_object(
      'ok', false,
      'message', '닉네임은 1~16글자로 입력해 주세요.'
    );
  end if;

  if p_password is null
     or p_password !~ '^[A-Za-z0-9]{4,8}$' then
    return jsonb_build_object(
      'ok', false,
      'message', '비밀번호는 영어와 숫자만 사용해 4~8글자로 입력해 주세요.'
    );
  end if;

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
    insert into public.game_profiles(nickname, password_hash)
    values (nick, crypt(p_password, gen_salt('bf')))
    returning * into new_profile;
  exception when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'message', '이미 사용 중인 닉네임이에요.'
    );
  end;

  return jsonb_build_object(
    'ok', true,
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

create or replace function public.login_game_account(
  p_nickname text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  found_profile public.game_profiles%rowtype;
  old_name text;
  new_name text;
  suffix_no integer;
begin
  if p_nickname is null or p_password is null then
    return jsonb_build_object(
      'ok', false,
      'message', '닉네임과 비밀번호를 입력해 주세요.'
    );
  end if;

  select *
  into found_profile
  from public.game_profiles
  where (
    lower(nickname) = lower(btrim(p_nickname))
    or (
      lower(previous_nickname) = lower(btrim(p_nickname))
      and previous_nickname_expires_at > now()
    )
  )
  and password_hash is not null
  and password_hash = crypt(p_password, password_hash)
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', '닉네임 또는 비밀번호가 맞지 않아요.'
    );
  end if;

  if found_profile.force_nickname_change then
    old_name := found_profile.nickname;
    suffix_no := found_profile.account_number % 1000;
    new_name := '사용자(' || lpad(suffix_no::text, 3, '0') || ')';

    while exists (
      select 1
      from public.game_profiles
      where lower(nickname) = lower(new_name)
        and id <> found_profile.id
    ) loop
      suffix_no := (suffix_no + 1) % 1000;
      new_name := '사용자(' || lpad(suffix_no::text, 3, '0') || ')';
    end loop;

    update public.game_profiles
    set nickname = new_name,
        previous_nickname = old_name,
        previous_nickname_expires_at = now() + interval '72 hours',
        force_nickname_change = false,
        updated_at = now()
    where id = found_profile.id
    returning * into found_profile;
  end if;

  if found_profile.previous_nickname_expires_at is not null
     and found_profile.previous_nickname_expires_at <= now() then
    update public.game_profiles
    set previous_nickname = null,
        previous_nickname_expires_at = null
    where id = found_profile.id
    returning * into found_profile;
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', found_profile.id,
      'nickname', found_profile.nickname,
      'coins', found_profile.coins,
      'account_number', found_profile.account_number,
      'is_developer', found_profile.is_developer
    ),
    'nickname_changed', old_name is not null,
    'message',
      case when old_name is not null
        then '닉네임이 변경되었습니다. 이전 닉네임은 72시간 동안 로그인용으로 유지됩니다.'
        else null
      end
  );
end;
$$;

create or replace function public.teacher_set_shortcut(
  p_code text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '교사 코드가 맞지 않습니다.'
    );
  end if;

  insert into public.game_settings(id, teacher_shortcut_enabled)
  values (true, coalesce(p_enabled, false))
  on conflict(id) do update
  set teacher_shortcut_enabled = excluded.teacher_shortcut_enabled,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'teacher_shortcut_enabled', coalesce(p_enabled, false)
  );
end;
$$;

create or replace function public.developer_set_account(
  p_developer_code text,
  p_nickname text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_id uuid;
begin
  if not public.developer_code_valid(p_developer_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '개발자 코드가 맞지 않습니다.'
    );
  end if;

  select id
  into target_id
  from public.game_profiles
  where lower(nickname) = lower(btrim(p_nickname));

  if target_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '계정을 찾을 수 없습니다.'
    );
  end if;

  update public.game_profiles
  set is_developer = false,
      updated_at = now()
  where is_developer = true;

  update public.game_profiles
  set is_developer = coalesce(p_enabled, false),
      updated_at = now()
  where id = target_id;

  return jsonb_build_object(
    'ok', true,
    'message',
      case when coalesce(p_enabled, false)
        then '개발자/소유자 계정을 지정했습니다.'
        else '개발자/소유자 지정을 해제했습니다.'
      end
  );
end;
$$;

create or replace function public.teacher_flag_nickname(
  p_code text,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target public.game_profiles%rowtype;
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '교사 코드가 맞지 않습니다.'
    );
  end if;

  select *
  into target
  from public.game_profiles
  where lower(nickname) = lower(btrim(p_nickname));

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', '계정을 찾을 수 없습니다.'
    );
  end if;

  update public.game_profiles
  set force_nickname_change = true,
      updated_at = now()
  where id = target.id;

  return jsonb_build_object(
    'ok', true,
    'nickname', '사용자(' ||
      lpad((target.account_number % 1000)::text, 3, '0') || ')'
  );
end;
$$;

create or replace function public.teacher_create_delete_challenge(
  p_code text,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_id uuid;
  token text;
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '교사 코드가 맞지 않습니다.'
    );
  end if;

  select id
  into target_id
  from public.game_profiles
  where lower(nickname) = lower(btrim(p_nickname));

  if target_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '계정을 찾을 수 없습니다.'
    );
  end if;

  token := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));

  insert into public.game_delete_challenges(
    profile_id, code_hash, expires_at
  )
  values (
    target_id,
    crypt(token, gen_salt('bf')),
    now() + interval '5 minutes'
  );

  return jsonb_build_object(
    'ok', true,
    'confirmation_code', token,
    'expires_in_seconds', 300
  );
end;
$$;

create or replace function public.teacher_delete_account(
  p_code text,
  p_developer_code text,
  p_nickname text,
  p_challenge text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare target_id uuid;
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '교사 코드가 맞지 않습니다.'
    );
  end if;

  if not public.developer_code_valid(p_developer_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '개발자 코드가 맞지 않습니다.'
    );
  end if;

  select id
  into target_id
  from public.game_profiles
  where lower(nickname) = lower(btrim(p_nickname));

  if target_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '계정을 찾을 수 없습니다.'
    );
  end if;

  if not exists (
    select 1
    from public.game_delete_challenges
    where profile_id = target_id
      and expires_at > now()
      and code_hash = crypt(coalesce(p_challenge, ''), code_hash)
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', '확인 코드가 틀렸거나 만료되었습니다. 다시 시작해 주세요.'
    );
  end if;

  delete from public.game_delete_challenges
  where profile_id = target_id;

  delete from public.coin_transactions
  where profile_id = target_id;

  delete from public.game_profiles
  where id = target_id;

  return jsonb_build_object(
    'ok', true,
    'message', '계정을 삭제했습니다.'
  );
end;
$$;

revoke all on function public.developer_code_valid(text) from public;
revoke all on function public.teacher_set_shortcut(text, boolean) from public;
revoke all on function public.developer_set_account(text, text, boolean) from public;
revoke all on function public.teacher_flag_nickname(text, text) from public;
revoke all on function public.teacher_create_delete_challenge(text, text) from public;
revoke all on function public.teacher_delete_account(text, text, text, text) from public;

grant execute on function public.developer_set_account(text, text, boolean) to anon, authenticated;
grant execute on function public.teacher_set_shortcut(text, boolean) to anon, authenticated;
grant execute on function public.teacher_flag_nickname(text, text) to anon, authenticated;
grant execute on function public.teacher_create_delete_challenge(text, text) to anon, authenticated;
grant execute on function public.teacher_delete_account(text, text, text, text) to anon, authenticated;

-- 아래 CHANGE_TO_YOUR_DEVELOPER_CODE를 실제 개발자 코드로 바꿔 실행하세요.
-- 실제 코드는 공개 GitHub 파일이나 브라우저 JS에 적지 마세요.
-- update public.game_teacher_config
-- set developer_code_hash = crypt('CHANGE_TO_YOUR_DEVELOPER_CODE', gen_salt('bf'))
-- where id = true;

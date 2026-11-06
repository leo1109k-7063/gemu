-- 홈 화면 공지사항 설정
-- 기존 게임 놀이터 Supabase 프로젝트에서 SQL Editor로 한 번 실행하세요.

create table if not exists public.game_announcement (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  message text not null default '',
  updated_at timestamptz not null default now(),
  constraint game_announcement_message_length
    check (char_length(message) <= 300)
);

insert into public.game_announcement (id, enabled, message)
values (true, false, '')
on conflict (id) do nothing;

alter table public.game_announcement enable row level security;

revoke all on public.game_announcement
from public, anon, authenticated;

-- 홈 화면에서 읽을 공지사항.
-- 테이블은 직접 공개하지 않고 이 함수로만 읽습니다.
create or replace function public.get_game_announcement()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'enabled',
      coalesce(
        (
          select enabled
          from public.game_announcement
          where id = true
        ),
        false
      ),
    'message',
      coalesce(
        (
          select message
          from public.game_announcement
          where id = true
        ),
        ''
      )
  );
$$;

-- 교사 코드가 맞을 때만 공지사항을 수정할 수 있습니다.
create or replace function public.teacher_update_announcement(
  p_code text,
  p_enabled boolean,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message text := btrim(coalesce(p_message, ''));
begin
  if not public.teacher_code_valid(p_code) then
    return jsonb_build_object(
      'ok', false,
      'message', '교사 코드가 맞지 않습니다.'
    );
  end if;

  if char_length(v_message) > 300 then
    return jsonb_build_object(
      'ok', false,
      'message', '공지사항은 300자 이내로 입력해 주세요.'
    );
  end if;

  if coalesce(p_enabled, false) and v_message = '' then
    return jsonb_build_object(
      'ok', false,
      'message', '표시할 공지 내용을 입력해 주세요.'
    );
  end if;

  insert into public.game_announcement (
    id,
    enabled,
    message,
    updated_at
  )
  values (
    true,
    coalesce(p_enabled, false),
    v_message,
    now()
  )
  on conflict (id) do update
    set enabled = excluded.enabled,
        message = excluded.message,
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'enabled', coalesce(p_enabled, false),
    'message', v_message
  );
end;
$$;

revoke all on function public.get_game_announcement()
from public;

grant execute on function public.get_game_announcement()
to anon, authenticated;

revoke all on function public.teacher_update_announcement(text, boolean, text)
from public;

grant execute on function public.teacher_update_announcement(text, boolean, text)
to anon, authenticated;

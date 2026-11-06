
-- =========================================================
-- 게임 놀이터: 온라인 오목 기본 SQL
-- 선착순 2명 자동 매칭 / 실시간 상태 조회 / 돌 놓기
-- 승리 보상: 코인 5개 + XP 1 / 사유: 게임 승리
-- =========================================================

create extension if not exists pgcrypto;

-- 1. XP 컬럼
alter table public.game_profiles
  add column if not exists xp integer not null default 0;

-- 2. 온라인 대기열
create table if not exists public.omok_online_queue (
  id boolean primary key default true check (id = true),
  nickname text,
  created_at timestamptz not null default now()
);

insert into public.omok_online_queue (id, nickname)
values (true, null)
on conflict (id) do nothing;

-- 3. 온라인 대국
create table if not exists public.omok_online_games (
  id uuid primary key default gen_random_uuid(),
  black_nickname text not null,
  white_nickname text not null,
  board jsonb not null,
  turn integer not null default 1 check (turn in (1, 2)),
  status text not null default 'playing'
    check (status in ('playing', 'finished', 'draw')),
  winner_nickname text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. 직접 테이블 접근 차단
alter table public.omok_online_queue enable row level security;
alter table public.omok_online_games enable row level security;

revoke all on public.omok_online_queue
  from public, anon, authenticated;

revoke all on public.omok_online_games
  from public, anon, authenticated;

-- 5. 선착순 자동 매칭
create or replace function public.omok_online_join(
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_nickname, ''));
  v_waiting text;
  v_game public.omok_online_games%rowtype;
  v_board jsonb;
begin
  if length(v_name) < 1 or length(v_name) > 16 then
    return jsonb_build_object(
      'ok', false, 'message', '닉네임을 확인해 주세요.'
    );
  end if;

  if not exists (
    select 1 from public.game_profiles
    where lower(nickname) = lower(v_name)
  ) then
    return jsonb_build_object(
      'ok', false, 'message', '계정을 찾을 수 없습니다.'
    );
  end if;

  -- 대기열의 단일 행을 잠가 동시 매칭 방지
  select nickname into v_waiting
  from public.omok_online_queue
  where id = true
  for update;

  -- 진행 중인 대국에 이미 참가 중인지 확인
  select * into v_game
  from public.omok_online_games
  where status = 'playing'
    and (
      lower(black_nickname) = lower(v_name)
      or lower(white_nickname) = lower(v_name)
    )
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'status', 'matched',
      'game_id', v_game.id,
      'color', case
        when lower(v_game.black_nickname) = lower(v_name)
          then 'black' else 'white' end,
      'opponent', case
        when lower(v_game.black_nickname) = lower(v_name)
          then v_game.white_nickname else v_game.black_nickname end
    );
  end if;

  if v_waiting is not null
     and lower(v_waiting) = lower(v_name) then
    return jsonb_build_object(
      'ok', true,
      'status', 'waiting',
      'message', '상대를 기다리는 중입니다.'
    );
  end if;

  if v_waiting is not null then
    select jsonb_agg(0 order by n)
    into v_board
    from generate_series(1,225) n;

    insert into public.omok_online_games (
      black_nickname,
      white_nickname,
      board
    )
    values (
      v_waiting,
      v_name,
      v_board
    )
    returning * into v_game;

    update public.omok_online_queue
    set nickname = null,
        created_at = now()
    where id = true;

    return jsonb_build_object(
      'ok', true,
      'status', 'matched',
      'game_id', v_game.id,
      'color', 'white',
      'opponent', v_waiting
    );
  end if;

  update public.omok_online_queue
  set nickname = v_name,
      created_at = now()
  where id = true;

  return jsonb_build_object(
    'ok', true,
    'status', 'waiting',
    'message', '상대를 기다리는 중입니다.'
  );
end;
$$;

-- 6. 대국 상태 조회
create or replace function public.omok_online_state(
  p_nickname text,
  p_game_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.omok_online_games%rowtype;
begin
  select * into g
  from public.omok_online_games
  where id = p_game_id
    and (
      lower(black_nickname) = lower(btrim(p_nickname))
      or lower(white_nickname) = lower(btrim(p_nickname))
    );

  if not found then
    return jsonb_build_object(
      'ok', false, 'message', '대국을 찾을 수 없습니다.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'game_id', g.id,
    'black_nickname', g.black_nickname,
    'white_nickname', g.white_nickname,
    'board', g.board,
    'turn', g.turn,
    'status', g.status,
    'winner_nickname', g.winner_nickname
  );
end;
$$;

-- 7. 돌 놓기 + 승리 판정 + 보상
create or replace function public.omok_online_move(
  p_nickname text,
  p_game_id uuid,
  p_row integer,
  p_col integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.omok_online_games%rowtype;
  v_name text := btrim(coalesce(p_nickname, ''));
  v_player integer;
  v_next integer;
  v_idx integer;
  v_board jsonb;
  v_dr integer;
  v_dc integer;
  v_side integer;
  v_step integer;
  v_r integer;
  v_c integer;
  v_total integer;
  v_empty integer;
  v_win boolean := false;
  v_profile_id uuid;
begin
  if p_row is null or p_col is null
     or p_row not between 0 and 14
     or p_col not between 0 and 14 then
    return jsonb_build_object(
      'ok', false, 'message', '잘못된 위치입니다.'
    );
  end if;

  select * into g
  from public.omok_online_games
  where id = p_game_id
  for update;

  if not found or g.status <> 'playing' then
    return jsonb_build_object(
      'ok', false, 'message', '진행 중인 대국이 없습니다.'
    );
  end if;

  if lower(g.black_nickname) = lower(v_name) then
    v_player := 1;
  elsif lower(g.white_nickname) = lower(v_name) then
    v_player := 2;
  else
    return jsonb_build_object(
      'ok', false, 'message', '대국 참가자가 아닙니다.'
    );
  end if;

  if g.turn <> v_player then
    return jsonb_build_object(
      'ok', false, 'message', '상대방 차례입니다.'
    );
  end if;

  v_idx := p_row * 15 + p_col;

  if coalesce(g.board ->> v_idx, '0') <> '0' then
    return jsonb_build_object(
      'ok', false, 'message', '이미 돌이 놓인 자리입니다.'
    );
  end if;

  v_board := jsonb_set(
    g.board,
    array[v_idx::text],
    to_jsonb(v_player),
    false
  );

  -- 가로, 세로, 두 대각선에서 양방향 연속 돌 확인
  for v_dr, v_dc in
    select * from (values
      (0, 1), (1, 0), (1, 1), (1, -1)
    ) d(dr, dc)
  loop
    v_total := 1;

    for v_side in -1..1 by 2 loop
      for v_step in 1..4 loop
        v_r := p_row + v_dr * v_step * v_side;
        v_c := p_col + v_dc * v_step * v_side;

        if v_r < 0 or v_r > 14
           or v_c < 0 or v_c > 14 then
          exit;
        end if;

        if (v_board ->> (v_r * 15 + v_c))::integer = v_player then
          v_total := v_total + 1;
        else
          exit;
        end if;
      end loop;
    end loop;

    if v_total >= 5 then
      v_win := true;
      exit;
    end if;
  end loop;

  if v_win then
    update public.omok_online_games
    set board = v_board,
        status = 'finished',
        winner_nickname = v_name,
        updated_at = now()
    where id = p_game_id;

    -- 보상 기록과 게임 상태 변경은 같은 트랜잭션
    select id into v_profile_id
    from public.game_profiles
    where lower(nickname) = lower(v_name)
    for update;

    if v_profile_id is null then
      raise exception 'PROFILE_NOT_FOUND';
    end if;

    update public.game_profiles
    set coins = coins + 5,
        xp = xp + 1,
        updated_at = now()
    where id = v_profile_id;

    insert into public.coin_transactions (
      profile_id, amount, reason
    )
    values (
      v_profile_id, 5, '게임 승리'
    );

    return jsonb_build_object(
      'ok', true,
      'status', 'finished',
      'winner_nickname', v_name,
      'board', v_board,
      'turn', v_player,
      'coins_awarded', 5,
      'xp_awarded', 1
    );
  end if;

  select count(*) into v_empty
  from jsonb_array_elements_text(v_board) x(value)
  where x.value = '0';

  if v_empty = 0 then
    update public.omok_online_games
    set board = v_board,
        status = 'draw',
        updated_at = now()
    where id = p_game_id;

    return jsonb_build_object(
      'ok', true, 'status', 'draw',
      'board', v_board, 'turn', v_player
    );
  end if;

  v_next := case when v_player = 1 then 2 else 1 end;

  update public.omok_online_games
  set board = v_board,
      turn = v_next,
      updated_at = now()
  where id = p_game_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'playing',
    'board', v_board,
    'turn', v_next
  );
end;
$$;

-- 8. 대기열 나가기
create or replace function public.omok_online_leave_queue(
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.omok_online_queue
  set nickname = null,
      created_at = now()
  where id = true
    and lower(coalesce(nickname, '')) =
        lower(btrim(coalesce(p_nickname, '')));

  return jsonb_build_object('ok', true);
end;
$$;

-- 9. RPC 권한
revoke all on function public.omok_online_join(text) from public;
revoke all on function public.omok_online_state(text, uuid) from public;
revoke all on function public.omok_online_move(text, uuid, integer, integer) from public;
revoke all on function public.omok_online_leave_queue(text) from public;

grant execute on function public.omok_online_join(text) to anon, authenticated;
grant execute on function public.omok_online_state(text, uuid) to anon, authenticated;
grant execute on function public.omok_online_move(text, uuid, integer, integer) to anon, authenticated;
grant execute on function public.omok_online_leave_queue(text) to anon, authenticated;

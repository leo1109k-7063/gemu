-- 1. 프로필 테이블 (코인 잔액 관리)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text,
  coins integer default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
drop policy if exists "Users can update own profile." on public.profiles;
create policy "Users can update own profile." on public.profiles for update using (auth.uid() = id);

-- 2. 학습 기록 테이블
create table if not exists public.learning_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  content_id text not null,
  status text default 'completed',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.learning_records enable row level security;
drop policy if exists "Users can view own learning records" on public.learning_records;
create policy "Users can view own learning records" on public.learning_records for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own learning records" on public.learning_records;
create policy "Users can insert own learning records" on public.learning_records for insert with check (auth.uid() = user_id);

-- 3. 퀴즈 기록 테이블
create table if not exists public.quiz_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  quiz_id text not null,
  is_correct boolean not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.quiz_records enable row level security;
drop policy if exists "Users can view own quiz records" on public.quiz_records;
create policy "Users can view own quiz records" on public.quiz_records for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own quiz records" on public.quiz_records;
create policy "Users can insert own quiz records" on public.quiz_records for insert with check (auth.uid() = user_id);

-- 4. 퀴즈 정답 시 3코인 지급 및 기록 저장 함수 (RPC)
create or replace function public.submit_quiz_result(
  p_quiz_id text,
  p_is_correct boolean
)
returns void
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception '로그인된 사용자가 없습니다.';
  end if;

  -- 퀴즈 풀이 기록 저장
  insert into public.quiz_records (user_id, quiz_id, is_correct)
  values (v_user_id, p_quiz_id, p_is_correct);

  -- 정답일 때만 코인 3개 지급
  if p_is_correct = true then
    update public.profiles
    set coins = coins + 3,
        updated_at = now()
    where id = v_user_id;
  end if;
end;
$$;

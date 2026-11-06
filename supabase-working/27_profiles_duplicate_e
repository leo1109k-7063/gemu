create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text,
  coins integer default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS(Row Level Security) 활성화
alter table public.profiles enable row level security;

-- 정책 설정 (조회 및 수정 권한)
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
create policy "Users can update own profile." on public.profiles for update using (auth.uid() = id);

create table public.quiz_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  quiz_id text not null,
  is_correct boolean not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.quiz_records enable row level security;
create policy "Users can view own quiz records" on public.quiz_records for select using (auth.uid() = user_id);
create policy "Users can insert own quiz records" on public.quiz_records for insert with check (auth.uid() = user_id);

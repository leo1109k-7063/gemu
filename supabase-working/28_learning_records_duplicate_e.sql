create table public.learning_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  content_id text not null,
  status text default 'completed',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.learning_records enable row level security;
create policy "Users can view own learning records" on public.learning_records for select using (auth.uid() = user_id);
create policy "Users can insert own learning records" on public.learning_records for insert with check (auth.uid() = user_id);

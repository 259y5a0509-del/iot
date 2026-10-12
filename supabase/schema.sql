-- Run this in Supabase Dashboard -> SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  session text,
  week integer,
  question_number integer,
  question text not null default '',
  options jsonb not null default '{}'::jsonb,
  correct_answer text,
  detailed_solution text,
  created_at timestamptz not null default now()
);

-- Starter version: public read access for the question bank. Do not put private data here.
alter table public.questions enable row level security;
drop policy if exists "Questions are readable by everyone" on public.questions;
create policy "Questions are readable by everyone"
  on public.questions for select using (true);

-- Optional table for later per-user progress after adding Supabase Auth.
create table if not exists public.user_question_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  status text not null check (status in ('seen', 'correct', 'incorrect')),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
alter table public.user_question_progress enable row level security;
drop policy if exists "Users can view their own question progress" on public.user_question_progress;
create policy "Users can view their own question progress"
  on public.user_question_progress for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert their own question progress" on public.user_question_progress;
create policy "Users can insert their own question progress"
  on public.user_question_progress for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update their own question progress" on public.user_question_progress;
create policy "Users can update their own question progress"
  on public.user_question_progress for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

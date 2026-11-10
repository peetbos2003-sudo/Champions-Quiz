-- Champions Pubquiz · database setup for Supabase
-- Paste this whole file into Supabase > SQL Editor and click Run.
-- Safe to run again: it only creates what is missing and refreshes the functions.
--
-- Security model
--   * Phones (anonymous) can only READ the game state, team names and lock-in times.
--   * Phones can only WRITE through join_team() and submit_answer(), which check
--     the team's secret device token, the current question and the time limit.
--   * Questions, correct answers and the teams' actual answers live in the private
--     schema, which the API never exposes. Only the quiz master (with the host PIN)
--     can read them through the host_* functions.
--   * The host PIN is NOT in this file. Set it separately (see README).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- public tables (readable by phones, live) ----------
create table if not exists public.game_state (
  id             int primary key default 1 check (id = 1),
  phase          text not null default 'lobby',
  q              int  not null default -1,
  started_at     timestamptz,
  opened_at      timestamptz default now(),
  question_count int  not null default 0,
  current        jsonb,
  reveal         jsonb,
  scores         jsonb not null default '{}'::jsonb,
  updated_at     timestamptz default now()
);
insert into public.game_state (id) values (1) on conflict do nothing;

create table if not exists public.teams (
  slot      text primary key check (slot in ('t1','t2','t3','t4','t5')),
  name      text not null check (char_length(name) between 1 and 24),
  joined_at timestamptz not null default now()
);

create table if not exists public.lockins (
  qid         text not null,
  slot        text not null references public.teams(slot) on delete cascade,
  answered_at timestamptz not null default now(),
  ms          int  not null,
  primary key (qid, slot)
);

-- ---------- private tables (never exposed) ----------
create table if not exists private.team_tokens (slot text primary key, token text not null);
create table if not exists private.answers (
  qid text not null, slot text not null, value jsonb, ms int not null, mark boolean,
  answered_at timestamptz not null default now(), primary key (qid, slot)
);
create table if not exists private.questions (id int primary key default 1 check (id = 1), list jsonb not null default '[]'::jsonb);
insert into private.questions (id) values (1) on conflict do nothing;
create table if not exists private.host (id int primary key default 1 check (id = 1), pin_hash text);

-- ---------- row level security: read-only for everyone ----------
alter table public.game_state enable row level security;
alter table public.teams      enable row level security;
alter table public.lockins    enable row level security;

drop policy if exists "read game"    on public.game_state;
drop policy if exists "read teams"   on public.teams;
drop policy if exists "read lockins" on public.lockins;
create policy "read game"    on public.game_state for select to anon, authenticated using (true);
create policy "read teams"   on public.teams      for select to anon, authenticated using (true);
create policy "read lockins" on public.lockins    for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
revoke insert, update, delete on public.game_state, public.teams, public.lockins from anon, authenticated;
grant select on public.game_state, public.teams, public.lockins to anon, authenticated;

-- ---------- live updates ----------
do $$
begin
  begin alter publication supabase_realtime add table public.game_state; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.teams;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.lockins;    exception when duplicate_object then null; end;
end $$;

-- ---------- private helpers ----------
create or replace function private.set_host_pin(p_pin text) returns void
language sql security definer set search_path = '' as $$
  insert into private.host (id, pin_hash) values (1, extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (id) do update set pin_hash = excluded.pin_hash;
$$;

create or replace function private.is_host(p_pin text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select pin_hash = extensions.crypt(coalesce(p_pin,''), pin_hash)
                   from private.host where id = 1 and pin_hash is not null), false);
$$;

-- ---------- functions for phones ----------
create or replace function public.server_time() returns timestamptz
language sql stable as $$ select now() $$;

create or replace function public.join_team(p_slot text, p_name text, p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_tok text;
begin
  if p_slot not in ('t1','t2','t3','t4','t5')
     or coalesce(char_length(trim(p_name)), 0) = 0
     or coalesce(char_length(p_token), 0) < 16 then
    return 'invalid';
  end if;
  insert into private.team_tokens (slot, token) values (p_slot, p_token) on conflict (slot) do nothing;
  select token into v_tok from private.team_tokens where slot = p_slot;
  if v_tok is distinct from p_token then return 'taken'; end if;
  insert into public.teams (slot, name) values (p_slot, left(trim(p_name), 24))
  on conflict (slot) do update set name = excluded.name;
  return 'ok';
end $$;

create or replace function public.submit_answer(p_slot text, p_token text, p_value jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.game_state; v_qid text; v_secs int; v_ms int;
begin
  if not exists (select 1 from private.team_tokens where slot = p_slot and token = p_token)
     or not exists (select 1 from public.teams where slot = p_slot) then
    return 'auth';
  end if;
  if char_length(coalesce(p_value::text, '')) > 300 then return 'invalid'; end if;
  select * into s from public.game_state where id = 1;
  if s.phase <> 'question' or s.current is null or s.started_at is null then return 'closed'; end if;
  v_qid  := s.current->>'id';
  v_secs := coalesce((s.current->>'seconds')::int, 30);
  if now() > s.started_at + make_interval(secs => v_secs + 3) then return 'late'; end if;
  v_ms := greatest(0, (extract(epoch from (now() - s.started_at)) * 1000)::int);
  insert into private.answers (qid, slot, value, ms) values (v_qid, p_slot, p_value, v_ms) on conflict do nothing;
  if not found then return 'already'; end if;
  insert into public.lockins (qid, slot, ms) values (v_qid, p_slot, v_ms) on conflict do nothing;
  return 'ok';
end $$;

-- ---------- functions for the quiz master (PIN required) ----------
create or replace function public.host_check(p_pin text) returns boolean
language sql security definer set search_path = '' as $$ select private.is_host(p_pin) $$;

create or replace function public.host_set_state(p_pin text, p_state jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_host(p_pin) then raise exception 'not_host'; end if;
  update public.game_state set
    phase      = coalesce(p_state->>'phase', phase),
    q          = coalesce((p_state->>'q')::int, q),
    current    = case when p_state ? 'current' then nullif(p_state->'current', 'null'::jsonb) else current end,
    reveal     = case when p_state ? 'reveal'  then nullif(p_state->'reveal',  'null'::jsonb) else reveal  end,
    scores     = case when p_state ? 'scores'  then coalesce(nullif(p_state->'scores','null'::jsonb), '{}'::jsonb) else scores end,
    started_at = case when coalesce((p_state->>'start')::boolean, false) then now() else started_at end,
    updated_at = now()
  where id = 1;
end $$;

create or replace function public.host_reset(p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_host(p_pin) then raise exception 'not_host'; end if;
  delete from public.lockins where true;
  delete from private.answers where true;
  delete from public.teams where true;
  delete from private.team_tokens where true;
  update public.game_state set phase = 'lobby', q = -1, current = null, reveal = null,
    scores = '{}'::jsonb, started_at = null, opened_at = now(), updated_at = now() where id = 1;
end $$;

create or replace function public.host_get_questions(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_host(p_pin) then raise exception 'not_host'; end if;
  return (select list from private.questions where id = 1);
end $$;

create or replace function public.host_save_questions(p_pin text, p_list jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_host(p_pin) then raise exception 'not_host'; end if;
  if jsonb_typeof(p_list) <> 'array' then raise exception 'not_a_list'; end if;
  update private.questions set list = p_list where id = 1;
  update public.game_state set question_count = jsonb_array_length(p_list), updated_at = now() where id = 1;
end $$;

create or replace function public.host_answers(p_pin text)
returns table (qid text, slot text, value jsonb, ms int, mark boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_host(p_pin) then raise exception 'not_host'; end if;
  return query select a.qid, a.slot, a.value, a.ms, a.mark from private.answers a;
end $$;

create or replace function public.host_mark(p_pin text, p_qid text, p_slot text, p_mark boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_host(p_pin) then raise exception 'not_host'; end if;
  update private.answers set mark = p_mark where qid = p_qid and slot = p_slot;
end $$;

-- ---------- who may call what ----------
revoke all on function private.set_host_pin(text), private.is_host(text) from public, anon, authenticated;

revoke all on function
  public.server_time(), public.join_team(text,text,text), public.submit_answer(text,text,jsonb),
  public.host_check(text), public.host_set_state(text,jsonb), public.host_reset(text),
  public.host_get_questions(text), public.host_save_questions(text,jsonb),
  public.host_answers(text), public.host_mark(text,text,text,boolean)
from public;

grant execute on function
  public.server_time(), public.join_team(text,text,text), public.submit_answer(text,text,jsonb),
  public.host_check(text), public.host_set_state(text,jsonb), public.host_reset(text),
  public.host_get_questions(text), public.host_save_questions(text,jsonb),
  public.host_answers(text), public.host_mark(text,text,text,boolean)
to anon, authenticated;

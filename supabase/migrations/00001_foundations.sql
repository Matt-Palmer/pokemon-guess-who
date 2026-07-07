-- Foundations: profiles + pokemon reference table, RLS keyed off Clerk's `sub` claim.

create table public.profiles (
  clerk_id text primary key,
  username text not null,
  avatar text,
  expo_push_token text,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are self-readable"
  on public.profiles for select
  to authenticated
  using (clerk_id = (auth.jwt() ->> 'sub'));

create policy "profiles are self-insertable"
  on public.profiles for insert
  to authenticated
  with check (clerk_id = (auth.jwt() ->> 'sub'));

create policy "profiles are self-updatable"
  on public.profiles for update
  to authenticated
  using (clerk_id = (auth.jwt() ->> 'sub'))
  with check (clerk_id = (auth.jwt() ->> 'sub'));

create table public.pokemon (
  id integer primary key,
  name text not null,
  sprite_url text not null,
  types text[] not null default '{}',
  generation integer not null
);

alter table public.pokemon enable row level security;

create policy "pokemon is readable by any signed-in user"
  on public.pokemon for select
  to authenticated
  using (true);

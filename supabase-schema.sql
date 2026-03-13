-- Supabase schema voor meetings, deelnemers, stemmen en reacties.
-- Draai dit script in de Supabase SQL editor.

create table if not exists public.meetings (
  id text primary key,
  owner_user_id uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  participants_json jsonb not null default '[]'::jsonb,
  geographic_center_json jsonb,
  selected_place_json jsonb not null,
  suggested_places_json jsonb not null default '[]'::jsonb,
  participant_routes_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.meeting_participants (
  id bigint generated always as identity primary key,
  meeting_id text not null references public.meetings(id) on delete cascade,
  participant_id integer not null,
  participant_name text not null,
  participant_location text not null,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default timezone('utc', now()),
  unique (meeting_id, participant_id)
);

create table if not exists public.votes (
  id text primary key,
  meeting_id text not null references public.meetings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  participant_name text not null,
  place_id text not null,
  place_name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.comments (
  id text primary key,
  vote_id text not null references public.votes(id) on delete cascade,
  meeting_id text not null references public.meetings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  content text not null check (char_length(content) <= 120),
  created_at timestamptz not null default timezone('utc', now()),
  unique (vote_id)
);

create index if not exists idx_meetings_owner_user_id on public.meetings(owner_user_id);
create index if not exists idx_meetings_expires_at on public.meetings(expires_at);
create index if not exists idx_meeting_participants_meeting_id on public.meeting_participants(meeting_id);
create index if not exists idx_votes_meeting_id on public.votes(meeting_id);
create index if not exists idx_comments_meeting_id on public.comments(meeting_id);
create index if not exists idx_comments_vote_id on public.comments(vote_id);

alter table public.meetings disable row level security;
alter table public.meeting_participants disable row level security;
alter table public.votes disable row level security;
alter table public.comments disable row level security;

-- TaskSpeck live database.
-- Paste this whole file into the Supabase SQL editor and press Run.
-- It creates the tables, the 10 km Melbourne CBD rule, and the privacy rules.
-- It does not contain any passwords or secret keys.
--
-- Standing rules baked in here:
--   * Launch zone is 10 km from Melbourne CBD (Flinders Street and Swanston Street).
--   * Painting, handyman and assembly over $10,000 are refused. They need a registered builder.
--   * TaskSpeck keeps 15% of the whole amount a Tasker is paid, including materials.
--     That fee is calculated by the app and stored on the job. It is not a separate materials discount.
--   * Phone numbers and the street address are not on the public job row.

create extension if not exists pgcrypto;

-- Distance from Flinders Street / Swanston Street. 10 km is the launch zone.
create or replace function public.in_launch_zone(p_lat double precision, p_lng double precision)
returns boolean
language sql
immutable
as $$
  select p_lat is not null
    and p_lng is not null
    and (
      6371 * acos(least(1::float8, greatest(-1::float8,
        cos(radians(-37.8183)) * cos(radians(p_lat)) * cos(radians(p_lng) - radians(144.9671))
        + sin(radians(-37.8183)) * sin(radians(p_lat))
      )))
    ) <= 10;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  suburb text not null default '',
  lat double precision,
  lng double precision,
  city_id text not null default '',
  role text,
  bio text not null default '',
  areas text not null default '',
  vehicle text not null default '',
  safety_guide boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_ok check (role is null or role in ('requester', 'tasker', 'both'))
);

-- Phone numbers live here, not on the public profile. Only the owner can read their own row.
create table if not exists public.profile_phones (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone text not null default ''
);

create table if not exists public.jobs (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default '',
  text text not null default '',
  cat text not null default 'other',
  stage text not null default 'Draft',
  status text not null default 'Draft',
  suburb text not null default '',
  lat double precision,
  lng double precision,
  city_id text not null default '',
  budget_label text not null default 'Open to offers',
  price_num numeric,
  start_at timestamptz,
  start_min integer,
  duration_min integer,
  published boolean not null default false,
  accepted_offer_id bigint,
  payment jsonb,
  payment_status text not null default 'none',
  cancelled_by text,
  cancel_reason text not null default '',
  repeat_every text,
  repeat_of bigint,
  assigned_at timestamptz,
  on_the_way_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  photo_count integer not null default 0,
  before_paths text[] not null default '{}',
  after_paths text[] not null default '{}',
  notes jsonb not null default '[]'::jsonb,
  special jsonb not null default '[]'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  bundle jsonb,
  fixes jsonb not null default '[]'::jsonb,
  dispute jsonb,
  fix_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Street and unit. Not readable by the whole launch zone.
create table if not exists public.job_private (
  job_id bigint primary key references public.jobs (id) on delete cascade,
  address text not null default '',
  prop_private text not null default ''
);

create table if not exists public.offers (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.jobs (id) on delete cascade,
  tasker_id uuid not null references public.profiles (id) on delete cascade,
  tasker_name text not null default '',
  fee numeric not null,
  message text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.jobs (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  with_user_id uuid,
  text text not null,
  warning boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.jobs (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  text text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (job_id, from_user_id)
);

-- People can file a report. They cannot edit or delete it, and they cannot read someone else's.
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.jobs (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  about_user_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.job_photos (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.jobs (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('before', 'after', 'listing')),
  path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default '',
  title text not null default '',
  body text not null default '',
  job_id bigint,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_searches (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  q text not null default '',
  cat text not null default 'all',
  km numeric,
  sort text not null default 'closest',
  alert boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.records (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default '',
  cat text not null default '',
  tasker_name text not null default '',
  date text not null default '',
  paid numeric not null default 0,
  suburb text not null default '',
  prop_private text not null default '',
  check_text text not null default '',
  note text not null default '',
  photo_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.shares (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.share_items (
  share_id bigint not null references public.shares (id) on delete cascade,
  record_id bigint not null references public.records (id) on delete cascade,
  primary key (share_id, record_id)
);

create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  name text not null default '',
  suburb text not null,
  created_at timestamptz not null default now()
);

create index if not exists jobs_requester_idx on public.jobs (requester_id);
create index if not exists jobs_stage_idx on public.jobs (stage);
create index if not exists jobs_published_idx on public.jobs (published, stage);
create index if not exists jobs_suburb_idx on public.jobs (suburb);
create index if not exists jobs_geo_idx on public.jobs (lat, lng);
create index if not exists offers_job_idx on public.offers (job_id);
create index if not exists offers_tasker_idx on public.offers (tasker_id);
create index if not exists offers_job_status_idx on public.offers (job_id, status);
create index if not exists messages_job_idx on public.messages (job_id, created_at);
create index if not exists reviews_job_idx on public.reviews (job_id);
create index if not exists reports_job_idx on public.reports (job_id);
create index if not exists reports_from_idx on public.reports (from_user_id);
create index if not exists photos_job_idx on public.job_photos (job_id);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists searches_user_idx on public.saved_searches (user_id);
create index if not exists records_user_idx on public.records (user_id);

-- Painting, handyman and assembly over $10,000 need a registered builder.
create or replace function public.reject_oversized_building()
returns trigger
language plpgsql
as $$
begin
  if new.price_num is not null
     and new.price_num > 10000
     and new.cat in ('painting', 'home', 'furniture') then
    raise exception 'Jobs of this kind over $10,000 need a registered builder in Victoria, so TaskSpeck cannot take them.';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_reject_oversized_building on public.jobs;
create trigger jobs_reject_oversized_building
  before insert or update of price_num, cat on public.jobs
  for each row execute function public.reject_oversized_building();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_party(p_job_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job_id and j.requester_id = auth.uid()
  )
  or exists (
    select 1 from public.offers o
    where o.job_id = p_job_id and o.status = 'accepted' and o.tasker_id = auth.uid()
  );
$$;

-- Phone and street, only for the customer and the booked Tasker.
-- The street stays available after the job is done. The phone number does not.
create or replace function public.job_contact(p_job_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  st text;
  req uuid;
  tasker uuid;
  addr text;
  prop text;
  req_phone text;
  tasker_phone text;
  booked boolean;
  phones boolean;
begin
  if auth.uid() is null then
    return null;
  end if;
  select j.stage, j.requester_id into st, req from public.jobs j where j.id = p_job_id;
  if req is null then
    return null;
  end if;
  select o.tasker_id into tasker
  from public.offers o
  where o.job_id = p_job_id and o.status = 'accepted'
  limit 1;
  if auth.uid() <> req and auth.uid() is distinct from tasker then
    return null;
  end if;
  booked := st in (
    'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED', 'TASKER_COMPLETED',
    'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED', 'REQUESTER_CONFIRMED', 'PAYMENT_RELEASED',
    'COMPLETED', 'RESOLVED'
  );
  phones := st in (
    'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED',
    'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED'
  );
  if auth.uid() = req or booked then
    select jp.address, jp.prop_private into addr, prop
    from public.job_private jp where jp.job_id = p_job_id;
  end if;
  if phones then
    select p.phone into req_phone from public.profile_phones p where p.user_id = req;
    select p.phone into tasker_phone from public.profile_phones p where p.user_id = tasker;
  end if;
  return jsonb_build_object(
    'address', addr,
    'prop_private', prop,
    'requester_phone', req_phone,
    'tasker_phone', tasker_phone
  );
end;
$$;

create or replace function public.offer_count(p_job_id bigint)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.offers where job_id = p_job_id and status = 'pending';
$$;

-- Taskers update the step they are on. They cannot change the price or the suburb here.
create or replace function public.set_job_stage(p_job_id bigint, p_stage text, p_patch jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.jobs;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not public.is_party(p_job_id) then
    raise exception 'You are not part of this task';
  end if;
  if p_stage is not null and p_stage not in (
    'Draft', 'POSTED', 'OFFERS_RECEIVED', 'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING',
    'ON_THE_WAY', 'TASK_STARTED', 'TASKER_COMPLETED', 'REQUESTER_CONFIRMED',
    'PAYMENT_RELEASED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'FIX_REQUESTED',
    'FIX_DONE', 'DISPUTED', 'RESOLVED', 'UNDER_REVIEW'
  ) then
    raise exception 'Unknown stage';
  end if;
  update public.jobs set
    stage = coalesce(p_stage, stage),
    status = coalesce(p_patch->>'status', status),
    payment_status = coalesce(p_patch->>'payment_status', payment_status),
    payment = case when p_patch ? 'payment' then p_patch->'payment' else payment end,
    cancelled_by = case when p_patch ? 'cancelled_by' then p_patch->>'cancelled_by' else cancelled_by end,
    cancel_reason = coalesce(p_patch->>'cancel_reason', cancel_reason),
    on_the_way_at = case when p_patch ? 'on_the_way_at' then (p_patch->>'on_the_way_at')::timestamptz else on_the_way_at end,
    started_at = case when p_patch ? 'started_at' then (p_patch->>'started_at')::timestamptz else started_at end,
    done_at = case when p_patch ? 'done_at' then (p_patch->>'done_at')::timestamptz else done_at end,
    assigned_at = case when p_patch ? 'assigned_at' then (p_patch->>'assigned_at')::timestamptz else assigned_at end,
    accepted_offer_id = case
      when p_patch ? 'accepted_offer_id' then nullif(p_patch->>'accepted_offer_id', '')::bigint
      else accepted_offer_id
    end,
    published = case when p_patch ? 'published' then (p_patch->>'published')::boolean else published end,
    fix_used = case when p_patch ? 'fix_used' then (p_patch->>'fix_used')::boolean else fix_used end,
    photo_count = case when p_patch ? 'photo_count' then (p_patch->>'photo_count')::integer else photo_count end,
    before_paths = case
      when p_patch ? 'before_paths' then (
        select coalesce(array_agg(value), '{}')
        from jsonb_array_elements_text(coalesce(p_patch->'before_paths', '[]'::jsonb)) as value
      )
      else before_paths
    end,
    after_paths = case
      when p_patch ? 'after_paths' then (
        select coalesce(array_agg(value), '{}')
        from jsonb_array_elements_text(coalesce(p_patch->'after_paths', '[]'::jsonb)) as value
      )
      else after_paths
    end,
    fixes = case when p_patch ? 'fixes' then p_patch->'fixes' else fixes end,
    dispute = case when p_patch ? 'dispute' then p_patch->'dispute' else dispute end,
    bundle = case when p_patch ? 'bundle' then p_patch->'bundle' else bundle end,
    updated_at = now()
  where id = p_job_id
  returning * into row;
  return row;
end;
$$;

create or replace function public.notify_user(
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_job bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_user is null then
    return;
  end if;
  if p_job is not null and not public.is_party(p_job) and p_user is distinct from auth.uid() then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, job_id)
  values (p_user, coalesce(p_kind, ''), coalesce(p_title, ''), coalesce(p_body, ''), p_job);
end;
$$;

create or replace function public.share_records(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'title', r.title,
    'cat', r.cat,
    'taskerName', r.tasker_name,
    'date', r.date,
    'paid', r.paid,
    'suburb', r.suburb,
    'check', r.check_text,
    'note', r.note,
    'photoCount', r.photo_count
  )), '[]'::jsonb)
  from public.shares s
  join public.share_items si on si.share_id = s.id
  join public.records r on r.id = si.record_id
  where s.token = p_token;
$$;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

alter table public.profiles enable row level security;
alter table public.profile_phones enable row level security;
alter table public.jobs enable row level security;
alter table public.job_private enable row level security;
alter table public.offers enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.job_photos enable row level security;
alter table public.notifications enable row level security;
alter table public.saved_searches enable row level security;
alter table public.records enable row level security;
alter table public.shares enable row level security;
alter table public.share_items enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists phones_own on public.profile_phones;
create policy phones_own on public.profile_phones
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select to authenticated using (
    requester_id = auth.uid()
    or exists (
      select 1 from public.offers o
      where o.job_id = jobs.id and o.tasker_id = auth.uid()
    )
    or (
      published
      and stage not in ('Draft', 'CANCELLED', 'UNDER_REVIEW')
      and public.in_launch_zone(lat, lng)
    )
  );
drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs
  for insert to authenticated with check (requester_id = auth.uid());
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
  for update to authenticated using (requester_id = auth.uid()) with check (requester_id = auth.uid());

drop policy if exists private_select on public.job_private;
create policy private_select on public.job_private
  for select to authenticated using (
    exists (
      select 1 from public.jobs j
      where j.id = job_private.job_id
        and (
          j.requester_id = auth.uid()
          or (
            j.stage in (
              'ACCEPTED', 'PAYMENT_CONFIRMED', 'UPCOMING', 'ON_THE_WAY', 'TASK_STARTED', 'TASKER_COMPLETED',
              'FIX_REQUESTED', 'FIX_DONE', 'DISPUTED', 'REQUESTER_CONFIRMED', 'PAYMENT_RELEASED',
              'COMPLETED', 'RESOLVED'
            )
            and exists (
              select 1 from public.offers o
              where o.job_id = j.id and o.status = 'accepted' and o.tasker_id = auth.uid()
            )
          )
        )
    )
  );
drop policy if exists private_write on public.job_private;
create policy private_write on public.job_private
  for all to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_private.job_id and j.requester_id = auth.uid()))
  with check (exists (select 1 from public.jobs j where j.id = job_private.job_id and j.requester_id = auth.uid()));

drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select to authenticated using (
    tasker_id = auth.uid()
    or exists (select 1 from public.jobs j where j.id = offers.job_id and j.requester_id = auth.uid())
  );
drop policy if exists offers_insert on public.offers;
create policy offers_insert on public.offers
  for insert to authenticated with check (tasker_id = auth.uid());
drop policy if exists offers_update_tasker on public.offers;
create policy offers_update_tasker on public.offers
  for update to authenticated using (tasker_id = auth.uid()) with check (tasker_id = auth.uid());
drop policy if exists offers_update_requester on public.offers;
create policy offers_update_requester on public.offers
  for update to authenticated
  using (exists (select 1 from public.jobs j where j.id = offers.job_id and j.requester_id = auth.uid()))
  with check (exists (select 1 from public.jobs j where j.id = offers.job_id and j.requester_id = auth.uid()));

-- Chat: the customer can read their job. A Tasker can read their own messages,
-- messages addressed to them, and the customer's replies once they have an offer.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated using (
    from_user_id = auth.uid()
    or with_user_id = auth.uid()
    or exists (
      select 1 from public.jobs j
      where j.id = messages.job_id and j.requester_id = auth.uid()
    )
    or exists (
      select 1 from public.offers o
      join public.jobs j on j.id = o.job_id
      where o.job_id = messages.job_id
        and o.tasker_id = auth.uid()
        and j.requester_id = messages.from_user_id
    )
  );
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (
    from_user_id = auth.uid()
    and (
      exists (select 1 from public.jobs j where j.id = job_id and j.requester_id = auth.uid())
      or exists (select 1 from public.offers o where o.job_id = messages.job_id and o.tasker_id = auth.uid())
      or exists (
        select 1 from public.jobs j
        where j.id = job_id and j.published and j.stage in ('POSTED', 'OFFERS_RECEIVED')
      )
    )
  );

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated using (public.is_party(job_id));
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated with check (from_user_id = auth.uid() and public.is_party(job_id));

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated with check (from_user_id = auth.uid());
drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated using (from_user_id = auth.uid());

drop policy if exists photos_select on public.job_photos;
create policy photos_select on public.job_photos
  for select to authenticated using (owner_id = auth.uid() or public.is_party(job_id));
drop policy if exists photos_insert on public.job_photos;
create policy photos_insert on public.job_photos
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists notes_own on public.notifications;
create policy notes_own on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notes_update on public.notifications;
create policy notes_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists searches_own on public.saved_searches;
create policy searches_own on public.saved_searches
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists records_own on public.records;
create policy records_own on public.records
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists shares_own on public.shares;
create policy shares_own on public.shares
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists share_items_own on public.share_items;
create policy share_items_own on public.share_items
  for all to authenticated
  using (exists (select 1 from public.shares s where s.id = share_items.share_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.shares s where s.id = share_items.share_id and s.user_id = auth.uid()));

drop policy if exists waitlist_insert on public.waitlist;
create policy waitlist_insert on public.waitlist
  for insert to authenticated with check (true);

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

drop policy if exists "job photos insert own folder" on storage.objects;
create policy "job photos insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "job photos read parties" on storage.objects;
create policy "job photos read parties" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_party(nullif((storage.foldername(name))[2], '')::bigint)
    )
  );

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on function public.job_contact(bigint) from public;
revoke all on function public.offer_count(bigint) from public;
revoke all on function public.set_job_stage(bigint, text, jsonb) from public;
revoke all on function public.notify_user(uuid, text, text, text, bigint) from public;
revoke all on function public.delete_own_account() from public;
revoke all on function public.share_records(text) from public;
revoke all on function public.is_party(bigint) from public;
grant execute on function public.job_contact(bigint) to authenticated;
grant execute on function public.offer_count(bigint) to authenticated;
grant execute on function public.set_job_stage(bigint, text, jsonb) to authenticated;
grant execute on function public.notify_user(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.is_party(bigint) to authenticated;
grant execute on function public.share_records(text) to anon, authenticated;

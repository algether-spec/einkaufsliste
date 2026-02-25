create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  sync_code text not null,
  item_id text,
  text text not null,
  erledigt boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_codes (
  sync_code text primary key,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

alter table public.shopping_items
  add column if not exists item_id text;

update public.shopping_items
set item_id = 'legacy-' || id::text
where item_id is null or length(trim(item_id)) = 0;

alter table public.shopping_items
  alter column item_id set not null;

insert into public.sync_codes (sync_code, last_used_at)
select distinct sync_code, now()
from public.shopping_items
where sync_code is not null and length(trim(sync_code)) > 0
on conflict (sync_code) do update
set last_used_at = greatest(public.sync_codes.last_used_at, excluded.last_used_at);

create index if not exists shopping_items_sync_code_idx
  on public.shopping_items (sync_code);

create index if not exists shopping_items_sync_code_position_idx
  on public.shopping_items (sync_code, position);

create unique index if not exists shopping_items_sync_code_item_id_uidx
  on public.shopping_items (sync_code, item_id);

create index if not exists sync_codes_last_used_at_idx
  on public.sync_codes (last_used_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_shopping_items_updated_at on public.shopping_items;
create trigger trg_shopping_items_updated_at
before update on public.shopping_items
for each row execute function public.set_updated_at();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shopping_items'
      and column_name = 'user_id'
      and is_nullable = 'NO'
  ) then
    execute 'alter table public.shopping_items alter column user_id drop not null';
  end if;
end
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.shopping_items to anon, authenticated;
grant usage, select on sequence public.shopping_items_id_seq to anon, authenticated;
grant select, insert, update on public.sync_codes to anon, authenticated;

alter table public.shopping_items enable row level security;
alter table public.sync_codes enable row level security;

drop policy if exists "shopping_items_select_by_code" on public.shopping_items;
create policy "shopping_items_select_by_code"
on public.shopping_items
for select
using (true);

drop policy if exists "shopping_items_insert_by_code" on public.shopping_items;
create policy "shopping_items_insert_by_code"
on public.shopping_items
for insert
with check (
  sync_code is not null and length(sync_code) > 0
  and item_id is not null and length(item_id) > 0
);

drop policy if exists "shopping_items_update_by_code" on public.shopping_items;
create policy "shopping_items_update_by_code"
on public.shopping_items
for update
using (true)
with check (
  sync_code is not null and length(sync_code) > 0
  and item_id is not null and length(item_id) > 0
);

drop policy if exists "shopping_items_delete_by_code" on public.shopping_items;
create policy "shopping_items_delete_by_code"
on public.shopping_items
for delete
using (true);

drop policy if exists "sync_codes_select" on public.sync_codes;
create policy "sync_codes_select"
on public.sync_codes
for select
using (true);

drop policy if exists "sync_codes_insert" on public.sync_codes;
create policy "sync_codes_insert"
on public.sync_codes
for insert
with check (sync_code is not null and length(sync_code) > 0);

drop policy if exists "sync_codes_update" on public.sync_codes;
create policy "sync_codes_update"
on public.sync_codes
for update
using (true)
with check (sync_code is not null and length(sync_code) > 0);


-- =============================
-- Sicherheits-Haertung: Code-Mitgliedschaften + RPC
-- =============================

create table if not exists public.device_sync_memberships (
  user_id uuid not null,
  sync_code text not null references public.sync_codes(sync_code) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  primary key (user_id, sync_code)
);

create index if not exists device_sync_memberships_sync_code_idx
  on public.device_sync_memberships (sync_code);

alter table public.device_sync_memberships enable row level security;

create or replace function public.has_sync_membership(p_sync_code text, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.device_sync_memberships m
    where m.sync_code = p_sync_code
      and m.user_id = p_user_id
  );
$$;

revoke all on function public.has_sync_membership(text, uuid) from public;
grant execute on function public.has_sync_membership(text, uuid) to authenticated;

drop function if exists public.use_sync_code(text);
drop function if exists public.use_sync_code(text, boolean);
drop function if exists public.use_sync_code(text, boolean, boolean);

create or replace function public.use_sync_code(
  p_code text,
  p_allow_create boolean default true,
  p_require_new boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_now timestamptz := now();
  v_exists boolean := false;
  v_created boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_code !~ '^[A-Z]{4}[0-9]{4}$' then
    raise exception 'SYNC_CODE_FORMAT_INVALID';
  end if;

  if v_code = 'HELP0000' then
    raise exception 'SYNC_CODE_RESERVED';
  end if;

  select exists(select 1 from public.sync_codes where sync_code = v_code)
    into v_exists;

  if p_require_new and v_exists then
    raise exception 'SYNC_CODE_ALREADY_EXISTS';
  end if;

  if not v_exists then
    if not p_allow_create then
      raise exception 'SYNC_CODE_NOT_FOUND';
    end if;

    insert into public.sync_codes (sync_code, created_at, last_used_at)
    values (v_code, v_now, v_now)
    on conflict (sync_code) do update
      set last_used_at = excluded.last_used_at;

    v_created := true;
  else
    update public.sync_codes
    set last_used_at = v_now
    where sync_code = v_code;
  end if;

  insert into public.device_sync_memberships (user_id, sync_code, created_at, last_used_at)
  values (v_uid, v_code, v_now, v_now)
  on conflict (user_id, sync_code) do update
    set last_used_at = excluded.last_used_at;

  return jsonb_build_object(
    'sync_code', v_code,
    'created', v_created,
    'joined', true
  );
end;
$$;

revoke all on function public.use_sync_code(text, boolean, boolean) from public;
grant execute on function public.use_sync_code(text, boolean, boolean) to authenticated;

-- Direkten Tabellenzugriff auf Sync-Codes/Memberships fuer Clients sperren
revoke select, insert, update on public.sync_codes from anon, authenticated;
revoke all on public.device_sync_memberships from anon, authenticated;

-- RLS-Policies neu: shopping_items nur mit Membership

drop policy if exists "shopping_items_select_by_code" on public.shopping_items;
create policy "shopping_items_select_by_code"
on public.shopping_items
for select
to authenticated
using (
  auth.uid() is not null
  and public.has_sync_membership(shopping_items.sync_code, auth.uid())
);

drop policy if exists "shopping_items_insert_by_code" on public.shopping_items;
create policy "shopping_items_insert_by_code"
on public.shopping_items
for insert
to authenticated
with check (
  auth.uid() is not null
  and public.has_sync_membership(shopping_items.sync_code, auth.uid())
  and sync_code is not null and length(trim(sync_code)) > 0
  and item_id is not null and length(trim(item_id)) > 0
);

drop policy if exists "shopping_items_update_by_code" on public.shopping_items;
create policy "shopping_items_update_by_code"
on public.shopping_items
for update
to authenticated
using (
  auth.uid() is not null
  and public.has_sync_membership(shopping_items.sync_code, auth.uid())
)
with check (
  auth.uid() is not null
  and public.has_sync_membership(shopping_items.sync_code, auth.uid())
  and sync_code is not null and length(trim(sync_code)) > 0
  and item_id is not null and length(trim(item_id)) > 0
);

drop policy if exists "shopping_items_delete_by_code" on public.shopping_items;
create policy "shopping_items_delete_by_code"
on public.shopping_items
for delete
to authenticated
using (
  auth.uid() is not null
  and public.has_sync_membership(shopping_items.sync_code, auth.uid())
);

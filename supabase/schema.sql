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
security definer
set search_path = public
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

-- =============================
-- Offline-First Sync (Soft Delete + idempotente Ops)
-- =============================

alter table public.shopping_items
  add column if not exists deleted_at timestamptz;

alter table public.shopping_items
  add column if not exists client_updated_at timestamptz;

alter table public.shopping_items
  add column if not exists updated_by_device text;

create index if not exists shopping_items_sync_code_updated_at_idx
  on public.shopping_items (sync_code, updated_at desc);

create index if not exists shopping_items_sync_code_deleted_at_idx
  on public.shopping_items (sync_code, deleted_at)
  where deleted_at is not null;

create table if not exists public.shopping_item_applied_ops (
  sync_code text not null,
  device_id text not null,
  op_id text not null,
  item_id text not null,
  op_type text not null,
  applied_at timestamptz not null default now(),
  primary key (sync_code, device_id, op_id)
);

create index if not exists shopping_item_applied_ops_sync_code_applied_at_idx
  on public.shopping_item_applied_ops (sync_code, applied_at desc);

alter table public.shopping_item_applied_ops enable row level security;
revoke all on public.shopping_item_applied_ops from anon, authenticated;

create or replace function public.apply_shopping_ops(
  p_sync_code text,
  p_device_id text,
  p_ops jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_ops jsonb := coalesce(p_ops, '[]'::jsonb);
  v_op jsonb;
  v_op_id text;
  v_op_type text;
  v_item_id text;
  v_text text;
  v_erledigt boolean;
  v_position integer;
  v_client_updated_at timestamptz;
  v_existing public.shopping_items%rowtype;
  v_applied integer := 0;
  v_skipped integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if coalesce(trim(p_sync_code), '') = '' then
    raise exception 'SYNC_CODE_REQUIRED';
  end if;

  if coalesce(trim(p_device_id), '') = '' then
    raise exception 'DEVICE_ID_REQUIRED';
  end if;

  if not public.has_sync_membership(p_sync_code, v_uid) then
    raise exception 'SYNC_CODE_NOT_JOINED';
  end if;

  for v_op in
    select value
    from jsonb_array_elements(v_ops)
  loop
    v_op_id := coalesce(trim(v_op->>'opId'), '');
    v_op_type := lower(coalesce(trim(v_op->>'opType'), ''));
    v_item_id := coalesce(trim(v_op->>'itemId'), '');
    v_text := coalesce(v_op->>'text', '[deleted]');
    v_erledigt := coalesce((v_op->>'erledigt')::boolean, false);
    v_position := coalesce((v_op->>'position')::integer, 0);
    v_client_updated_at := nullif(v_op->>'clientUpdatedAt', '')::timestamptz;

    if v_op_id = '' or v_item_id = '' or v_op_type not in ('upsert', 'delete') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.shopping_item_applied_ops a
      where a.sync_code = p_sync_code
        and a.device_id = p_device_id
        and a.op_id = v_op_id
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select *
    into v_existing
    from public.shopping_items s
    where s.sync_code = p_sync_code
      and s.item_id = v_item_id
    for update;

    if v_op_type = 'delete' then
      if found then
        update public.shopping_items
        set
          deleted_at = coalesce(deleted_at, v_now),
          updated_by_device = p_device_id,
          client_updated_at = coalesce(v_client_updated_at, client_updated_at),
          position = v_position
        where sync_code = p_sync_code
          and item_id = v_item_id;
      else
        insert into public.shopping_items (
          sync_code,
          item_id,
          text,
          erledigt,
          position,
          deleted_at,
          client_updated_at,
          updated_by_device
        ) values (
          p_sync_code,
          v_item_id,
          coalesce(nullif(v_text, ''), '[deleted]'),
          false,
          v_position,
          v_now,
          v_client_updated_at,
          p_device_id
        );
      end if;
    else
      if found then
        -- Delete-wins ohne explizite Restore-Operation:
        -- Tombstones werden nicht durch alte Offline-Updates reaktiviert.
        if v_existing.deleted_at is null then
          update public.shopping_items
          set
            text = v_text,
            erledigt = v_erledigt,
            position = v_position,
            client_updated_at = coalesce(v_client_updated_at, client_updated_at),
            updated_by_device = p_device_id
          where sync_code = p_sync_code
            and item_id = v_item_id;
        else
          v_skipped := v_skipped + 1;
        end if;
      else
        insert into public.shopping_items (
          sync_code,
          item_id,
          text,
          erledigt,
          position,
          deleted_at,
          client_updated_at,
          updated_by_device
        ) values (
          p_sync_code,
          v_item_id,
          v_text,
          v_erledigt,
          v_position,
          null,
          v_client_updated_at,
          p_device_id
        );
      end if;
    end if;

    insert into public.shopping_item_applied_ops (
      sync_code,
      device_id,
      op_id,
      item_id,
      op_type,
      applied_at
    ) values (
      p_sync_code,
      p_device_id,
      v_op_id,
      v_item_id,
      v_op_type,
      v_now
    );

    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function public.apply_shopping_ops(text, text, jsonb) from public;
grant execute on function public.apply_shopping_ops(text, text, jsonb) to authenticated;

-- =============================
-- Retention: Alte Daten aufräumen (manuell oder als Cron-Job)
-- =============================

create or replace function public.cleanup_old_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tombstones integer;
  v_ops integer;
begin
  -- Soft-delete-Tombstones nach 90 Tagen permanent löschen
  delete from public.shopping_items
  where deleted_at is not null
    and deleted_at < now() - interval '90 days';
  get diagnostics v_tombstones = row_count;

  -- Angewendete Ops-Logs nach 90 Tagen löschen
  delete from public.shopping_item_applied_ops
  where applied_at < now() - interval '90 days';
  get diagnostics v_ops = row_count;

  return jsonb_build_object(
    'tombstones_deleted', v_tombstones,
    'ops_deleted', v_ops
  );
end;
$$;

revoke all on function public.cleanup_old_data() from public;
grant execute on function public.cleanup_old_data() to authenticated;

-- Aufruf (manuell in Supabase SQL-Editor):
-- select public.cleanup_old_data();
-- Als Cron-Job (Supabase Dashboard → Database → Scheduled jobs → täglich):
-- select public.cleanup_old_data();

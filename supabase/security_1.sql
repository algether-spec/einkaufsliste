-- =============================================================
-- security_1.sql – Sicherheits-Härtung, Schritt 1
--
-- Verträglich mit dem ALTEN Client (Produktion ≤ v1.0.163) und dem neuen.
-- Ausführen: Supabase Dashboard → SQL Editor → komplett ausführen.
-- Mehrfaches Ausführen ist unschädlich.
--
-- Danach Schritt 2 (security_2.sql) ERST, wenn der neue Client auf main ist.
-- =============================================================


-- -------------------------------------------------------------
-- 1. has_sync_membership: nur noch Auskunft über den eigenen User
--    (vorher konnte jeder für beliebige user_id/Code-Kombinationen fragen)
-- -------------------------------------------------------------
create or replace function public.has_sync_membership(p_sync_code text, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1
      from public.device_sync_memberships m
      where m.sync_code = p_sync_code
        and m.user_id = p_user_id
    );
$$;

revoke all on function public.has_sync_membership(text, uuid) from public;
grant execute on function public.has_sync_membership(text, uuid) to authenticated;


-- -------------------------------------------------------------
-- 2. Hilfsfunktion: User zu einem Code als Mitglied eintragen
-- -------------------------------------------------------------
create or replace function public.sync_membership_add(p_user_id uuid, p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sync_codes set last_used_at = now() where sync_code = p_code;
  insert into public.device_sync_memberships (user_id, sync_code, created_at, last_used_at)
  values (p_user_id, p_code, now(), now())
  on conflict (user_id, sync_code) do update set last_used_at = excluded.last_used_at;
$$;

revoke all on function public.sync_membership_add(uuid, text) from public, anon, authenticated;


-- -------------------------------------------------------------
-- 3. use_sync_code mit Begrenzung gegen Durchprobieren von Codes
--    Max. 20 fremde Codes pro User und Stunde (eigene Codes zählen nicht).
--    NOT_FOUND / ALREADY_EXISTS werden als JSON zurückgegeben statt geworfen,
--    damit der Versuch gezählt wird (eine Exception würde ihn zurückrollen).
-- -------------------------------------------------------------
create table if not exists public.sync_code_join_attempts (
  user_id uuid not null,
  sync_code text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists sync_code_join_attempts_user_time_idx
  on public.sync_code_join_attempts (user_id, attempted_at desc);

alter table public.sync_code_join_attempts enable row level security;
revoke all on public.sync_code_join_attempts from anon, authenticated;

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
  v_exists boolean;
  v_attempts integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_code !~ '^[A-Z]{4}[0-9]{4}$' then raise exception 'SYNC_CODE_FORMAT_INVALID'; end if;
  if v_code = 'HELP0000' then raise exception 'SYNC_CODE_RESERVED'; end if;

  -- Bereits Mitglied → kein Limit, nur Zeitstempel aktualisieren
  if exists (select 1 from public.device_sync_memberships
             where user_id = v_uid and sync_code = v_code) then
    perform public.sync_membership_add(v_uid, v_code);
    return jsonb_build_object('sync_code', v_code, 'created', false, 'joined', true);
  end if;

  select count(*) into v_attempts
  from public.sync_code_join_attempts
  where user_id = v_uid and attempted_at > now() - interval '1 hour';
  if v_attempts >= 20 then raise exception 'SYNC_CODE_RATE_LIMITED'; end if;

  insert into public.sync_code_join_attempts (user_id, sync_code) values (v_uid, v_code);

  select exists(select 1 from public.sync_codes where sync_code = v_code) into v_exists;

  if p_require_new and v_exists then
    return jsonb_build_object('error', 'SYNC_CODE_ALREADY_EXISTS');
  end if;
  if not v_exists and not p_allow_create then
    return jsonb_build_object('error', 'SYNC_CODE_NOT_FOUND');
  end if;

  if not v_exists then
    insert into public.sync_codes (sync_code) values (v_code) on conflict do nothing;
  end if;
  perform public.sync_membership_add(v_uid, v_code);

  return jsonb_build_object('sync_code', v_code, 'created', not v_exists, 'joined', true);
end;
$$;

revoke all on function public.use_sync_code(text, boolean, boolean) from public, anon;
grant execute on function public.use_sync_code(text, boolean, boolean) to authenticated;


-- -------------------------------------------------------------
-- 4. Join-Token einlösen (ersetzt direktes Lesen von device_join_tokens)
--    Token = 128-Bit-Zufallswert → wer ihn hat, darf beitreten.
-- -------------------------------------------------------------
create or replace function public.redeem_join_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token public.device_join_tokens%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_token
  from public.device_join_tokens
  where join_token = trim(coalesce(p_token, ''))
    and (expires_at is null or expires_at > now());

  if not found or not exists (select 1 from public.sync_codes where sync_code = v_token.sync_code) then
    return null;
  end if;

  perform public.sync_membership_add(v_uid, v_token.sync_code);
  return jsonb_build_object(
    'rolle', v_token.rolle,
    'sync_code', v_token.sync_code,
    'expires_at', v_token.expires_at
  );
end;
$$;

revoke all on function public.redeem_join_token(text) from public, anon;
grant execute on function public.redeem_join_token(text) to authenticated;


-- -------------------------------------------------------------
-- 5. Legacy-Einladung (#invite=<device_id>) einlösen
--    (ersetzt direktes Lesen von sync_invites)
-- -------------------------------------------------------------
create or replace function public.redeem_legacy_invite(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select i.sync_code into v_code
  from public.sync_invites i
  join public.sync_codes c on c.sync_code = i.sync_code
  where i.device_id = trim(coalesce(p_device_id, ''));

  if v_code is null then return null; end if;

  perform public.sync_membership_add(v_uid, v_code);
  return jsonb_build_object('sync_code', v_code);
end;
$$;

revoke all on function public.redeem_legacy_invite(text) from public, anon;
grant execute on function public.redeem_legacy_invite(text) to authenticated;


-- -------------------------------------------------------------
-- 6. apply_shopping_ops mit Grenzen (Schutz gegen Speicher-Missbrauch)
--    Client: 200 Ops/Batch, Fotos bis 5 MB Text → Server etwas großzügiger.
-- -------------------------------------------------------------
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
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce(trim(p_sync_code), '') = '' then raise exception 'SYNC_CODE_REQUIRED'; end if;
  if coalesce(trim(p_device_id), '') = '' or length(p_device_id) > 128 then
    raise exception 'DEVICE_ID_INVALID';
  end if;
  if jsonb_typeof(v_ops) <> 'array' or jsonb_array_length(v_ops) > 500 then
    raise exception 'TOO_MANY_OPS';
  end if;
  if not public.has_sync_membership(p_sync_code, v_uid) then
    raise exception 'SYNC_CODE_NOT_JOINED';
  end if;

  for v_op in select value from jsonb_array_elements(v_ops)
  loop
    v_op_id := coalesce(trim(v_op->>'opId'), '');
    v_op_type := lower(coalesce(trim(v_op->>'opType'), ''));
    v_item_id := coalesce(trim(v_op->>'itemId'), '');
    v_text := coalesce(v_op->>'text', '[deleted]');
    v_erledigt := coalesce((v_op->>'erledigt')::boolean, false);
    v_position := coalesce((v_op->>'position')::integer, 0);
    v_client_updated_at := nullif(v_op->>'clientUpdatedAt', '')::timestamptz;

    if v_op_id = '' or v_item_id = '' or v_op_type not in ('upsert', 'delete')
       or length(v_op_id) > 128 or length(v_item_id) > 128
       or length(v_text) > 6000000 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (
      select 1 from public.shopping_item_applied_ops a
      where a.sync_code = p_sync_code and a.device_id = p_device_id and a.op_id = v_op_id
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_existing
    from public.shopping_items s
    where s.sync_code = p_sync_code and s.item_id = v_item_id
    for update;

    if v_op_type = 'delete' then
      if found then
        update public.shopping_items
        set deleted_at = coalesce(deleted_at, v_now),
            updated_by_device = p_device_id,
            client_updated_at = coalesce(v_client_updated_at, client_updated_at),
            position = v_position
        where sync_code = p_sync_code and item_id = v_item_id;
      else
        insert into public.shopping_items (sync_code, item_id, text, erledigt, position,
                                           deleted_at, client_updated_at, updated_by_device)
        values (p_sync_code, v_item_id, coalesce(nullif(v_text, ''), '[deleted]'), false,
                v_position, v_now, v_client_updated_at, p_device_id);
      end if;
    else
      if found then
        -- Delete-wins: Tombstones werden nicht durch alte Offline-Updates reaktiviert
        if v_existing.deleted_at is null then
          update public.shopping_items
          set text = v_text,
              erledigt = v_erledigt,
              position = v_position,
              client_updated_at = coalesce(v_client_updated_at, client_updated_at),
              updated_by_device = p_device_id
          where sync_code = p_sync_code and item_id = v_item_id;
        else
          v_skipped := v_skipped + 1;
        end if;
      else
        insert into public.shopping_items (sync_code, item_id, text, erledigt, position,
                                           deleted_at, client_updated_at, updated_by_device)
        values (p_sync_code, v_item_id, v_text, v_erledigt, v_position,
                null, v_client_updated_at, p_device_id);
      end if;
    end if;

    insert into public.shopping_item_applied_ops (sync_code, device_id, op_id, item_id, op_type, applied_at)
    values (p_sync_code, p_device_id, v_op_id, v_item_id, v_op_type, v_now);

    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_shopping_ops(text, text, jsonb) from public, anon;
grant execute on function public.apply_shopping_ops(text, text, jsonb) to authenticated;


-- -------------------------------------------------------------
-- 7. shopping_items: Schreiben nur noch über apply_shopping_ops
--    (Client liest die Tabelle nur; so greifen die Grenzen aus Punkt 6)
-- -------------------------------------------------------------
revoke insert, update, delete on public.shopping_items from anon, authenticated;
revoke all on public.shopping_items from anon;


-- -------------------------------------------------------------
-- 8. Join-Tokens und Einladungen: Anlegen/Ändern nur für Mitglieder
--    (der Client tut das nur nach erfolgreichem Beitritt)
-- -------------------------------------------------------------
drop policy if exists "device_join_tokens_insert" on public.device_join_tokens;
create policy "device_join_tokens_insert"
on public.device_join_tokens
for insert
to authenticated
with check (
  length(trim(coalesce(join_token, ''))) >= 16
  and rolle in ('hauptgeraet', 'gast')
  and public.has_sync_membership(sync_code, auth.uid())
);

drop policy if exists "device_join_tokens_update" on public.device_join_tokens;
create policy "device_join_tokens_update"
on public.device_join_tokens
for update
to authenticated
using (public.has_sync_membership(sync_code, auth.uid()))
with check (
  length(trim(coalesce(join_token, ''))) >= 16
  and rolle in ('hauptgeraet', 'gast')
  and public.has_sync_membership(sync_code, auth.uid())
);

drop policy if exists "sync_invites_insert" on public.sync_invites;
create policy "sync_invites_insert"
on public.sync_invites
for insert
to authenticated
with check (
  length(trim(coalesce(device_id, ''))) > 0
  and public.has_sync_membership(sync_code, auth.uid())
);

drop policy if exists "sync_invites_update" on public.sync_invites;
create policy "sync_invites_update"
on public.sync_invites
for update
to authenticated
using (public.has_sync_membership(sync_code, auth.uid()))
with check (
  length(trim(coalesce(device_id, ''))) > 0
  and public.has_sync_membership(sync_code, auth.uid())
);


-- -------------------------------------------------------------
-- 9. Aufräumen nur noch intern / per Cron, nicht für Clients
-- -------------------------------------------------------------
create or replace function public.cleanup_old_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tombstones integer;
  v_ops integer;
  v_attempts integer;
  v_tokens integer;
begin
  delete from public.shopping_items
  where deleted_at is not null and deleted_at < now() - interval '90 days';
  get diagnostics v_tombstones = row_count;

  delete from public.shopping_item_applied_ops
  where applied_at < now() - interval '90 days';
  get diagnostics v_ops = row_count;

  delete from public.sync_code_join_attempts
  where attempted_at < now() - interval '1 day';
  get diagnostics v_attempts = row_count;

  delete from public.device_join_tokens
  where expires_at is not null and expires_at < now() - interval '7 days';
  get diagnostics v_tokens = row_count;

  return jsonb_build_object(
    'tombstones_deleted', v_tombstones,
    'ops_deleted', v_ops,
    'attempts_deleted', v_attempts,
    'tokens_deleted', v_tokens
  );
end;
$$;

revoke all on function public.cleanup_old_data() from public, anon, authenticated;

-- Hilfsfunktion für Trigger braucht keine erhöhten Rechte
alter function public.set_updated_at() security invoker;

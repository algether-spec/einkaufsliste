-- =============================================================
-- security_2.sql – Sicherheits-Härtung, Schritt 2
--
-- VORAUSSETZUNG: security_1.sql ist ausgeführt UND der neue Client
-- (ab v1.0.167, nutzt redeem_join_token / redeem_legacy_invite) ist auf main.
-- Der alte Client liest Join-Tokens und Einladungen direkt aus den Tabellen
-- und würde nach diesem Schritt neue Gäste nicht mehr verbinden können.
--
-- VORAUSSETZUNG Erinnerungen-App: ab v1.0.51 auf main (nutzt dieselben Tabellen).
--
-- Ausführen: Supabase Dashboard → SQL Editor → NICHTS markieren →
-- komplett ausführen. Mehrfaches Ausführen ist unschädlich.
-- Bei Erfolg erscheint eine Tabelle mit genau 9 Regeln, bei einer
-- Abweichung eine Fehlermeldung und es wird ALLES zurückgerollt.
-- =============================================================


-- -------------------------------------------------------------
-- 0. ALLE bestehenden Regeln dieser drei Tabellen entfernen – auch solche,
--    die im Dashboard angelegt wurden (z. B. "device_roles select" mit
--    auth.role() = 'authenticated'). Regeln werden mit ODER verknüpft:
--    eine offene Regel würde alle strengen Regeln aushebeln.
-- -------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('device_join_tokens', 'sync_invites', 'device_roles')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end
$$;


-- -------------------------------------------------------------
-- 1. device_join_tokens: nur Tokens der eigenen Codes sichtbar
--    (vorher: jeder konnte ALLE Tokens samt Sync-Code auslesen
--     und damit jeder Liste beitreten)
--    Fremde Geräte lösen Tokens über redeem_join_token() ein.
-- -------------------------------------------------------------
drop policy if exists "device_join_tokens_select" on public.device_join_tokens;
create policy "device_join_tokens_select"
on public.device_join_tokens
for select
to authenticated
using (public.has_sync_membership(sync_code, auth.uid()));

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


-- -------------------------------------------------------------
-- 2. sync_invites: nur Einladungen der eigenen Codes sichtbar
--    Fremde Geräte lösen Einladungen über redeem_legacy_invite() ein.
-- -------------------------------------------------------------
drop policy if exists "sync_invites_select" on public.sync_invites;
create policy "sync_invites_select"
on public.sync_invites
for select
to authenticated
using (public.has_sync_membership(sync_code, auth.uid()));

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
-- 3. device_roles: Lesen und Schreiben nur für Mitglieder des Codes
--    (vorher: jeder konnte alle Geräte → Sync-Codes lesen und
--     beliebige Rollen-Einträge überschreiben)
-- -------------------------------------------------------------
drop policy if exists "device_roles_select" on public.device_roles;
create policy "device_roles_select"
on public.device_roles
for select
to authenticated
using (public.has_sync_membership(sync_code, auth.uid()));

drop policy if exists "device_roles_insert" on public.device_roles;
create policy "device_roles_insert"
on public.device_roles
for insert
to authenticated
with check (
  length(trim(coalesce(device_id, ''))) > 0
  and public.has_sync_membership(sync_code, auth.uid())
);

drop policy if exists "device_roles_update" on public.device_roles;
create policy "device_roles_update"
on public.device_roles
for update
to authenticated
using (public.has_sync_membership(sync_code, auth.uid()))
with check (
  length(trim(coalesce(device_id, ''))) > 0
  and public.has_sync_membership(sync_code, auth.uid())
);


-- -------------------------------------------------------------
-- 4. Selbstkontrolle – bricht bei Abweichung ab (alles wird zurückgerollt)
-- -------------------------------------------------------------
do $$
declare
  v_count integer;
  v_bad integer;
begin
  select count(*),
         count(*) filter (
           where roles <> '{authenticated}'
              or coalesce(qual, '') || coalesce(with_check, '') not like '%has_sync_membership%'
         )
  into v_count, v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('device_join_tokens', 'sync_invites', 'device_roles');

  if v_count <> 9 or v_bad <> 0 then
    raise exception 'KONTROLLE FEHLGESCHLAGEN: % Regeln, davon % offen (erwartet 9, 0 offen)', v_count, v_bad;
  end if;
end
$$;

-- Ergebnis anzeigen: erwartet genau 9 Zeilen, alle {authenticated}
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('device_join_tokens', 'sync_invites', 'device_roles')
order by tablename, cmd;

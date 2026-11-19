-- =============================================================
-- security_2.sql – Sicherheits-Härtung, Schritt 2
--
-- VORAUSSETZUNG: security_1.sql ist ausgeführt UND der neue Client
-- (ab v1.0.167, nutzt redeem_join_token / redeem_legacy_invite) ist auf main.
-- Der alte Client liest Join-Tokens und Einladungen direkt aus den Tabellen
-- und würde nach diesem Schritt neue Gäste nicht mehr verbinden können.
--
-- Ausführen: Supabase Dashboard → SQL Editor → komplett ausführen.
-- =============================================================


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
-- Prüfung (optional):
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies where schemaname = 'public' order by tablename, cmd;
-- -------------------------------------------------------------

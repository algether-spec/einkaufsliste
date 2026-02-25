# Supabase Setup

## 1) Tabelle anlegen
1. Supabase Projekt oeffnen.
2. SQL Editor oeffnen.
3. Inhalt aus `supabase/schema.sql` ausfuehren.

## 2) Auth aktivieren
1. In Supabase: `Authentication -> Providers -> Anonymous`.
2. Anonymous Sign-Ins aktivieren.

## 3) App konfigurieren
1. `config.example.js` nach `config.js` kopieren (oder `config.js` direkt bearbeiten).
2. `supabaseUrl` und `supabaseAnonKey` eintragen.

## 4) Verhalten
- Wenn Supabase konfiguriert ist: Daten werden lokal gespeichert und zusaetzlich mit Supabase synchronisiert.
- Wenn Supabase nicht erreichbar ist: App bleibt lokal nutzbar (Fallback auf `localStorage`).
- Sync laeuft ueber einen 8-stelligen geraeteuebergreifenden Zahlencode (`Geräte-Code` in der App).
- Auf beiden Handys denselben Code eintragen, dann teilen beide dieselbe Liste.
- `00000000` ist reserviert (Anleitungs-Code) und kann nicht als Geräte-Code genutzt werden.

## 5) Hinweis
- Die Tabelle ist mit Row Level Security (RLS) geschuetzt.
- Zugriff wird fuer diese Version ueber den Sync-Code gesteuert.
- Zusaetzlich speichert `sync_codes` dauerhaft, welche Codes schon genutzt wurden (`created_at`, `last_used_at`).
- Dadurch kann `Neu` belegte Codes zuverlaessiger erkennen, auch wenn eine Liste gerade leer ist.

## 6) Fehlerbild: "erst Verbunden, dann Offline (lokal)"
- Ursache ist meist fehlende DB-Berechtigung fuer `anon`/`authenticated` (insb. Sequence bei Insert).
- Loesung: `supabase/schema.sql` im SQL Editor erneut komplett ausfuehren.
- Danach App auf beiden Geraeten neu laden und erneut mit gleichem 8-stelligen Code verbinden.

## 7) Fehlerbild: `null value in column "user_id"`
- Das ist ein Altbestand aus frueherem Schema (`user_id` war `NOT NULL`).
- Loesung: `supabase/schema.sql` erneut komplett ausfuehren (enthaelt die automatische Migration).

## 8) Fehlerbild: `column shopping_items.item_id does not exist`
- Das Schema ist noch nicht auf dem aktuellen Stand (neuer stabiler Eintrag-Sync mit `item_id`).
- Loesung: `supabase/schema.sql` erneut komplett ausfuehren, danach App auf beiden Geraeten neu laden.


## 9) Fehlerbild: `42P10` bei Sync (`ON CONFLICT`)
- Ursache: Der benoetigte UNIQUE-Index auf `shopping_items(sync_code, item_id)` fehlt oder ist nicht korrekt nutzbar.
- Die App nutzt `upsert(..., { onConflict: "sync_code,item_id" })` und braucht dafuer einen passenden UNIQUE-Index.
- Pruefen in Supabase: `pg_indexes` fuer `public.shopping_items`.
- Wenn noetig: Duplikate (`sync_code`, `item_id`) bereinigen und danach den Index neu anlegen:
  `create unique index shopping_items_sync_code_item_id_uidx on public.shopping_items (sync_code, item_id);`
- Danach App neu laden / Update druecken und erneut testen.

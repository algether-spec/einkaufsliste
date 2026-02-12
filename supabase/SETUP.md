# Supabase Setup

## 1) Tabelle anlegen
1. Supabase Projekt oeffnen.
2. SQL Editor oeffnen.
3. Inhalt aus `supabase/schema.sql` ausfuehren.

## 2) Auth aktivieren
1. In Supabase: `Authentication -> Providers -> Anonymous`.
2. Anonymous Sign-Ins aktivieren.
3. In Supabase: `Authentication -> Sign In / Providers -> Email` aktiv lassen.
4. Unter `Authentication -> URL Configuration` die Site URL auf deine App-URL setzen (z. B. GitHub Pages URL).

## 3) App konfigurieren
1. `config.example.js` nach `config.js` kopieren (oder `config.js` direkt bearbeiten).
2. `supabaseUrl` und `supabaseAnonKey` eintragen.

## 4) Verhalten
- Wenn Supabase konfiguriert ist: Daten werden lokal gespeichert und zusaetzlich mit Supabase synchronisiert.
- Wenn Supabase nicht erreichbar ist: App bleibt lokal nutzbar (Fallback auf `localStorage`).
- Sync ist user-basiert ueber anonyme Supabase-Auth.
- Optional kann per Magic-Link-E-Mail auf mehreren Geraeten derselbe Account genutzt werden.

## 5) Hinweis
- Die Tabelle ist mit Row Level Security (RLS) geschuetzt.
- Jeder User sieht nur seine eigenen Eintraege (`auth.uid() = user_id`).

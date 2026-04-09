# Offline-First Sync-Strategie

## Kernregeln
- Synchronisation ist operationbasiert (Upsert/Delete-Operationen), nicht Snapshot-Overwrite.
- Jede Operation besitzt `opId` + `deviceId` und wird serverseitig idempotent verarbeitet.
- Konflikte bei parallelem `update/update`: Last-Write-Wins ueber serverseitiges `updated_at`.
- Loeschungen sind Soft-Deletes (`deleted_at`) und gewinnen gegen spaete stale Updates (kein unbeabsichtigtes Wiederbeleben).

## Konfliktmatrix
- `create` vs `create` (verschiedene `item_id`): beide bleiben erhalten.
- `update` vs `update` (gleiche `item_id`): letzte serverseitig angewendete Operation gewinnt.
- `delete` vs `update` (gleiche `item_id`): Delete bleibt bestehen, Update wird fuer Tombstone ignoriert.
- `delete` vs `delete`: idempotent, Item bleibt geloescht.

## Ablauf (2 Offline-Geraete)
1. Beide Geraete bearbeiten lokal und legen Operationen in lokale Queue.
2. Bei Reconnect werden Operations-Batches via `apply_shopping_ops` hochgeladen.
3. Server wendet jede Operation genau einmal an (Dedup ueber `(sync_code, device_id, op_id)`).
4. Geraete laden danach alle Remote-Aenderungen seit `lastRemoteSyncAt`.

## Reihenfolge (`position`)
- `position` wird als Feld pro Operation synchronisiert.
- Bei parallelen Updates gilt ebenfalls Last-Write-Wins.
- Client sortiert stabil nach `position` und normalisiert danach laufende Reihenfolge.

## Trade-offs
- Delete-Wins verhindert unbeabsichtigte Wiederbelebung, erfordert fuer echte Wiederherstellung ein neues Item (neue `item_id`) oder eine explizite Restore-Funktion.
- Tombstones (`deleted_at`) bleiben erhalten und sollten spaeter optional per Retention-Job bereinigt werden.

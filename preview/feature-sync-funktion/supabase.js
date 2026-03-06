/* ======================
   SUPABASE.JS
   Datenbankverbindung, Auth, Realtime und Remote-Queries.
====================== */

const hasSupabaseCredentials = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);
const hasSupabaseLibrary = Boolean(
    window.supabase && typeof window.supabase.createClient === "function"
);
const supabaseClient = hasSupabaseCredentials && hasSupabaseLibrary
    ? window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey)
    : null;

let supabaseReady = false;
let supabaseUserId = "";
let echtzeitKanal = null;
let echtzeitTimer = null;


/* --- Auth ------------------------------------------------------- */

async function authSicherstellen() {
    if (keinNetzwerk()) {
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        return false;
    }
    if (!supabaseClient) {
        eingabeFehlerSetzen("Supabase Client nicht initialisiert. config.js / Internet pruefen.");
        syncStatusSetzen("Sync: Offline (lokal)", "offline");
        return false;
    }
    if (supabaseReady && supabaseUserId) return true;

    try {
        syncStatusSetzen("Sync: Verbinde...", "warn");
        const sessionResult = await supabaseClient.auth.getSession();
        if (sessionResult?.error) throw sessionResult.error;
        let user = sessionResult?.data?.session?.user || null;

        if (!user) {
            const anonResult = await supabaseClient.auth.signInAnonymously();
            if (anonResult?.error) throw anonResult.error;
            user = anonResult?.data?.user || null;
        }

        if (!user?.id) {
            eingabeFehlerSetzen("Anonyme Anmeldung fehlgeschlagen. Supabase Auth/Anon-Login pruefen.");
            syncStatusSetzen("Anonyme Anmeldung fehlgeschlagen. Supabase Auth/Anon-Login pruefen.", "offline");
            syncDebugAktualisieren();
            return false;
        }
        supabaseUserId = user.id;
        supabaseReady = true;
        echtzeitSyncStarten();
        eingabeFehlerSetzen("");
        syncStatusSetzen("Sync: Verbunden", "ok");
        syncDebugAktualisieren();
        return true;
    } catch (err) {
        console.warn("Supabase Auth nicht verfuegbar:", err);
        supabaseReady = false;
        supabaseUserId = "";
        echtzeitSyncStoppen();
        eingabeFehlerSetzen(syncFehlerHinweis(err));
        syncStatusSetzen(syncFehlerHinweis(err), "offline");
        syncDebugAktualisieren();
        return false;
    }
}


/* --- Realtime --------------------------------------------------- */

function echtzeitSyncStoppen() {
    if (echtzeitTimer) {
        clearTimeout(echtzeitTimer);
        echtzeitTimer = null;
    }
    if (!supabaseClient || !echtzeitKanal) return;
    try {
        supabaseClient.removeChannel(echtzeitKanal);
    } catch (err) {
        console.warn("Realtime-Channel konnte nicht entfernt werden:", err);
    }
    echtzeitKanal = null;
}

function echtzeitAktualisierungPlanen() {
    if (echtzeitTimer) clearTimeout(echtzeitTimer);
    echtzeitTimer = setTimeout(() => {
        void vonRemoteAktualisieren();
    }, 250);
}

function echtzeitSyncStarten() {
    if (!supabaseClient || !currentSyncCode) return;
    echtzeitSyncStoppen();

    echtzeitKanal = supabaseClient
        .channel(`shopping_items_${currentSyncCode}`)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: SUPABASE_TABLE,
                filter: `sync_code=eq.${currentSyncCode}`
            },
            () => {
                if (document.hidden) return;
                echtzeitAktualisierungPlanen();
            }
        )
        .subscribe(status => {
            if (status === "CHANNEL_ERROR") {
                console.warn("Realtime-Channel Fehler, nutze Polling weiter.");
                echtzeitSyncStoppen();
            }
        });
}


/* --- Sync-Code RPC ---------------------------------------------- */

async function syncCodeRpcVerwenden(code, options = {}) {
    if (!supabaseClient) throw new Error("SUPABASE_CLIENT_MISSING");
    if (!istGueltigerSyncCode(code)) throw new Error("SYNC_CODE_FORMAT_INVALID");
    if (istReservierterSyncCode(code)) throw new Error("SYNC_CODE_RESERVED");
    if (!(await authSicherstellen())) throw new Error("AUTH_REQUIRED");

    const allowCreate = options.allowCreate !== false;
    const requireNew = options.requireNew === true;

    const { data, error } = await supabaseClient.rpc("use_sync_code", {
        p_code: String(code),
        p_allow_create: allowCreate,
        p_require_new: requireNew
    });
    if (error) throw error;
    return data;
}

async function syncCodeNutzungAktualisieren(code) {
    if (!supabaseClient) return;
    if (!istGueltigerSyncCode(code)) return;
    if (istReservierterSyncCode(code)) return;
    await syncCodeRpcVerwenden(code, { allowCreate: true, requireNew: false });
}


/* --- Remote-Operationen ----------------------------------------- */

async function ausstehendHochladen() {
    const meta = syncMetaLaden();
    if (!Array.isArray(meta.pendingOps) || meta.pendingOps.length === 0) return false;
    if (!supabaseClient) return false;
    if (!(await authSicherstellen())) return false;

    const batch = meta.pendingOps.slice(0, SYNC_OP_BATCH_SIZE);
    const { error } = await supabaseClient.rpc("apply_shopping_ops", {
        p_sync_code: currentSyncCode,
        p_device_id: geraeteIdLaden(),
        p_ops: batch
    });
    if (error) throw error;

    meta.pendingOps = meta.pendingOps.slice(batch.length);
    syncMetaSpeichern(meta);
    return batch.length > 0;
}

function remoteZeilenAnwenden(snapshotData, remoteRows) {
    const snapshotMap = new Map(normalizeSnapshotData(snapshotData).map(item => [item.itemId, item]));
    let latestUpdatedAt = "";

    for (const row of remoteRows) {
        const itemId = String(row.itemId || "").trim();
        if (!itemId) continue;
        const rowUpdatedAt = String(row.updatedAt || "");
        if (rowUpdatedAt && (!latestUpdatedAt || rowUpdatedAt > latestUpdatedAt)) {
            latestUpdatedAt = rowUpdatedAt;
        }
        if (row.deletedAt) {
            snapshotMap.delete(itemId);
            continue;
        }
        snapshotMap.set(itemId, {
            itemId,
            text: String(row.text || ""),
            erledigt: Boolean(row.erledigt),
            position: Number.isFinite(row.position) ? row.position : snapshotMap.size
        });
    }

    return {
        snapshot: [...snapshotMap.values()].sort((a, b) => a.position - b.position),
        latestUpdatedAt
    };
}

async function remoteAenderungenLaden(lastRemoteSyncAt) {
    if (!supabaseClient) return [];
    if (!(await authSicherstellen())) return [];

    const PAGE_SIZE = 500;
    const alle = [];
    let offset = 0;

    while (true) {
        let query = supabaseClient
            .from(SUPABASE_TABLE)
            .select("item_id, text, erledigt, position, deleted_at, updated_at")
            .eq("sync_code", currentSyncCode)
            .order("updated_at", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (lastRemoteSyncAt) {
            query = query.gt("updated_at", lastRemoteSyncAt);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) break;
        alle.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return alle.slice(0, MAX_REMOTE_ROWS).flatMap((row, index) => {
        const itemId = String(row.item_id || "").trim().slice(0, MAX_ITEM_ID_LENGTH);
        if (!itemId) return [];
        const position = Number.isFinite(row.position) && row.position >= 0 ? row.position : index;
        return [{
            itemId,
            text: (() => {
                const t = String(row.text || "");
                return t.slice(0, isPhotoEntryText(t) ? MAX_PHOTO_TEXT_LENGTH : MAX_TEXT_LENGTH);
            })(),
            erledigt: Boolean(row.erledigt),
            position,
            deletedAt: row.deleted_at ? String(row.deleted_at) : "",
            updatedAt: row.updated_at ? String(row.updated_at) : ""
        }];
    });
}

async function remoteAenderungenAnwenden(authStatusMsg) {
    const meta = syncMetaLaden();
    const remoteChanges = await remoteAenderungenLaden(meta.lastRemoteSyncAt);
    if (remoteChanges.length > 0) {
        const applied = remoteZeilenAnwenden(meta.snapshot, remoteChanges);
        meta.snapshot = applied.snapshot;
        if (applied.latestUpdatedAt) meta.lastRemoteSyncAt = applied.latestUpdatedAt;
        syncMetaSpeichern(meta);
        snapshotInUiSchreiben(meta.snapshot);
        authStatusSetzen(authStatusMsg);
    }
}

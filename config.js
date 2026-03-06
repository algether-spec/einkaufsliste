window.APP_CONFIG = {
  supabaseUrl: "https://eixhupjefdpwyvnsqejf.supabase.co",
  supabaseAnonKey: "sb_publishable_a9RPkdLen0OGWL2CK5zKAg_dm_saG8Q"
};

const APP_CONFIG = window.APP_CONFIG || {};

/* ======================
   KONSTANTEN
====================== */

const APP_VERSION = "1.0.122";
const STORAGE_KEY = "einkaufsliste";
const SUPABASE_TABLE = "shopping_items";
const SYNC_CODE_KEY = "einkaufsliste-sync-code";
const SYNC_META_PREFIX = "einkaufsliste-sync-meta:";
const DEVICE_ID_KEY = "einkaufsliste-device-id";

const SYNC_OP_BATCH_SIZE = 200;
const MAX_REMOTE_ROWS = 10_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_PHOTO_TEXT_LENGTH = 5_000_000;
const MAX_ITEM_ID_LENGTH = 128;
const TOMBSTONE_TEXT = "[deleted]";
const IMAGE_IDB_REF_PREFIX = "__IMG_IDB__:";

const PHOTO_IDB_NAME = "einkaufsliste-photos";
const PHOTO_IDB_STORE = "photos";

const SYNC_CODE_LENGTH = 8;
const RESERVED_SYNC_CODE = "HELP0000";

const BACKGROUND_SYNC_INTERVAL_MS = 4000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 60000;
const MIC_SESSION_MS = 30000;

const MODUS_ERFASSEN = "erfassen";
const MODUS_EINKAUFEN = "einkaufen";

const debugEnabled = new URLSearchParams(location.search).get("debug") === "1";

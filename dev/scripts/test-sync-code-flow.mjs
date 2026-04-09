/**
 * Logik-Test für den Sync-Code-Fluss beim PWA-Install.
 * Testet die Kernlogik aus app.js ohne Browser-APIs.
 *
 * Szenarien:
 *  A) Erstinstall: Link mit Hash → Code aus URL übernommen
 *  B) Frische PWA ohne URL-Code → Code wird generiert
 *  C) Bestehender Code + gleicher URL-Code → kein Konflikt
 *  D) Bestehender Code + anderer URL-Code (Install-URL) → kein Dialog, permanenter Code bleibt
 *  E) Bestehender Code + echter neuer geteilter Link → Konflikt-Dialog
 *  F) Permanenter Code überlebt generierten Code (kein Überschreiben)
 *  G) Code-Normalisierung (Kleinbuchstaben, Sonderzeichen)
 *  H) Reservierter Code HELP0000 wird nicht gespeichert
 */

// --- Minimal-Implementierung der Kernlogik (aus config.js / sync.js / app.js) ---

const SYNC_CODE_KEY = "einkaufsliste-sync-code";
const SYNC_CODE_PERMANENT_KEY = "einkaufsliste-sync-code-permanent";
const SYNC_CODE_INSTALL_URL_KEY = "einkaufsliste-install-url-code";
const RESERVED_SYNC_CODE = "HELP0000";
const SYNC_CODE_LENGTH = 8;

function createStorage() {
    const d = {};
    return {
        getItem: k => Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null,
        setItem: (k, v) => { d[k] = String(v); },
        removeItem: k => { delete d[k]; },
        _dump: () => ({ ...d })
    };
}

function syncCodeNormalisieren(input) {
    const raw = String(input || "").toUpperCase();
    const letters = raw.replace(/[^A-Z]/g, "").slice(0, 4);
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    return (letters + digits).slice(0, SYNC_CODE_LENGTH);
}

function istGueltigerSyncCode(code) {
    return /^[A-Z]{4}[0-9]{4}$/.test(String(code || ""));
}

function istReservierterSyncCode(code) {
    return code === RESERVED_SYNC_CODE;
}

function syncCodeErzeugen() {
    const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = RESERVED_SYNC_CODE;
    while (istReservierterSyncCode(code)) {
        let l = "", d = "";
        for (let i = 0; i < 4; i++) l += L[Math.floor(Math.random() * 26)];
        for (let i = 0; i < 4; i++) d += Math.floor(Math.random() * 10);
        code = l + d;
    }
    return code;
}

// Simuliert die Logik von app.js + syncCodeLadenMitBackup
function simuliereAppStart(ls, locationHash = "", locationSearch = "") {
    const hashParams = new URLSearchParams(locationHash.startsWith("#") ? locationHash.slice(1) : locationHash);
    const rawHashCode = hashParams.get("code");
    const rawQueryCode = new URLSearchParams(locationSearch.startsWith("?") ? locationSearch.slice(1) : locationSearch).get("code");
    const rawUrlCode = rawHashCode || rawQueryCode;
    const normalizedUrlCode = rawUrlCode ? syncCodeNormalisieren(rawUrlCode) : "";

    const preExistingCode = syncCodeNormalisieren(
        ls.getItem(SYNC_CODE_PERMANENT_KEY) || ls.getItem(SYNC_CODE_KEY) || ""
    );
    const hatVorherigenCode = istGueltigerSyncCode(preExistingCode) && !istReservierterSyncCode(preExistingCode);
    const urlCodeGueltig = istGueltigerSyncCode(normalizedUrlCode);
    const urlCodeAutoAnwenden = urlCodeGueltig && !istReservierterSyncCode(normalizedUrlCode) && !hatVorherigenCode;

    let installUrlCode = syncCodeNormalisieren(ls.getItem(SYNC_CODE_INSTALL_URL_KEY) || "");
    let istInstallUrl = false;

    if (urlCodeAutoAnwenden) {
        ls.setItem(SYNC_CODE_PERMANENT_KEY, normalizedUrlCode);
        ls.setItem(SYNC_CODE_KEY, normalizedUrlCode);
        ls.setItem(SYNC_CODE_INSTALL_URL_KEY, normalizedUrlCode);
        installUrlCode = normalizedUrlCode;
    }

    istInstallUrl = urlCodeGueltig && installUrlCode === normalizedUrlCode;

    // Konflikt-Dialog?
    const zeigeKonflikt = urlCodeGueltig && hatVorherigenCode
        && preExistingCode !== normalizedUrlCode && !istInstallUrl;

    // syncCodeLadenMitBackup Logik
    const fromPermanent = syncCodeNormalisieren(ls.getItem(SYNC_CODE_PERMANENT_KEY) || "");
    if (istGueltigerSyncCode(fromPermanent) && !istReservierterSyncCode(fromPermanent)) {
        ls.setItem(SYNC_CODE_KEY, fromPermanent);
        return { code: fromPermanent, source: "permanent", konflikt: zeigeKonflikt };
    }
    const fromLs = syncCodeNormalisieren(ls.getItem(SYNC_CODE_KEY) || "");
    if (istGueltigerSyncCode(fromLs) && !istReservierterSyncCode(fromLs)) {
        return { code: fromLs, source: "localStorage", konflikt: zeigeKonflikt };
    }
    const generated = syncCodeErzeugen();
    ls.setItem(SYNC_CODE_KEY, generated); // permanent NICHT gesetzt (auto-generiert)
    return { code: generated, source: "generated", konflikt: zeigeKonflikt };
}

// --- Test-Runner ---

let pass = 0, fail = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        pass++;
    } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
        fail++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || "Assertion failed");
}

// ===== SZENARIO A: Erstinstall vom geteilten Link =====
console.log("\n[A] Erstinstall: Link mit Hash öffnen");
{
    const ls = createStorage();
    const r = simuliereAppStart(ls, "#code=RIGX2191");
    test("Code RIGX2191 wird übernommen", () => assert(r.code === "RIGX2191", `Got: ${r.code}`));
    test("Quelle ist 'permanent'", () => assert(r.source === "permanent", `Got: ${r.source}`));
    test("Kein Konflikt-Dialog", () => assert(!r.konflikt, "Konflikt unerwünscht"));
    test("SYNC_CODE_PERMANENT_KEY gesetzt", () => assert(ls.getItem(SYNC_CODE_PERMANENT_KEY) === "RIGX2191"));
    test("SYNC_CODE_INSTALL_URL_KEY gesetzt", () => assert(ls.getItem(SYNC_CODE_INSTALL_URL_KEY) === "RIGX2191"));
}

// ===== SZENARIO B: Frische PWA ohne URL-Code =====
console.log("\n[B] Frische PWA ohne URL-Code (leerer localStorage)");
{
    const ls = createStorage();
    const r = simuliereAppStart(ls, "");
    test("Code wurde generiert", () => assert(istGueltigerSyncCode(r.code), `Got: ${r.code}`));
    test("Quelle ist 'generated'", () => assert(r.source === "generated", `Got: ${r.source}`));
    test("Kein Konflikt-Dialog", () => assert(!r.konflikt));
    test("Permanent-Slot LEER (auto-generiert ≠ permanent)", () => {
        assert(ls.getItem(SYNC_CODE_PERMANENT_KEY) === null, `Got: ${ls.getItem(SYNC_CODE_PERMANENT_KEY)}`);
    });
}

// ===== SZENARIO C: PWA-Start mit Install-URL (gleicher Code) =====
console.log("\n[C] Folgestart: Install-URL-Code = permanenter Code");
{
    const ls = createStorage();
    // Erster Start: Code aus Link
    simuliereAppStart(ls, "#code=RIGX2191");
    // Zweiter Start: gleicher Code in URL
    const r2 = simuliereAppStart(ls, "#code=RIGX2191");
    test("Code RIGX2191 bleibt", () => assert(r2.code === "RIGX2191", `Got: ${r2.code}`));
    test("Kein Konflikt-Dialog", () => assert(!r2.konflikt));
}

// ===== SZENARIO D: Nutzer ändert Code, dann PWA-Start mit alter Install-URL =====
console.log("\n[D] Nutzer ändert Code → PWA-Start mit alter Install-URL zeigt keinen Dialog");
{
    const ls = createStorage();
    // Erstinstall mit RIGX2191
    simuliereAppStart(ls, "#code=RIGX2191");
    // Nutzer ändert Code manuell zu WXYZ9876
    ls.setItem(SYNC_CODE_PERMANENT_KEY, "WXYZ9876");
    ls.setItem(SYNC_CODE_KEY, "WXYZ9876");
    // PWA-Start – iOS öffnet immer mit Install-URL #code=RIGX2191
    const r = simuliereAppStart(ls, "#code=RIGX2191");
    test("Permanenter Code WXYZ9876 wird verwendet", () => assert(r.code === "WXYZ9876", `Got: ${r.code}`));
    test("KEIN Konflikt-Dialog (ist Install-URL)", () => assert(!r.konflikt, "Unerwünschter Konflikt-Dialog"));
    test("Quelle ist 'permanent'", () => assert(r.source === "permanent", `Got: ${r.source}`));
}

// ===== SZENARIO E: Echter neuer geteilter Link → Konflikt-Dialog =====
console.log("\n[E] Echter neuer geteilter Link → Konflikt-Dialog erscheint");
{
    const ls = createStorage();
    // Erstinstall mit RIGX2191
    simuliereAppStart(ls, "#code=RIGX2191");
    // Jemand teilt anderen Link ABCD5678
    const r = simuliereAppStart(ls, "#code=ABCD5678");
    test("Permanenter Code RIGX2191 bleibt", () => assert(r.code === "RIGX2191", `Got: ${r.code}`));
    test("Konflikt-Dialog erscheint (echter neuer Link)", () => assert(r.konflikt, "Konflikt-Dialog erwartet"));
}

// ===== SZENARIO F: Permanenter Code überlebt generierten Code =====
console.log("\n[F] Permanenter Code wird nicht durch auto-generierten überschrieben");
{
    const ls = createStorage();
    // Erstinstall mit Link
    simuliereAppStart(ls, "#code=RIGX2191");
    // Storage wird teilweise geleert (nur SYNC_CODE_KEY)
    ls.removeItem(SYNC_CODE_KEY);
    // Neustart ohne URL
    const r = simuliereAppStart(ls, "");
    test("Permanenter Code RIGX2191 wiederhergestellt", () => assert(r.code === "RIGX2191", `Got: ${r.code}`));
    test("Quelle ist 'permanent'", () => assert(r.source === "permanent", `Got: ${r.source}`));
}

// ===== SZENARIO G: Code-Normalisierung =====
console.log("\n[G] Code-Normalisierung (Kleinbuchstaben, gemischt)");
{
    const ls = createStorage();
    const r = simuliereAppStart(ls, "#code=rigx2191");
    test("Kleinschreibung wird zu RIGX2191 normalisiert", () => assert(r.code === "RIGX2191", `Got: ${r.code}`));
}
{
    const ls = createStorage();
    const r = simuliereAppStart(ls, "?code=RIGX2191"); // Query-Param Fallback
    test("Query-Param ?code= wird als Fallback gelesen", () => assert(r.code === "RIGX2191", `Got: ${r.code}`));
}

// ===== SZENARIO H: Reservierter Code HELP0000 =====
console.log("\n[H] Reservierter Code HELP0000 wird nicht gespeichert");
{
    const ls = createStorage();
    const r = simuliereAppStart(ls, "#code=HELP0000");
    test("HELP0000 wird nicht übernommen", () => assert(r.code !== "HELP0000", `Got: ${r.code}`));
    test("Stattdessen generierter Code", () => assert(r.source === "generated", `Got: ${r.source}`));
    test("Permanent-Slot bleibt leer", () => assert(ls.getItem(SYNC_CODE_PERMANENT_KEY) === null));
}

// ===== SZENARIO I: Mehrere Neustarts – Code bleibt stabil =====
console.log("\n[I] Mehrere PWA-Neustarts – Code bleibt stabil");
{
    const ls = createStorage();
    simuliereAppStart(ls, "#code=RIGX2191"); // Install
    const r2 = simuliereAppStart(ls, "#code=RIGX2191"); // 2. Start
    const r3 = simuliereAppStart(ls, "#code=RIGX2191"); // 3. Start
    const r4 = simuliereAppStart(ls, ""); // 4. Start ohne Hash (falls iOS Hash verliert)
    test("2. Start: RIGX2191", () => assert(r2.code === "RIGX2191", `Got: ${r2.code}`));
    test("3. Start: RIGX2191", () => assert(r3.code === "RIGX2191", `Got: ${r3.code}`));
    test("4. Start ohne Hash: permanent RIGX2191 bleibt", () => assert(r4.code === "RIGX2191", `Got: ${r4.code}`));
    test("4. Start: kein Konflikt-Dialog", () => assert(!r4.konflikt));
}

// --- Zusammenfassung ---
const total = pass + fail;
console.log(`\n${"─".repeat(50)}`);
console.log(`${total} Tests: ${pass} bestanden, ${fail} fehlgeschlagen`);
if (fail > 0) {
    console.error("FAIL");
    process.exit(1);
} else {
    console.log("PASS");
}

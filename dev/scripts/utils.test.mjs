import test from 'node:test';
import assert from 'node:assert/strict';
import {
    IMAGE_ENTRY_PREFIX,
    IMAGE_ENTRY_CAPTION_MARKER,
    parsePhotoEntryText,
    buildPhotoEntryText,
    isPhotoEntryText,
    generateItemId,
    normalizeForGroupMatch,
    getGroupIndex,
    GROUP_ORDER,
    normalizeListData,
    normalizeSnapshotData,
    listDataSignature,
    sortDataByCaptureTextFirst,
    sortDataByStoreGroups,
} from '../utils.js';

/* --- isPhotoEntryText / parsePhotoEntryText / buildPhotoEntryText --- */

test('isPhotoEntryText erkennt Foto-Einträge', () => {
    assert.ok(isPhotoEntryText(IMAGE_ENTRY_PREFIX + 'data:image/png;base64,abc'));
    assert.equal(isPhotoEntryText('Milch'), false);
    assert.equal(isPhotoEntryText(''), false);
    assert.equal(isPhotoEntryText(null), false);
});

test('buildPhotoEntryText ohne Caption', () => {
    const text = buildPhotoEntryText('data:image/png;base64,abc');
    assert.ok(text.startsWith(IMAGE_ENTRY_PREFIX));
    assert.ok(!text.includes(IMAGE_ENTRY_CAPTION_MARKER));
});

test('buildPhotoEntryText mit Caption', () => {
    const text = buildPhotoEntryText('data:image/png;base64,abc', 'Einkaufsliste');
    assert.ok(text.includes(IMAGE_ENTRY_CAPTION_MARKER));
    assert.ok(text.endsWith('Einkaufsliste'));
});

test('parsePhotoEntryText round-trip mit Caption', () => {
    const src = 'data:image/png;base64,xyz';
    const cap = 'Mein Foto';
    const built = buildPhotoEntryText(src, cap);
    const parsed = parsePhotoEntryText(built);
    assert.equal(parsed.imageSrc, src);
    assert.equal(parsed.caption, cap);
});

test('parsePhotoEntryText round-trip ohne Caption', () => {
    const src = 'data:image/jpeg;base64,abc123';
    const built = buildPhotoEntryText(src);
    const parsed = parsePhotoEntryText(built);
    assert.equal(parsed.imageSrc, src);
    assert.equal(parsed.caption, '');
});

test('parsePhotoEntryText gibt null für normalen Text', () => {
    assert.equal(parsePhotoEntryText('Milch'), null);
    assert.equal(parsePhotoEntryText(''), null);
});

/* --- generateItemId --- */

test('generateItemId gibt eindeutige IDs zurück', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateItemId()));
    assert.equal(ids.size, 50);
});

test('generateItemId gibt nicht-leere Strings zurück', () => {
    const id = generateItemId();
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
});

/* --- normalizeForGroupMatch --- */

test('normalizeForGroupMatch wandelt Umlaute um', () => {
    assert.equal(normalizeForGroupMatch('Äpfel'), 'aepfel');
    assert.equal(normalizeForGroupMatch('Öl'), 'oel');
    assert.equal(normalizeForGroupMatch('Über'), 'ueber');
    assert.equal(normalizeForGroupMatch('Straße'), 'strasse');
});

test('normalizeForGroupMatch gibt Kleinschrift zurück', () => {
    assert.equal(normalizeForGroupMatch('MILCH'), 'milch');
});

/* --- getGroupIndex --- */

test('getGroupIndex ordnet Milch der Milch/Eier-Gruppe zu', () => {
    const milchIdx = getGroupIndex('Milch');
    const obst = getGroupIndex('Apfel');
    assert.ok(milchIdx !== GROUP_ORDER.length, 'Milch sollte einer Gruppe zugeordnet sein');
    assert.ok(obst !== GROUP_ORDER.length, 'Apfel sollte einer Gruppe zugeordnet sein');
    assert.notEqual(milchIdx, obst); // verschiedene Gruppen
});

test('getGroupIndex ordnet unbekannte Artikel ans Ende', () => {
    const idx = getGroupIndex('ZzZunbekannt999');
    assert.equal(idx, GROUP_ORDER.length);
});

test('getGroupIndex ordnet Foto-Einträge nach unbekannten Artikeln', () => {
    const photoIdx = getGroupIndex(IMAGE_ENTRY_PREFIX + 'data:image/png;base64,x');
    assert.equal(photoIdx, GROUP_ORDER.length + 1);
});

test('getGroupIndex ist deterministisch (Cache)', () => {
    const a = getGroupIndex('Joghurt');
    const b = getGroupIndex('Joghurt');
    assert.equal(a, b);
});

/* --- normalizeListData --- */

test('normalizeListData filtert leere Texte', () => {
    const result = normalizeListData([
        { text: 'Milch', erledigt: false },
        { text: '', erledigt: false },
        { text: '   ', erledigt: false },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'Milch');
});

test('normalizeListData ergänzt fehlende itemIds', () => {
    const result = normalizeListData([
        { text: 'Brot' },
        { text: 'Käse' },
    ]);
    assert.ok(result[0].itemId.length > 0);
    assert.ok(result[1].itemId.length > 0);
    assert.notEqual(result[0].itemId, result[1].itemId);
});

test('normalizeListData dedupliziert doppelte itemIds', () => {
    const result = normalizeListData([
        { itemId: 'same', text: 'Milch' },
        { itemId: 'same', text: 'Butter' },
    ]);
    assert.equal(result.length, 2);
    assert.notEqual(result[0].itemId, result[1].itemId);
});

test('normalizeListData normalisiert erledigt auf Boolean', () => {
    const result = normalizeListData([
        { text: 'A', erledigt: 1 },
        { text: 'B', erledigt: 0 },
        { text: 'C' },
    ]);
    assert.equal(result[0].erledigt, true);
    assert.equal(result[1].erledigt, false);
    assert.equal(result[2].erledigt, false);
});

test('normalizeListData setzt position fortlaufend', () => {
    const result = normalizeListData([
        { text: 'A', position: 99 },
        { text: 'B', position: 3 },
    ]);
    assert.equal(result[0].position, 0);
    assert.equal(result[1].position, 1);
});

test('normalizeListData gibt [] für Nicht-Array zurück', () => {
    assert.deepEqual(normalizeListData(null), []);
    assert.deepEqual(normalizeListData(undefined), []);
    assert.deepEqual(normalizeListData('string'), []);
});

/* --- listDataSignature --- */

test('listDataSignature ist stabil bei gleichen Daten', () => {
    const daten = [{ itemId: 'x', text: 'Milch', erledigt: false, position: 0 }];
    assert.equal(listDataSignature(daten), listDataSignature(daten));
});

test('listDataSignature ignoriert Groß-/Kleinschreibung des Textes', () => {
    const a = [{ itemId: 'x', text: 'Milch', erledigt: false, position: 0 }];
    const b = [{ itemId: 'x', text: 'MILCH', erledigt: false, position: 0 }];
    assert.equal(listDataSignature(a), listDataSignature(b));
});

test('listDataSignature unterscheidet verschiedene Daten', () => {
    const a = [{ itemId: 'x', text: 'Milch', erledigt: false, position: 0 }];
    const b = [{ itemId: 'x', text: 'Butter', erledigt: false, position: 0 }];
    assert.notEqual(listDataSignature(a), listDataSignature(b));
});

/* --- sortDataByCaptureTextFirst --- */

test('sortDataByCaptureTextFirst: Text vor Foto, Offene vor Erledigt', () => {
    const daten = [
        { itemId: '1', text: IMAGE_ENTRY_PREFIX + 'x', erledigt: false, position: 0 },
        { itemId: '2', text: 'Milch', erledigt: false, position: 1 },
        { itemId: '3', text: 'Brot', erledigt: true, position: 2 },
        { itemId: '4', text: 'Käse', erledigt: false, position: 3 },
    ];
    const result = sortDataByCaptureTextFirst(daten);
    // Offene Texte zuerst
    assert.equal(result[0].text, 'Milch');
    assert.equal(result[1].text, 'Käse');
    // Dann offene Fotos
    assert.ok(isPhotoEntryText(result[2].text));
    // Dann erledigte
    assert.equal(result[3].erledigt, true);
});

test('sortDataByCaptureTextFirst setzt positions neu', () => {
    const daten = [
        { itemId: '1', text: 'A', erledigt: false, position: 99 },
        { itemId: '2', text: 'B', erledigt: false, position: 42 },
    ];
    const result = sortDataByCaptureTextFirst(daten);
    assert.equal(result[0].position, 0);
    assert.equal(result[1].position, 1);
});

/* --- sortDataByStoreGroups --- */

test('sortDataByStoreGroups sortiert nach Gruppen', () => {
    const daten = [
        { itemId: '1', text: 'Wasser', erledigt: false, position: 0 },
        { itemId: '2', text: 'Milch', erledigt: false, position: 1 },
        { itemId: '3', text: 'Apfel', erledigt: false, position: 2 },
    ];
    const result = sortDataByStoreGroups(daten);
    const groupIdxApfel = getGroupIndex('Apfel');
    const groupIdxMilch = getGroupIndex('Milch');
    const groupIdxWasser = getGroupIndex('Wasser');
    // Die relative Gruppenreihenfolge muss erhalten bleiben
    const posApfel = result.findIndex(e => e.text === 'Apfel');
    const posMilch = result.findIndex(e => e.text === 'Milch');
    const posWasser = result.findIndex(e => e.text === 'Wasser');
    assert.ok(posApfel < posMilch === (groupIdxApfel < groupIdxMilch) || groupIdxApfel === groupIdxMilch);
    assert.ok(posMilch < posWasser === (groupIdxMilch < groupIdxWasser) || groupIdxMilch === groupIdxWasser);
});

test('sortDataByStoreGroups: Fotos ans Ende', () => {
    const daten = [
        { itemId: '1', text: IMAGE_ENTRY_PREFIX + 'x', erledigt: false, position: 0 },
        { itemId: '2', text: 'Milch', erledigt: false, position: 1 },
    ];
    const result = sortDataByStoreGroups(daten);
    assert.equal(result[0].text, 'Milch');
    assert.ok(isPhotoEntryText(result[result.length - 1].text));
});

test('sortDataByStoreGroups: Erledigte nach Offenen', () => {
    const daten = [
        { itemId: '1', text: 'Milch', erledigt: true, position: 0 },
        { itemId: '2', text: 'Brot', erledigt: false, position: 1 },
    ];
    const result = sortDataByStoreGroups(daten);
    assert.equal(result[0].erledigt, false);
    assert.equal(result[1].erledigt, true);
});

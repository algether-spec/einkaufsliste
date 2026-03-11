/* ======================
   UI.JS
   DOM-Elemente, Benutzeroberfläche, Eingabe, Sprache, Foto, Modus.
====================== */

/* --- DOM-Elemente ----------------------------------------------- */

const liste = document.getElementById("liste");

const btnErfassen    = document.getElementById("btnErfassen");
const btnEinkaufen   = document.getElementById("btnEinkaufen");
const btnExport      = document.getElementById("btnExport");
const btnForceUpdate = document.getElementById("btn-force-update");
const syncCodeCompact   = document.getElementById("sync-code-compact");
const btnSyncCodeDisplay = document.getElementById("btn-sync-code-display");
const btnSyncCodeShare   = document.getElementById("btn-sync-code-share");
const btnSyncConnect     = document.getElementById("btn-sync-connect");
const versionBadge   = document.getElementById("version-badge");
const syncStatus     = document.getElementById("sync-status");
const syncDebug      = document.getElementById("sync-debug");
const authBar        = document.getElementById("auth-bar");
const syncCodeInput  = document.getElementById("sync-code");
const btnSyncApply   = document.getElementById("btn-sync-apply");
const authStatus     = document.getElementById("auth-status");

const multiInput       = document.getElementById("multi-line-input");
const multiAdd         = document.getElementById("add-all-button");
const btnPhotoOcr      = document.getElementById("btn-photo-ocr");
const photoOcrInput    = document.getElementById("photo-ocr-input");
const btnClearInput    = document.getElementById("btn-clear-input");
const btnNewLine       = document.getElementById("newline-button");
const btnMic           = document.getElementById("mic-button");
const micStatus        = document.getElementById("mic-status");
const inputErrorStatus = document.getElementById("input-error-status");
const imageViewer      = document.getElementById("image-viewer");
const imageViewerImg   = document.getElementById("image-viewer-img");
const btnImageViewerClose = document.getElementById("btn-image-viewer-close");
const helpViewer          = document.getElementById("help-viewer");
const btnHelpViewerClose  = document.getElementById("btn-help-viewer-close");
const btnHelp             = document.getElementById("btn-help");

const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;

let modus = MODUS_ERFASSEN;

if (authBar) authBar.hidden = true;


/* --- Status-Anzeigen -------------------------------------------- */

function syncStatusSetzen(text, tone = "offline") {
    if (!syncStatus) return;
    syncStatus.textContent = text;
    syncStatus.classList.remove("ok", "warn", "offline");
    syncStatus.classList.add(tone);
}

function authStatusSetzen(text) {
    if (!authStatus) return;
    authStatus.textContent = text;
}

function eingabeFehlerSetzen(text) {
    if (!inputErrorStatus) return;
    inputErrorStatus.textContent = String(text || "").trim();
}



/* --- Listen-Rendering ------------------------------------------- */

function datenAusListeLesen() {
    const daten = [];
    liste.querySelectorAll("li").forEach((li, index) => {
        const itemId = String(li.dataset.itemId || "").trim() || generateItemId();
        li.dataset.itemId = itemId;
        daten.push({
            itemId,
            text: li.dataset.rawText || li.dataset.text || "",
            erledigt: li.classList.contains("erledigt"),
            position: index
        });
    });
    return daten;
}

function datenInListeSchreiben(daten) {
    const fragment = document.createDocumentFragment();
    daten.forEach(e => eintragAnlegen(e.text, e.erledigt, e.itemId, fragment));
    liste.innerHTML = "";
    liste.appendChild(fragment);
}

function eintragAnlegen(text, erledigt = false, itemId = generateItemId(), _batchTarget = null) {
    const li = document.createElement("li");
    const rawText = String(text || "");
    li.dataset.itemId = String(itemId || "").trim() || generateItemId();
    li.dataset.rawText = rawText;
    li.dataset.text = rawText;
    if (isPhotoEntryText(rawText)) li.classList.add("foto-eintrag");

    if (rawText.startsWith(IMAGE_ENTRY_PREFIX)) {
        const parsedPhoto = parsePhotoEntryText(rawText) || { imageSrc: "", caption: "" };
        const rawImageSrc = parsedPhoto.imageSrc;
        const imageSrc = String(rawImageSrc || "").startsWith("data:image/") ? rawImageSrc : "";
        let photoCaption = String(parsedPhoto.caption || "").trim();

        const wrapper = document.createElement("div");
        wrapper.className = "list-photo-item";

        const thumb = document.createElement("img");
        thumb.className = "list-photo-thumb";
        thumb.src = imageSrc;
        thumb.alt = photoCaption ? `Foto: ${photoCaption}` : "Fotoeintrag";

        const content = document.createElement("div");
        content.className = "list-photo-content";

        const actions = document.createElement("div");
        actions.className = "list-photo-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "list-photo-open";
        openBtn.textContent = "Foto öffnen";
        openBtn.onclick = event => {
            event.stopPropagation();
            bildViewerOeffnen(imageSrc);
        };

        const captionBtn = document.createElement("button");
        captionBtn.type = "button";
        captionBtn.className = "list-photo-caption";
        captionBtn.textContent = "Text";

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "list-photo-delete";
        deleteBtn.textContent = "Löschen";
        deleteBtn.onclick = event => {
            event.stopPropagation();
            li.remove();
            speichern();
            mikStatusSetzen("Foto gelöscht.");
        };

        const captionText = document.createElement("div");
        captionText.className = "list-photo-caption-text";

        const applyPhotoCaption = (nextCaption, saveNow = false) => {
            photoCaption = String(nextCaption || "").trim();
            li.dataset.rawText = buildPhotoEntryText(imageSrc, photoCaption);
            li.dataset.text = li.dataset.rawText;
            thumb.alt = photoCaption ? `Foto: ${photoCaption}` : "Fotoeintrag";
            captionText.textContent = photoCaption;
            captionText.hidden = !photoCaption;
            captionBtn.textContent = photoCaption ? "Text ändern" : "Text";
            if (saveNow) speichern();
        };

        captionBtn.onclick = event => {
            event.stopPropagation();
            const current = photoCaption;
            const result = window.prompt("Bildbeschreibung (optional):", current);
            if (result === null) return;
            applyPhotoCaption(result, true);
            mikStatusSetzen(result.trim() ? "Bildbeschreibung gespeichert." : "Bildbeschreibung entfernt.");
        };

        thumb.onclick = event => {
            event.stopPropagation();
            bildViewerOeffnen(imageSrc);
        };

        actions.appendChild(openBtn);
        actions.appendChild(captionBtn);
        actions.appendChild(deleteBtn);
        content.appendChild(actions);
        content.appendChild(captionText);

        wrapper.appendChild(thumb);
        wrapper.appendChild(content);
        li.appendChild(wrapper);

        applyPhotoCaption(photoCaption, false);
    } else {
        li.textContent = rawText;
    }

    if (erledigt) li.classList.add("erledigt");

    li.onclick = () => {
        if (modus !== MODUS_EINKAUFEN) return;
        li.classList.toggle("erledigt");
        listeNachGruppenSortieren();
        speichern();
    };

    if (_batchTarget) {
        _batchTarget.appendChild(li);
        return;
    }

    if (erledigt) {
        liste.appendChild(li);
        return;
    }

    if (modus === MODUS_ERFASSEN) {
        if (isPhotoEntryText(rawText)) {
            liste.appendChild(li);
        } else {
            const firstText = liste.querySelector("li:not(.foto-eintrag)");
            const firstPhoto = liste.querySelector("li.foto-eintrag");
            if (firstText) liste.insertBefore(li, firstText);
            else if (firstPhoto) liste.insertBefore(li, firstPhoto);
            else liste.appendChild(li);
        }
        return;
    }

    liste.appendChild(li);
}


/* --- Sortierung -------------------------------------------------- */

function listeNachErfassungSortieren() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;
    const sortierte = sortDataByCaptureTextFirst(daten);
    datenInListeSchreiben(sortierte);
    void speichernLokal(sortierte);
    return true;
}

function listeNachGruppenSortieren() {
    const daten = normalizeListData(datenAusListeLesen());
    if (!daten.length) return false;
    const sortierte = sortDataByStoreGroups(daten);
    datenInListeSchreiben(sortierte);
    void speichernLokal(sortierte);
    return true;
}

function modusSortierungAnwenden() {
    if (modus === MODUS_EINKAUFEN) {
        listeNachGruppenSortieren();
        return;
    }
    if (modus === MODUS_ERFASSEN) {
        listeNachErfassungSortieren();
    }
}


/* --- Modus ------------------------------------------------------- */

function modusSetzen(neu) {
    const vorher = modus;
    modus = neu;

    btnErfassen.classList.toggle("active", modus === MODUS_ERFASSEN);
    btnEinkaufen.classList.toggle("active", modus === MODUS_EINKAUFEN);
    document.body.classList.toggle("modus-einkaufen", modus === MODUS_EINKAUFEN);
    if (syncCodeCompact) syncCodeCompact.hidden = modus !== MODUS_ERFASSEN;
    if (authBar) authBar.hidden = !(modus === MODUS_ERFASSEN && syncEditMode);

    if (vorher !== MODUS_EINKAUFEN && neu === MODUS_EINKAUFEN) {
        if (listeNachGruppenSortieren()) speichern();
    }

    if (vorher === MODUS_EINKAUFEN && neu === MODUS_ERFASSEN) {
        liste.querySelectorAll("li.erledigt").forEach(li => li.remove());
        listeNachErfassungSortieren();
        speichern();
    }
}

btnErfassen.onclick  = () => modusSetzen(MODUS_ERFASSEN);
btnEinkaufen.onclick = () => modusSetzen(MODUS_EINKAUFEN);


/* --- Eingabe-Größe ---------------------------------------------- */

function eingabeGroessenpassen() {
    multiInput.style.height = "auto";
    multiInput.style.height = multiInput.scrollHeight + "px";
}

function fokusInputAmEnde() {
    const pos = multiInput.value.length;
    multiInput.setSelectionRange(pos, pos);
}


/* --- Mehrzeilen-Eingabe ------------------------------------------ */

function mehrzeilenSpeichern() {
    const text = multiInput.value.trim();
    if (!text) return;

    text.split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .forEach(item => eintragAnlegen(item));

    if (modus === MODUS_EINKAUFEN) listeNachGruppenSortieren();
    multiInput.value = "";
    eingabeGroessenpassen();
    speichern();
    multiInput.blur();

    if (isListening) {
        finalTranscript = "";
        latestTranscript = "";
        skipAutoSaveForCurrentBuffer = true;
        ignoreResultsUntil = Date.now() + 500;
        restartMicAfterManualCommit = true;
        clearTimeout(micSessionTimer);
        recognition.stop();
        mikStatusSetzen("Eintrag gespeichert, Mikro wird neu gestartet...");
    }
}

function eingabeLeeren(stopDictation = false) {
    multiInput.value = "";
    eingabeGroessenpassen();

    finalTranscript = "";
    latestTranscript = "";
    skipAutoSaveForCurrentBuffer = true;
    ignoreResultsUntil = Date.now() + 700;

    if (stopDictation && isListening && recognition) {
        restartMicAfterManualCommit = false;
        clearTimeout(micSessionTimer);
        recognition.stop();
        mikStatusSetzen("Eingabe geloescht.");
        return;
    }

    if (isListening) mikStatusSetzen("Eingabe geloescht. Bitte weiter sprechen...");
    else mikStatusSetzen("Eingabe geloescht.");
}

multiAdd.onclick = mehrzeilenSpeichern;

if (btnClearInput) {
    btnClearInput.onclick = () => eingabeLeeren(false);
}

btnNewLine.onclick = () => {
    multiInput.value += "\n";
    eingabeGroessenpassen();
    multiInput.blur();
};

multiInput.addEventListener("input", eingabeGroessenpassen);
multiInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const start = multiInput.selectionStart;
    const end = multiInput.selectionEnd;
    const text = multiInput.value;
    multiInput.value = text.slice(0, start) + "\n" + text.slice(end);
    const nextPos = start + 1;
    multiInput.setSelectionRange(nextPos, nextPos);
    eingabeGroessenpassen();
});


/* --- Viewer ----------------------------------------------------- */

function bildViewerOeffnen(src) {
    if (!imageViewer || !imageViewerImg) return;
    imageViewerImg.src = src;
    imageViewer.hidden = false;
}

function bildViewerSchliessen() {
    if (!imageViewer || !imageViewerImg) return;
    imageViewer.hidden = true;
    imageViewerImg.src = "";
}

function hilfeViewerOeffnen() {
    if (!helpViewer) return;
    helpViewer.hidden = false;
}

function hilfeViewerSchliessen() {
    if (!helpViewer) return;
    helpViewer.hidden = true;
}

if (btnImageViewerClose) btnImageViewerClose.onclick = bildViewerSchliessen;
if (imageViewer) {
    imageViewer.onclick = event => {
        if (event.target === imageViewer) bildViewerSchliessen();
    };
}
if (btnHelp) btnHelp.onclick = hilfeViewerOeffnen;
if (btnHelpViewerClose) btnHelpViewerClose.onclick = hilfeViewerSchliessen;
if (helpViewer) {
    helpViewer.onclick = event => {
        if (event.target === helpViewer) hilfeViewerSchliessen();
    };
}


/* --- Foto -------------------------------------------------------- */

function dateiAlsDataUrlLesen(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
        reader.readAsDataURL(file);
    });
}

async function fotoOptimieren(dataUrl) {
    if (!String(dataUrl || "").startsWith("data:image/")) return dataUrl;

    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
            img.src = dataUrl;
        });

        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return dataUrl;
        ctx.drawImage(image, 0, 0, width, height);

        const compressed = canvas.toDataURL("image/jpeg", 0.78);
        return compressed.length < dataUrl.length ? compressed : dataUrl;
    } catch {
        return dataUrl;
    }
}

async function fotoHinzufuegen(file) {
    if (!file) return;
    if (btnPhotoOcr) btnPhotoOcr.disabled = true;
    mikStatusSetzen("Foto wird geladen...");

    try {
        const imageSrc = await dateiAlsDataUrlLesen(file);
        const optimizedImageSrc = await fotoOptimieren(imageSrc);
        eintragAnlegen(buildPhotoEntryText(optimizedImageSrc));
        if (modus === MODUS_EINKAUFEN) listeNachGruppenSortieren();
        speichern();
        if (multiInput?.value?.trim()) {
            mikStatusSetzen("Foto gespeichert. Text bleibt im Feld und kann mit Übernehmen gespeichert werden.");
        } else {
            mikStatusSetzen("Foto zur Liste hinzugefügt.");
        }
    } catch (err) {
        console.warn("Foto konnte nicht hinzugefuegt werden:", err);
        mikStatusSetzen("Foto konnte nicht gelesen werden.");
    } finally {
        if (btnPhotoOcr) btnPhotoOcr.disabled = false;
        if (photoOcrInput) {
            photoOcrInput.value = "";
            photoOcrInput.type = "";
            photoOcrInput.type = "file";
        }
    }
}

if (btnPhotoOcr && photoOcrInput) {
    btnPhotoOcr.onclick = () => photoOcrInput.click();
    photoOcrInput.onchange = () => {
        const file = photoOcrInput.files?.[0];
        void fotoHinzufuegen(file);
    };
}


/* --- Mikrofon / Sprache ----------------------------------------- */

let recognition;
let isListening = false;
let finalTranscript = "";
let latestTranscript = "";
let micSessionTimer;
let skipAutoSaveForCurrentBuffer = false;
let ignoreResultsUntil = 0;
let restartMicAfterManualCommit = false;

function mikStatusSetzen(message = "") {
    if (!micStatus) return;
    micStatus.textContent = message;
}

function mikButtonSetzen(listening) {
    if (!btnMic) return;
    btnMic.classList.toggle("listening", listening);
    btnMic.setAttribute("aria-pressed", listening ? "true" : "false");
    btnMic.textContent = listening ? "⏹" : "🎤";
}

function eingabeMitDiktat(text) {
    multiInput.value = text;
    eingabeGroessenpassen();
    if (document.activeElement === multiInput) {
        fokusInputAmEnde();
    }
}

function spracherkennungInit() {
    if (!SpeechRecognitionCtor) return null;

    const r = new SpeechRecognitionCtor();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
        isListening = true;
        finalTranscript = "";
        latestTranscript = "";
        skipAutoSaveForCurrentBuffer = false;
        if (Date.now() >= ignoreResultsUntil) ignoreResultsUntil = 0;
        restartMicAfterManualCommit = false;
        mikButtonSetzen(true);
        mikStatusSetzen("Spracheingabe aktiv (max. 30s)...");
        clearTimeout(micSessionTimer);
        micSessionTimer = setTimeout(() => {
            if (!isListening) return;
            mikStatusSetzen("Zeitlimit erreicht.");
            r.stop();
        }, MIC_SESSION_MS);
    };

    r.onresult = event => {
        if (!isListening) return;
        if (Date.now() < ignoreResultsUntil) return;

        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const part = event.results[i][0]?.transcript?.trim() || "";
            if (!part) continue;
            if (event.results[i].isFinal) finalTranscript += (finalTranscript ? " " : "") + part;
            else interimTranscript += (interimTranscript ? " " : "") + part;
        }

        const combined = [finalTranscript, interimTranscript].filter(Boolean).join(" ").trim();
        latestTranscript = combined;
        if (combined) skipAutoSaveForCurrentBuffer = false;
        eingabeMitDiktat(combined);
    };

    r.onerror = event => {
        clearTimeout(micSessionTimer);
        // Zustand zurücksetzen – sonst glaubt die App das Mikro läuft noch
        isListening = false;
        mikButtonSetzen(false);
        // Recognition-Objekt verwerfen: bei Folge-Tap wird ein frisches erstellt
        recognition = null;
        const errorText = {
            "not-allowed": "Mikrofon nicht erlaubt – bitte in Einstellungen erlauben.",
            "service-not-allowed": "Spracherkennung blockiert – bitte in Einstellungen erlauben.",
            "audio-capture": "Kein Mikrofon verfuegbar.",
            "network": "Netzwerkfehler bei Spracherkennung.",
            "no-speech": "Keine Sprache erkannt."
        }[event.error] || ("Spracherkennung-Fehler: " + event.error);
        mikStatusSetzen(errorText);
    };

    r.onend = () => {
        clearTimeout(micSessionTimer);
        isListening = false;
        mikButtonSetzen(false);
        if (restartMicAfterManualCommit) {
            restartMicAfterManualCommit = false;
            spracherkennungStarten();
            return;
        }

        if (skipAutoSaveForCurrentBuffer) {
            skipAutoSaveForCurrentBuffer = false;
            mikStatusSetzen("Spracheingabe beendet.");
            return;
        }

        const spokenText = finalTranscript.trim() || latestTranscript.trim();

        if (spokenText) {
            const currentValue = multiInput.value.trim();
            if (currentValue !== spokenText) {
                multiInput.value = currentValue ? `${currentValue}\n${spokenText}` : spokenText;
            }
            eingabeGroessenpassen();
            multiInput.focus();
            fokusInputAmEnde();
            mikStatusSetzen("Text erkannt. Mit Übernehmen speichern.");
            return;
        }

        if (!micStatus?.textContent) mikStatusSetzen("Keine Sprache erkannt.");
    };

    return r;
}

function spracherkennungStarten() {
    if (!recognition) return;
    mikStatusSetzen("Mikrofon wird gestartet...");

    try {
        recognition.start();
    } catch (error) {
        console.warn("Speech start error:", error);
        // Objekt könnte in kaputtem Zustand sein – verwerfen damit nächster Tap funktioniert
        isListening = false;
        mikButtonSetzen(false);
        recognition = null;
        mikStatusSetzen("Mikrofon nicht bereit. Bitte erneut tippen.");
    }
}

function diktatUmschalten() {
    if (!SpeechRecognitionCtor) {
        mikStatusSetzen("Spracherkennung wird hier nicht unterstuetzt.");
        return;
    }

    if (!window.isSecureContext && !istLokalhost()) {
        mikStatusSetzen("Spracheingabe braucht HTTPS.");
        return;
    }

    // Inkonsistenter Zustand (recognition null aber isListening true) → zurücksetzen
    if (!recognition && isListening) {
        isListening = false;
        mikButtonSetzen(false);
    }

    if (!recognition) recognition = spracherkennungInit();
    if (!recognition) return;

    if (isListening) {
        clearTimeout(micSessionTimer);
        restartMicAfterManualCommit = false;
        recognition.stop();
        return;
    }

    spracherkennungStarten();
}

if (btnMic) btnMic.onclick = diktatUmschalten;


/* --- Export ----------------------------------------------------- */

btnExport.onclick = async () => {
    const textEntries = [...liste.querySelectorAll("li")]
        .map(li => ({
            erledigt: li.classList.contains("erledigt"),
            raw: String(li.dataset.rawText || li.dataset.text || "")
        }))
        .filter(item => item.raw && !item.raw.startsWith(IMAGE_ENTRY_PREFIX));

    const offeneLines = textEntries
        .filter(item => !item.erledigt)
        .map(item => "• " + item.raw);
    const erledigteLines = textEntries
        .filter(item => item.erledigt)
        .map(item => "✔ " + item.raw);

    const exportDate = new Intl.DateTimeFormat("de-AT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(new Date());

    const text = [
        "Einkaufen",
        `Datum: ${exportDate}`,
        `Text-Einträge: ${textEntries.length}`,
        "────────────",
        "",
        "Offen",
        ...(offeneLines.length ? offeneLines : ["(keine offenen Text-Einträge)"]),
        "",
        "Erledigt",
        ...(erledigteLines.length ? erledigteLines : ["(keine erledigten Text-Einträge)"])
    ].join("\n");

    if (navigator.share) {
        try {
            await navigator.share({ title: "Einkaufen", text });
            return;
        } catch (err) {
            if (err?.name === "AbortError") return;
        }
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert("Liste kopiert.");
    } else {
        alert(text);
    }
};


/* --- Splash ----------------------------------------------------- */

window.addEventListener("load", () => {
    const splash = document.getElementById("splash");
    setTimeout(() => {
        if (splash) splash.remove();
    }, 350);
    setTimeout(eingabeGroessenpassen, 200);
});

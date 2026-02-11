/* ======================
   SPLASH + START
====================== */

window.addEventListener("load", () => {
    const splash = document.getElementById("splash");
    setTimeout(() => {
        if (splash) splash.remove();
    }, 2600);

    setTimeout(autoResize, 200);
});


/* ======================
   DOM ELEMENTE
====================== */

const liste = document.getElementById("liste");

const btnErfassen  = document.getElementById("btnErfassen");
const btnEinkaufen = document.getElementById("btnEinkaufen");
const btnExport    = document.getElementById("btnExport");
const modeBadge    = document.getElementById("mode-badge");
const versionBadge = document.getElementById("version-badge");

const multiInput = document.getElementById("multi-line-input");
const multiAdd   = document.getElementById("add-all-button");
const btnNewLine = document.getElementById("newline-button");
const btnMic     = document.getElementById("mic-button");
const micStatus  = document.getElementById("mic-status");

let modus = "erfassen";
const APP_VERSION = "1.0.12";
const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition;
let isListening = false;
let finalTranscript = "";
let latestTranscript = "";
let micSessionTimer;
const MIC_SESSION_MS = 30000;
let skipAutoSaveForCurrentBuffer = false;
let ignoreResultsUntil = 0;
let restartMicAfterManualCommit = false;


/* ======================
   SPEICHERN & LADEN
====================== */

function speichern() {
    const daten = [];

    liste.querySelectorAll("li").forEach(li => {
        daten.push({
            text: li.dataset.text,
            erledigt: li.classList.contains("erledigt")
        });
    });

    localStorage.setItem("einkaufsliste", JSON.stringify(daten));
}

function laden() {
    const raw = localStorage.getItem("einkaufsliste");
    if (!raw) return;

    try {
        JSON.parse(raw).forEach(e =>
            eintragAnlegen(e.text, e.erledigt)
        );
    } catch (err) {
        console.warn("Fehler beim Laden:", err);
    }
}


/* ======================
   EINTRÄGE
====================== */

function eintragAnlegen(text, erledigt = false) {
    const li = document.createElement("li");
    li.dataset.text = text;
    li.textContent = text;

    if (erledigt) li.classList.add("erledigt");

    li.onclick = () => {
        if (modus !== "einkaufen") return;

        li.classList.toggle("erledigt");
        speichern();

        if (li.classList.contains("erledigt")) {
            liste.appendChild(li);
        } else {
            liste.insertBefore(li, liste.firstChild);
        }
    };

    erledigt
        ? liste.appendChild(li)
        : liste.insertBefore(li, liste.firstChild);
}


/* ======================
   MEHRZEILEN-EINGABE
====================== */

function fokusInputAmEnde() {
    const pos = multiInput.value.length;
    multiInput.setSelectionRange(pos, pos);
}

function mehrzeilenSpeichern() {
    const text = multiInput.value.trim();
    if (!text) return;

    text.split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .forEach(item => eintragAnlegen(item));

    speichern();
    multiInput.value = "";
    autoResize();
    multiInput.blur();

    if (isListening) {
        // Restart recognition to flush Safari's internal phrase buffer.
        finalTranscript = "";
        latestTranscript = "";
        skipAutoSaveForCurrentBuffer = true;
        ignoreResultsUntil = Date.now() + 500;
        restartMicAfterManualCommit = true;
        clearTimeout(micSessionTimer);
        recognition.stop();
        setMicStatus("Eintrag gespeichert, Mikro wird neu gestartet...");
    }
}

multiAdd.onclick = mehrzeilenSpeichern;

btnNewLine.onclick = () => {
    multiInput.value += "\n";
    autoResize();
    multiInput.blur();
};

multiInput.addEventListener("input", autoResize);
multiInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;

    event.preventDefault();
    const start = multiInput.selectionStart;
    const end = multiInput.selectionEnd;
    const text = multiInput.value;
    multiInput.value = text.slice(0, start) + "\n" + text.slice(end);
    const nextPos = start + 1;
    multiInput.setSelectionRange(nextPos, nextPos);
    autoResize();
});

function autoResize() {
    multiInput.style.height = "auto";
    multiInput.style.height = multiInput.scrollHeight + "px";
}

function isLocalhost() {
    return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function setMicStatus(message = "") {
    if (!micStatus) return;
    micStatus.textContent = message;
}

function setMicButtonState(listening) {
    if (!btnMic) return;
    btnMic.classList.toggle("listening", listening);
    btnMic.setAttribute("aria-pressed", listening ? "true" : "false");
    btnMic.textContent = listening ? "⏹" : "🎤";
}

function setInputWithDictation(text) {
    multiInput.value = text;
    autoResize();
    if (document.activeElement === multiInput) {
        fokusInputAmEnde();
    }
}

function initRecognition() {
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
        ignoreResultsUntil = 0;
        restartMicAfterManualCommit = false;
        setMicButtonState(true);
        setMicStatus("Spracheingabe aktiv (max. 30s)...");
        clearTimeout(micSessionTimer);
        micSessionTimer = setTimeout(() => {
            if (!isListening) return;
            setMicStatus("Zeitlimit erreicht.");
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
        setInputWithDictation(combined);
    };

    r.onerror = event => {
        clearTimeout(micSessionTimer);
        const errorText = {
            "not-allowed": "Mikrofon wurde nicht erlaubt.",
            "service-not-allowed": "Spracherkennung ist in Safari blockiert.",
            "audio-capture": "Kein Mikrofon verfuegbar.",
            "network": "Netzwerkfehler bei Spracherkennung.",
            "no-speech": "Keine Sprache erkannt."
        }[event.error] || ("Spracherkennung-Fehler: " + event.error);

        setMicStatus(errorText);
    };

    r.onend = () => {
        clearTimeout(micSessionTimer);
        isListening = false;
        setMicButtonState(false);
        if (restartMicAfterManualCommit) {
            restartMicAfterManualCommit = false;
            startRecognition();
            return;
        }

        if (skipAutoSaveForCurrentBuffer) {
            skipAutoSaveForCurrentBuffer = false;
            setMicStatus("Spracheingabe beendet.");
            return;
        }

        const spokenText = finalTranscript.trim() || latestTranscript.trim();

        if (spokenText) {
            eintragAnlegen(spokenText);
            speichern();
            multiInput.value = "";
            autoResize();
            multiInput.blur();
            setMicStatus("Eintrag per Sprache gespeichert.");
            return;
        }

        if (!micStatus?.textContent) setMicStatus("Keine Sprache erkannt.");
    };

    return r;
}

function startRecognition() {
    if (!recognition) return;
    setMicStatus("Mikrofon wird gestartet...");

    try {
        recognition.start();
    } catch (error) {
        setMicStatus("Start fehlgeschlagen. Bitte erneut tippen.");
        console.warn("Speech start error:", error);
    }
}

function toggleDictation() {
    if (!SpeechRecognitionCtor) {
        setMicStatus("Safari unterstuetzt hier keine Spracherkennung.");
        return;
    }

    if (!window.isSecureContext && !isLocalhost()) {
        setMicStatus("Spracheingabe braucht HTTPS.");
        return;
    }

    if (!recognition) recognition = initRecognition();
    if (!recognition) return;

    if (isListening) {
        clearTimeout(micSessionTimer);
        restartMicAfterManualCommit = false;
        recognition.stop();
        return;
    }

    startRecognition();
}

if (btnMic) btnMic.onclick = toggleDictation;


/* ======================
   MODUS
====================== */

function setModus(neu) {
    const vorher = modus;
    modus = neu;

    btnErfassen.classList.toggle("active", modus === "erfassen");
    btnEinkaufen.classList.toggle("active", modus === "einkaufen");
    if (modeBadge) modeBadge.textContent = modus === "einkaufen" ? "Einkaufen" : "Erfassen";
    document.body.classList.toggle("modus-einkaufen", modus === "einkaufen");

    if (vorher === "einkaufen" && neu === "erfassen") {
        liste.querySelectorAll("li.erledigt").forEach(li => li.remove());
        speichern();
    }
}

btnErfassen.onclick  = () => setModus("erfassen");
btnEinkaufen.onclick = () => setModus("einkaufen");


/* ======================
   EXPORT
====================== */

btnExport.onclick = async () => {
    const text = [...liste.querySelectorAll("li")]
        .map(li =>
            (li.classList.contains("erledigt") ? "✔ " : "• ") + li.dataset.text
        )
        .join("\n");

    if (navigator.share) {
        try {
            await navigator.share({ title: "Einkaufsliste", text });
            return;
        } catch {}
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert("Liste kopiert.");
    } else {
        alert(text);
    }
};


/* ======================
   INIT
====================== */

laden();
setModus("erfassen");
if (versionBadge) versionBadge.textContent = "v" + APP_VERSION;

if (btnMic && !SpeechRecognitionCtor) {
    btnMic.disabled = true;
    btnMic.title = "Spracherkennung wird hier nicht unterstuetzt";
    setMicStatus("Spracherkennung wird in diesem Browser nicht unterstuetzt.");
}

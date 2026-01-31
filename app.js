/* ======================
   SPRACHEINGABE (NEU)
====================== */

let recog = null;
let isListening = false;

const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    recog = new SpeechRecognition();
    recog.lang = "de-DE";

    // 👉 Live-Erkennung aktivieren
    recog.interimResults = true;
    recog.continuous = true;

    mikrofon.onclick = async () => {
        if (modus !== "erfassen") return;

        // Doppelklick verhindern
        if (isListening) return;

        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });

            isListening = true;
            mikrofon.classList.add("mic-active");
            recog.start();
        } catch {
            mikrofon.classList.remove("mic-active");
            alert("❌ Mikrofon nicht erlaubt");
        }
    };

    // 👉 Live-Text + sofortiges Einfügen bei finalem Ergebnis
    recog.onresult = e => {
        const last = e.results.length - 1;
        const result = e.results[last];
        const text = result[0].transcript;

        // Live-Vorschau im Eingabefeld
        eingabe.value = text;

        // Wenn final → sofort in Liste übernehmen
        if (result.isFinal) {
            eintragAnlegen(text);
            speichern();
            eingabe.value = "";
        }
    };

    recog.onerror = () => {
        isListening = false;
        mikrofon.classList.remove("mic-active");
    };

    recog.onend = () => {
        // Bei continuous=true startet Chrome manchmal neu → wir kontrollieren das
        isListening = false;
        mikrofon.classList.remove("mic-active");
    };

} else {
    mikrofon.disabled = true;
}


/* ======================
   ROBUSTHEIT
====================== */

// Mikrofon stoppen, wenn Tab/App verlassen wird
document.addEventListener("visibilitychange", () => {
    if (document.hidden && recog && isListening) {
        try { recog.abort(); } catch {}
        isListening = false;
        mikrofon.classList.remove("mic-active");
    }
});

// Sicherheit: nach 10 Sekunden abbrechen
setInterval(() => {
    if (isListening && recog) {
        try { recog.abort(); } catch {}
        isListening = false;
        mikrofon.classList.remove("mic-active");
    }
}, 10000);


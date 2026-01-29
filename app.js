/* ======================
   GRUNDZUSTAND
====================== */
let modus = "erfassen";

/* ======================
   DOM-ELEMENTE
====================== */
const eingabe = document.getElementById("eingabe");
const btnAdd = document.getElementById("hinzufuegen");
const liste = document.getElementById("liste");
const mikrofon = document.getElementById("mikrofon");

const btnErfassen = document.getElementById("btnErfassen");
const btnEinkaufen = document.getElementById("btnEinkaufen");
const headerTitel = document.querySelector("header");

/* ======================
   SPEICHERN / LADEN
====================== */
function speichern() {
    const daten = [];
    liste.querySelectorAll("li").forEach(li => {
        daten.push({
            text: li.querySelector("span").textContent,
            erledigt: li.classList.contains("erledigt")
        });
    });
    localStorage.setItem("einkaufsliste", JSON.stringify(daten));
}

function laden() {
    const daten = JSON.parse(localStorage.getItem("einkaufsliste")) || [];
    daten.forEach(e => eintragAnlegen(e.text, e.erledigt));
}

/* ======================
   EINTRAG ANLEGEN
====================== */
function eintragAnlegen(text, erledigt = false) {
    const li = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = erledigt;

    const span = document.createElement("span");
    span.textContent = text;

    if (erledigt) li.classList.add("erledigt");

    checkbox.onchange = () => {
        if (modus !== "einkaufen") {
            checkbox.checked = !checkbox.checked;
            return;
        }
        li.classList.toggle("erledigt", checkbox.checked);
        speichern();
    };

    span.onclick = () => {
        if (modus !== "einkaufen") return;
        checkbox.checked = !checkbox.checked;
        li.classList.toggle("erledigt", checkbox.checked);
        speichern();
    };

    li.appendChild(span);
    li.appendChild(checkbox);
    liste.appendChild(li);
}

/* ======================
   MODUS WECHSEL
====================== */
function setModus(neu) {
    modus = neu;

    btnErfassen.classList.toggle("active", neu === "erfassen");
    btnEinkaufen.classList.toggle("active", neu === "einkaufen");

    headerTitel.textContent =
        neu === "erfassen"
            ? "Einkaufsliste – Erfassen"
            : "Einkaufsliste – Einkaufen";

    document.body.classList.toggle(
        "modus-einkaufen",
        neu === "einkaufen"
    );

    if (neu === "erfassen") {
        liste.querySelectorAll(".erledigt").forEach(li => li.remove());
        speichern();
    }
}

btnErfassen.onclick = () => setModus("erfassen");
btnEinkaufen.onclick = () => setModus("einkaufen");

/* ======================
   HINZUFÜGEN
====================== */
btnAdd.onclick = () => {
    const text = eingabe.value.trim();
    if (!text) return;

    eintragAnlegen(text);
    speichern();
    eingabe.value = "";
};


/* ======================
   SPRACHEINGABE
====================== */
let recog = null;
let isListening = false;

const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    recog = new SpeechRecognition();
    recog.lang = "de-DE";
    recog.interimResults = false;
    recog.continuous = false;

    mikrofon.onclick = async () => {
        if (modus !== "erfassen") return;

        // 👉 Verhindert Fehlermeldung bei erneutem Klick
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

    recog.onresult = e => {
        eingabe.value = e.results[0][0].transcript;
    };

    recog.onerror = () => {
        isListening = false;
        mikrofon.classList.remove("mic-active");
    };

    recog.onend = () => {
        isListening = false;
        mikrofon.classList.remove("mic-active");
    };
} else {
    mikrofon.disabled = true;
}




/* ======================
   EXPORT (NUR TEXT)
====================== */
const btnExport = document.getElementById("btnExport");

btnExport.onclick = async () => {
    let text = "Einkaufsliste\n\n";

    liste.querySelectorAll("li").forEach(li => {
        const name = li.querySelector("span").textContent;
        const erledigt = li.classList.contains("erledigt");
        text += `${erledigt ? "[x]" : "[ ]"} ${name}\n`;
    });

    if (navigator.share) {
        await navigator.share({
            text: text   // nur Text → Nachrichten
        });
    } else {
        await navigator.clipboard.writeText(text);
        alert("Text in Zwischenablage kopiert.");
    }
};

/* ======================
   START
====================== */
laden();


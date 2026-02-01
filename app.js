/* ======================
   DOM ELEMENTE
====================== */

const liste = document.getElementById("liste");

const btnErfassen = document.getElementById("btnErfassen");
const btnEinkaufen = document.getElementById("btnEinkaufen");
const btnExport = document.getElementById("btnExport");

const multiInput = document.getElementById("multiInput");
const multiAdd = document.getElementById("multiAdd");

let modus = "erfassen"; // oder "einkaufen"


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
        const daten = JSON.parse(raw);
        daten.forEach(e => eintragAnlegen(e.text, e.erledigt));
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
        if (modus === "einkaufen") {
            li.classList.toggle("erledigt");
            speichern();
        }
    };

    liste.appendChild(li);
}


/* ======================
   MEHRZEILEN-EINGABE
====================== */

multiAdd.onclick = () => {
    const text = multiInput.value.trim();
    if (!text) return;

    const lines = text.split("\n");
    lines.forEach(line => {
        const item = line.trim();
        if (item !== "") eintragAnlegen(item);
    });

    speichern();
    multiInput.value = "";
    multiInput.focus(); // Cursor bleibt im Feld
};

// Auto-Resize
multiInput.addEventListener("input", () => {
    multiInput.style.height = "auto";
    multiInput.style.height = multiInput.scrollHeight + "px";
});


/* ======================
   MODUS-WECHSEL
====================== */

function setModus(neu) {
    modus = neu;

    btnErfassen.classList.toggle("active", modus === "erfassen");
    btnEinkaufen.classList.toggle("active", modus === "einkaufen");

    document.body.classList.toggle("modus-einkaufen", modus === "einkaufen");
}

btnErfassen.onclick = () => setModus("erfassen");
btnEinkaufen.onclick = () => setModus("einkaufen");


/* ======================
   EXPORT
====================== */

btnExport.onclick = () => {
    const items = [];
    liste.querySelectorAll("li").forEach(li => {
        items.push((li.classList.contains("erledigt") ? "✔ " : "") + li.dataset.text);
    });

    const text = items.join("\n");
    navigator.clipboard.writeText(text);

    alert("Liste wurde in die Zwischenablage kopiert.");
};


/* ======================
   START
====================== */

laden();
setModus("erfassen");

window.addEventListener("load", () => {
    multiInput.focus();
});

// Autofokus beim Start
window.addEventListener("load", () => {
    multiInput.focus();
});

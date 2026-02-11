/* ======================
   SPLASH + START
====================== */

window.addEventListener("load", () => {
    const splash = document.getElementById("splash");
    setTimeout(() => {
        if (splash) splash.remove();
    }, 2600);

    setTimeout(() => {
        multiInput.focus();
        autoResize();
    }, 200);
});


/* ======================
   DOM ELEMENTE
====================== */

const liste = document.getElementById("liste");

const btnErfassen  = document.getElementById("btnErfassen");
const btnEinkaufen = document.getElementById("btnEinkaufen");
const btnExport    = document.getElementById("btnExport");
const versionBadge = document.getElementById("version-badge");

const multiInput = document.getElementById("multi-line-input");
const multiAdd   = document.getElementById("add-all-button");
const btnNewLine = document.getElementById("newline-button");

let modus = "erfassen";
const APP_VERSION = "1.0.9";


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
    multiInput.focus();
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
    fokusInputAmEnde();
}

multiAdd.onclick = mehrzeilenSpeichern;

btnNewLine.onclick = () => {
    multiInput.value += "\n";
    autoResize();
    fokusInputAmEnde();
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
    multiInput.focus();
});

function autoResize() {
    multiInput.style.height = "auto";
    multiInput.style.height = multiInput.scrollHeight + "px";
}


/* ======================
   MODUS
====================== */

function setModus(neu) {
    const vorher = modus;
    modus = neu;

    btnErfassen.classList.toggle("active", modus === "erfassen");
    btnEinkaufen.classList.toggle("active", modus === "einkaufen");
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

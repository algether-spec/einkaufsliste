/* ======================
   SPLASH
====================== */

window.addEventListener("load", () => {
    const splash = document.getElementById("splash");
    setTimeout(() => {
        if (splash) splash.remove();
    }, 2600);
});

/* ======================
   DOM ELEMENTE
====================== */

const liste = document.getElementById("liste");

const btnErfassen = document.getElementById("btnErfassen");
const btnEinkaufen = document.getElementById("btnEinkaufen");
const btnExport = document.getElementById("btnExport");

const multiInput = document.getElementById("multiInput");
const multiAdd = document.getElementById("multiAdd");
const btnNewLine = document.getElementById("btnNewLine");
const btnMic = document.getElementById("btnMic");

let modus = "erfassen";


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

            if (li.classList.contains("erledigt")) {
                liste.appendChild(li);
            } else {
                liste.insertBefore(li, liste.firstChild);
            }
        }
    };

    if (erledigt) {
        liste.appendChild(li);
    } else {
        liste.insertBefore(li, liste.firstChild);
    }
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
    autoResize();
    multiInput.focus();
};

btnNewLine.onclick = () => {
    multiInput.value += (multiInput.value ? "\n" : "");
    autoResize();
    multiInput.focus();
};

multiInput.addEventListener("input", autoResize);

function autoResize() {
    multiInput.style.height = "auto";
    multiInput.style.height = multiInput.scrollHeight + "px";
}


/* ======================
   MIKROFON
====================== */

btnMic.onclick = () => {
    if (!("webkitSpeechRecognition" in window)) {
        alert("Spracherkennung wird nicht unterstützt.");
        return;
    }

    const rec = new webkitSpeechRecognition();
    rec.lang = "de-DE";
    rec.interimResults = false;

    rec.onresult = (event) => {
        const text = event.results[0][0].transcript;
        multiInput.value += (multiInput.value ? "\n" : "") + text;
        autoResize();
        multiInput.focus();
    };

    rec.start();
};


/* ======================
   MODUS-WECHSEL
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

btnErfassen.onclick = () => setModus("erfassen");
btnEinkaufen.onclick = () => setModus("einkaufen");


/* ======================
   EXPORT
====================== */

btnExport.onclick = async () => {
    const items = [];
    liste.querySelectorAll("li").forEach(li => {
        const prefix = li.classList.contains("erledigt") ? "✔ " : "• ";
        items.push(prefix + li.dataset.text);
    });

    const text = items.join("\n");

    if (navigator.share) {
        try {
            await navigator.share({
                title: "Einkaufsliste",
                text
            });
            return;
        } catch (e) {}
    }

    if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        alert("Liste kopiert – du kannst sie jetzt im Messenger einfügen.");
    } else {
        alert(text);
    }
};


/* ======================
   START
====================== */

laden();
setModus("erfassen");

window.addEventListener("load", () => {
    multiInput.focus();
    autoResize();
});

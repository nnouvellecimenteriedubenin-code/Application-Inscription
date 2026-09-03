const formulaireConnexion = document.getElementById("formulaireConnexion");
const messageConnexion = document.getElementById("messageConnexion");
const champMotDePasse = document.getElementById("motdepasse");
const boutonsToggle = document.querySelectorAll(".toggle-mot-de-passe");
let jetonCsrf = null;
let promesseJetonCsrf = null;

const ETAT_HISTORIQUE_CONNEXION = "connexion";

function viderChampMotDePasse() {
    champMotDePasse.value = "";
    champMotDePasse.type = "password";

    const boutonToggle = document.querySelector('[data-cible="motdepasse"]');
    if (boutonToggle) {
        boutonToggle.textContent = "👁";
        boutonToggle.setAttribute("aria-label", "Afficher le mot de passe");
    }
}

function ancrerPageConnexionDansHistorique() {
    const etatCourant = window.history.state;

    if (!etatCourant || etatCourant.page !== ETAT_HISTORIQUE_CONNEXION) {
        window.history.replaceState(
            { page: ETAT_HISTORIQUE_CONNEXION, position: "base" },
            "",
            window.location.href
        );
        window.history.pushState(
            { page: ETAT_HISTORIQUE_CONNEXION, position: "garde" },
            "",
            window.location.href
        );
    }
}

viderChampMotDePasse();
ancrerPageConnexionDansHistorique();

window.addEventListener("pagehide", viderChampMotDePasse);
window.addEventListener("pageshow", viderChampMotDePasse);
window.addEventListener("popstate", () => {
    viderChampMotDePasse();
    window.history.pushState(
        { page: ETAT_HISTORIQUE_CONNEXION, position: "garde" },
        "",
        window.location.href
    );
});

async function obtenirJetonCsrf() {
    if (jetonCsrf) return jetonCsrf;

    if (!promesseJetonCsrf) {
        promesseJetonCsrf = (async () => {
            const reponse = await fetch("/csrf-token", {
                cache: "no-store"
            });

            if (!reponse.ok) {
                throw new Error("Impossible d'obtenir le jeton de sécurité.");
            }

            const resultat = await reponse.json();
            jetonCsrf = resultat.csrfToken;
            return jetonCsrf;
        })();
    }

    try {
        return await promesseJetonCsrf;
    } finally {
        promesseJetonCsrf = null;
    }
}

boutonsToggle.forEach((bouton) => {
    bouton.addEventListener("click", () => {
        const champ = document.getElementById(bouton.dataset.cible);
        if (!champ) return;

        const afficher = champ.type === "password";
        champ.type = afficher ? "text" : "password";
        bouton.textContent = afficher ? "🙈" : "👁";
        bouton.setAttribute("aria-label", afficher ? "Masquer le mot de passe" : "Afficher le mot de passe");
    });
});

const parametresUrl = new URLSearchParams(window.location.search);
const messageInitial = parametresUrl.get("message");

if (messageInitial) {
    messageConnexion.textContent = messageInitial;
}

obtenirJetonCsrf().catch(() => {
    messageConnexion.textContent = "Le service de sécurité sera sollicité de nouveau lors de la connexion.";
});

formulaireConnexion.addEventListener("submit", async (event) => {
    event.preventDefault();

    const identifiant = document.getElementById("identifiant").value;
    const motdepasse = champMotDePasse.value;

    try {
        const csrfToken = await obtenirJetonCsrf();

        const reponse = await fetch("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken
            },
            body: JSON.stringify({
                identifiant,
                motDePasse: motdepasse
            })
        });

        const resultat = await reponse.json();
        messageConnexion.textContent = resultat.message || "Connexion en cours...";

        if (reponse.ok) {
            viderChampMotDePasse();
            window.location.href = "/";
        }
    } catch (erreur) {
        messageConnexion.textContent = "Impossible de contacter le serveur.";
    }
});

const formulaireConnexion = document.getElementById("formulaireConnexion");
const messageConnexion = document.getElementById("messageConnexion");
const boutonsToggle = document.querySelectorAll(".toggle-mot-de-passe");
let jetonCsrf = null;

async function obtenirJetonCsrf() {
    if (jetonCsrf) return jetonCsrf;

    const reponse = await fetch("/csrf-token", {
        cache: "no-store"
    });

    if (!reponse.ok) {
        throw new Error("Impossible d'obtenir le jeton de sécurité.");
    }

    const resultat = await reponse.json();
    jetonCsrf = resultat.csrfToken;
    return jetonCsrf;
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

formulaireConnexion.addEventListener("submit", async (event) => {
    event.preventDefault();

    const identifiant = document.getElementById("identifiant").value;
    const motdepasse = document.getElementById("motdepasse").value;

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
            window.location.href = "/";
        }
    } catch (erreur) {
        messageConnexion.textContent = "Impossible de contacter le serveur.";
    }
});

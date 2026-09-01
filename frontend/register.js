const formulaireInscription = document.getElementById("formulaireInscription");
const messageInscription = document.getElementById("messageInscription");
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

formulaireInscription.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageInscription.textContent = "Enregistrement en cours...";

    const donnees = {
        nom: document.getElementById("nom").value,
        prenom: document.getElementById("prenom").value,
        identifiant: document.getElementById("identifiant").value,
        email: document.getElementById("email").value,
        telephone: document.getElementById("telephone").value,
        motDePasse: document.getElementById("motDePasse").value,
        confirmationMotDePasse: document.getElementById("confirmationMotDePasse").value
    };

    try {
        const csrfToken = await obtenirJetonCsrf();

        const reponse = await fetch("/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken
            },
            body: JSON.stringify(donnees)
        });

        const resultat = await reponse.json();
        messageInscription.textContent = resultat.message || "Traitement en cours...";

        if (reponse.ok) {
            setTimeout(() => {
                window.location.href = resultat.redirectTo || "/login";
            }, 1200);
        }
    } catch (erreur) {
        messageInscription.textContent = "Impossible de contacter le serveur.";
    }
});

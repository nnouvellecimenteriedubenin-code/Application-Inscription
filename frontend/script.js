const formulaire = document.getElementById("formulaire");
const corpsTableau = document.querySelector("#tableInscriptions tbody");
const boutonEnregistrer = document.getElementById("boutonEnregistrer");
const champRecherche = document.getElementById("recherche");
const compteurInscriptions = document.getElementById("compteurInscriptions");
const enTetesTriables = document.querySelectorAll("#tableInscriptions .sortable");
const sectionInscriptions = document.getElementById("listeInscriptions");
const lienInscriptions = document.getElementById("lienInscriptions");
const lienAdmin = document.getElementById("lienAdmin");
const messageSession = document.getElementById("messageSession");
const boutonExporterExcel = document.getElementById("boutonExporterExcel");

// Adresse de l'API
const API = "";
let inscriptionsEnMemoire = [];
let triActif = {
    colonne: null,
    direction: "asc"
};
let estAdministrateurActif = false;
let jetonCsrf = null;

async function obtenirJetonCsrf() {

    if (jetonCsrf) {
        return jetonCsrf;
    }

    const reponse = await fetch(`${API}/csrf-token`, {
        cache: "no-store"
    });

    if (!reponse.ok) {
        throw new Error("Impossible d'obtenir le jeton de sécurité.");
    }

    const resultat = await reponse.json();
    jetonCsrf = resultat.csrfToken;
    return jetonCsrf;
}

function normaliserTexte(texte) {

    return texte
        ? texte.toString()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
        : "";

}

function formaterDate(dateValeur) {

    if (!dateValeur) {
        return "";
    }

    const date = new Date(dateValeur);

    if (Number.isNaN(date.getTime())) {
        return dateValeur;
    }

    return date.toLocaleDateString("fr-FR");

}

function obtenirValeurTri(personne, colonne) {

    switch (colonne) {

        case "nom":
            return personne.nom ?? "";
        case "prenom":
            return personne.prenom ?? "";
        case "sexe":
            return personne.sexe ?? "";
        case "telephone":
            return personne.telephone ?? "";
        case "date":
            return personne.date_naissance ?? personne.dateNaissance ?? "";
        default:
            return "";

    }

}

function trierInscriptions(inscriptions) {

    if (!triActif.colonne) {
        return inscriptions;
    }

    const inscriptionsTriees = [...inscriptions];

    inscriptionsTriees.sort((a, b) => {

        const valeurA = obtenirValeurTri(a, triActif.colonne);
        const valeurB = obtenirValeurTri(b, triActif.colonne);

        if (triActif.colonne === "date") {

            const dateA = new Date(valeurA);
            const dateB = new Date(valeurB);

            if (!Number.isNaN(dateA.getTime()) && !Number.isNaN(dateB.getTime())) {

                const difference = dateA - dateB;
                return triActif.direction === "asc" ? difference : -difference;

            }

        }

        const texteA = normaliserTexte(valeurA);
        const texteB = normaliserTexte(valeurB);
        const difference = texteA.localeCompare(texteB);

        return triActif.direction === "asc" ? difference : -difference;

    });

    return inscriptionsTriees;

}

function filtrerInscriptions() {

    const termeRecherche = normaliserTexte(champRecherche.value.trim());

    if (!termeRecherche) {
        return inscriptionsEnMemoire;
    }

    return inscriptionsEnMemoire.filter((personne) => {

        const champs = [personne.nom, personne.prenom, personne.telephone];

        return champs.some((valeur) =>
            normaliserTexte(valeur).includes(termeRecherche)
        );

    });

}

function mettreAJourCompteur(inscriptions) {

    const total = inscriptions.length;

    compteurInscriptions.textContent = `${total} inscription${total > 1 ? "s" : ""} affichée${total > 1 ? "s" : ""}`;

}

function mettreAJourIndicateursTri() {

    enTetesTriables.forEach((enTete) => {

        const indicateur = enTete.querySelector(".tri-indicateur");

        if (enTete.dataset.col === triActif.colonne) {
            indicateur.textContent = triActif.direction === "asc" ? " ▲" : " ▼";
        } else {
            indicateur.textContent = "";
        }

    });

}

function creerCellule(texte) {

    const cellule = document.createElement("td");
    cellule.textContent = texte ?? "";
    return cellule;

}

function afficherInscriptions() {

    const inscriptionsFiltrees = filtrerInscriptions();
    const inscriptionsAffichees = trierInscriptions(inscriptionsFiltrees);

    corpsTableau.replaceChildren();
    mettreAJourCompteur(inscriptionsAffichees);

    inscriptionsAffichees.forEach((personne) => {

        const ligne = document.createElement("tr");

        ligne.appendChild(creerCellule(personne.id));
        ligne.appendChild(creerCellule(personne.nom));
        ligne.appendChild(creerCellule(personne.prenom));
        ligne.appendChild(creerCellule(personne.sexe));
        ligne.appendChild(creerCellule(personne.telephone));
        ligne.appendChild(creerCellule(formaterDate(personne.date_naissance ?? personne.dateNaissance)));
        ligne.appendChild(creerCellule(personne.courriel));

        const celluleActions = document.createElement("td");
        const boutonModifier = document.createElement("button");
        const boutonSupprimer = document.createElement("button");

        boutonModifier.type = "button";
        boutonModifier.textContent = "✏️ Modifier";
        boutonModifier.addEventListener("click", () => modifierInscription(personne.id));

        boutonSupprimer.type = "button";
        boutonSupprimer.textContent = "🗑️ Supprimer";
        boutonSupprimer.addEventListener("click", () => supprimerInscription(personne.id));

        celluleActions.appendChild(boutonModifier);
        celluleActions.appendChild(boutonSupprimer);
        ligne.appendChild(celluleActions);

        corpsTableau.appendChild(ligne);

    });

}

async function mettreAJourInterface(session) {
    const estConnexe = session.connecte === true;
    const estActif = session.utilisateur?.statut === "actif";
    const estAdministrateur = estConnexe && session.utilisateur?.role === "administrateur" && estActif;
    const estUtilisateurActif = estConnexe && session.utilisateur?.role === "utilisateur" && estActif;

    if (sectionInscriptions) {
        sectionInscriptions.style.display = estAdministrateur ? "block" : "none";
    }

    if (lienInscriptions) {
        lienInscriptions.style.display = estAdministrateur ? "inline-block" : "none";
    }

    if (lienAdmin) {
        lienAdmin.style.display = estAdministrateur ? "inline-block" : "none";
    }

    if (boutonExporterExcel) {
        boutonExporterExcel.style.display = estAdministrateur ? "inline-block" : "none";
    }

    if (messageSession) {
        if (!estConnexe) {
            messageSession.textContent = "Veuillez vous connecter pour utiliser l'application.";
            formulaire.style.display = "none";
        } else if (!estActif) {
            messageSession.textContent = "Votre compte n'est pas actif. Contactez un administrateur.";
            formulaire.style.display = "none";
        } else {
            messageSession.textContent = estAdministrateur
                ? "Connecté en tant qu'administrateur actif. Vous avez accès aux inscriptions et à la gestion des utilisateurs."
                : "Connecté en tant qu'utilisateur actif. Vous pouvez soumettre un formulaire d'inscription.";
            formulaire.style.display = "block";
        }
    }

    if (!estAdministrateur) {
        inscriptionsEnMemoire = [];
        afficherInscriptions();
    }

    if (estAdministrateur) {
        await chargerInscriptions();
    }
}

async function chargerSession() {

    try {

        const reponse = await fetch(`${API}/session`);
        const session = await reponse.json();

        await mettreAJourInterface(session);

    } catch (erreur) {

        console.error(erreur);

    }

}

// Charger toutes les inscriptions
async function chargerInscriptions() {

    try {

        const reponse = await fetch(`${API}/inscriptions`);

        if (!reponse.ok) {
            throw new Error("Accès refusé");
        }

        const inscriptions = await reponse.json();

        inscriptionsEnMemoire = inscriptions;
        afficherInscriptions();

    } catch (erreur) {

        console.error(erreur);

    }

}

// Charger une inscription dans le formulaire
async function modifierInscription(id) {

    try {

        const reponse = await fetch(`${API}/inscriptions`);

        const inscriptions = await reponse.json();

        const personne = inscriptions.find((p) => p.id == id);

        if (!personne) return;

        document.getElementById("idInscription").value = personne.id;
        document.getElementById("nom").value = personne.nom;
        document.getElementById("prenom").value = personne.prenom;
        document.getElementById("dateNaissance").value =
            personne.date_naissance.substring(0, 10);
        document.getElementById("sexe").value = personne.sexe;
        document.getElementById("adresse").value = personne.adresse ?? "";
        document.getElementById("telephone").value = personne.telephone ?? "";
        document.getElementById("courriel").value = personne.courriel ?? "";

        boutonEnregistrer.textContent = "Mettre à jour";

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

    } catch (erreur) {

        console.error(erreur);

    }

}

// Supprimer une inscription
async function supprimerInscription(id) {

    if (!confirm("Voulez-vous vraiment supprimer cette inscription ?")) {

        return;

    }

    try {

        const csrfToken = await obtenirJetonCsrf();

        const reponse = await fetch(`${API}/inscriptions/${id}`, {

            method: "DELETE",
            headers: {
                "X-CSRF-Token": csrfToken
            }

        });

        const resultat = await reponse.json();

        alert(resultat.message);

        chargerInscriptions();

    } catch (erreur) {

        console.error(erreur);

        alert("Erreur lors de la suppression.");

    }

}

// Enregistrer ou modifier
formulaire.addEventListener("submit", async function (event) {

    event.preventDefault();

    const id = document.getElementById("idInscription").value;

    const personne = {

        nom: document.getElementById("nom").value,
        prenom: document.getElementById("prenom").value,
        dateNaissance: document.getElementById("dateNaissance").value,
        sexe: document.getElementById("sexe").value,
        adresse: document.getElementById("adresse").value,
        telephone: document.getElementById("telephone").value,
        courriel: document.getElementById("courriel").value

    };

    let url = `${API}/inscriptions`;
    let methode = "POST";

    if (id) {

        url = `${API}/inscriptions/${id}`;
        methode = "PUT";

    }

    try {

        const csrfToken = await obtenirJetonCsrf();

        const reponse = await fetch(url, {

            method: methode,

            headers: {

                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken

            },

            body: JSON.stringify(personne)

        });

        const resultat = await reponse.json();

        alert(resultat.message);

        formulaire.reset();

        document.getElementById("idInscription").value = "";

        boutonEnregistrer.textContent = "Enregistrer";

        chargerInscriptions();

    } catch (erreur) {

        console.error(erreur);

        alert("Erreur lors de l'enregistrement.");

    }

});

champRecherche.addEventListener("input", afficherInscriptions);

if (boutonExporterExcel) {
    boutonExporterExcel.addEventListener("click", async () => {
        try {
            const reponse = await fetch("/api/inscriptions/export");

            if (!reponse.ok) {
                throw new Error("Impossible d'exporter les inscriptions");
            }

            const blob = await reponse.blob();
            const url = window.URL.createObjectURL(blob);
            const lien = document.createElement("a");
            const nomFichier = reponse.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "inscriptions-export.xlsx";

            lien.href = url;
            lien.download = nomFichier;
            document.body.appendChild(lien);
            lien.click();
            document.body.removeChild(lien);
            window.URL.revokeObjectURL(url);
        } catch (erreur) {
            console.error(erreur);
            alert("Impossible d'exporter les inscriptions.");
        }
    });
}

enTetesTriables.forEach((enTete) => {

    enTete.addEventListener("click", () => {

        const colonne = enTete.dataset.col;

        if (triActif.colonne === colonne) {
            triActif.direction = triActif.direction === "asc" ? "desc" : "asc";
        } else {
            triActif.colonne = colonne;
            triActif.direction = "asc";
        }

        mettreAJourIndicateursTri();
        afficherInscriptions();

    });

});

// Chargement initial de la session pour définir l'accès
chargerSession();

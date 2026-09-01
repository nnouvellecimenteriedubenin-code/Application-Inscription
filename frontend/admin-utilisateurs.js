const filtreStatut = document.getElementById("filtreStatut");
const corpsUtilisateurs = document.getElementById("corpsUtilisateurs");
const messageAdmin = document.getElementById("messageAdmin");

let utilisateursEnMemoire = [];
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

function formaterDate(dateValeur) {
    if (!dateValeur) return "";
    const date = new Date(dateValeur);
    if (Number.isNaN(date.getTime())) return dateValeur;
    return date.toLocaleDateString("fr-FR");
}

function obtenirLabelStatut(statut) {
    const libelles = {
        actif: "Actif",
        en_attente: "En attente",
        refusé: "Refusé",
        désactivé: "Désactivé"
    };
    return libelles[statut] || statut;
}

function filtrerUtilisateurs() {
    const filtre = filtreStatut.value;
    if (filtre === "tous") return utilisateursEnMemoire;
    return utilisateursEnMemoire.filter((utilisateur) => utilisateur.statut === filtre);
}

function obtenirActionsPourStatut(statut) {
    switch (statut) {
        case "en_attente":
            return [
                { label: "Approuver", action: "approuver" },
                { label: "Refuser", action: "refuser" }
            ];
        case "actif":
            return [
                { label: "Désactiver", action: "desactiver" }
            ];
        case "refusé":
            return [
                { label: "Approuver", action: "approuver" }
            ];
        case "désactivé":
            return [
                { label: "Réactiver", action: "reactiver" }
            ];
        default:
            return [];
    }
}

function creerCellule(texte) {
    const cellule = document.createElement("td");
    cellule.textContent = texte ?? "";
    return cellule;
}

function afficherUtilisateurs() {
    const utilisateurs = filtrerUtilisateurs();
    corpsUtilisateurs.replaceChildren();

    if (utilisateurs.length === 0) {
        const ligneVide = document.createElement("tr");
        const celluleVide = creerCellule("Aucun utilisateur trouvé.");
        celluleVide.colSpan = 9;
        ligneVide.appendChild(celluleVide);
        corpsUtilisateurs.appendChild(ligneVide);
        return;
    }

    utilisateurs.forEach((utilisateur) => {
        const actions = obtenirActionsPourStatut(utilisateur.statut);
        const ligne = document.createElement("tr");

        ligne.appendChild(creerCellule(utilisateur.nom));
        ligne.appendChild(creerCellule(utilisateur.prenom));
        ligne.appendChild(creerCellule(utilisateur.identifiant));
        ligne.appendChild(creerCellule(utilisateur.email));
        ligne.appendChild(creerCellule(utilisateur.telephone));
        ligne.appendChild(creerCellule(utilisateur.role));

        const celluleStatut = document.createElement("td");
        const badgeStatut = document.createElement("span");
        badgeStatut.className = "etat-badge";
        badgeStatut.textContent = obtenirLabelStatut(utilisateur.statut);
        celluleStatut.appendChild(badgeStatut);
        ligne.appendChild(celluleStatut);

        ligne.appendChild(creerCellule(formaterDate(utilisateur.cree_le)));

        const celluleActions = document.createElement("td");
        const conteneurActions = document.createElement("div");
        conteneurActions.className = "boutons-actions";

        actions.forEach((action) => {
            const bouton = document.createElement("button");
            bouton.type = "button";
            bouton.dataset.action = action.action;
            bouton.dataset.id = utilisateur.id;
            bouton.textContent = action.label;
            conteneurActions.appendChild(bouton);
        });

        celluleActions.appendChild(conteneurActions);
        ligne.appendChild(celluleActions);
        corpsUtilisateurs.appendChild(ligne);
    });
}

async function chargerUtilisateurs() {
    try {
        const reponse = await fetch("/api/admin/utilisateurs");
        if (!reponse.ok) {
            throw new Error("Impossible de charger les utilisateurs");
        }
        utilisateursEnMemoire = await reponse.json();
        afficherUtilisateurs();
        messageAdmin.textContent = `${utilisateursEnMemoire.length} utilisateur(s) chargé(s)`;
    } catch (erreur) {
        console.error(erreur);
        messageAdmin.textContent = "Impossible de charger les utilisateurs.";
    }
}

function convertirActionVersStatut(action) {
    switch (action) {
        case "approuver":
            return "actif";
        case "refuser":
            return "refusé";
        case "desactiver":
            return "désactivé";
        case "reactiver":
            return "actif";
        default:
            return null;
    }
}

async function mettreAJourStatut(id, action) {
    const statutCible = convertirActionVersStatut(action);

    if (!statutCible) {
        messageAdmin.textContent = "Action inconnue.";
        return;
    }

    try {
        const csrfToken = await obtenirJetonCsrf();

        const reponse = await fetch(`/api/admin/utilisateurs/${id}/statut`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken
            },
            body: JSON.stringify({ statut: statutCible })
        });

        const resultat = await reponse.json();
        if (!reponse.ok) {
            throw new Error(resultat.message || "Erreur lors de la mise à jour");
        }

        messageAdmin.textContent = `Statut mis à jour : ${obtenirLabelStatut(statutCible)}`;
        await chargerUtilisateurs();
    } catch (erreur) {
        console.error(erreur);
        messageAdmin.textContent = erreur.message;
    }
}

corpsUtilisateurs.addEventListener("click", (event) => {
    const bouton = event.target.closest("button[data-action]");
    if (!bouton) return;

    const { action, id } = bouton.dataset;
    mettreAJourStatut(id, action);
});

filtreStatut.addEventListener("change", afficherUtilisateurs);

chargerUtilisateurs();

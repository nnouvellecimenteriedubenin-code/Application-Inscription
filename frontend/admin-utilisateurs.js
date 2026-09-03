const filtreStatut = document.getElementById("filtreStatut");
const corpsUtilisateurs = document.getElementById("corpsUtilisateurs");
const messageAdmin = document.getElementById("messageAdmin");

let utilisateursEnMemoire = [];
let jetonCsrf = null;
let promesseJetonCsrf = null;
const boutonDeconnexion = document.getElementById("boutonDeconnexion");
const DUREE_INACTIVITE_SESSION_MS = 10 * 60 * 1000;
const MARGE_VERIFICATION_SESSION_MS = 2 * 1000;
let minuteurVerificationSession = null;
let verificationSessionEnCours = null;
const canalSession = typeof BroadcastChannel === "function"
    ? new BroadcastChannel("application-inscription-session")
    : null;

function redirigerVersConnexion(notifierAutresOnglets = true) {
    if (minuteurVerificationSession) {
        clearTimeout(minuteurVerificationSession);
        minuteurVerificationSession = null;
    }

    if (notifierAutresOnglets && canalSession) {
        canalSession.postMessage({ type: "session-terminee" });
    }

    window.location.replace("/login");
}

function programmerVerificationSession() {
    if (minuteurVerificationSession) {
        clearTimeout(minuteurVerificationSession);
    }

    minuteurVerificationSession = setTimeout(() => {
        verifierSessionAdmin();
    }, DUREE_INACTIVITE_SESSION_MS + MARGE_VERIFICATION_SESSION_MS);
}

async function fetchAuthentifie(url, options) {
    const reponse = await fetch(url, options);

    if (reponse.status === 401) {
        redirigerVersConnexion();
        throw new Error("Votre session a expiré.");
    }

    programmerVerificationSession();
    return reponse;
}

if (canalSession) {
    canalSession.addEventListener("message", (event) => {
        if (event.data?.type === "session-terminee") {
            redirigerVersConnexion(false);
        }
    });
}

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

function creerCellule(texte) {
    const cellule = document.createElement("td");
    cellule.textContent = texte ?? "";
    return cellule;
}

function ajouterOption(selecteur, valeur, libelle, desactivee = false) {
    const option = document.createElement("option");
    option.value = valeur;
    option.textContent = libelle;
    option.disabled = desactivee;
    selecteur.appendChild(option);
}

function creerSelecteurRole(utilisateur) {
    const selecteur = document.createElement("select");
    selecteur.className = "selecteur-tableau";
    selecteur.dataset.type = "role";
    selecteur.dataset.id = utilisateur.id;
    selecteur.setAttribute("aria-label", `Rôle de ${utilisateur.identifiant}`);

    ajouterOption(selecteur, "utilisateur", "Utilisateur");
    ajouterOption(selecteur, "administrateur", "Administrateur");
    selecteur.value = utilisateur.role;

    return selecteur;
}

function creerBoutonAction(utilisateur, label, action, desactive = false) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.dataset.action = action;
    bouton.dataset.id = utilisateur.id;
    bouton.textContent = label;
    bouton.disabled = desactive;

    if (action === "supprimer") {
        bouton.classList.add("bouton-danger");
    }

    return bouton;
}

function commencerTraitement(controle) {
    if (!controle) return () => {};

    const libelleInitial = controle.textContent;
    controle.disabled = true;
    controle.textContent = "Traitement…";
    controle.setAttribute("aria-busy", "true");

    return () => {
        if (!controle.isConnected) return;

        controle.disabled = false;
        controle.textContent = libelleInitial;
        controle.removeAttribute("aria-busy");
    };
}

function remplacerUtilisateurEnMemoire(utilisateurMisAJour) {
    utilisateursEnMemoire = utilisateursEnMemoire.map((utilisateur) => (
        String(utilisateur.id) === String(utilisateurMisAJour.id)
            ? utilisateurMisAJour
            : utilisateur
    ));
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
        const ligne = document.createElement("tr");

        ligne.appendChild(creerCellule(utilisateur.nom));
        ligne.appendChild(creerCellule(utilisateur.prenom));
        ligne.appendChild(creerCellule(utilisateur.identifiant));
        ligne.appendChild(creerCellule(utilisateur.email));
        ligne.appendChild(creerCellule(utilisateur.telephone));
        const celluleRole = document.createElement("td");
        celluleRole.appendChild(creerSelecteurRole(utilisateur));
        ligne.appendChild(celluleRole);

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

        if (utilisateur.statut === "en_attente"
            || utilisateur.statut === "désactivé") {
            conteneurActions.appendChild(creerBoutonAction(
                utilisateur,
                "Activer",
                "activer"
            ));
        }

        if (utilisateur.statut === "actif") {
            conteneurActions.appendChild(creerBoutonAction(
                utilisateur,
                "Désactiver",
                "desactiver"
            ));
        }

        conteneurActions.appendChild(creerBoutonAction(
            utilisateur,
            "Supprimer",
            "supprimer"
        ));

        celluleActions.appendChild(conteneurActions);
        ligne.appendChild(celluleActions);
        corpsUtilisateurs.appendChild(ligne);
    });
}

async function chargerUtilisateurs() {
    try {
        const reponse = await fetchAuthentifie("/api/admin/utilisateurs");
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

async function mettreAJourStatut(id, statutCible, controle = null) {
    const restaurerControle = commencerTraitement(controle);

    try {
        const csrfToken = await obtenirJetonCsrf();

        const reponse = await fetchAuthentifie(`/api/admin/utilisateurs/${id}/statut`, {
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

        if (resultat.sessionInvalidee) {
            window.location.assign("/login");
            return;
        }

        remplacerUtilisateurEnMemoire(resultat.utilisateur);
        afficherUtilisateurs();
        messageAdmin.textContent = `Statut mis à jour : ${obtenirLabelStatut(resultat.utilisateur.statut)}`;
    } catch (erreur) {
        console.error(erreur);
        restaurerControle();
        messageAdmin.textContent = erreur.message;
    }
}

async function mettreAJourRole(id, role, controle) {
    try {
        controle.disabled = true;
        const csrfToken = await obtenirJetonCsrf();

        const reponse = await fetchAuthentifie(`/api/admin/utilisateurs/${id}/role`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrfToken
            },
            body: JSON.stringify({ role })
        });

        const resultat = await reponse.json();
        if (!reponse.ok) {
            throw new Error(resultat.message || "Erreur lors de la mise à jour du rôle");
        }

        if (resultat.sessionInvalidee) {
            window.location.assign("/login");
            return;
        }

        await chargerUtilisateurs();
        messageAdmin.textContent = `Rôle mis à jour : ${role === "administrateur" ? "Administrateur" : "Utilisateur"}`;
    } catch (erreur) {
        console.error(erreur);
        const messageErreur = erreur.message;
        await chargerUtilisateurs();
        messageAdmin.textContent = messageErreur;
    }
}

async function supprimerUtilisateur(id, identifiant, controle) {
    const confirmation = window.confirm(
        `Confirmer la suppression du compte « ${identifiant} » ? Cette action est irréversible.`
    );

    if (!confirmation) {
        messageAdmin.textContent = "Suppression annulée.";
        return;
    }

    const restaurerControle = commencerTraitement(controle);

    try {
        const csrfToken = await obtenirJetonCsrf();
        const reponse = await fetchAuthentifie(`/api/admin/utilisateurs/${id}`, {
            method: "DELETE",
            headers: {
                "X-CSRF-Token": csrfToken
            }
        });

        const resultat = await reponse.json();
        if (!reponse.ok) {
            throw new Error(resultat.message || "Erreur lors de la suppression");
        }

        if (resultat.sessionInvalidee) {
            window.location.assign("/login");
            return;
        }

        utilisateursEnMemoire = utilisateursEnMemoire.filter(
            (utilisateur) => String(utilisateur.id) !== String(id)
        );
        afficherUtilisateurs();
        messageAdmin.textContent = "Utilisateur supprimé.";
    } catch (erreur) {
        console.error(erreur);
        restaurerControle();
        messageAdmin.textContent = erreur.message;
    }
}

corpsUtilisateurs.addEventListener("click", (event) => {
    const bouton = event.target.closest("button[data-action]");
    if (!bouton) return;

    const { action, id } = bouton.dataset;
    const utilisateur = utilisateursEnMemoire.find(
        (element) => String(element.id) === String(id)
    );

    if (!utilisateur) {
        messageAdmin.textContent = "Utilisateur introuvable dans la liste.";
        return;
    }

    if (action === "activer") {
        mettreAJourStatut(id, "actif", bouton);
    } else if (action === "desactiver") {
        mettreAJourStatut(id, "désactivé", bouton);
    } else if (action === "supprimer") {
        supprimerUtilisateur(id, utilisateur.identifiant, bouton);
    }
});

corpsUtilisateurs.addEventListener("change", (event) => {
    const selecteur = event.target.closest("select[data-type]");
    if (!selecteur) return;

    const { type, id } = selecteur.dataset;

    if (type === "role") {
        mettreAJourRole(id, selecteur.value, selecteur);
    }
});

async function verifierSessionAdmin() {
    if (verificationSessionEnCours) {
        return verificationSessionEnCours;
    }

    verificationSessionEnCours = (async () => {
        try {
            const reponse = await fetch("/session", {
                cache: "no-store"
            });

            if (!reponse.ok) {
                throw new Error("Impossible de vérifier la session.");
            }

            const session = await reponse.json();

            if (session.connecte !== true) {
                redirigerVersConnexion();
                return;
            }

            programmerVerificationSession();
        } catch (erreur) {
            console.error(erreur);
        }
    })();

    try {
        return await verificationSessionEnCours;
    } finally {
        verificationSessionEnCours = null;
    }
}

async function deconnecter() {
    if (!boutonDeconnexion) return;

    try {
        boutonDeconnexion.disabled = true;
        const csrfToken = await obtenirJetonCsrf();
        const reponse = await fetchAuthentifie("/logout", {
            method: "POST",
            headers: {
                "X-CSRF-Token": csrfToken
            }
        });

        if (!reponse.ok) {
            throw new Error("Impossible de vous déconnecter.");
        }

        jetonCsrf = null;
        redirigerVersConnexion();
    } catch (erreur) {
        console.error(erreur);
        boutonDeconnexion.disabled = false;
        messageAdmin.textContent = erreur.message;
    }
}

filtreStatut.addEventListener("change", afficherUtilisateurs);

if (boutonDeconnexion) {
    boutonDeconnexion.addEventListener("click", deconnecter);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        verifierSessionAdmin();
    }
});

window.addEventListener("focus", verifierSessionAdmin);
window.addEventListener("pageshow", verifierSessionAdmin);

obtenirJetonCsrf().catch(() => {
    console.warn("Le jeton CSRF sera demandé de nouveau lors de la prochaine action.");
});
verifierSessionAdmin();
chargerUtilisateurs();

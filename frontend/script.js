const formulaire = document.getElementById("formulaire");
const corpsTableau = document.querySelector("#tableInscriptions tbody");
const boutonEnregistrer = document.getElementById("boutonEnregistrer");

// Adresse de l'API
const API = "";

// Charger toutes les inscriptions
async function chargerInscriptions() {

    try {

        const reponse = await fetch(`${API}/inscriptions`);

        const inscriptions = await reponse.json();

        corpsTableau.innerHTML = "";

        inscriptions.forEach((personne) => {

            const ligne = document.createElement("tr");

            ligne.innerHTML = `
                <td>${personne.id}</td>
                <td>${personne.nom}</td>
                <td>${personne.prenom}</td>
                <td>${personne.sexe}</td>
                <td>${personne.telephone ?? ""}</td>
                <td>${personne.courriel ?? ""}</td>
                <td>
                    <button onclick="modifierInscription(${personne.id})">
                        ✏️ Modifier
                    </button>

                    <button onclick="supprimerInscription(${personne.id})">
                        🗑️ Supprimer
                    </button>
                </td>
            `;

            corpsTableau.appendChild(ligne);

        });

    } catch (erreur) {

        console.error(erreur);

        alert("Impossible de charger les inscriptions.");

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

        const reponse = await fetch(`${API}/inscriptions/${id}`, {

            method: "DELETE"

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

        const reponse = await fetch(url, {

            method: methode,

            headers: {

                "Content-Type": "application/json"

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

// Chargement initial
chargerInscriptions();
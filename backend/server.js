require("dotenv").config({ path: ".env" });

const express = require("express");
const path = require("path");
const pool = require("./database");

const app = express();

const PORT = process.env.PORT || 3000;

console.log("=== Variables chargées ===");
console.log("DB_HOST :", process.env.DB_HOST);
console.log("DB_PORT :", process.env.DB_PORT);
console.log("DB_NAME :", process.env.DB_NAME);
console.log("DB_USER :", process.env.DB_USER);
console.log("Mot de passe :", process.env.DB_PASSWORD ? "OK" : "ABSENT");

// Middleware
app.use(express.json());

// Servir le dossier frontend
app.use(express.static(path.join(__dirname, "../frontend")));

// Test connexion PostgreSQL
pool.query("SELECT NOW()")
.then((result) => {
    console.log("✅ Connexion à PostgreSQL réussie !");
    console.log(result.rows[0]);
})
.catch((error) => {
    console.error("❌ ERREUR COMPLETE");
    console.error(error);
});

// Validation
function validerInscription(donnees) {

    const {
        nom,
        prenom,
        dateNaissance,
        sexe,
        telephone,
        courriel
    } = donnees;

    if (!nom || !prenom) {
        return "Le nom et le prénom sont obligatoires.";
    }

    if (!dateNaissance) {
        return "La date de naissance est obligatoire.";
    }

    if (!["Homme", "Femme"].includes(sexe)) {
        return "Le sexe doit être Homme ou Femme.";
    }

    if (!telephone) {
        return "Le téléphone est obligatoire.";
    }

    if (courriel) {

        const emailRegle = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegle.test(courriel)) {
            return "Le format du courriel est incorrect.";
        }

    }

    return null;
}

// Accueil
app.get("/", (req, res) => {

    res.sendFile(path.join(__dirname, "../frontend/index.html"));

});

// Liste des inscriptions
app.get("/inscriptions", async (req, res) => {

    try {

        const result = await pool.query(
            "SELECT * FROM inscriptions ORDER BY id ASC"
        );

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Erreur serveur"
        });

    }

});

// Ajouter
app.post("/inscriptions", async (req, res) => {

    const erreur = validerInscription(req.body);

    if (erreur) {

        return res.status(400).json({
            message: erreur
        });

    }

    const {
        nom,
        prenom,
        dateNaissance,
        sexe,
        adresse,
        telephone,
        courriel
    } = req.body;

    try {

        const result = await pool.query(

            `INSERT INTO inscriptions
            (nom,prenom,date_naissance,sexe,adresse,telephone,courriel)
            VALUES($1,$2,$3,$4,$5,$6,$7)
            RETURNING *`,

            [
                nom,
                prenom,
                dateNaissance,
                sexe,
                adresse,
                telephone,
                courriel
            ]

        );

        res.json({

            message: "Inscription enregistrée avec succès",

            donnees: result.rows[0]

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Erreur serveur"

        });

    }

});

// Modifier
app.put("/inscriptions/:id", async (req, res) => {

    const id = req.params.id;

    const {
        nom,
        prenom,
        dateNaissance,
        sexe,
        adresse,
        telephone,
        courriel
    } = req.body;

    try {

        const result = await pool.query(

            `UPDATE inscriptions
            SET nom=$1,
                prenom=$2,
                date_naissance=$3,
                sexe=$4,
                adresse=$5,
                telephone=$6,
                courriel=$7
            WHERE id=$8
            RETURNING *`,

            [
                nom,
                prenom,
                dateNaissance,
                sexe,
                adresse,
                telephone,
                courriel,
                id
            ]

        );

        if (result.rows.length === 0) {

            return res.status(404).json({

                message: "Inscription introuvable"

            });

        }

        res.json({

            message: "Inscription modifiée avec succès",

            donnees: result.rows[0]

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Erreur serveur"

        });

    }

});

// Supprimer
app.delete("/inscriptions/:id", async (req, res) => {

    try {

        const result = await pool.query(

            "DELETE FROM inscriptions WHERE id=$1 RETURNING *",

            [req.params.id]

        );

        if (result.rows.length === 0) {

            return res.status(404).json({

                message: "Inscription introuvable"

            });

        }

        res.json({

            message: "Inscription supprimée avec succès"

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message: "Erreur serveur"

        });

    }

});

app.listen(PORT, () => {

    console.log(`Serveur démarré sur http://localhost:${PORT}`);

});
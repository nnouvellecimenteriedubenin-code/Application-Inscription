const path = require("path");
require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const bcrypt = require("bcrypt");
const pool = require("./database");

function lireConfigurationBootstrap() {

    const identifiant = String(process.env.ADMIN_IDENTIFIER || "").trim();
    const motDePasse = String(process.env.ADMIN_PASSWORD || "");

    if (!identifiant || !motDePasse) {
        throw new Error(
            "Configuration manquante : ADMIN_IDENTIFIER et ADMIN_PASSWORD sont requis pour le bootstrap explicite."
        );
    }

    return {
        identifiant,
        motDePasse
    };
}

async function bootstrapAdministrateur() {

    const { identifiant, motDePasse } = lireConfigurationBootstrap();
    const client = await pool.connect();

    try {

        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [741852]);

        const administrateurExistant = await client.query(
            "SELECT id FROM utilisateurs WHERE role='administrateur' LIMIT 1"
        );

        if (administrateurExistant.rows.length > 0) {
            await client.query("COMMIT");
            console.log("Bootstrap ignoré : un administrateur existe déjà dans utilisateurs.");
            return;
        }

        const identifiantExistant = await client.query(
            "SELECT id FROM utilisateurs WHERE identifiant=$1 LIMIT 1",
            [identifiant]
        );

        if (identifiantExistant.rows.length > 0) {
            throw new Error(
                "Bootstrap annulé : l'identifiant configuré appartient déjà à un utilisateur."
            );
        }

        const motDePasseHash = await bcrypt.hash(motDePasse, 10);

        await client.query(
            `INSERT INTO utilisateurs (identifiant, mot_de_passe, role, statut)
             VALUES ($1, $2, 'administrateur', 'actif')`,
            [identifiant, motDePasseHash]
        );

        await client.query("COMMIT");
        console.log("Compte administrateur initial créé dans utilisateurs.");

    } catch (error) {

        await client.query("ROLLBACK");
        throw error;

    } finally {

        client.release();
    }
}

bootstrapAdministrateur()
    .catch((error) => {
        console.error("Erreur de bootstrap administrateur :", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

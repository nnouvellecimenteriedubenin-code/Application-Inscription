const express = require("express");
const pool = require("./database");

const app = express();

const PORT = 3000;


// Validation des données d'inscription
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

        const emailRegle =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


        if (!emailRegle.test(courriel)) {

            return "Le format du courriel est incorrect.";

        }

    }


    return null;

}


// Permet de lire les données JSON
app.use(express.json());

// Test de connexion PostgreSQL
pool.query("SELECT NOW()")
  .then((result) => {
    console.log("✅ Connexion à PostgreSQL réussie !");
    console.log(result.rows[0]);
  })
 .catch((error) => {
  console.error("❌ ERREUR COMPLETE");
  console.dir(error, { depth: null });
});

// Route d'accueil
app.get("/", (req, res) => {
  res.send("Bienvenue sur Application-Inscription !");
});

// Enregistrer une inscription
app.post("/inscriptions", (req, res) => {

  const {
    nom,
    prenom,
    dateNaissance,
    sexe,
    adresse,
    telephone,
    courriel
  } = req.body;

const erreur = validerInscription(req.body);


if (erreur) {

    return res.status(400).json({

        message: erreur

    });

}

  const sql = `
    INSERT INTO inscriptions
    (nom, prenom, date_naissance, sexe, adresse, telephone, courriel)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;

  pool.query(sql, [
    nom,
    prenom,
    dateNaissance,
    sexe,
    adresse,
    telephone,
    courriel
  ])
    .then((result) => {

      console.log("Nouvelle inscription enregistrée :");
      console.log(result.rows[0]);

      res.json({
        message: "Inscription enregistrée avec succès",
        donnees: result.rows[0]
      });

    })
    .catch((error) => {

      console.error("Erreur lors de l'enregistrement :");
      console.error(error.message);

      res.status(500).json({
        message: "Erreur serveur"
      });

    });

});

// Récupérer toutes les inscriptions
app.get("/inscriptions", (req, res) => {

  pool.query("SELECT * FROM inscriptions ORDER BY id ASC")
    .then((result) => {
      res.json(result.rows);
    })
    .catch((error) => {

      console.error(error.message);

      res.status(500).json({
        message: "Erreur serveur"
      });

    });

});

// Modifier une inscription
app.put("/inscriptions/:id", (req, res) => {

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


    const sql = `
        UPDATE inscriptions
        SET
            nom = $1,
            prenom = $2,
            date_naissance = $3,
            sexe = $4,
            adresse = $5,
            telephone = $6,
            courriel = $7
        WHERE id = $8
        RETURNING *
    `;


    pool.query(sql, [
        nom,
        prenom,
        dateNaissance,
        sexe,
        adresse,
        telephone,
        courriel,
        id
    ])

    .then((result) => {


        if(result.rows.length === 0){

            return res.status(404).json({
                message:"Inscription introuvable"
            });

        }


        console.log("Inscription modifiée :");
        console.log(result.rows[0]);


        res.json({

            message:"Inscription modifiée avec succès",

            donnees: result.rows[0]

        });


    })

    .catch((error)=>{


        console.error(
            "Erreur modification :",
            error.message
        );


        res.status(500).json({

            message:"Erreur serveur"

        });


    });


});




// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});

// Supprimer une inscription
app.delete("/inscriptions/:id", (req, res) => {

  const id = req.params.id;

  pool.query(
    "DELETE FROM inscriptions WHERE id = $1 RETURNING *",
    [id]
  )
  .then((result) => {

    if (result.rows.length === 0) {

      return res.status(404).json({
        message: "Inscription introuvable"
      });

    }

    console.log("Inscription supprimée :");
    console.log(result.rows[0]);

    res.json({
      message: "Inscription supprimée avec succès"
    });

  })
  .catch((error) => {

    console.error(error.message);

    res.status(500).json({
      message: "Erreur serveur"
    });

  });

});
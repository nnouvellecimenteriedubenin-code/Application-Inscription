const crypto = require("crypto");
const bcrypt = require("bcrypt");
const pool = require("./database");

const IDENTIFIANT_ADMINISTRATEUR = "admin";
const ROLE_ADMINISTRATEUR = "administrateur";
const STATUT_ACTIF = "actif";
const BCRYPT_ROUNDS = 12;
const VERROU_ROTATION_ADMIN = 741852;

class ErreurRotation extends Error {}

function genererMotDePasse() {
  const donneesAleatoires = crypto.randomBytes(32);
  const motDePasse = donneesAleatoires.toString("base64url");

  donneesAleatoires.fill(0);

  const longueurEnOctets = Buffer.byteLength(motDePasse, "utf8");
  if (longueurEnOctets < 32 || longueurEnOctets > 72) {
    throw new ErreurRotation(
      "La génération du mot de passe n'a pas respecté les limites de sécurité attendues."
    );
  }

  return motDePasse;
}

async function rotationMotDePasseAdministrateur() {
  let client = null;
  let transactionOuverte = false;
  let nouveauMotDePasse = null;
  let nouveauHash = null;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionOuverte = true;

    await client.query("SELECT pg_advisory_xact_lock($1)", [
      VERROU_ROTATION_ADMIN,
    ]);

    const administrateurs = await client.query(
      `SELECT id, identifiant, role, statut
       FROM utilisateurs
       WHERE role = $1
       ORDER BY id
       FOR UPDATE`,
      [ROLE_ADMINISTRATEUR]
    );

    if (administrateurs.rowCount !== 1) {
      throw new ErreurRotation(
        "Rotation refusée : la base doit contenir exactement un administrateur."
      );
    }

    const administrateur = administrateurs.rows[0];

    if (administrateur.statut !== STATUT_ACTIF) {
      throw new ErreurRotation(
        "Rotation refusée : l'unique administrateur n'est pas actif."
      );
    }

    if (administrateur.identifiant !== IDENTIFIANT_ADMINISTRATEUR) {
      throw new ErreurRotation(
        "Rotation refusée : l'identifiant de l'administrateur ne correspond pas à celui attendu."
      );
    }

    nouveauMotDePasse = genererMotDePasse();
    nouveauHash = await bcrypt.hash(nouveauMotDePasse, BCRYPT_ROUNDS);

    const miseAJour = await client.query(
      `UPDATE utilisateurs
       SET mot_de_passe = $1
       WHERE id = $2
         AND identifiant = $3
         AND role = $4
         AND statut = $5
       RETURNING id`,
      [
        nouveauHash,
        administrateur.id,
        IDENTIFIANT_ADMINISTRATEUR,
        ROLE_ADMINISTRATEUR,
        STATUT_ACTIF,
      ]
    );

    if (miseAJour.rowCount !== 1) {
      throw new ErreurRotation(
        "Rotation annulée : le compte administrateur a changé pendant l'opération."
      );
    }

    await client.query(
      `DELETE FROM sessions_application
       WHERE sess->>'userId' = $1`,
      [String(administrateur.id)]
    );

    await client.query("COMMIT");
    transactionOuverte = false;

    process.stdout.write(
      `Rotation réussie.\n` +
        `Identifiant administrateur : ${IDENTIFIANT_ADMINISTRATEUR}\n` +
        `NOUVEAU MOT DE PASSE : ${nouveauMotDePasse}\n`
    );
  } catch (erreur) {
    if (transactionOuverte) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ne pas exposer les détails internes de PostgreSQL.
      }
    }

    if (erreur instanceof ErreurRotation) {
      process.stderr.write(`${erreur.message}\n`);
    } else {
      process.stderr.write(
        "Rotation annulée en raison d'une erreur interne. Aucune modification n'a été validée.\n"
      );
    }

    process.exitCode = 1;
  } finally {
    nouveauMotDePasse = null;
    nouveauHash = null;
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

rotationMotDePasseAdministrateur().catch(() => {
  process.stderr.write(
    "Rotation interrompue en raison d'une erreur interne non récupérable.\n"
  );
  process.exitCode = 1;
});

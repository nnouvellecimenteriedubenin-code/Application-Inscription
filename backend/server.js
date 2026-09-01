require("dotenv").config({ path: ".env" });

const express = require("express");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const Redis = require("ioredis");
const session = require("express-session");
const PostgreSqlSessionStore = require("connect-pg-simple")(session);
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const XLSX = require("xlsx");
const pool = require("./database");

const app = express();

const PORT = process.env.PORT || 3000;
const ENVIRONNEMENT = process.env.NODE_ENV || "development";
const EST_PRODUCTION = ENVIRONNEMENT === "production";
const DUREE_SESSION_MS = 8 * 60 * 60 * 1000;
const LONGUEUR_MINIMALE_SECRET_SESSION = 32;

function obtenirProxysConfiance() {

    if (!EST_PRODUCTION) {
        return [];
    }

    const configuration = String(process.env.TRUST_PROXY || "").trim();

    if (!configuration) {
        return [];
    }

    const proxys = configuration
        .split(",")
        .map((valeur) => valeur.trim())
        .filter(Boolean);
    const valeursInterdites = new Set([
        "true",
        "false",
        "loopback",
        "linklocal",
        "uniquelocal",
        "0.0.0.0/0",
        "::/0"
    ]);

    if (proxys.some((valeur) => valeursInterdites.has(valeur.toLowerCase())
        || /^\d+$/.test(valeur))) {
        throw new Error(
            "Configuration invalide : TRUST_PROXY doit contenir uniquement les IP ou CIDR explicitement documentés par l'hébergeur."
        );
    }

    return proxys;
}

const PROXYS_CONFIANCE = obtenirProxysConfiance();

app.set("env", ENVIRONNEMENT);

if (EST_PRODUCTION && PROXYS_CONFIANCE.length > 0) {
    try {
        app.set("trust proxy", PROXYS_CONFIANCE);
    } catch (error) {
        throw new Error(
            "Configuration invalide : TRUST_PROXY contient une IP ou un CIDR incorrect."
        );
    }
}

app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            upgradeInsecureRequests: EST_PRODUCTION ? [] : null
        }
    },
    strictTransportSecurity: EST_PRODUCTION
        ? {
            maxAge: 31536000,
            includeSubDomains: true
        }
        : false,
    frameguard: {
        action: "deny"
    },
    referrerPolicy: {
        policy: "no-referrer"
    }
}));

if (EST_PRODUCTION) {
    app.use((req, res, next) => {

        if (req.secure) {
            return next();
        }

        return res.status(426).json({
            message: "Une connexion HTTPS est requise."
        });
    });
}

const stockageSessions = new PostgreSqlSessionStore({
    pool,
    tableName: "sessions_application",
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60
});

console.log("=== Variables chargées ===");
console.log("DB_HOST :", process.env.DB_HOST);
console.log("DB_PORT :", process.env.DB_PORT);
console.log("DB_NAME :", process.env.DB_NAME);
console.log("DB_USER :", process.env.DB_USER);
console.log("Mot de passe :", process.env.DB_PASSWORD ? "OK" : "ABSENT");

function verifierConfiguration() {

    const environnementsAutorises = ["development", "test", "production"];

    if (!environnementsAutorises.includes(ENVIRONNEMENT)) {
        throw new Error(
            "Configuration invalide : NODE_ENV doit valoir development, test ou production."
        );
    }

    const variablesRequises = [
        "SESSION_SECRET"
    ];

    const manquantes = variablesRequises.filter((nom) => {
        const valeur = process.env[nom];
        return !valeur || valeur.trim() === "";
    });

    if (manquantes.length > 0) {
        throw new Error(
            `Configuration manquante : ${manquantes.join(", ")}. Ajoutez ces variables dans le fichier .env avant de démarrer le serveur.`
        );
    }

    const longueurSecretSession = Buffer.byteLength(
        process.env.SESSION_SECRET,
        "utf8"
    );

    if (EST_PRODUCTION && longueurSecretSession < LONGUEUR_MINIMALE_SECRET_SESSION) {
        throw new Error(
            `Configuration invalide : SESSION_SECRET doit contenir au moins ${LONGUEUR_MINIMALE_SECRET_SESSION} octets aléatoires en production.`
        );
    }

    if (EST_PRODUCTION && PROXYS_CONFIANCE.length === 0) {
        throw new Error(
            "Configuration manquante : TRUST_PROXY doit contenir les IP ou CIDR documentés du proxy HTTPS."
        );
    }

    if (!EST_PRODUCTION && longueurSecretSession < LONGUEUR_MINIMALE_SECRET_SESSION) {
        console.warn(
            `Avertissement : SESSION_SECRET devra contenir au moins ${LONGUEUR_MINIMALE_SECRET_SESSION} octets aléatoires avant le déploiement en production.`
        );
    }

}

verifierConfiguration();

function obtenirUrlRedisProduction() {

    if (!EST_PRODUCTION) {
        return null;
    }

    const valeur = String(process.env.REDIS_URL || "").trim();

    if (!valeur) {
        throw new Error(
            "Configuration manquante : REDIS_URL est requise en production."
        );
    }

    try {
        const url = new URL(valeur);

        if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname) {
            throw new Error("URL Valkey invalide");
        }
    } catch (error) {
        throw new Error(
            "Configuration invalide : REDIS_URL doit être une URL Redis/Valkey valide."
        );
    }

    return valeur;
}

const URL_REDIS = obtenirUrlRedisProduction();
const clientRedis = URL_REDIS
    ? new Redis(URL_REDIS, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000
    })
    : null;

if (clientRedis) {
    clientRedis.on("error", () => {
        console.error("Connexion au service Valkey temporairement indisponible.");
    });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    name: "application_inscription.sid",
    store: stockageSessions,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    unset: "destroy",
    cookie: {
        httpOnly: true,
        secure: EST_PRODUCTION,
        sameSite: "lax",
        maxAge: DUREE_SESSION_MS
    }
}));

function obtenirJetonCsrf(req) {

    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }

    return req.session.csrfToken;
}

function jetonsEgaux(jetonRecu, jetonSession) {

    if (typeof jetonRecu !== "string" || typeof jetonSession !== "string") {
        return false;
    }

    const tamponRecu = Buffer.from(jetonRecu, "utf8");
    const tamponSession = Buffer.from(jetonSession, "utf8");

    return tamponRecu.length === tamponSession.length
        && crypto.timingSafeEqual(tamponRecu, tamponSession);
}

function origineRequeteAutorisee(req) {

    const origine = req.get("origin");
    const referer = req.get("referer");
    const source = origine || referer;

    if (!source) {
        return true;
    }

    try {
        const urlSource = new URL(source);
        const origineAttendue = `${req.protocol}://${req.get("host")}`;
        return urlSource.origin === origineAttendue;
    } catch (error) {
        return false;
    }
}

function protegerCsrf(req, res, next) {

    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        return next();
    }

    const jetonRecu = req.get("x-csrf-token");
    const jetonSession = req.session && req.session.csrfToken;

    if (!origineRequeteAutorisee(req) || !jetonsEgaux(jetonRecu, jetonSession)) {
        return res.status(403).json({
            message: "Requête refusée : jeton CSRF invalide."
        });
    }

    return next();
}

function obtenirCleClientLimiteurCsrf(req) {

    if (!EST_PRODUCTION) {
        return ipKeyGenerator(req.ip);
    }

    const adresseRender = String(req.get("cf-connecting-ip") || "").trim();

    if (net.isIP(adresseRender) === 0) {
        throw new Error("Adresse client Render absente ou invalide.");
    }

    return ipKeyGenerator(adresseRender);
}

let limiteurCreationSessionCsrf = null;

function creerLimiteurCreationSessionCsrf() {

    const options = {
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        identifier: "csrf-session-creation",
        passOnStoreError: false,
        keyGenerator: obtenirCleClientLimiteurCsrf,
        skip: (req) => Boolean(req.session && req.session.csrfToken),
        message: {
            message: "Trop de créations de session. Réessayez dans 15 minutes."
        }
    };

    if (clientRedis) {
        options.store = new RedisStore({
            prefix: "application-inscription:csrf:",
            sendCommand: (commande, ...argumentsCommande) => (
                clientRedis.call(commande, ...argumentsCommande)
            )
        });
    }

    return rateLimit(options);
}

function protegerCreationSessionCsrf(req, res, next) {

    if (!limiteurCreationSessionCsrf) {
        return res.status(503).json({
            message: "Service de sécurité temporairement indisponible."
        });
    }

    limiteurCreationSessionCsrf(req, res, (error) => {

        if (!error) {
            return next();
        }

        const referenceErreur = crypto.randomUUID();

        console.error(
            `[${referenceErreur}] Service de limitation CSRF indisponible.`
        );

        return res.status(503).json({
            message: "Service de sécurité temporairement indisponible.",
            reference: referenceErreur
        });
    });
}

app.get("/csrf-token", protegerCreationSessionCsrf, (req, res) => {

    res.setHeader("Cache-Control", "no-store");
    res.json({
        csrfToken: obtenirJetonCsrf(req)
    });

});

app.use(protegerCsrf);

const limiteurConnexion = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
        message: "Trop de tentatives de connexion. Réessayez dans 15 minutes."
    }
});

const limiteurInscription = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        message: "Trop de demandes d'inscription. Réessayez plus tard."
    }
});

// Pages et routes d'authentification
app.get("/login", (req, res) => {

    res.sendFile(path.join(__dirname, "../frontend/login.html"));

});

app.get("/register", (req, res) => {

    res.sendFile(path.join(__dirname, "../frontend/register.html"));

});

async function verifierUtilisateurSession(req) {

    if (!req.session || !req.session.userId) {
        return null;
    }

    const resultat = await pool.query(
        "SELECT id, role, statut FROM utilisateurs WHERE id=$1",
        [req.session.userId]
    );

    const utilisateur = resultat.rows[0] || null;

    if (utilisateur) {
        req.session.role = utilisateur.role;
        req.session.statut = utilisateur.statut;
    }

    return utilisateur;
}

function detruireSession(req) {

    return new Promise((resolve, reject) => {

        if (!req.session) {
            return resolve();
        }

        req.session.destroy((erreur) => {

            if (erreur) {
                return reject(erreur);
            }

            resolve();

        });

    });
}

function regenererSessionUtilisateur(req, utilisateur) {

    return new Promise((resolve, reject) => {

        req.session.regenerate((erreurRegeneration) => {

            if (erreurRegeneration) {
                return reject(erreurRegeneration);
            }

            req.session.userId = utilisateur.id;
            req.session.identifiant = utilisateur.identifiant;
            req.session.role = utilisateur.role;
            req.session.statut = utilisateur.statut;

            req.session.save((erreurSauvegarde) => {

                if (erreurSauvegarde) {
                    return reject(erreurSauvegarde);
                }

                resolve();

            });

        });

    });
}

async function protegerCompteActif(req, res, next) {

    try {

        const utilisateur = await verifierUtilisateurSession(req);

        if (utilisateur && utilisateur.statut === "actif") {
            return next();
        }

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            message: "Erreur serveur"
        });

    }

    if (req.accepts("html")) {
        return res.status(403).send("Accès refusé.");
    }

    return res.status(403).json({
        message: "Accès refusé."
    });

}

async function protegerAdmin(req, res, next) {

    try {

        const utilisateur = await verifierUtilisateurSession(req);

        if (utilisateur && utilisateur.role === "administrateur" && utilisateur.statut === "actif") {
            return next();
        }

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            message: "Erreur serveur"
        });

    }

    if (req.accepts("html")) {
        return res.status(403).send("Accès refusé.");
    }

    return res.status(403).json({
        message: "Accès refusé."
    });

}

app.get("/admin-utilisateurs", protegerAdmin, (req, res) => {

    res.sendFile(path.join(__dirname, "../frontend/admin-utilisateurs.html"));

});

app.get("/admin-utilisateurs.html", protegerAdmin, (req, res) => {

    res.sendFile(path.join(__dirname, "../frontend/admin-utilisateurs.html"));

});

app.get("/api/admin/utilisateurs", protegerAdmin, async (req, res) => {

    try {

        const resultat = await pool.query(`
            SELECT id, nom, prenom, identifiant, email, telephone, role, statut, cree_le
            FROM utilisateurs
            ORDER BY cree_le DESC
        `);

        res.json(resultat.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Erreur serveur"
        });

    }

});

function laisseraitSansAdministrateurActif(utilisateur, statutCible, nombreAdministrateursActifs) {

    return utilisateur.role === "administrateur"
        && utilisateur.statut === "actif"
        && statutCible !== "actif"
        && nombreAdministrateursActifs <= 1;

}

app.patch("/api/admin/utilisateurs/:id/statut", protegerAdmin, async (req, res) => {

    const id = validerIdentifiantPositif(req.params.id);

    if (id === null) {
        return res.status(400).json({
            message: "L'identifiant utilisateur doit être un entier positif."
        });
    }

    const validationStatut = validerChangementStatut(req.body);

    if (validationStatut.erreur) {
        return res.status(400).json({
            message: validationStatut.erreur
        });
    }

    const statut = validationStatut.valeur;

    let client;
    let transactionOuverte = false;

    try {

        client = await pool.connect();
        await client.query("BEGIN");
        transactionOuverte = true;

        // Ce verrou sérialise les changements de comptes afin que deux opérations
        // concurrentes ne puissent pas désactiver les derniers administrateurs.
        await client.query("LOCK TABLE utilisateurs IN SHARE ROW EXCLUSIVE MODE");

        const resultatUtilisateur = await client.query(
            `SELECT id, nom, prenom, identifiant, email, telephone, role, statut, cree_le
             FROM utilisateurs
             WHERE id=$1`,
            [id]
        );

        if (resultatUtilisateur.rows.length === 0) {
            await client.query("ROLLBACK");
            transactionOuverte = false;

            return res.status(404).json({
                message: "Utilisateur introuvable"
            });
        }

        const utilisateur = resultatUtilisateur.rows[0];
        let nombreAdministrateursActifs = 0;

        if (utilisateur.role === "administrateur"
            && utilisateur.statut === "actif"
            && statut !== "actif") {

            const resultatAdministrateursActifs = await client.query(
                `SELECT COUNT(*)::integer AS total
                 FROM utilisateurs
                 WHERE role='administrateur' AND statut='actif'`
            );

            nombreAdministrateursActifs = resultatAdministrateursActifs.rows[0].total;
        }

        if (laisseraitSansAdministrateurActif(
            utilisateur,
            statut,
            nombreAdministrateursActifs
        )) {
            await client.query("ROLLBACK");
            transactionOuverte = false;

            return res.status(409).json({
                message: "Impossible de désactiver ou refuser le dernier administrateur actif."
            });
        }

        const resultat = await client.query(
            `UPDATE utilisateurs
             SET statut=$1
             WHERE id=$2
             RETURNING id, nom, prenom, identifiant, email, telephone, role, statut, cree_le`,
            [statut, id]
        );

        await client.query("COMMIT");
        transactionOuverte = false;

        res.json({
            message: "Statut mis à jour",
            utilisateur: resultat.rows[0]
        });

    } catch (error) {

        if (client && transactionOuverte) {
            try {
                await client.query("ROLLBACK");
            } catch (erreurAnnulation) {
                console.error(erreurAnnulation);
            }
        }

        console.error(error);

        res.status(500).json({
            message: "Erreur serveur"
        });

    } finally {

        if (client) {
            client.release();
        }

    }

});

// Accueil
async function servirApplicationPrivee(req, res) {

    let utilisateur;

    try {

        utilisateur = await verifierUtilisateurSession(req);

    } catch (error) {

        console.error(error);

        return res.status(503).send("Service temporairement indisponible.");

    }

    if (!utilisateur || utilisateur.statut !== "actif") {

        try {

            await detruireSession(req);

        } catch (error) {

            console.error(error);

            return res.status(500).send("Erreur serveur");

        }

        return res.redirect("/login");
    }

    res.sendFile(path.join(__dirname, "../frontend/index.html"));

}

app.get("/", servirApplicationPrivee);
app.get("/index.html", servirApplicationPrivee);

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
const STATUTS_AUTORISES = new Set(["actif", "en_attente", "refusé", "désactivé"]);
const SEXES_AUTORISES = new Set(["Homme", "Femme"]);
const REGLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGLE_IDENTIFIANT = /^[\p{L}\p{N}._@-]+$/u;

function estObjetRequete(donnees) {

    return donnees !== null && typeof donnees === "object" && !Array.isArray(donnees);
}

function trouverChampInattendu(donnees, champsAutorises) {

    return Object.keys(donnees).find((champ) => !champsAutorises.includes(champ));
}

function normaliserTexte(valeur) {

    return valeur.normalize("NFC").trim().replace(/\s+/g, " ");
}

function validerTexte(valeur, nomChamp, longueurMaximale, obligatoire = true) {

    if (typeof valeur !== "string") {
        return {
            erreur: `${nomChamp} doit être une chaîne de caractères.`
        };
    }

    const valeurNormalisee = normaliserTexte(valeur);

    if (obligatoire && valeurNormalisee.length === 0) {
        return {
            erreur: `${nomChamp} est obligatoire.`
        };
    }

    if (valeurNormalisee.length > longueurMaximale) {
        return {
            erreur: `${nomChamp} ne doit pas dépasser ${longueurMaximale} caractères.`
        };
    }

    return {
        valeur: valeurNormalisee
    };
}

function validerEmail(valeur, nomChamp, longueurMaximale, obligatoire = true) {

    const resultatTexte = validerTexte(
        valeur,
        nomChamp,
        longueurMaximale,
        obligatoire
    );

    if (resultatTexte.erreur || resultatTexte.valeur.length === 0) {
        return resultatTexte;
    }

    const email = resultatTexte.valeur.toLowerCase();
    const [partieLocale, domaine] = email.split("@");

    if (!REGLE_EMAIL.test(email)
        || !partieLocale
        || partieLocale.length > 64
        || !domaine
        || domaine.length > 253) {
        return {
            erreur: `Le format de ${nomChamp.toLowerCase()} est incorrect.`
        };
    }

    return {
        valeur: email
    };
}

function validerTelephone(valeur, nomChamp, longueurMaximale) {

    const resultatTexte = validerTexte(valeur, nomChamp, longueurMaximale);

    if (resultatTexte.erreur) {
        return resultatTexte;
    }

    const telephoneSaisi = resultatTexte.valeur;

    if (!/^\+?[0-9 .()/-]+$/.test(telephoneSaisi)) {
        return {
            erreur: `${nomChamp} contient des caractères invalides.`
        };
    }

    const chiffres = telephoneSaisi.replace(/\D/g, "");

    if (chiffres.length < 7 || chiffres.length > 15) {
        return {
            erreur: `${nomChamp} doit contenir entre 7 et 15 chiffres.`
        };
    }

    return {
        valeur: telephoneSaisi.startsWith("+") ? `+${chiffres}` : chiffres
    };
}

function validerDateNaissance(valeur) {

    if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
        return {
            erreur: "La date de naissance doit respecter le format AAAA-MM-JJ."
        };
    }

    const [annee, mois, jour] = valeur.split("-").map(Number);
    const date = new Date(Date.UTC(annee, mois - 1, jour));

    if (date.getUTCFullYear() !== annee
        || date.getUTCMonth() !== mois - 1
        || date.getUTCDate() !== jour) {
        return {
            erreur: "La date de naissance est invalide."
        };
    }

    const maintenant = new Date();
    const aujourdHui = new Date(Date.UTC(
        maintenant.getUTCFullYear(),
        maintenant.getUTCMonth(),
        maintenant.getUTCDate()
    ));
    const dateMinimale = new Date(aujourdHui);
    dateMinimale.setUTCFullYear(dateMinimale.getUTCFullYear() - 120);

    if (date > aujourdHui || date < dateMinimale) {
        return {
            erreur: "La date de naissance n'est pas réaliste."
        };
    }

    return {
        valeur
    };
}

function validerIdentifiantPositif(valeur) {

    if (typeof valeur !== "string" || !/^\d+$/.test(valeur)) {
        return null;
    }

    const identifiant = Number(valeur);

    if (!Number.isSafeInteger(identifiant)
        || identifiant <= 0
        || identifiant > 2147483647) {
        return null;
    }

    return identifiant;
}

function validerInscription(donnees) {

    const champsAutorises = [
        "nom",
        "prenom",
        "dateNaissance",
        "sexe",
        "adresse",
        "telephone",
        "courriel"
    ];

    if (!estObjetRequete(donnees)) {
        return {
            erreur: "Le corps de la requête doit être un objet JSON."
        };
    }

    const champInattendu = trouverChampInattendu(donnees, champsAutorises);

    if (champInattendu) {
        return {
            erreur: `Champ inattendu : ${champInattendu}.`
        };
    }

    const nom = validerTexte(donnees.nom, "Le nom", 100);
    const prenom = validerTexte(donnees.prenom, "Le prénom", 100);
    const dateNaissance = validerDateNaissance(donnees.dateNaissance);
    const sexe = validerTexte(donnees.sexe, "Le sexe", 20);
    const adresse = validerTexte(donnees.adresse ?? "", "L'adresse", 500, false);
    const telephone = validerTelephone(donnees.telephone, "Le téléphone", 30);
    const courriel = validerEmail(donnees.courriel ?? "", "Le courriel", 150, false);
    const resultats = [nom, prenom, dateNaissance, sexe, adresse, telephone, courriel];
    const resultatInvalide = resultats.find((resultat) => resultat.erreur);

    if (resultatInvalide) {
        return resultatInvalide;
    }

    if (!SEXES_AUTORISES.has(sexe.valeur)) {
        return {
            erreur: "Le sexe doit être Homme ou Femme."
        };
    }

    return {
        valeur: {
            nom: nom.valeur,
            prenom: prenom.valeur,
            dateNaissance: dateNaissance.valeur,
            sexe: sexe.valeur,
            adresse: adresse.valeur,
            telephone: telephone.valeur,
            courriel: courriel.valeur
        }
    };
}

function validerCreationCompte(donnees) {

    const champsAutorises = [
        "nom",
        "prenom",
        "identifiant",
        "email",
        "telephone",
        "motDePasse",
        "confirmationMotDePasse"
    ];

    if (!estObjetRequete(donnees)) {
        return {
            erreur: "Le corps de la requête doit être un objet JSON."
        };
    }

    const champInattendu = trouverChampInattendu(donnees, champsAutorises);

    if (champInattendu) {
        return {
            erreur: `Champ inattendu : ${champInattendu}.`
        };
    }

    const nom = validerTexte(donnees.nom, "Le nom", 100);
    const prenom = validerTexte(donnees.prenom, "Le prénom", 100);
    const identifiant = validerTexte(donnees.identifiant, "L'identifiant", 100);
    const email = validerEmail(donnees.email, "Le courriel", 254);
    const telephone = validerTelephone(donnees.telephone, "Le téléphone", 50);
    const resultats = [nom, prenom, identifiant, email, telephone];
    const resultatInvalide = resultats.find((resultat) => resultat.erreur);

    if (resultatInvalide) {
        return resultatInvalide;
    }

    if (identifiant.valeur.length < 3 || !REGLE_IDENTIFIANT.test(identifiant.valeur)) {
        return {
            erreur: "L'identifiant doit contenir entre 3 et 100 caractères autorisés."
        };
    }

    if (typeof donnees.motDePasse !== "string"
        || donnees.motDePasse.length < 8
        || donnees.motDePasse.length > 128
        || Buffer.byteLength(donnees.motDePasse, "utf8") > 72) {
        return {
            erreur: "Le mot de passe doit contenir entre 8 caractères et 72 octets."
        };
    }

    if (typeof donnees.confirmationMotDePasse !== "string"
        || donnees.motDePasse !== donnees.confirmationMotDePasse) {
        return {
            erreur: "La confirmation du mot de passe ne correspond pas."
        };
    }

    return {
        valeur: {
            nom: nom.valeur,
            prenom: prenom.valeur,
            identifiant: identifiant.valeur,
            email: email.valeur,
            telephone: telephone.valeur,
            motDePasse: donnees.motDePasse
        }
    };
}

function validerConnexion(donnees) {

    const champsAutorises = ["identifiant", "motDePasse"];

    if (!estObjetRequete(donnees)) {
        return {
            erreur: "Le corps de la requête doit être un objet JSON."
        };
    }

    const champInattendu = trouverChampInattendu(donnees, champsAutorises);

    if (champInattendu) {
        return {
            erreur: `Champ inattendu : ${champInattendu}.`
        };
    }

    const identifiant = validerTexte(donnees.identifiant, "L'identifiant", 100);

    if (identifiant.erreur) {
        return identifiant;
    }

    if (typeof donnees.motDePasse !== "string"
        || donnees.motDePasse.length === 0
        || donnees.motDePasse.length > 256) {
        return {
            erreur: "Le mot de passe est requis et ne doit pas dépasser 256 caractères."
        };
    }

    return {
        valeur: {
            identifiant: identifiant.valeur,
            motDePasse: donnees.motDePasse
        }
    };
}

function statutAutoriseConnexion(statut) {

    return statut === "actif";
}

function validerChangementStatut(donnees) {

    if (!estObjetRequete(donnees)) {
        return {
            erreur: "Le corps de la requête doit être un objet JSON."
        };
    }

    const champInattendu = trouverChampInattendu(donnees, ["statut"]);

    if (champInattendu || typeof donnees.statut !== "string") {
        return {
            erreur: champInattendu
                ? `Champ inattendu : ${champInattendu}.`
                : "Le statut est obligatoire."
        };
    }

    if (!STATUTS_AUTORISES.has(donnees.statut)) {
        return {
            erreur: "Statut invalide."
        };
    }

    return {
        valeur: donnees.statut
    };
}

async function recupererConflitsCompte(donnees) {

    const identifiant = String(donnees.identifiant || "").trim();
    const email = String(donnees.email || "").trim().toLowerCase();
    const telephone = String(donnees.telephone || "").trim();

    const resultat = await pool.query(
        `SELECT id, identifiant, email, telephone
         FROM utilisateurs
         WHERE identifiant=$1 OR email=$2 OR telephone=$3
         LIMIT 1`,
        [identifiant, email, telephone]
    );

    return resultat.rows[0] || null;
}

app.post("/register", limiteurInscription, async (req, res) => {

    const validationCompte = validerCreationCompte(req.body);

    if (validationCompte.erreur) {
        return res.status(400).json({
            message: validationCompte.erreur
        });
    }

    const {
        nom,
        prenom,
        identifiant,
        email,
        telephone,
        motDePasse
    } = validationCompte.valeur;

    try {

        const conflit = await recupererConflitsCompte({
            identifiant,
            email,
            telephone
        });

        if (conflit) {
            if (conflit.identifiant === identifiant) {
                return res.status(409).json({
                    message: "Cet identifiant est déjà utilisé."
                });
            }

            if (conflit.email === email) {
                return res.status(409).json({
                    message: "Cette adresse e-mail est déjà utilisée."
                });
            }

            return res.status(409).json({
                message: "Ce numéro de téléphone est déjà utilisé."
            });
        }

        const motDePasseHash = await bcrypt.hash(motDePasse, 10);

        await pool.query(
            `INSERT INTO utilisateurs (nom, prenom, identifiant, email, telephone, mot_de_passe, role, statut)
             VALUES ($1, $2, $3, $4, $5, $6, 'utilisateur', 'en_attente')`,
            [nom, prenom, identifiant, email, telephone, motDePasseHash]
        );

        const message = "Compte créé avec succès. Votre demande est en attente d'approbation.";

        return res.status(201).json({
            message,
            redirectTo: `/login?message=${encodeURIComponent(message)}`
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            message: "Erreur serveur"
        });

    }

});

app.post("/login", limiteurConnexion, async (req, res) => {

    const validationConnexion = validerConnexion(req.body);

    if (validationConnexion.erreur) {
        return res.status(400).json({
            message: validationConnexion.erreur
        });
    }

    const { identifiant, motDePasse } = validationConnexion.valeur;

    try {

        const resultat = await pool.query(
            "SELECT * FROM utilisateurs WHERE identifiant=$1",
            [identifiant]
        );

        if (resultat.rows.length === 0) {
            return res.status(401).json({
                message: "Identifiant ou mot de passe incorrect."
            });
        }

        const utilisateur = resultat.rows[0];

        const motDePasseValide = await bcrypt.compare(motDePasse, utilisateur.mot_de_passe);

        if (!motDePasseValide) {
            return res.status(401).json({
                message: "Identifiant ou mot de passe incorrect."
            });
        }

        if (!statutAutoriseConnexion(utilisateur.statut)) {
            const messagesParStatut = {
                en_attente: "Votre compte est en attente d'approbation.",
                refusé: "Votre compte a été refusé.",
                désactivé: "Votre compte a été désactivé."
            };

            return res.status(403).json({
                message: messagesParStatut[utilisateur.statut]
                    || "Votre compte n'est pas actif."
            });
        }

        await regenererSessionUtilisateur(req, utilisateur);

        res.json({
            message: "Connexion réussie",
            utilisateur: {
                identifiant: utilisateur.identifiant,
                role: utilisateur.role
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Erreur serveur"
        });

    }

});

app.post("/logout", (req, res) => {

    req.session.destroy((erreur) => {

        if (erreur) {
            return res.status(500).json({
                message: "Erreur lors de la déconnexion"
            });
        }

        res.json({
            message: "Déconnexion réussie"
        });

    });

});

app.get("/session", async (req, res) => {

    let utilisateur;

    try {

        utilisateur = await verifierUtilisateurSession(req);

    } catch (error) {

        console.error(error);

        return res.status(503).json({
            message: "Service d'authentification temporairement indisponible."
        });

    }

    if (!utilisateur || utilisateur.statut !== "actif") {

        try {

            await detruireSession(req);

        } catch (error) {

            console.error(error);

            return res.status(500).json({
                message: "Erreur lors de l'invalidation de la session."
            });

        }

        return res.json({
            connecte: false
        });
    }

    res.json({
        connecte: true,
        utilisateur: {
            identifiant: req.session.identifiant,
            role: utilisateur.role,
            statut: utilisateur.statut
        }
    });

});

// Liste des inscriptions
app.get("/inscriptions", protegerAdmin, async (req, res) => {

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

app.get("/api/inscriptions/export", protegerAdmin, async (req, res) => {

    try {

        const result = await pool.query(
            `SELECT id, nom, prenom, date_naissance, sexe, adresse, telephone, courriel
             FROM inscriptions
             ORDER BY id ASC`
        );

        const entetes = [
            "ID",
            "Nom",
            "Prénom",
            "Date de naissance",
            "Sexe",
            "Adresse",
            "Téléphone",
            "Courriel"
        ];

        const lignes = result.rows.map((inscription) => [
            inscription.id,
            inscription.nom || "",
            inscription.prenom || "",
            inscription.date_naissance ? new Date(inscription.date_naissance).toLocaleDateString("fr-FR") : "",
            inscription.sexe || "",
            inscription.adresse || "",
            inscription.telephone || "",
            inscription.courriel || ""
        ]);

        const feuille = XLSX.utils.aoa_to_sheet([entetes, ...lignes]);
        const classeur = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(classeur, feuille, "Inscriptions");

        const tampon = XLSX.write(classeur, {
            type: "buffer",
            bookType: "xlsx"
        });

        const dateExport = new Date().toISOString().slice(0, 10);

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="inscriptions-export-${dateExport}.xlsx"`
        );
        res.setHeader("Cache-Control", "no-store, private");

        res.send(tampon);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Erreur serveur"
        });

    }

});

// Ajouter
app.post("/inscriptions", protegerCompteActif, async (req, res) => {

    const validationInscription = validerInscription(req.body);

    if (validationInscription.erreur) {

        return res.status(400).json({
            message: validationInscription.erreur
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
    } = validationInscription.valeur;

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
app.put("/inscriptions/:id", protegerAdmin, async (req, res) => {

    const id = validerIdentifiantPositif(req.params.id);

    if (id === null) {
        return res.status(400).json({
            message: "L'identifiant d'inscription doit être un entier positif."
        });
    }

    const validationInscription = validerInscription(req.body);

    if (validationInscription.erreur) {
        return res.status(400).json({
            message: validationInscription.erreur
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
    } = validationInscription.valeur;

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
app.delete("/inscriptions/:id", protegerAdmin, async (req, res) => {

    const id = validerIdentifiantPositif(req.params.id);

    if (id === null) {
        return res.status(400).json({
            message: "L'identifiant d'inscription doit être un entier positif."
        });
    }

    try {

        const result = await pool.query(

            "DELETE FROM inscriptions WHERE id=$1 RETURNING *",

            [id]

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

app.use((req, res) => {

    if (req.path.startsWith("/api/")) {
        return res.status(404).json({
            message: "Ressource introuvable."
        });
    }

    return res.status(404).type("text/plain").send("Ressource introuvable.");
});

app.use((error, req, res, next) => {

    if (res.headersSent) {
        return next(error);
    }

    if (error instanceof SyntaxError
        && error.status === 400
        && error.type === "entity.parse.failed") {
        return res.status(400).json({
            message: "Le corps JSON de la requête est invalide."
        });
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({
            message: "Le corps de la requête est trop volumineux."
        });
    }

    if (error.status === 400) {
        return res.status(400).json({
            message: "La requête est invalide."
        });
    }

    const referenceErreur = crypto.randomUUID();

    if (EST_PRODUCTION) {
        console.error(
            `[${referenceErreur}] Erreur interne sur ${req.method} ${req.originalUrl}`
        );
    } else {
        console.error(`[${referenceErreur}]`, error);
    }

    return res.status(500).json({
        message: "Erreur serveur",
        reference: referenceErreur
    });
});

async function demarrerServeur() {

    if (clientRedis) {
        try {
            await clientRedis.connect();
            await clientRedis.ping();
        } catch (error) {
            clientRedis.disconnect();
            throw new Error("Connexion au service Valkey impossible.");
        }
    }

    limiteurCreationSessionCsrf = creerLimiteurCreationSessionCsrf();

    app.listen(PORT, "0.0.0.0", () => {

        console.log(`Serveur démarré sur http://localhost:${PORT}`);

    });

}

demarrerServeur().catch((error) => {

    console.error("❌ Erreur de démarrage du serveur", error.message);
    process.exit(1);

});

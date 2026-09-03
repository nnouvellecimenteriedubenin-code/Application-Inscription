const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env")
});

const { Pool } = require("pg");

console.log("=== Variables chargées ===");
console.log("DB_HOST :", process.env.DB_HOST);
console.log("DB_PORT :", process.env.DB_PORT);
console.log("DB_NAME :", process.env.DB_NAME);
console.log("DB_USER :", process.env.DB_USER);
console.log("Mot de passe :", process.env.DB_PASSWORD ? "OK" : "ABSENT");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: true
  }
});

module.exports = pool;

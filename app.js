const express = require("express");
const cors = require("cors");
const restKorisnici = require("./restKorisnici.js");
const restKnjige = require("./restKnjige.js");
const jwt = require("./jwt.js");
const baza = require("./DAO/baza.js");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");


const app = express();

async function initializeSecrets() {
    if (process.env.NODE_ENV === 'production') {
        const keyVaultUrl = process.env.KEY_VAULT_URL; 
        if (!keyVaultUrl) {
            throw new Error("KEY_VAULT_URL environment variable is not set.");
        }
        const credential = new DefaultAzureCredential();
        const secretClient = new SecretClient(keyVaultUrl, credential);

        process.env.MONGODB = (await secretClient.getSecret("CosmosDbConnectionString")).value;
        process.env.JWT = (await secretClient.getSecret("jwt")).value;
        console.log("Secrets loaded from Azure Key Vault.");
    } else {
        require("dotenv").config();
    }
}

function pokreniServer() {
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
              ? 'https://your-frontend-app-name.azurewebsites.net' 
              : ['http://localhost:3000', 'http://localhost:4000'],
    optionsSuccessStatus: 200
  };

  // Use the configured CORS options
  app.use(cors(corsOptions));

  pripremaPutanja();

  app.use((zahtjev, odgovor) => {
    odgovor.status(404);
    let poruka = { greska: "Stranica nije pronađena!" };
    odgovor.json(poruka);
  });

  baza
    .connect()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server pokrenut na portu: ${port}`);
      });
    })
    .catch((error) => {
      console.error("Nije moguće pokrenuti server, greška s bazom:", error);
      process.exit(1);
    });
}

const pripremaPutanja = () => {
  app.post("/api/prijava", restKorisnici.prijava);
  app.post("/api/registracija", restKorisnici.registracija);
  app.get("/api/profil", jwt.verificirajToken, restKorisnici.profil);

  app.get("/api/knjige", jwt.verificirajToken, restKnjige.knjige);

  app.get("/api/narudzbe", jwt.verificirajToken, restKnjige.narudzbe);
  app.post("/api/narudzbe", jwt.verificirajToken, restKnjige.narudzbe);
  app.post(
    "/api/stripe/webhooks",
    express.raw({ type: "application/json" }),
    restKnjige.webhooks
  );

  app.get("/api/kosarica", jwt.verificirajToken, restKnjige.kosarica);
  app.put("/api/kosarica", jwt.verificirajToken, restKnjige.kosarica);
  app.post("/api/favoriti", jwt.verificirajToken, restKorisnici.favoriti);

  app.get("/api/preporuke", jwt.verificirajToken, restKnjige.preporuke);

};

initializeSecrets()
  .then(() => {
    pokreniServer();
  })
  .catch((error) => {
    console.error("Greška prilikom inicijalizacije tajni:", error);
    process.exit(1);
  });

process.on("SIGINT", async () => {
  await baza.prekiniVezu();
  console.log("Server se gasi.");
  process.exit(0);
});

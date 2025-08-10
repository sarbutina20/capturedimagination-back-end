const express = require("express");
const cors = require("cors");
const restKorisnici = require("./restKorisnici.js");
const restKnjige = require("./restKnjige.js");
const jwt = require("./jwt.js");
const baza = require("./DAO/baza.js");


const app = express();

// SIMPLIFIED: This function is now only for local development.
// In Azure, environment variables are set automatically by App Service.
function initializeApp() {
    if (process.env.NODE_ENV !== 'production') {
        require("dotenv").config();
    } else {
        console.log("Running in production mode. Reading environment variables from App Service settings.");
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

  const port = process.env.PORT || 8080;
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

// Start the application
initializeApp();
pokreniServer();


process.on("SIGINT", async () => {
  await baza.prekiniVezu();
  console.log("Server se gasi.");
  process.exit(0);
});

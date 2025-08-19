const { KnjigeDAO, logirajInterakcije } = require("./DAO/knjigeDAO");
const baza = require("./DAO/baza.js");
const kljuc = process.env.STRIPE;
const endpointSecret = process.env.WEBHOOKS;
const stripe = require("stripe")(kljuc);

exports.knjige = async function (zahtjev, odgovor) {
  const kdao = new KnjigeDAO();
  const lista = zahtjev.query.lista;
  try {
    //kdao.knjige_NYT(lista).then((poruka) => {
      kdao.dohvatiBestsellereIzBaze(lista).then((poruka) => {
      if (poruka.error) {
        odgovor.status(400).json({ error: poruka.error });
      } else {
        odgovor.status(200).json({ knjige: poruka.knjige });
      }
    });
  } catch (serverError) {
    odgovor.status(500).json({ error: serverError });
  }
};

exports.narudzbe = async function (zahtjev, odgovor) {  
  if (zahtjev.method === "GET") {
    const korisnik = zahtjev.korisnik;
    const kdao = new KnjigeDAO();
    kdao.dohvatiNarudzbe(korisnik).then((poruka) => {
      if (poruka.error) {
        odgovor.status(400).json({ error: poruka.error });
      } else {
        odgovor.status(200).json({ narudzbe: poruka.narudzbe });
      }
    });
  }

  if (zahtjev.method === "POST") {
    const korisnik = zahtjev.korisnik;
    const narudzba = zahtjev.body.narudzba;


    const customer = await stripe.customers.create({
      metadata: {
        Korisnik_ID: korisnik._id,
        kosarica: JSON.stringify(narudzba),
      },
    });

    const line_items = await Promise.all(
      narudzba.map(async (knjiga) => {
        const price = knjiga.cijena * 100;
        const item = {
          price_data: {
            currency: "usd",
            product_data: {
              name: knjiga.naslov,
              images: [knjiga.slika],
              metadata: {
                id: knjiga.isbn.toString(),
              },
            },
            unit_amount: price,
          },
          quantity: knjiga.kolicina,
        };
        return item;
      })
    );

    const session = await kreiranjeStripeSesije(line_items, customer, zahtjev.headers.origin);

    odgovor.status(303).send({ url: session.url });
  }
};

exports.webhooks = async (zahtjev, odgovor) => {
  const narudzba = zahtjev.body.data.object;
  const eventType = zahtjev.body.type;


  if (eventType === "payment_intent.succeeded") {
    const kupac = await stripe.customers.retrieve(narudzba.customer);
    try {
      const kdao = new KnjigeDAO();
      kdao.kreirajNarudzbu(narudzba, kupac).then((poruka) => {
        if (poruka.error) {
          odgovor.status(400).json({ error: poruka.error });
        } else {
          odgovor.sendStatus(200);
        }
      });
    } catch (serverError) {
      odgovor.status(500).json({ error: serverError });
    }
  }
};

exports.kosarica = async function (zahtjev, odgovor) {
  const korisnik = zahtjev.korisnik;
  const kdao = new KnjigeDAO();

  if (zahtjev.method === "GET") {
    kdao.dohvatiKosaricu(korisnik).then((poruka) => {
      if (poruka.error) {
        odgovor.status(400).json({ error: poruka.error });
      } else {
        odgovor.status(200).json({ kosarica: poruka.kosarica });
      }
    });
  } else if (zahtjev.method === "PUT") {
    const korisnik = zahtjev.korisnik;
    const novaKosarica = zahtjev.body;

    kdao.dohvatiKosaricu(korisnik)
      .then((staraPoruka) => {
        if (staraPoruka.error) throw new Error(staraPoruka.error);
        const staraKosarica = staraPoruka.kosarica;
        const stariIsbnSet = new Set(staraKosarica.stavke.map((s) => s.isbn));
        const noveStavke = novaKosarica.stavke.filter(
          (stavka) => !stariIsbnSet.has(stavka.isbn)
        );

        if (noveStavke.length > 0) {
          return logirajInterakcije(korisnik._id, noveStavke, "cart");
        }
      })
      .then(() => {
        return kdao.azurirajKosaricu(korisnik, novaKosarica);
      })
      .then((poruka) => {
        if (poruka.error) {
          odgovor.status(400).json({ error: poruka.error });
        } else {
          odgovor.status(200).json({ kosarica: poruka.azuriranaKosarica });
        }
      })
      .catch((error) => {
        console.error("Greška prilikom ažuriranja košarice:", error);
        odgovor.status(500).json({ error: "Došlo je do greške prilikom ažuriranja košarice." });
      });

   }
};

exports.preporuke = async function (zahtjev, odgovor) {
  const korisnik = zahtjev.korisnik;
  if (!korisnik) {
    return odgovor.status(401).json({ error: "Niste prijavljeni." });
  }
  try {
    const kdao = new KnjigeDAO();
    const rezultat = await kdao.dohvatiPreporuke(korisnik._id);
    odgovor.status(200).json(rezultat);
  } catch (error) {
    odgovor.status(500).json({ error: "Greška na serveru." });
  }
};

kreiranjeStripeSesije = async (line_items, customer) => {
  const frontendUrl = process.env.FRONTEND_URL || `http://localhost:3000`;
  const session = await stripe.checkout.sessions.create({
    success_url: `${frontendUrl}/uspjesnaTransakcija`,
    cancel_url: `${frontendUrl}/`,
    locale: "auto",
    line_items: line_items,
    payment_method_types: ["card"],
    shipping_address_collection: {
      allowed_countries: ["US", "CA", "HR"],
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: 0,
            currency: "usd",
          },
          display_name: "Besplatna isporuka",
          delivery_estimate: {
            minimum: {
              unit: "business_day",
              value: 5,
            },
            maximum: {
              unit: "business_day",
              value: 7,
            },
          },
        },
      },
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: 3000,
            currency: "usd",
          },
          display_name: "Brza isporuka",
          delivery_estimate: {
            minimum: {
              unit: "business_day",
              value: 1,
            },
            maximum: {
              unit: "business_day",
              value: 5,
            },
          },
        },
      },
    ],
    phone_number_collection: {
      enabled: true,
    },
    mode: "payment",
    customer: customer.id,
  });
  return session;
};

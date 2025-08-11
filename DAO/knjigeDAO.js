const baza = require("./baza.js");
const { ObjectId } = require("mongodb");
const crypto = require("crypto");
const kljuc = process.env.NYT;
const kljucGoogle = process.env.GBOOKS;

class KnjigeDAO {
  constructor() {
    this.baza = baza;
  }

  async dohvatiNarudzbe(korisnik) {
    const db = this.baza.getDb();
    const kolekcijaNarudzbi = db.collection("narudzbe");

    try {
      const narudzbe = await kolekcijaNarudzbi
        .find({ Korisnik_ID: new ObjectId(korisnik._id) })
        .toArray();
      return { narudzbe };
    } catch (error) {
      console.error("Greška pri dohvaćanju narudžbi iz baze:", error);
      return { error: "Greška pri dohvaćanju narudžbi iz baze." };
    }
  }

  async kreirajNarudzbu(narudzba, kupac) {
    const db = this.baza.getDb();
    const kolekcijaNarudzbi = db.collection("narudzbe");

    const trenutniDatum = new Date();

    const proizvodi = JSON.parse(kupac.metadata.kosarica);
    const ukupnaCijenaStavki = narudzba.amount / 100;
    const stavke = proizvodi.map((knjiga) => {
      return {
        isbn: knjiga.isbn,
        kolicina: knjiga.kolicina,
        naslov: knjiga.naslov,
        cijena: knjiga.cijena,
      };
    });

    const novaNarudzba = {
      stavke: stavke,
      datum: trenutniDatum.toISOString(),
      Korisnik_ID: new ObjectId(kupac.metadata.Korisnik_ID),
      ukupnaCijenaStavki: ukupnaCijenaStavki,
      adresa: narudzba.shipping.address,
      kontakt: { email: kupac.email, telefon: kupac.phone },
    };

    try {
      const povratneInfo = await kolekcijaNarudzbi.insertOne(novaNarudzba);

      const korisnikId = kupac.metadata.Korisnik_ID;
      await logirajInterakcije(korisnikId, novaNarudzba.stavke, "order");

      return povratneInfo;
    } catch (error) {
      console.error("Greška pri dodavanju narudžbe u bazu:", error);
      return { error: "Greška pri dodavanju narudžbe u bazu." };
    }
  }

  // OUTDATED: This method is no longer used, but kept for reference
  async knjige_NYT(lista) {
    try {
      const odgovor = await fetch(
        `https://api.nytimes.com/svc/books/v3/lists/current/${lista}.json?api-key=${kljuc}`
      );

      if (!odgovor.ok) {
        return { error: "Neispravan zahtjev za dohvaćanje knjiga s NYT API." };
      }

      const podaci = await odgovor.json();

      const knjige = podaci.results.books.map((knjiga) => {
        const hash = crypto
          .createHash("md5")
          .update(`${knjiga.title}${knjiga.author}${knjiga.primary_isbn13}`)
          .digest("hex");
        const generiranaCijena = (parseInt(hash, 16) % 44) + 7;

        return {
          isbn: knjiga.primary_isbn13,
          autor: knjiga.author,
          naslov: knjiga.title,
          opis: knjiga.description,
          slika: knjiga.book_image,
          cijena: generiranaCijena,
        };
      });

      const db = this.baza.getDb();
      const kolekcijaKnjiga = db.collection("knjige");

      const operations = knjige.map((knjiga) => ({
        updateOne: {
          filter: { isbn: knjiga.isbn },
          update: { $set: knjiga },
          upsert: true,
        },
      }));

      if (operations.length > 0) {
        await kolekcijaKnjiga.bulkWrite(operations);
      }

      return { knjige };
    } catch (error) {
      console.error("Greška pri dohvaćanju knjiga s NYT API:", error);
      return { error: "Greška pri dohvaćanju knjiga s NYT API." };
    }
  }

  async azurirajBestsellere(lista) {
    const db = this.baza.getDb();
    const kolekcijaKnjiga = db.collection("knjige");

    try {
      const odgovorNYT = await fetch(
        `https://api.nytimes.com/svc/books/v3/lists/current/${lista}.json?api-key=${kljuc}`
      );

      if (!odgovorNYT.ok) {
        console.error(
          `Greška pri dohvaćanju NYT liste: ${odgovorNYT.statusText}`
        );
        return;
      }
      const podaciNYT = await odgovorNYT.json();

      if (!podaciNYT.results || !podaciNYT.results.books) {
        console.log(`Nema knjiga na NYT listi: ${lista}`);
        return;
      }

      const operacije = await Promise.all(
        podaciNYT.results.books.map(async (knjiga) => {
          const isbn = knjiga.primary_isbn13;
          if (!isbn) return null;

          try {
            const odgovorGoogle = await fetch(
              `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${kljucGoogle}`
            );
            if (!odgovorGoogle.ok) {
              console.error(
                `Greška pri dohvaćanju Google Books podataka za ISBN ${isbn}: ${odgovorGoogle.statusText}`
              );
              return null;
            }
            const podaciGoogle = await odgovorGoogle.json();
            const volInfo = podaciGoogle.items?.[0]?.volumeInfo;

            const hash = crypto
              .createHash("md5")
              .update(`${knjiga.title}${knjiga.author}${isbn}`)
              .digest("hex");
            const generiranaCijena = (parseInt(hash, 16) % 44) + 7;

            const gCats = Array.isArray(volInfo?.categories) ? volInfo.categories : [];
            // Always include 'lista' alongside Google categories
            const kategorijeMerged = Array.from(new Set([...(gCats || []), lista]));

            const obogacenaKnjiga = {
              isbn: isbn,
              autor: knjiga.author,
              naslov: knjiga.title,
              opis:
                volInfo?.description ||
                knjiga.description ||
                "Nema dostupnog opisa.",
              slika: volInfo?.imageLinks?.thumbnail || knjiga.book_image,
              izdavac: volInfo?.publisher,
              datumIzdavanja: volInfo?.publishedDate,
              cijena: generiranaCijena,
            };

            return {
              updateOne: {
                filter: { isbn },
                update: {
                  // For new docs: set kategorije including 'lista'
                  $setOnInsert: {
                    ...obogacenaKnjiga,
                    kategorije: kategorijeMerged
                  },
                  // For existing docs: update fields, and ALWAYS add 'lista' + Google cats
                  $set: obogacenaKnjiga,
                  $addToSet: {
                    bestseller_lists: lista,
                    kategorije: { $each: kategorijeMerged } // ensures 'lista' is present
                  }
                },
                upsert: true,
              },
            };
          } catch (error) {
            console.error(`Greška pri obradi knjige s ISBN ${isbn}:`, error);
            return null;
          }
        })
      );

      const filtriraneOperacije = operacije.filter((op) => op !== null);
      if (filtriraneOperacije.length > 0) {
        await kolekcijaKnjiga.bulkWrite(filtriraneOperacije);
        console.log(`Bestselleri s liste '${lista}' su ažurirani.`);
      }
    } catch (error) {
      console.error(
        `Neočekivana greška u azurirajBestsellere za listu '${lista}':`,
        error
      );
    }
  }

  async dohvatiBestsellereIzBaze(lista) {
    //this.osveziKategorijeIzBestsellerLista();
    //this.azurirajBestsellere(lista);
    //this.popuniKatalogGoogleKnjigama();
    const db = this.baza.getDb();
    try {
      const knjige = await db
        .collection("knjige")
        .find({ bestseller_lists: lista })
        .project({ sbert_embedding: 0 })
        .toArray();
      return { knjige };
    } catch (error) {
      console.error("Greška pri dohvaćanju bestsellera iz baze:", error);
      return { error: "Greška pri dohvaćanju bestsellera iz baze." };
    }
  }

  async popuniKatalogGoogleKnjigama() {
    const kategorije = [
      "young+adult",
      "hardcover-fiction",
      "hardcover-nonfiction",
      "graphic+books",
      "graphic-books",
      "graphic",
      "comic+books",
      "manga",
      "business",
      "science",
      "history",
      "biography",
      "fantasy",
      "romance",
      "thriller",
      "mystery",
      "technology",
      "philosophy",
    ];
    let ukupnoDodanihKnjiga = 0;
    const knjigaPoStranici = 40;
    const stranicaZaDohvat = 5;

    const db = this.baza.getDb();
    const kolekcijaKnjiga = db.collection("knjige");

    for (const kategorija of kategorije) {
      for (let stranica = 0; stranica < stranicaZaDohvat; stranica++) {
        const pocetniIndeks = stranica * knjigaPoStranici;
        try {
          const odgovor = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=subject:${kategorija}&maxResults=${knjigaPoStranici}&startIndex=${pocetniIndeks}&lang=en&key=${kljucGoogle}`
          );
          const podaci = await odgovor.json();

          if (!podaci.items) {
            console.log(
              `Nema više knjiga za kategoriju: ${kategorija} na stranici ${stranica + 1}`
            );
            break;
          }

          const operacije = podaci.items
            .map((item) => {
              const volInfo = item.volumeInfo;
              const isbn = volInfo.industryIdentifiers?.find(
                (id) => id.type === "ISBN_13"
              )?.identifier;
              if (!isbn || !volInfo.imageLinks?.thumbnail) return null;

              const hash = crypto
                .createHash("md5")
                .update(`${volInfo.title}${volInfo.authors?.join("")}${isbn}`)
                .digest("hex");
              const generiranaCijena = (parseInt(hash, 16) % 44) + 7;

              const gCats = Array.isArray(volInfo.categories) ? volInfo.categories : [];
              const categoriesMerged = Array.from(new Set([...gCats, kategorija])).filter(Boolean);

              return {
                updateOne: {
                  filter: { isbn },
                  update: {
                    $setOnInsert: {
                      isbn,
                      autor: volInfo.authors?.join(", ") || "Nepoznat autor",
                      naslov: volInfo.title,
                      opis: volInfo.description || "Nema dostupnog opisa.",
                      slika: volInfo.imageLinks?.thumbnail,
                      izdavac: volInfo.publisher,
                      datumIzdavanja: volInfo.publishedDate,
                      kategorije: categoriesMerged,
                      bestseller_lists: [],
                      cijena: generiranaCijena,
                    },
                    $addToSet: { kategorije: { $each: categoriesMerged } },
                  },
                  upsert: true,
                },
              };
            })
            .filter((op) => op !== null);

          if (operacije.length > 0) {
            const rezultat = await kolekcijaKnjiga.bulkWrite(operacije);
            const dodano = rezultat.upsertedCount;
            ukupnoDodanihKnjiga += dodano;
            console.log(
              `Dodano ${dodano} novih knjiga iz kategorije '${kategorija}' (Stranica ${stranica + 1}).`
            );
          }
        } catch (error) {
          console.error(
            `Greška pri dohvaćanju knjiga za kategoriju '${kategorija}':`,
            error
          );
        }
      }
    }
    console.log(`Katalog je ukupno popunjen s ${ukupnoDodanihKnjiga} novih knjiga.`);
  }

  async dohvatiKosaricu(korisnik) {
    const db = this.baza.getDb();
    const kolekcijaKosarica = db.collection("kosarica");

    try {
      const kosarica = await kolekcijaKosarica.findOne({
        Korisnik_ID: new ObjectId(korisnik._id),
      });

      return { kosarica };
    } catch (error) {
      console.error("Greška pri dohvaćanju korisnikove košarice:", error);
      return { error: "Greška pri dohvaćanju korisnikove košarice." };
    }
  }

  async azurirajKosaricu(korisnik, kosarica) {
    const db = this.baza.getDb();
    const kolekcijaKosarica = db.collection("kosarica");

    try {
      const azuriranaKosarica = await kolekcijaKosarica.updateOne(
        { Korisnik_ID: new ObjectId(korisnik._id) },
        {
          $set: {
            stavke: kosarica.stavke,
            ukupnaCijenaStavki: kosarica.ukupnaCijenaStavki,
            ukupnaKolicina: kosarica.ukupnaKolicina,
          },
        }
      );
      return { azuriranaKosarica };
    } catch (error) {
      console.error("Greška pri ažuriranju korisnikove košarice:", error);
      return { error: "Greška pri ažuriranju korisnikove košarice." };
    }
  }

  async dohvatiPreporuke(korisnikId) {
    try {
      const pythonApiUrl = `${process.env.RECOMMENDATION_API_URL}/recommendations/${korisnikId}`;
      //const pythonApiUrl = `${process.env.RECOMMENDATION_API_URL}/debug/${korisnikId}`;

      const preporukeOdgovor = await fetch(pythonApiUrl);

      if (!preporukeOdgovor.ok) {
        throw new Error(
          `Python servis je vratio status: ${preporukeOdgovor.status}`
        );
      }

      const podaci = await preporukeOdgovor.json();
      const preporuceniIsbnovi = podaci.recommendations;

      if (!preporuceniIsbnovi || preporuceniIsbnovi.length === 0) {
        throw new Error("Python servis nije vratio preporuke.");
      }

      const db = this.baza.getDb();
      const knjige = await db
        .collection("knjige")
        .find({
          isbn: { $in: preporuceniIsbnovi },
        })
        .project({ sbert_embedding: 0 })
        .toArray();

      return { knjige: knjige };
    } catch (error) {
      console.error(
        "Greška pri dohvaćanju preporuka, koristim fallback:",
        error.message
      );
      return this.dohvatiNajpopularnijeKnjige();
    }
  }

  async dohvatiNajpopularnijeKnjige(limit = 21) {
    try {
      const db = this.baza.getDb();
      if (!db) {
        throw new Error("Baza podataka nije dostupna.");
      }

      const pipeline = [
        { $match: { tip_interakcije: { $in: ["like", "order"] } } },
        { $group: { _id: "$isbn", brojInterakcija: { $sum: 1 } } },
        { $sort: { brojInterakcija: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: "knjige",
            localField: "_id",
            foreignField: "isbn",
            as: "detaljiKnjige",
          },
        },
        { $unwind: "$detaljiKnjige" },
        { $replaceRoot: { newRoot: "$detaljiKnjige" } },
        { $project: { sbert_embedding: 0 } },
      ];

      const popularneKnjige = await db
        .collection("interakcije")
        .aggregate(pipeline)
        .toArray();
      return { knjige: popularneKnjige };
    } catch (error) {
      console.error("Greška pri dohvaćanju najpopularnijih knjiga:", error);
      return this.dohvatiBestsellereIzBaze("hardcover-fiction");
    }
  }

  async osveziKategorijeIzBestsellerLista() {
    const db = this.baza.getDb();
    try {
      const rezultat = await db
        .collection("knjige")
        .updateMany(
          {},
          [
            {
              $set: {
                kategorije: {
                  $setUnion: [
                    { $ifNull: ["$kategorije", []] },
                    { $ifNull: ["$bestseller_lists", []] }
                  ]
                }
              }
            }
          ]
        );
      console.log(
        `Ažurirano je ${rezultat.modifiedCount} dokumenata u kolekciji 'knjige'.`
      );
    } catch (error) {
      console.error("Greška pri ažuriranju kategorija:", error);
    }
  }
}

async function logirajInterakcije(korisnikId, stavke, tipInterakcije) {
  if (!stavke || stavke.length === 0) {
    return;
  }
  try {
    const db = baza.getDb();
    const logovi = stavke.map((stavka) => ({
      korisnik_id: new ObjectId(korisnikId),
      isbn: stavka.isbn,
      tip_interakcije: tipInterakcije,
      vrijeme: new Date(),
    }));
    await db.collection("interakcije").insertMany(logovi);
  } catch (error) {
    console.error(
      `Greška prilikom logiranja interakcije '${tipInterakcije}':`,
      error
    );
  }
}

module.exports = { KnjigeDAO, logirajInterakcije };

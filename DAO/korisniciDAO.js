const { ObjectId } = require("mongodb");
const baza = require("./baza.js");
const bcrypt = require("bcrypt");
const jwt = require("../jwt.js");

class KorisniciDAO {
  constructor() {
    this.baza = baza;
  }

  async prijava(korisnik) {
    const db = this.baza.getDb();
    try {
      const dohvaceniKorisnik = await dohvatiKorisnika(
        db,
        korisnik.KorisnickoIme
      );

      if (!dohvaceniKorisnik) {
        console.error("Ne postoji korisnik s takvim korisničkim imenom.");
        return { error: "Ne postoji korisnik s takvim korisničkim imenom." };
      }

      const lozinkaUsporedba = await provjeriLozinku(
        korisnik.Lozinka,
        dohvaceniKorisnik.Lozinka
      );

      if (lozinkaUsporedba) {
        const uloga = await dohvatiUlogu(db, dohvaceniKorisnik.Uloga_ID);
        const kosarica = await dohvatiKosaricu(db, dohvaceniKorisnik._id);
        const token = await jwt.kreirajToken({
          korisnik: dohvaceniKorisnik,
          Uloga: uloga,
          _id: dohvaceniKorisnik._id,
        });
        return { token, kosarica, favoriti: dohvaceniKorisnik.favoriti || [] };
      } else {
        return { error: "Neispravna lozinka." };
      }
    } catch (error) {
      console.error("Greška pri prijavi:", error);
      return { error: "Greška pri prijavi." };
    }
  }

  async registracija(noviKorisnik) {
    const db = this.baza.getDb();

    const hashiranaLozinka = await bcrypt.hash(noviKorisnik.Lozinka, 12);

    try {
      const noviKorisnikObjekt = {
        KorisnickoIme: noviKorisnik.KorisnickoIme,
        Lozinka: hashiranaLozinka,
        Email: noviKorisnik.Email,
        Uloga_ID: new ObjectId("64e22057f9497eba62ed9513"),
        favoriti: [],
      };

      const povratneInfo = await dodavanjeNovogKorisnika(
        db,
        noviKorisnikObjekt
      );

      if (!povratneInfo.error) {
        await stvoriKosaricu(db, povratneInfo.insertedId);
      }

      console.log("Korisnik uspješno dodan.");

      return povratneInfo;
    } catch (error) {
      console.error("Greška pri registraciji:", error);
      return { error: "Greška pri registraciji." };
    }
  }

async toggleFavorit(korisnikId, isbn) {
    const db = this.baza.getDb();
    const kolekcijaKorisnika = db.collection("korisnici");

    const korisnik = await kolekcijaKorisnika.findOne({ _id: new ObjectId(korisnikId) });

    const jeFavorit = korisnik.favoriti && korisnik.favoriti.includes(isbn);

    let updateOperation;
    if (jeFavorit) {
      updateOperation = { $pull: { favoriti: isbn } };
    } else {
      updateOperation = { $addToSet: { favoriti: isbn } };
      await logInteraction(db, korisnikId, isbn, 'like');
    }

    await kolekcijaKorisnika.updateOne({ _id: new ObjectId(korisnikId) }, updateOperation);

    const azuriraniKorisnik = await kolekcijaKorisnika.findOne({ _id: new ObjectId(korisnikId) });
    return azuriraniKorisnik;
  }

async dajPodatke(id) {
    const db = this.baza.getDb();
    const korisnik = await db
      .collection("korisnici")
      .findOne({ _id: new ObjectId(id) });
    return korisnik;
  }

}

async function stvoriKosaricu(baza, korisnikId) {
  const kosariceKolekcija = baza.collection("kosarica");
  const novaKosarica = {
    stavke: [],
    ukupnaCijenaStavki: 0,
    ukupnaKolicina: 0,
    Korisnik_ID: new ObjectId(korisnikId),
  };

  try {
    const stvaranjeKosarice = await kosariceKolekcija.insertOne(
      novaKosarica
    );
    return stvaranjeKosarice;
  } catch (error) {
    return { error: "Greška pri stvaranju košarice." };
  }
}

async function dodavanjeNovogKorisnika(baza, noviKorisnikObjekt) {
  try {
    const korisniciKolekcija = baza.collection("korisnici");
    const povratneInfo = await korisniciKolekcija.insertOne(
      noviKorisnikObjekt
    );
    return povratneInfo;
  } catch (error) {
    if (error.code === 11000) {
      console.error("Korisničko ime već postoji.");
      return { error: "Korisničko ime već postoji." };
    } else {
      console.error("Greška pri unosu korisnika:", error);
      return { error: "Greška pri unosu korisnika." };
    }
  }
}

async function provjeriLozinku(lozinka, hash) {
  return await bcrypt.compare(lozinka, hash);
}

async function dohvatiUlogu(baza, ulogaId) {
  const ulogeKolekcija = baza.collection("uloge");
  return await ulogeKolekcija.findOne({ _id: ulogaId });
}

async function dohvatiKorisnika(baza, korisnickoIme) {
  const korisniciKolekcija = baza.collection("korisnici");
  return await korisniciKolekcija.findOne({ KorisnickoIme: korisnickoIme });
}

async function dohvatiKosaricu(baza, korisnikId) {
  const kosariceKolekcija = baza.collection("kosarica");
  return await kosariceKolekcija.findOne({ Korisnik_ID: korisnikId });
}

async function logInteraction(baza, korisnikId, isbnKnjige, tipInterakcije) {
  const kolekcijaInterakcija = baza.collection("interakcije");
  try {
    await kolekcijaInterakcija.insertOne({
      korisnik_id: new ObjectId(korisnikId),
      isbn: isbnKnjige,
      tip_interakcije: tipInterakcije,
      vrijeme: new Date(),
    });
  } catch (error) {
    console.error("Greška pri bilježenju interakcije:", error);
  }
}

module.exports = KorisniciDAO;

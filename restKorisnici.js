const KorisniciDAO = require("./DAO/korisniciDAO");
const korisniciDAO = require("./DAO/korisniciDAO");

exports.prijava = function (zahtjev, odgovor) {
    const kdao = new korisniciDAO();
    let korisnik = zahtjev.body;
    if(!korisnik || !korisnik.KorisnickoIme || !korisnik.Lozinka) odgovor.status(400).json({error:"Nisu poslani podaci"});
    else {
        try {
            kdao.prijava(korisnik).then((poruka) => {
                if(poruka.error) {
                    odgovor.status(400).json({error:poruka.error})
                }
                else {
                    odgovor.status(200).json({ token: poruka.token, kosarica: poruka.kosarica });
                }
            });
        } catch (serverError) {
            odgovor.status(500).json({error:serverError})
        }
    }
    
}

exports.registracija = function (zahtjev, odgovor) {
    const kdao = new korisniciDAO();
    let korisnik = zahtjev.body;
    if(!korisnik || !korisnik.KorisnickoIme || !korisnik.Lozinka) odgovor.status(400).json({error:"Nisu poslani podaci"});
    else {
        try {
            kdao.registracija(korisnik).then((poruka) => {
                if(poruka.error) {
                    odgovor.status(400).json({error:poruka.error})
                }
                else {
                    odgovor.sendStatus(200);
                }
            });
        } catch (serverError) {
            odgovor.status(500).json({error:serverError})
        }
    }
 
}

exports.favoriti = async function (zahtjev, odgovor) {
  const korisnik = zahtjev.korisnik;
  const { isbn } = zahtjev.body;

  if (!isbn) {
    return odgovor.status(400).json({ error: "ISBN knjige je obavezan." });
  }

  const kdao = new korisniciDAO();
  try {
    const azuriraniKorisnik = await kdao.toggleFavorit(korisnik._id, isbn);
    odgovor.status(200).json({ favoriti: azuriraniKorisnik.favoriti });
  } catch (error) {
    odgovor.status(500).json({ error: "Greška pri ažuriranju favorita." });
  }
};

exports.profil = async function (zahtjev, odgovor) {
  const kdao = new KorisniciDAO();
  const korisnik = await kdao.dajPodatke(zahtjev.korisnik._id);
  if (korisnik) {
    odgovor.json({ kosarica: korisnik.kosarica, favoriti: korisnik.favoriti });
  } else {
    odgovor.status(404).json({ error: "Korisnik nije pronađen." });
  }
};

exports.korisnik = function (zahtjev, odgovor) {}
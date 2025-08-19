const jwt = require('jsonwebtoken');

exports.kreirajToken = async function (korisnik) {

    const payload = {
        KorisnickoIme: korisnik.KorisnickoIme,
        Uloga: korisnik.Uloga,
        _id: korisnik._id
    };

    const tajniKljuc = process.env.JWT;
    const token = jwt.sign(payload, tajniKljuc, { expiresIn: '1h' });

    return token;
}

exports.verificirajToken = function (zahtjev, odgovor, nastavi) {
    const token = zahtjev.header('Authorization');
    const tajniKljuc = process.env.JWT;
    
    if (!token) {
        return odgovor.status(402).json({ error: 'Nedostaje token' });
    }

    try {
        const provjerenToken = jwt.verify(token, tajniKljuc);
        zahtjev.korisnik = provjerenToken;
        nastavi();
    } catch (error) {
        odgovor.status(401).json({ error: 'Neispravni token' });
    }
}

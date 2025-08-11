const { MongoClient } = require("mongodb");

class Baza {
  constructor() {
    this.url = process.env.DB_CONNECTION_STRING;
    const clientOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      retryReads: true,
      retryWrites: true,
      maxPoolSize: 50, 
    };
    this.client = new MongoClient(this.url, clientOptions);
    this.db = null;
  }

  async poveziSeNaBazu() {
    try {
      await this.client.connect();

      const db = this.client.db();

      this.database = db;

      return this;
    } catch (error) {
      console.error("Greška pri povezivanju s bazom podataka", error);
    }
  }

  async prekiniVezu() {
    try {
      if (this.client) {
            await this.client.close();
            this.db = null;
            console.log('Veza s bazom podataka je prekinuta.');
        }
    } catch (error) {
      console.error("Greška pri prekidanju veze s bazom podataka", error);
    }
  }

  async connect() {
    if (this.db) return this.db;
    try {
      await this.client.connect();
      this.db = this.client.db(); // You can specify the DB name here, e.g., this.client.db("yourDbName")
      console.log("Uspješno spojen na Cosmos DB.");
      return this.db;
    } catch (error) {
      console.error("Greška pri povezivanju s Cosmos DB", error);
      throw error;
    }
  }

  getDb() {
        if (!this.db) {
            throw new Error("Niste povezani na bazu. Pozovite connect() prvo.");
        }
        return this.db;
    }
}

module.exports = new Baza();

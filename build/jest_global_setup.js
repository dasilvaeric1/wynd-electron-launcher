// Provisionne le front embarque attendu par les tests de validation de config.
//
// `src/local/` est gitignore : c'est l'emplacement ou l'exploitant depose le
// front embarque, il est donc vide dans un clone frais. Sans `index.html`, la
// regle `local` du validateur echoue sur `config.url` et masque l'assertion
// reelle de chaque test (on recoit "local" au lieu de l'erreur attendue).
const fs = require("fs");
const path = require("path");

const LOCAL_INDEX = path.join(__dirname, "..", "src", "local", "index.html");

module.exports = () => {
  if (fs.existsSync(LOCAL_INDEX)) {
    // Un front embarque est deja en place (poste de dev) : on n'y touche pas.
    process.env.EL_TEST_LOCAL_INDEX_CREATED = "0";
    return;
  }
  fs.mkdirSync(path.dirname(LOCAL_INDEX), { recursive: true });
  fs.writeFileSync(LOCAL_INDEX, "<!DOCTYPE html><title>test</title>\n");
  process.env.EL_TEST_LOCAL_INDEX_CREATED = "1";
};

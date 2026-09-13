// Retire le front embarque factice, uniquement si c'est nous qui l'avons pose
// (cf build/jest_global_setup.js).
const fs = require("fs");
const path = require("path");

const LOCAL_INDEX = path.join(__dirname, "..", "src", "local", "index.html");

module.exports = () => {
  if (process.env.EL_TEST_LOCAL_INDEX_CREATED !== "1") return;
  try {
    fs.unlinkSync(LOCAL_INDEX);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
};

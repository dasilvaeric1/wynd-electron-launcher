/**
 * Signalement d'anomalie : ferme par defaut, ouvert par la config.
 *
 * Le signalement televerse les journaux, l'etat des peripheriques et le numero
 * de caisse. C'est un canal de donnees, pas un simple bouton d'interface : un
 * parc doit pouvoir choisir de l'ouvrir, pas le subir parce qu'il est livre
 * actif. Ces tests fixent la POLITIQUE, pas seulement la presence du champ.
 *
 * checkConfig mute l'objet recu et ne renvoie rien — on inspecte donc l'entree.
 */

const checkConfig = require("../src/main/helpers/config/check_config");

const resolve = (incident) => {
  const config = { url: "http://localhost:3000" };
  if (incident !== undefined) config.incident = incident;
  checkConfig(config);
  return config;
};

describe("politique par defaut", () => {
  test("ferme quand config.ini ne dit rien", () => {
    expect(resolve().incident).toEqual({ enable: false });
  });

  test("ouvrir le signalement n'ouvre pas le rapport de caisse", () => {
    const config = resolve({ enable: "1" });
    expect(config.incident.enable).toBe(true);
    expect(config.report.enable).toBe(false);
  });
});

describe("valeurs acceptees", () => {
  // config.ini est parse par `ini` : tout arrive en CHAINE. C'est la forme
  // qu'un exploitant produit reellement en ecrivant `enable=1`.
  test.each([
    ['"1"', "1", true],
    ['"true"', "true", true],
    ["booleen true", true, true],
    ['"0"', "0", false],
    ['"false"', "false", false],
    ["booleen false", false, false],
  ])("enable=%s donne %s", (_label, value, attendu) => {
    expect(resolve({ enable: value }).incident.enable).toBe(attendu);
  });
});

describe("valeurs refusees", () => {
  // Un nombre nu est rejete, comme pour TOUS les drapeaux de la config
  // (keyword coerce_boolean). Le cas ne se produit pas depuis config.ini, qui
  // ne porte que du texte ; le test verrouille la coherence si un jour la
  // config arrive d'ailleurs — un ordre BO en JSON, par exemple.
  test.each([
    ["nombre 1", 1],
    ["nombre 0", 0],
    ["chaine vide", ""],
    ["oui", "oui"],
  ])("enable=%s est refuse", (_label, value) => {
    expect(() => resolve({ enable: value })).toThrow();
  });
});

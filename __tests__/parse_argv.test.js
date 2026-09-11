/**
 * parse_argv — remplace yargs, retiré pour une raison d'empaquetage
 * (electron-builder omettait string-width/wrap-ansi à cause des alias npm de
 * @isaacs/cliui, ce qui faisait planter le launcher packagé au demarrage).
 *
 * Ces tests verrouillent la compatibilité avec ce que yargs acceptait, et
 * surtout le fait que les switches Chromium traversent sans être consommés.
 */

const {
  parseLauncherArgs,
  parseArgs,
  hideBin,
} = require("../src/main/helpers/parse_argv");

const DEFAULT_CONF = "../../config.ini";
// Packagé : argv[0] est l'exe, pas de script à sauter.
const packaged = (...args) => ["C:\\app\\launcher.exe", ...args];

describe("hideBin", () => {
  test("saute le binaire seul en mode packagé", () => {
    expect(hideBin(["/app/launcher", "--url", "x"], false)).toEqual([
      "--url",
      "x",
    ]);
  });

  test("saute binaire ET point d'entrée en dev (electron .)", () => {
    expect(hideBin(["/bin/electron", ".", "--url", "x"], true)).toEqual([
      "--url",
      "x",
    ]);
  });
});

describe("valeurs par défaut", () => {
  test("sans argument, tout vaut son défaut", () => {
    const a = parseLauncherArgs(DEFAULT_CONF, packaged());
    expect(a).toEqual({ config_path: DEFAULT_CONF, screen: 0, url: null });
  });
});

describe("formes acceptées", () => {
  test("--option=valeur", () => {
    expect(
      parseLauncherArgs(DEFAULT_CONF, packaged("--config_path=/etc/conf.ini"))
        .config_path,
    ).toBe("/etc/conf.ini");
  });

  test("--option valeur", () => {
    expect(
      parseLauncherArgs(DEFAULT_CONF, packaged("--config_path", "/etc/c.ini"))
        .config_path,
    ).toBe("/etc/c.ini");
  });

  test("alias court, avec et sans egal", () => {
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("-c", "/a.ini")).config_path).toBe("/a.ini");
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("-c=/b.ini")).config_path).toBe("/b.ini");
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("-u", "http://pos")).url).toBe("http://pos");
  });

  test("un chemin Windows avec deux-points reste intact", () => {
    expect(
      parseLauncherArgs(
        DEFAULT_CONF,
        packaged("--config_path=C:\\Retail\\cfg\\config.ini"),
      ).config_path,
    ).toBe("C:\\Retail\\cfg\\config.ini");
  });

  test("une URL avec des = dans la query n'est pas tronquee", () => {
    const url = "https://pos.example/app?a=1&b=2";
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("--url=" + url)).url).toBe(url);
  });
});

describe("typage", () => {
  test("screen est converti en nombre", () => {
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("--screen", "2")).screen).toBe(2);
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("-s=1")).screen).toBe(1);
  });

  test("un screen non numerique retombe sur le defaut", () => {
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("--screen", "abc")).screen).toBe(0);
  });
});

describe("robustesse face aux switches Chromium", () => {
  test("les switches inconnus sont ignores sans rien casser", () => {
    const a = parseLauncherArgs(
      DEFAULT_CONF,
      packaged(
        "--no-sandbox",
        "--user-data-dir=C:\\tmp\\ud",
        "--disable-gpu",
        "--url",
        "http://pos",
      ),
    );
    expect(a.url).toBe("http://pos");
    expect(a.screen).toBe(0);
    expect(a.config_path).toBe(DEFAULT_CONF);
  });

  test("une option suivie d'une autre option ne consomme pas celle-ci", () => {
    const a = parseLauncherArgs(DEFAULT_CONF, packaged("--url", "--no-sandbox"));
    expect(a.url).toBeNull();
  });

  test("une option en fin de ligne sans valeur garde son defaut", () => {
    expect(parseLauncherArgs(DEFAULT_CONF, packaged("--url")).url).toBeNull();
  });

  test("un switch dont le nom CONTIENT un nom d'option n'est pas confondu", () => {
    // --urls / --screenshot ne doivent pas etre pris pour --url / --screen
    const a = parseLauncherArgs(
      DEFAULT_CONF,
      packaged("--urls=http://x", "--screenshot=1"),
    );
    expect(a.url).toBeNull();
    expect(a.screen).toBe(0);
  });
});

describe("parseArgs (generique)", () => {
  test("la derniere occurrence gagne", () => {
    const out = parseArgs(["--x", "a", "--x", "b"], {
      x: { type: "string", default: null },
    });
    expect(out.x).toBe("b");
  });

  test("les arguments positionnels sont ignores", () => {
    const out = parseArgs(["fichier.txt", "--x=1"], {
      x: { type: "string", default: null },
    });
    expect(out.x).toBe("1");
  });
});

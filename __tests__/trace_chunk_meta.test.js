/**
 * Metadonnees d'un chunk de trace.
 *
 * Regression constatee en production : le dashboard affichait « 0 ms » sur
 * toutes les traces, parce que l'uploader envoyait un `durationMs` code en dur
 * a 0 et un `stoppedAt` egal a l'heure d'UPLOAD, alors que les bornes reelles
 * etaient dans le meta.json du bundle.
 *
 * Verifie aussi la presence de `sessionId` / `seq`, sans lesquels le dashboard
 * ne peut pas regrouper les chunks d'une meme session ni afficher une plage
 * « de … a … ».
 */

jest.mock("../src/main/helpers/electron_log", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

const { buildChunkZip } = require("../src/main/helpers/trace_chunk");
const { readChunkMeta } = require("../src/main/helpers/trace_uploader");

const START = Date.parse("2026-09-11T14:02:00.000Z");
const STOP = Date.parse("2026-09-11T14:07:00.000Z");

const META = {
  kind: "continuous",
  caisseSerial: "53R1124914",
  sessionId: "9f1c1b5a-0000-4000-8000-000000000001",
  seq: 3,
  startedAt: new Date(START).toISOString(),
  stoppedAt: new Date(STOP).toISOString(),
  durationMs: STOP - START,
  closedBy: "interval",
};

test("le meta.json survit a l'aller-retour dans le ZIP", async () => {
  const buf = await buildChunkZip({ events: [{ type: 4 }], meta: META });
  const back = await readChunkMeta(buf);

  expect(back.durationMs).toBe(300000);
  expect(back.startedAt).toBe("2026-09-11T14:02:00.000Z");
  expect(back.stoppedAt).toBe("2026-09-11T14:07:00.000Z");
});

test("les champs de regroupement sont presents", async () => {
  const buf = await buildChunkZip({ events: [], meta: META });
  const back = await readChunkMeta(buf);

  // Sans sessionId, le dashboard ne peut pas rassembler les chunks d'un meme
  // run ; sans seq, il ne peut ni les ordonner ni voir les trous.
  expect(back.sessionId).toBe(META.sessionId);
  expect(back.seq).toBe(3);
  expect(back.caisseSerial).toBe("53R1124914");
});

test("la duree n'est jamais zero quand les bornes existent", async () => {
  const buf = await buildChunkZip({ events: [], meta: META });
  const back = await readChunkMeta(buf);

  expect(back.durationMs).toBeGreaterThan(0);
  expect(Date.parse(back.stoppedAt) - Date.parse(back.startedAt)).toBe(
    back.durationMs,
  );
});

test("un ZIP sans meta.json ne fait pas exploser l'upload", async () => {
  const buf = await buildChunkZip({ events: [] });
  const back = await readChunkMeta(buf);
  expect(back).toEqual({});
});

test("un buffer corrompu renvoie null plutot que de throw", async () => {
  expect(await readChunkMeta(Buffer.from("pas un zip"))).toBeNull();
});

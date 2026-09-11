const fs = require("fs");
const os = require("os");
const { join } = require("path");
const { createSpool } = require("../src/main/helpers/trace_spool");

function tmpSpool(maxBytes = 1024 * 1024) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "el-trace-"));
  return createSpool({ dir, maxBytes });
}

test("partial chunk survives a round-trip through disk", () => {
  const spool = tmpSpool();
  spool.openPartial({ startedAtMs: 1700000000000 });
  spool.appendPartial([{ type: 2, data: "snapshot" }]);
  spool.appendPartial([{ type: 3, data: "mutation" }]);

  const partial = spool.readPartial();
  expect(partial.meta.startedAtMs).toBe(1700000000000);
  expect(partial.events).toHaveLength(2);
  expect(partial.events[0].data).toBe("snapshot");
});

test("a dropped partial leaves nothing behind", () => {
  const spool = tmpSpool();
  spool.openPartial({ startedAtMs: 1 });
  spool.appendPartial([{ a: 1 }]);
  spool.dropPartial();
  expect(spool.readPartial()).toBeNull();
});

test("unserialisable events are skipped without losing the batch", () => {
  const spool = tmpSpool();
  spool.openPartial({ startedAtMs: 1 });
  const circular = { self: null };
  circular.self = circular;

  spool.appendPartial([{ ok: 1 }, circular, { ok: 2 }]);

  const events = spool.readPartial().events;
  expect(events).toEqual([{ ok: 1 }, { ok: 2 }]);
});

test("chunks are listed in chronological order", () => {
  const spool = tmpSpool();
  spool.putChunk(300, Buffer.from("c"));
  spool.putChunk(100, Buffer.from("a"));
  spool.putChunk(200, Buffer.from("b"));

  expect(spool.listChunks().map((c) => c.startedAtMs)).toEqual([100, 200, 300]);
});

test("the disk cap drops the oldest chunks first", () => {
  const spool = tmpSpool(250); // 250 octets de budget
  spool.putChunk(100, Buffer.alloc(100, 1));
  spool.putChunk(200, Buffer.alloc(100, 2));
  spool.putChunk(300, Buffer.alloc(100, 3));

  // 300 octets demandés pour 250 disponibles → le plus ancien saute.
  const remaining = spool.listChunks().map((c) => c.startedAtMs);
  expect(remaining).toEqual([200, 300]);
});

test("the cap never sacrifices the newest chunk", () => {
  const spool = tmpSpool(10); // budget plus petit qu'un seul chunk
  spool.putChunk(100, Buffer.alloc(50, 1));
  spool.putChunk(200, Buffer.alloc(50, 2));

  // Tout dépasse, mais on garde le dernier arrivé : c'est lui qui a de la
  // valeur pour diagnostiquer.
  expect(spool.listChunks().map((c) => c.startedAtMs)).toEqual([200]);
});

test("a chunk can be read back and removed", () => {
  const spool = tmpSpool();
  const name = spool.putChunk(42, Buffer.from("payload"));

  expect(spool.readChunk(name).toString()).toBe("payload");
  expect(spool.removeChunk(name)).toBe(true);
  expect(spool.listChunks()).toHaveLength(0);
});

test("non-chunk files in the spool directory are ignored", () => {
  const spool = tmpSpool();
  spool.putChunk(100, Buffer.from("a"));
  fs.writeFileSync(join(spool.dir, "notes.txt"), "whatever");
  fs.writeFileSync(join(spool.dir, "current.ndjson"), "{}\n");

  expect(spool.listChunks().map((c) => c.name)).toEqual(["100.zip"]);
});

test("stats report what is waiting on disk", () => {
  const spool = tmpSpool(999);
  spool.putChunk(1, Buffer.alloc(30));
  spool.putChunk(2, Buffer.alloc(20));

  const s = spool.stats();
  expect(s.chunks).toBe(2);
  expect(s.bytes).toBe(50);
  expect(s.maxBytes).toBe(999);
});

const { resolveTraceConfig } = require("../src/main/helpers/trace_config");

const NOW = Date.parse("2026-09-11T10:00:00Z");
const FUTURE = "2026-09-11T18:00:00Z";
const PAST = "2026-09-11T08:00:00Z";

test("trace is off when nothing enables it", () => {
  const cfg = resolveTraceConfig({ conf: {}, env: {}, now: NOW });
  expect(cfg.enable).toBe(false);
  expect(cfg.source).toBe("default");
});

test("config.ini enables the trace", () => {
  const cfg = resolveTraceConfig({
    conf: { trace: { enable: true } },
    env: {},
    now: NOW,
  });
  expect(cfg.enable).toBe(true);
  expect(cfg.source).toBe("config");
});

test("EL_TRACE overrides a disabled config.ini", () => {
  const cfg = resolveTraceConfig({
    conf: { trace: { enable: false } },
    env: { EL_TRACE: "1" },
    now: NOW,
  });
  expect(cfg.enable).toBe(true);
  expect(cfg.source).toBe("env");
});

test("EL_TRACE=0 wins over a remote activation", () => {
  const cfg = resolveTraceConfig({
    conf: {},
    env: { EL_TRACE: "0" },
    remote: { enable: true, until: FUTURE },
    now: NOW,
  });
  expect(cfg.enable).toBe(false);
  expect(cfg.source).toBe("env");
});

test("remote activation works and carries its provenance", () => {
  const cfg = resolveTraceConfig({
    conf: {},
    env: {},
    remote: { enable: true, until: FUTURE, reason: "ticket #1234" },
    now: NOW,
  });
  expect(cfg.enable).toBe(true);
  expect(cfg.source).toBe("remote");
  expect(cfg.reason).toBe("ticket #1234");
  expect(cfg.until).toBe(FUTURE);
});

test("a remote order without expiry is refused", () => {
  const cfg = resolveTraceConfig({
    conf: {},
    env: {},
    remote: { enable: true },
    now: NOW,
  });
  expect(cfg.enable).toBe(false);
  expect(cfg.remoteRejected).toBe("missing_until");
});

test("an expired remote order stops being honoured", () => {
  const cfg = resolveTraceConfig({
    conf: {},
    env: {},
    remote: { enable: true, until: PAST },
    now: NOW,
  });
  expect(cfg.enable).toBe(false);
  expect(cfg.remoteRejected).toBe("expired");
});

test("allow_remote=0 hard-blocks remote activation", () => {
  const cfg = resolveTraceConfig({
    conf: { trace: { allow_remote: false } },
    env: {},
    remote: { enable: true, until: FUTURE },
    now: NOW,
  });
  expect(cfg.enable).toBe(false);
  expect(cfg.remoteRejected).toBe("blocked_by_config");
});

test("allow_remote=0 does not prevent a local activation", () => {
  const cfg = resolveTraceConfig({
    conf: { trace: { enable: true, allow_remote: false } },
    env: {},
    remote: { enable: true, until: FUTURE },
    now: NOW,
  });
  expect(cfg.enable).toBe(true);
  expect(cfg.source).toBe("config");
});

test("masking cannot be weakened from the dashboard", () => {
  const cfg = resolveTraceConfig({
    conf: { trace: { mask_all_inputs: true, mask_text_class: "secret" } },
    env: {},
    remote: {
      enable: true,
      until: FUTURE,
      maskAllInputs: false,
      maskTextClass: "none",
      blockClass: "none",
    },
    now: NOW,
  });
  expect(cfg.maskAllInputs).toBe(true);
  expect(cfg.maskTextClass).toBe("secret");
  expect(cfg.blockClass).toBe("el-norec");
});

test("chunk duration is clamped to the hard limits", () => {
  expect(
    resolveTraceConfig({ conf: { trace: { chunk_seconds: 1 } }, now: NOW })
      .chunkSeconds,
  ).toBe(30);
  expect(
    resolveTraceConfig({ conf: { trace: { chunk_seconds: 99999 } }, now: NOW })
      .chunkSeconds,
  ).toBe(1800);
});

test("a remote order cannot push parameters out of range", () => {
  const cfg = resolveTraceConfig({
    conf: {},
    env: {},
    remote: { enable: true, until: FUTURE, chunkSeconds: 5 },
    now: NOW,
  });
  expect(cfg.chunkSeconds).toBe(30);
});

test("spool cap and idle pause fall back to defaults then honour config", () => {
  expect(resolveTraceConfig({ conf: {}, now: NOW }).spoolMaxMb).toBe(500);
  expect(
    resolveTraceConfig({
      conf: { trace: { spool_max_mb: 200, idle_pause_seconds: 0 } },
      now: NOW,
    }).idlePauseSeconds,
  ).toBe(0);
});

test("touch tuning defaults to 150ms and is overridable by env", () => {
  expect(resolveTraceConfig({ conf: {}, now: NOW }).mousemoveMs).toBe(150);
  expect(
    resolveTraceConfig({ conf: {}, env: { EL_TRACE_MOUSEMOVE_MS: "300" }, now: NOW })
      .mousemoveMs,
  ).toBe(300);
});

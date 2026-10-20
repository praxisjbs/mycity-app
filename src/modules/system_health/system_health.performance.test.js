"use strict";
/**
 * Settings · Performance without a database: reading the server from /proc and the
 * cgroups (against a folder laid out like them), turning two readings into rates, the
 * row the sampler writes, and how figures are judged and split. The endpoints run against
 * Postgres in tests/integration/system-health.test.js.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const host = require("./system_health.host");
const sampler = require("./system_health.sample");
const perf = require("./system_health.performance");

/** A server laid out on disk: /proc, the cgroups of a few services, os-release. */
function fakeServer(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-host-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const MEMINFO = [
  "MemTotal:       18874368 kB",
  "MemFree:         3670016 kB",
  "MemAvailable:   13526016 kB",
  "Buffers:          262144 kB",
  "Cached:          9437184 kB",
  "SwapTotal:       2097152 kB",
  "SwapFree:        1572864 kB",
].join("\n");

const DISKSTATS = [
  "   8       0 sda 100 0 2048 10 200 0 4096 20 0 1000 30",
  "   8       1 sda1 100 0 2048 10 200 0 4096 20 0 1000 30",
  "   7       0 loop0 5 0 10 0 0 0 0 0 0 0 0",
].join("\n");

const NETDEV = [
  "Inter-|   Receive                                                |  Transmit",
  " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
  "    lo: 999999 10 0 0 0 0 0 0 999999 10 0 0 0 0 0 0",
  "  eth0: 1048576 10 0 0 0 0 0 0 2097152 10 0 0 0 0 0 0",
].join("\n");

const TCP = [
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
  "   0: 0100007F:1B58 00000000:0000 0A 00000000:00000000 00:00000000 00000000   0        0 1",
  "   1: 0100007F:1B58 0100007F:D2F0 01 00000000:00000000 00:00000000 00000000   0        0 2",
  "   2: 0100007F:1B58 0100007F:D2F1 01 00000000:00000000 00:00000000 00000000   0        0 3",
].join("\n");

const cgroup = (usec, current, file) => ({ usec, current, file });
function cgroupFiles(units) {
  const out = {};
  for (const [unit, g] of Object.entries(units)) {
    out[`sys/fs/cgroup/system.slice/${unit}/cpu.stat`] = `usage_usec ${g.usec}\nuser_usec 1\n`;
    out[`sys/fs/cgroup/system.slice/${unit}/memory.current`] = `${g.current}\n`;
    out[`sys/fs/cgroup/system.slice/${unit}/memory.stat`] = `anon 1\nactive_file ${g.file}\ninactive_file 0\n`;
  }
  return out;
}

const MB = 1024 * 1024;

describe("reading the server from Linux", () => {
  test("memory is in use, cache and free, and in use never counts the disk cache", async () => {
    const root = fakeServer({ "proc/meminfo": MEMINFO });
    const m = await host.memory(root);
    expect(m.total_mb).toBe(18432);
    expect(m.in_use_mb).toBe(18432 - 13209);
    expect(m.free_mb).toBe(3584);
    expect(m.cache_mb).toBe(13209 - 3584);
    expect(m.in_use_mb + m.cache_mb + m.free_mb).toBe(m.total_mb);
    expect(m.swap_used_mb).toBe(512);
  });

  test("the disk's activity is summed over whole disks, never a partition or a loop device", async () => {
    const io = await host.diskIo(fakeServer({ "proc/diskstats": DISKSTATS }));
    expect(io).toEqual({ read_sectors: 2048, written_sectors: 4096, busy_ms: 1000 });
  });

  test("network leaves loopback out, and connections count only the established", async () => {
    const root = fakeServer({ "proc/net/dev": NETDEV, "proc/net/tcp": TCP });
    expect(await host.network(root)).toEqual({ in_bytes: 1048576, out_bytes: 2097152 });
    expect(await host.connections(root)).toBe(2);
  });

  test("each service is found by its unit, template slices included, and its cache is not its memory", async () => {
    const root = fakeServer({
      ...cgroupFiles({
        "mycity-api-prod.service": cgroup(1_000_000, 300 * MB, 100 * MB),
        "mycity-worker-prod.service": cgroup(500_000, 250 * MB, 50 * MB),
        "redis-server.service": cgroup(10_000, 40 * MB, 0),
        "ssh.service": cgroup(1, 5 * MB, 0),
      }),
      "sys/fs/cgroup/system.slice/system-postgresql.slice/postgresql@16-main.service/cpu.stat": "usage_usec 2000000\n",
      "sys/fs/cgroup/system.slice/system-postgresql.slice/postgresql@16-main.service/memory.current": `${1200 * MB}\n`,
      "sys/fs/cgroup/system.slice/system-postgresql.slice/postgresql@16-main.service/memory.stat": `active_file ${200 * MB}\ninactive_file 0\n`,
    });
    const svc = await host.services(root);
    expect(svc.production).toEqual({ cpu_usec: 1_500_000, memory_mb: 400 });
    expect(svc.database).toEqual({ cpu_usec: 2_000_000, memory_mb: 1000 });
    expect(svc.redis.memory_mb).toBe(40);
    expect(svc.staging).toBeUndefined();
    expect(Object.keys(svc)).not.toContain("ssh");
  });

  test("a machine with nothing to read answers null, never an error", async () => {
    const empty = fakeServer({ "nothing/here": "" });
    expect(await host.memory(empty)).toBeNull();
    expect(await host.cpuTimes(empty)).toBeNull();
    expect(await host.services(empty)).toBeNull();
    expect(await host.connections(empty)).toBeNull();
    expect(await host.collected(path.join(empty, "host-stats.json"))).toBeNull();
  });

  test("the root timer's file is read only when it is the version this code knows", async () => {
    const root = fakeServer({
      "good.json": JSON.stringify({ version: 1, taken_at: "2026-10-20T10:00:00Z", uses: { backups: 5 } }),
      "future.json": JSON.stringify({ version: 2, uses: {} }),
    });
    expect((await host.collected(path.join(root, "good.json"))).uses.backups).toBe(5);
    expect(await host.collected(path.join(root, "future.json"))).toBeNull();
  });
});

describe("two readings make a rate", () => {
  const reading = (at, cpu, io, net, services, cores = 4) => ({ at, cores, cpu, io, net, services });

  test("busy, steal and I/O wait are shares of all the processor's time, never added together", () => {
    const r = host.rates(
      reading(0, { busy: 100, idle: 800, iowait: 50, steal: 50, total: 1000 }),
      reading(60_000, { busy: 400, idle: 1300, iowait: 150, steal: 150, total: 2000 }),
    );
    expect(r.cpu_busy_pct).toBe(30);
    expect(r.cpu_iowait_pct).toBe(10);
    expect(r.cpu_steal_pct).toBe(10);
  });

  test("a service's CPU is a share of the whole machine, every core counted", () => {
    const r = host.rates(
      reading(0, null, null, null, { production: { cpu_usec: 0, memory_mb: 100 } }),
      reading(60_000, null, null, null, { production: { cpu_usec: 60e6, memory_mb: 120 } }),
    );
    // One core busy for the whole minute on a four-core machine is a quarter of it.
    expect(r.services.production).toEqual({ cpu_pct: 25, memory_mb: 120 });
  });

  test("a counter that went backwards was reset by a restart, so it has no rate rather than a negative one", () => {
    const r = host.rates(
      reading(0, null, { read_sectors: 5000, written_sectors: 5000, busy_ms: 5000 }, { in_bytes: 9e9, out_bytes: 1 }),
      reading(60_000, null, { read_sectors: 10, written_sectors: 6024, busy_ms: 5600 }, { in_bytes: 1024, out_bytes: 2049 }),
    );
    expect(r.disk_read_kb).toBeNull();
    expect(r.disk_written_kb).toBe(512);
    expect(r.disk_busy_pct).toBe(1);
    expect(r.network_in_kb).toBeNull();
    expect(r.network_out_kb).toBe(2);
  });
});

describe("the row the sampler writes", () => {
  const base = {
    cores: 8,
    load_1m: 1.234,
    memory: { total_mb: 18432, in_use_mb: 5200, cache_mb: 9700, free_mb: 3532, swap_total_mb: 0, swap_used_mb: 0 },
    disk: { total_mb: 241000, used_mb: 24000, free_mb: 205000, reserved_mb: 12000 },
    tcp: 42,
  };

  test("amounts read a second apart after a restart are scaled to a minute, not drawn as a trickle", () => {
    const before = { ...base, at: 0, io: { read_sectors: 0, written_sectors: 0, busy_ms: 0 }, net: { in_bytes: 0, out_bytes: 0 } };
    const now = { ...base, at: 1000, io: { read_sectors: 2048, written_sectors: 0, busy_ms: 0 }, net: { in_bytes: 10 * 1024, out_bytes: 0 } };
    const row = sampler.rowOf(new Date("2026-10-20T10:00:00Z"), before, now, { apiUp: true, usersOnline: 7 });
    expect(row.disk_read_kb).toBe(1024 * 60);
    expect(row.network_in_kb).toBe(10 * 60);
    expect(row.memory_in_use_mb).toBe(5200);
    expect(row.load_1m).toBe(1.23);
    expect(row.api_up).toBe(true);
    expect(row.users_online).toBe(7);
    // No cgroups were read: every service's column is empty, and Other carries them all.
    expect(row.production_memory_mb).toBeNull();
    expect(row.database_cpu_pct).toBeNull();
  });

  test("an API that does not answer is a minute down", async () => {
    await expect(sampler.apiReady(1)).resolves.toBe(false);
  });
});

describe("judging and splitting what the server says", () => {
  test("a target is met at its value, and nothing to judge is not a pass", () => {
    expect(perf.judge("99.90", "99.90", true)).toBe("met");
    expect(perf.judge("99.89", "99.90", true)).toBe("missed");
    expect(perf.judge(800, 800, false)).toBe("met");
    expect(perf.judge(801, 800, false)).toBe("missed");
    expect(perf.judge(null, 800, false)).toBe("none");
  });

  test("levels go degraded at the warning and down at the down level, free disk the other way round", () => {
    expect(perf.level(84, 85, 95)).toBe("up");
    expect(perf.level(85, 85, 95)).toBe("degraded");
    expect(perf.level(95, 85, 95)).toBe("down");
    expect(perf.level(12, 10, 5, false)).toBe("up");
    expect(perf.level(9, 10, 5, false)).toBe("degraded");
    expect(perf.level(4, 10, 5, false)).toBe("down");
    expect(perf.level(null, 10, 5)).toBeNull();
  });

  test("memory's parts are each service and Other, which is what is in use less the named ones", () => {
    const parts = perf.partsOf(
      { production_memory_mb: 1900, staging_memory_mb: 800, database_memory_mb: 1600, redis_memory_mb: 200, scanner_memory_mb: null },
      "memory_mb",
      5100,
      (mb) => ({ mb }),
    );
    expect(parts).toEqual([
      { key: "production", mb: 1900 },
      { key: "staging", mb: 800 },
      { key: "database", mb: 1600 },
      { key: "redis", mb: 200 },
      { key: "other", mb: 600 },
    ]);
    expect(perf.partsOf({}, "memory_mb", 5100, (mb) => ({ mb }))).toEqual([]);
  });

  test("the disk's parts are each environment, backups and logs, and System is the rest of what is used", () => {
    const gb = 1024 ** 3;
    const parts = perf.diskParts(
      { uses: { production_database: 3 * gb, production_files: 8 * gb, staging_database: gb, staging_files: gb, backups: 6 * gb, logs: gb } },
      24 * 1024,
    );
    expect(parts).toEqual([
      { key: "production_database", mb: 3072 },
      { key: "production_files", mb: 8192 },
      { key: "staging", mb: 2048 },
      { key: "backups", mb: 6144 },
      { key: "logs", mb: 1024 },
      { key: "system", mb: 24 * 1024 - 20480 },
    ]);
    expect(perf.diskParts(null, 1000)).toEqual([]);
  });

  test("every scheduler's cadence reads as words", () => {
    expect(perf.everyOf({ every: 60_000 })).toBe("Every minute");
    expect(perf.everyOf({ every: 5 * 60_000 })).toBe("Every 5 minutes");
    expect(perf.everyOf({ every: 1000 })).toBe("Every second");
    expect(perf.everyOf({ pattern: "0 8 * * *" })).toBe("Daily at 08:00");
    expect(perf.everyOf({ pattern: "10 * * * *" })).toBe("Hourly at :10");
    expect(perf.everyOf({ pattern: "*/5 * * * *" })).toBe("Every 5 minutes");
    expect(perf.everyOf({ pattern: "*/5 8-17 * * *" })).toBe("Every 5 minutes, 08:00 to 18:00");
  });
});

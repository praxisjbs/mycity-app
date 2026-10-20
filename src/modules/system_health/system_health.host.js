"use strict";
/**
 * The whole server, read from Linux itself (docs/guides/system-health.md §6): processor,
 * memory, disk, disk activity, network, and each systemd service's own share through its
 * cgroup. The server is shared by production and staging, so these are the machine's
 * figures, not one environment's.
 *
 *   const now = await host.read();           // counters and gauges, this instant
 *   const rates = host.rates(before, now);   // what happened between two readings
 *
 * Every reader takes the filesystem root, so the tests give it a folder of fixtures, and
 * every reader answers null rather than throwing: a laptop on Windows or macOS has no
 * /proc, and a service that is not running has no cgroup. The units' sandboxing
 * (ProtectSystem=strict, ProtectControlGroups) leaves /proc and /sys/fs/cgroup readable.
 *
 * Nothing here needs root. What does (the size of the other environment's files, the
 * backups, pending updates) is measured by the root timer and read from its file
 * (`collected()`).
 */
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

/** Where the root timer writes what fills the disk (ops/monitoring/host-stats.sh). */
const COLLECTOR_FILE = "/var/lib/mycity/host-stats.json";

const MB = 1024 * 1024;

/**
 * The systemd services a part of the processor and memory is named after. Production and
 * staging are each their API and worker (Chromium runs inside the worker); Other is the
 * rest of the machine, worked out by the caller.
 */
const GROUPS = [
  { key: "production", match: /^mycity-(api|worker)-prod\.service$/ },
  { key: "staging", match: /^mycity-(api|worker)-stg\.service$/ },
  { key: "database", match: /^postgresql(@[^/]+)?\.service$/ },
  { key: "redis", match: /^redis(-server)?(@[^/]+)?\.service$/ },
  { key: "scanner", match: /^clamav-daemon\.service$/ },
];

/** A whole disk, never a partition, a loop device or a RAM disk. */
const WHOLE_DISK = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;

const text = async (root, rel) => {
  try {
    return await fs.readFile(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
};

/** The aggregate `cpu` line of /proc/stat, in clock ticks. */
async function cpuTimes(root = "/") {
  const raw = await text(root, "proc/stat");
  if (!raw) return null;
  const line = raw.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const [user, nice, system, idle, iowait, irq, softirq, steal] = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((n) => Number(n) || 0);
  return {
    busy: user + nice + system + irq + softirq,
    idle,
    iowait,
    steal,
    total: user + nice + system + idle + iowait + irq + softirq + steal,
  };
}

/** /proc/meminfo, in MB. In use is total less available: what the server cannot give back. */
async function memory(root = "/") {
  const raw = await text(root, "proc/meminfo");
  if (!raw) return null;
  const kb = {};
  for (const line of raw.split("\n")) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) kb[m[1]] = Number(m[2]);
  }
  if (!kb.MemTotal) return null;
  const toMb = (k) => Math.round((k || 0) / 1024);
  const total = toMb(kb.MemTotal);
  const free = toMb(kb.MemFree);
  // Kernels before 3.14 have no MemAvailable; free plus the page cache is its old estimate.
  const available = toMb(kb.MemAvailable ?? (kb.MemFree || 0) + (kb.Cached || 0) + (kb.Buffers || 0));
  const inUse = Math.max(0, total - available);
  return {
    total_mb: total,
    in_use_mb: inUse,
    cache_mb: Math.max(0, available - free),
    free_mb: free,
    swap_total_mb: toMb(kb.SwapTotal),
    swap_used_mb: Math.max(0, toMb(kb.SwapTotal) - toMb(kb.SwapFree)),
  };
}

/** The root filesystem, in MB. Left is what a process may still write; the rest is reserved for root. */
async function disk(root = "/") {
  try {
    const st = await fs.statfs(root);
    const size = st.blocks * st.bsize;
    const freeAll = st.bfree * st.bsize;
    const avail = st.bavail * st.bsize;
    if (!size) return null;
    return {
      total_mb: Math.round(size / MB),
      used_mb: Math.round((size - freeAll) / MB),
      free_mb: Math.round(avail / MB),
      reserved_mb: Math.max(0, Math.round((freeAll - avail) / MB)),
    };
  } catch {
    return null;
  }
}

/** Sectors read and written and time spent busy, summed over the whole disks. */
async function diskIo(root = "/") {
  const raw = await text(root, "proc/diskstats");
  if (!raw) return null;
  let readSectors = 0;
  let written = 0;
  let busyMs = 0;
  let found = false;
  for (const line of raw.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 14 || !WHOLE_DISK.test(f[2])) continue;
    found = true;
    readSectors += Number(f[5]) || 0;
    written += Number(f[9]) || 0;
    // Disks work in parallel; the busiest one is how busy the storage is.
    busyMs = Math.max(busyMs, Number(f[12]) || 0);
  }
  return found ? { read_sectors: readSectors, written_sectors: written, busy_ms: busyMs } : null;
}

/** Bytes in and out over every interface but loopback. */
async function network(root = "/") {
  const raw = await text(root, "proc/net/dev");
  if (!raw) return null;
  let inBytes = 0;
  let outBytes = 0;
  for (const line of raw.split("\n").slice(2)) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
    if (!m || m[1].trim() === "lo") continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    inBytes += f[0] || 0;
    outBytes += f[8] || 0;
  }
  return { in_bytes: inBytes, out_bytes: outBytes };
}

/** Established TCP connections, IPv4 and IPv6. */
async function connections(root = "/") {
  let count = 0;
  let readable = false;
  for (const file of ["proc/net/tcp", "proc/net/tcp6"]) {
    const raw = await text(root, file);
    if (raw === null) continue;
    readable = true;
    for (const line of raw.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f[3] === "01") count += 1;
    }
  }
  return readable ? count : null;
}

/** Every service unit under system.slice, one level of template slices included (postgresql@16-main). */
async function units(root) {
  const base = path.join(root, "sys/fs/cgroup/system.slice");
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.endsWith(".service")) out.push({ name: e.name, dir: path.join(base, e.name) });
    else if (e.name.endsWith(".slice")) {
      try {
        for (const inner of await fs.readdir(path.join(base, e.name), { withFileTypes: true })) {
          if (inner.isDirectory() && inner.name.endsWith(".service"))
            out.push({ name: inner.name, dir: path.join(base, e.name, inner.name) });
        }
      } catch {
        /* a slice that vanished while it was read */
      }
    }
  }
  return out;
}

/**
 * Each group's CPU time (microseconds, cumulative) and memory in use (MB, less its file
 * cache), from cgroup v2. A group with no running unit is left out, so the caller counts
 * it in Other. Null on cgroup v1 or without /sys.
 */
async function services(root = "/") {
  const found = await units(root);
  if (!found.length) return null;
  const out = {};
  for (const { name, dir } of found) {
    const group = GROUPS.find((g) => g.match.test(name));
    if (!group) continue;
    const cpu = await text(dir, "cpu.stat");
    const current = await text(dir, "memory.current");
    const stat = await text(dir, "memory.stat");
    const usec = cpu ? Number((/usage_usec\s+(\d+)/.exec(cpu) || [])[1]) || 0 : 0;
    let bytes = current ? Number(current.trim()) || 0 : 0;
    if (stat) {
      const file = (k) => Number((new RegExp(`^${k}\\s+(\\d+)`, "m").exec(stat) || [])[1]) || 0;
      bytes = Math.max(0, bytes - file("active_file") - file("inactive_file"));
    }
    const g = out[group.key] || { cpu_usec: 0, memory_mb: 0 };
    g.cpu_usec += usec;
    g.memory_mb += Math.round(bytes / MB);
    out[group.key] = g;
  }
  return out;
}

/** One reading of everything: counters to diff, gauges as they stand. */
async function read(root = "/") {
  const [cpu, mem, dsk, io, net, tcp, svc] = await Promise.all([
    cpuTimes(root),
    memory(root),
    disk(root),
    diskIo(root),
    network(root),
    connections(root),
    services(root),
  ]);
  return {
    at: Date.now(),
    cores: Math.max(1, os.cpus().length),
    load_1m: os.loadavg()[0],
    cpu,
    memory: mem,
    disk: dsk,
    io,
    net,
    tcp,
    services: svc,
  };
}

const share = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part * 100) / whole)) : null);
const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
/** A counter that went backwards was reset (a reboot, a restarted service): no rate for it. */
const delta = (a, b) => (a === undefined || b === undefined || b < a ? null : b - a);

/**
 * What happened between two readings: the processor as shares of all its time, disk and
 * network as kilobytes moved, and each group's CPU as a share of the whole machine.
 */
function rates(before, now) {
  const seconds = (now.at - before.at) / 1000;
  const out = {
    cpu_busy_pct: null,
    cpu_steal_pct: null,
    cpu_iowait_pct: null,
    disk_read_kb: null,
    disk_written_kb: null,
    disk_busy_pct: null,
    network_in_kb: null,
    network_out_kb: null,
    services: {},
  };
  if (!(seconds > 0)) return out;
  if (before.cpu && now.cpu) {
    const total = delta(before.cpu.total, now.cpu.total);
    if (total) {
      out.cpu_busy_pct = round2(share(delta(before.cpu.busy, now.cpu.busy) ?? 0, total));
      out.cpu_steal_pct = round2(share(delta(before.cpu.steal, now.cpu.steal) ?? 0, total));
      out.cpu_iowait_pct = round2(share(delta(before.cpu.iowait, now.cpu.iowait) ?? 0, total));
    }
  }
  if (before.io && now.io) {
    const r = delta(before.io.read_sectors, now.io.read_sectors);
    const w = delta(before.io.written_sectors, now.io.written_sectors);
    const b = delta(before.io.busy_ms, now.io.busy_ms);
    out.disk_read_kb = r === null ? null : Math.round((r * 512) / 1024);
    out.disk_written_kb = w === null ? null : Math.round((w * 512) / 1024);
    out.disk_busy_pct = b === null ? null : round2(share(b, seconds * 1000));
  }
  if (before.net && now.net) {
    const i = delta(before.net.in_bytes, now.net.in_bytes);
    const o = delta(before.net.out_bytes, now.net.out_bytes);
    out.network_in_kb = i === null ? null : Math.round(i / 1024);
    out.network_out_kb = o === null ? null : Math.round(o / 1024);
  }
  if (before.services && now.services) {
    const machineUsec = seconds * 1e6 * now.cores;
    for (const [key, g] of Object.entries(now.services)) {
      const was = before.services[key];
      const used = was ? delta(was.cpu_usec, g.cpu_usec) : null;
      out.services[key] = {
        cpu_pct: used === null ? null : round2(share(used, machineUsec)),
        memory_mb: g.memory_mb,
      };
    }
  }
  return out;
}

/**
 * What the root timer last wrote: the disk's parts, restart needed, updates waiting.
 * Null when there is no file (the timer is not installed) or it cannot be read.
 */
async function collected(file = COLLECTOR_FILE) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The operating system's name, from os-release. */
async function osName(root = "/") {
  const raw = (await text(root, "etc/os-release")) || (await text(root, "usr/lib/os-release"));
  if (!raw) return `${os.type()} ${os.release()}`;
  const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(raw);
  return m ? m[1] : os.type();
}

/** Whether the server has asked to be restarted (Ubuntu writes this after a kernel update). */
async function restartNeeded(root = "/") {
  if (process.platform !== "linux") return null;
  try {
    await fs.access(path.join(root, "var/run/reboot-required"));
    return true;
  } catch {
    return false;
  }
}

/** The server's own facts that need no database. */
async function facts(root = "/") {
  const cpus = os.cpus();
  return {
    os: await osName(root),
    kernel: os.release(),
    cpu_model: cpus[0] ? cpus[0].model.replace(/\s+/g, " ").trim() : null,
    up_since: new Date(Date.now() - os.uptime() * 1000).toISOString(),
    restart_needed: await restartNeeded(root),
  };
}

module.exports = {
  COLLECTOR_FILE,
  GROUPS,
  cpuTimes,
  memory,
  disk,
  diskIo,
  network,
  connections,
  services,
  read,
  rates,
  collected,
  facts,
};

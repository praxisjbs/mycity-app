"use strict";
/**
 * In-process metrics in the Prometheus text format, served at GET /api/metrics
 * when METRICS_TOKEN is set (http/routes.js).
 *
 *   metrics.inc("mycity_auth_failures_total", { reason: "expired" }, 1, "Authentication failures by reason.");
 *   metrics.observe("mycity_http_request_duration_seconds", 0.042, { method: "GET", route: "/api/v1/things" });
 *   metrics.setGauge("mycity_outbox_backlog", {}, 3);
 *
 * Names are prefixed `mycity_`. No client library: three maps and a renderer.
 * Values are per process, so the API and the worker each report their own.
 *
 * Label values must be bounded (a method, a templated route, a reason code),
 * never an id: every distinct label set is a new series held in memory.
 */
const counters = new Map();
const histograms = new Map();
const gauges = new Map();

const STARTED_AT = Date.now();
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelKey(labels = {}) {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${String(labels[k]).replace(/[\\"\n,=]/g, "_")}`).join(",");
}

function parseKey(key) {
  if (!key) return {};
  const out = {};
  for (const pair of key.split(",")) {
    const i = pair.indexOf("=");
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

function family(map, name, help, extra = {}) {
  if (!map.has(name)) map.set(name, { help, values: new Map(), ...extra });
  return map.get(name);
}

function inc(name, labels = {}, value = 1, help = "") {
  const c = family(counters, name, help);
  const k = labelKey(labels);
  c.values.set(k, (c.values.get(k) || 0) + value);
}

function setGauge(name, labels = {}, value = 0, help = "") {
  family(gauges, name, help).values.set(labelKey(labels), Number(value) || 0);
}

function observe(name, seconds, labels = {}, help = "") {
  const h = family(histograms, name, help, { buckets: DEFAULT_BUCKETS });
  const k = labelKey(labels);
  let v = h.values.get(k);
  if (!v) {
    v = { counts: new Array(h.buckets.length).fill(0), sum: 0, count: 0 };
    h.values.set(k, v);
  }
  v.count += 1;
  v.sum += seconds;
  for (let i = 0; i < h.buckets.length; i += 1) if (seconds <= h.buckets[i]) v.counts[i] += 1;
}

/** /api/v1/employees/3f2a...-uuid/documents → /api/v1/employees/:id/documents */
function templatePath(p) {
  return String(p || "/")
    .split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    .slice(0, 120);
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

function renderLabels(labels) {
  const entries = Object.entries(labels);
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}` : "";
}

function render() {
  const out = [
    "# HELP mycity_process_uptime_seconds Seconds since this process started.",
    "# TYPE mycity_process_uptime_seconds gauge",
    `mycity_process_uptime_seconds ${Math.floor((Date.now() - STARTED_AT) / 1000)}`,
    "# HELP mycity_process_heap_bytes Heap in use, bytes.",
    "# TYPE mycity_process_heap_bytes gauge",
    `mycity_process_heap_bytes ${process.memoryUsage().heapUsed}`,
  ];
  for (const [name, c] of counters) {
    if (c.help) out.push(`# HELP ${name} ${esc(c.help)}`);
    out.push(`# TYPE ${name} counter`);
    for (const [k, v] of c.values) out.push(`${name}${renderLabels(parseKey(k))} ${v}`);
  }
  for (const [name, g] of gauges) {
    if (g.help) out.push(`# HELP ${name} ${esc(g.help)}`);
    out.push(`# TYPE ${name} gauge`);
    for (const [k, v] of g.values) out.push(`${name}${renderLabels(parseKey(k))} ${v}`);
  }
  for (const [name, h] of histograms) {
    if (h.help) out.push(`# HELP ${name} ${esc(h.help)}`);
    out.push(`# TYPE ${name} histogram`);
    for (const [k, v] of h.values) {
      const labels = parseKey(k);
      h.buckets.forEach((b, i) => out.push(`${name}_bucket${renderLabels({ ...labels, le: b })} ${v.counts[i]}`));
      out.push(`${name}_bucket${renderLabels({ ...labels, le: "+Inf" })} ${v.count}`);
      out.push(`${name}_sum${renderLabels(labels)} ${v.sum.toFixed(6)}`);
      out.push(`${name}_count${renderLabels(labels)} ${v.count}`);
    }
  }
  return `${out.join("\n")}\n`;
}

/** Plain-object view, for tests and the readiness probe. */
function snapshot() {
  const out = { counters: {}, gauges: {}, histograms: {} };
  for (const [name, c] of counters) out.counters[name] = Object.fromEntries(c.values);
  for (const [name, g] of gauges) out.gauges[name] = Object.fromEntries(g.values);
  for (const [name, h] of histograms) {
    out.histograms[name] = Object.fromEntries([...h.values].map(([k, v]) => [k, { count: v.count, sum: v.sum }]));
  }
  return out;
}

function __reset() {
  counters.clear();
  gauges.clear();
  histograms.clear();
}

module.exports = { inc, setGauge, observe, templatePath, render, snapshot, __reset };

#!/usr/bin/env bash
# What fills the server's disk, for Settings · Performance (docs/guides/system-health.md §4, §6).
#
# Run as root every 15 minutes by mycity-host-stats.timer, installed by ops/provision/provision.sh
# as /srv/mycity/bin/mycity-host-stats. Root, because the app cannot see this: production's
# service user cannot read staging's files or the backups, and neither may read the other
# environment's database. It writes one small file both environments read:
#
#   /var/lib/mycity/host-stats.json   (mode 644)
#   { "version": 1, "taken_at": "...",
#     "uses": { "production_database", "production_files", "staging_database",
#               "staging_files", "backups", "logs" },          every size in bytes, or null
#     "restart_needed": true|false,
#     "updates": { "waiting": n, "security": n } | null }
#
# Sizes and counts only: no file names, no people. Anything it cannot measure is null, and the
# screen says Not Measured for it. Run now:  sudo systemctl start mycity-host-stats
set -uo pipefail

OUT_DIR=/var/lib/mycity
OUT="$OUT_DIR/host-stats.json"
cd /tmp # psql as postgres cannot read root's working directory

# Bytes under a folder, on its own filesystem, or null when it is not there.
size_of() {
  local n
  [[ -e "$1" ]] || { echo null; return; }
  n="$(du -sb --one-file-system "$1" 2>/dev/null | awk '{ print $1 }')"
  [[ "$n" =~ ^[0-9]+$ ]] && echo "$n" || echo null
}

# A database's size in bytes, or null when Postgres does not answer.
db_size() {
  local n
  n="$(runuser -u postgres -- psql -X -tAc "SELECT pg_database_size('$1')" 2>/dev/null | tr -d '[:space:]')"
  [[ "$n" =~ ^[0-9]+$ ]] && echo "$n" || echo null
}

restart=false
[[ -f /var/run/reboot-required ]] && restart=true

# Ubuntu's own count of upgradable packages, "all;security" on stderr.
updates=null
if [[ -x /usr/lib/update-notifier/apt-check ]]; then
  counts="$(/usr/lib/update-notifier/apt-check 2>&1 >/dev/null | tail -1)"
  if [[ "$counts" =~ ^([0-9]+)\;([0-9]+)$ ]]; then
    updates="{ \"waiting\": ${BASH_REMATCH[1]}, \"security\": ${BASH_REMATCH[2]} }"
  fi
fi

install -d -m 755 "$OUT_DIR"
tmp="$(mktemp "$OUT_DIR/.host-stats.XXXXXX")"
cat >"$tmp" <<JSON
{
  "version": 1,
  "taken_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "uses": {
    "production_database": $(db_size mycity_prod),
    "production_files": $(size_of /srv/mycity/prod/media),
    "staging_database": $(db_size mycity_stg),
    "staging_files": $(size_of /srv/mycity/stg/media),
    "backups": $(size_of /srv/mycity/backups),
    "logs": $(size_of /var/log)
  },
  "restart_needed": $restart,
  "updates": $updates
}
JSON
chmod 644 "$tmp"
# Renamed into place, so a reader never sees half a file.
mv -f "$tmp" "$OUT"

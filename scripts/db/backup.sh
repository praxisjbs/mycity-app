#!/usr/bin/env bash
# backup.sh · the nightly backup of both environments (SYSTEM_ARCHITECTURE §11,
# docs/runbooks/backup-restore.md).
#
# Installed root-owned at /srv/mycity/bin/mycity-backup by ops/provision/provision.sh and run as
# root by mycity-backup.service, which mycity-backup.timer starts every night at 02:30 Lagos time.
# Run it by hand the same way:  sudo systemctl start mycity-backup  (or sudo /srv/mycity/bin/mycity-backup)
#
# For each environment (prod, then stg):
#
#   database  pg_dump (custom format) to backups/<env>/nightly-<UTC time>.dump, with a
#             nightly-<UTC time>.json beside it: sha256, size, release, timings, and the migration
#             head and exact row count of every table AS THEY ARE IN THE DUMP. The dump and the
#             counts read one exported snapshot (pg_dump --snapshot), so the restore drill can
#             demand the same numbers back, not roughly similar ones. pg_restore must also be able
#             to read the dump's table of contents back, or the dump counts as failed.
#   media     an rsync snapshot to backups/<env>/media/<UTC time>/; a file unchanged since the
#             previous snapshot is a hard link to it, so each night costs only what changed.
#   keep      the newest 14 dumps and 14 media snapshots. The pre-deploy dumps are deploy-gate's.
#
# Then, when /etc/mycity/backup.env sets OFFSITE_TARGET, the whole of /srv/mycity/backups is
# mirrored over SSH into mycity-backups/ under that target: one server is one disk, and a backup only counts once a copy is
# somewhere else. /root/mycity-secrets is never sent with the data; it is kept apart on purpose.
#
#   /etc/mycity/backup.env (root, 600; every line optional)
#     OFFSITE_TARGET=mycity-offsite@203.0.113.10:          rsync destination (docs/runbooks/backup-restore.md §2)
#     OFFSITE_SSH_KEY=/root/.ssh/mycity-offsite            private key for it (this is the default)
#     OFFSITE_PORT=22
#
# Every run writes backups/last-run.json. On any failure the run carries on with the rest, exits 1
# (the unit shows as failed) and sends one alert through mycity-alert to production's channels
# (ALERT_WEBHOOK_URL, ALERT_WHATSAPP_URLS: src/shared/observability/alert.js).
#
# The BK_* variables exist for the tests and nothing else.

set -uo pipefail
umask 077
# A write to a psql that has exited fails with an error instead of killing the whole run.
trap '' PIPE

ROOT="${BK_ROOT:-/srv/mycity}"
CONF="${BK_CONF:-/etc/mycity/backup.env}"
read -r -a ENVS <<<"${BK_ENVS:-prod stg}"
KEEP="${BK_KEEP:-14}"
PG_DUMP="${BK_PG_DUMP:-pg_dump}"
PG_RESTORE="${BK_PG_RESTORE:-pg_restore}"
PSQL="${BK_PSQL:-psql}"
RSYNC="${BK_RSYNC:-rsync}"
ALERT="${BK_ALERT:-/srv/mycity/bin/mycity-alert}"
SNAP_TIMEOUT="${BK_SNAP_TIMEOUT:-1800}" # seconds the row counts may take

BACKUPS="$ROOT/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ITEMS=()    # one JSON object per thing backed up
FAILURES=() # one sentence per thing that failed

say() { printf '[backup] %s\n' "$*"; }
# One line per failure: a tool's multi-line message is cut to its first line (the journal has it all).
fail() {
  local line="${*%%$'\n'*}"
  FAILURES+=("$line")
  say "FAILED: $*"
}
now() { date +%s; }

# One value from a file of KEY=value lines, as written (the .env files use no quotes).
value_in() { # file key
  [[ -r "$1" ]] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n 1
}
env_value() { value_in "$ROOT/$1/shared/.env" "$2"; }

# psql or pg_dump against an environment's database, with that environment's own role.
with_db() { # env command...
  PGPASSWORD="$(env_value "$1" DB_PASSWORD)" PGHOST="$(env_value "$1" DB_HOST)" \
    PGPORT="$(env_value "$1" DB_PORT)" PGUSER="$(env_value "$1" DB_USER)" \
    PGDATABASE="$(env_value "$1" DB_NAME)" PGCONNECT_TIMEOUT=10 "${@:2}"
}

# A read-only transaction on the environment's database, kept open by psql running as a
# coprocess, whose snapshot pg_dump then shares. Sets SNAPSHOT, or returns 1 with the reason in it.
snapshot_open() { # env
  local line
  SNAPSHOT=""
  coproc SNAP { with_db "$1" "$PSQL" -X -A -t -q -v ON_ERROR_STOP=1 2>&1; }
  printf '%s\n' "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;" "SELECT pg_export_snapshot();" 1>&"${SNAP[1]}"
  if ! IFS= read -r -t 30 line <&"${SNAP[0]:-0}" || [[ ! "$line" =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]]; then
    SNAPSHOT="${line:-no answer in 30 seconds}"
    snapshot_close
    return 1
  fi
  SNAPSHOT="$line"
}

# Lines of output for one query inside the snapshot's transaction.
snapshot_query() { # sql
  local line
  if [[ -z "${SNAP[1]:-}" ]]; then
    echo "psql has exited" >&2
    return 1
  fi
  printf '%s\n' "$1" '\echo __end__' 1>&"${SNAP[1]}"
  while IFS= read -r -t "$SNAP_TIMEOUT" line <&"${SNAP[0]}"; do
    if [[ "$line" == __end__ ]]; then return 0; fi
    if [[ "$line" == *ERROR:* ]]; then
      printf '%s\n' "$line" >&2
      return 1
    fi
    printf '%s\n' "$line"
  done
  return 1
}

snapshot_close() {
  # bash unsets SNAP when psql has already exited.
  if [[ -n "${SNAP[1]:-}" ]]; then
    printf '%s\n' "ROLLBACK;" '\q' 1>&"${SNAP[1]}" || true
  fi
  if [[ -n "${SNAP_PID:-}" ]]; then wait "$SNAP_PID" 2>/dev/null || true; fi
}

# The newest applied migration ("none" before the first), and every table's exact row count.
HEAD_SQL="SELECT CASE WHEN to_regclass('schema_migration') IS NULL THEN 'none'
  ELSE coalesce((SELECT max(name) FROM schema_migration), 'none') END;"
COUNTS_SQL="SELECT format('%s.%s', schemaname, tablename) || '|' ||
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text
  FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1;"

release_of() { # env
  local link
  link="$(readlink "$ROOT/$1/current" 2>/dev/null || true)"
  if [[ -n "$link" ]]; then basename "$link"; else echo none; fi
}

# Keep the newest $KEEP entries matching a pattern (names sort by their UTC time).
keep_newest() { # dir pattern [also-remove-suffix]
  find "$1" -mindepth 1 -maxdepth 1 -name "$2" -printf '%f\n' | LC_ALL=C sort -r |
    tail -n +$((KEEP + 1)) | while IFS= read -r old; do
      rm -rf "${1:?}/$old"
      if [[ -n "${3:-}" ]]; then rm -f "${1:?}/${old%.*}$3"; fi
      say "removed old $1/$old"
    done
}

# ---------------------------------------------------------------------------------------

dump_database() { # env
  local env="$1" dir="$BACKUPS/$1" name db file meta head counts tables started took bytes sum
  name="nightly-$STAMP"
  file="$dir/$name.dump"
  meta="$dir/$name.json"
  db="$(env_value "$env" DB_NAME)"
  if [[ -z "$db" ]]; then
    fail "$env database: no DB_NAME in $ROOT/$env/shared/.env"
    return
  fi
  install -d -m 700 "$dir"
  started="$(now)"
  if ! snapshot_open "$env"; then
    fail "$env database: cannot reach $db: $SNAPSHOT"
    return
  fi
  if ! with_db "$env" "$PG_DUMP" --format=custom --no-owner --snapshot="$SNAPSHOT" \
    --file="$file.partial" 2>"$dir/$name.err"; then
    snapshot_close
    fail "$env database: pg_dump of $db failed ($(tail -n 1 "$dir/$name.err"))"
    rm -f "$file.partial"
    return
  fi
  rm -f "$dir/$name.err"
  # Into files, not $(...): the coprocess's pipes are not open in a subshell.
  if ! snapshot_query "$HEAD_SQL" >"$dir/$name.head" 2>"$dir/$name.err" ||
    ! snapshot_query "$COUNTS_SQL" >"$dir/$name.counts" 2>"$dir/$name.err"; then
    snapshot_close
    fail "$env database: the row counts of $db could not be read ($(tail -n 1 "$dir/$name.err"))"
    rm -f "$file.partial" "$dir/$name".{err,head,counts}
    return
  fi
  snapshot_close
  head="$(head -n 1 "$dir/$name.head")"
  counts="$(cat "$dir/$name.counts")"
  rm -f "$dir/$name".{err,head,counts}
  if ! "$PG_RESTORE" --list "$file.partial" >/dev/null 2>&1; then
    fail "$env database: the dump of $db cannot be read back by pg_restore"
    rm -f "$file.partial"
    return
  fi
  mv -f "$file.partial" "$file"
  took=$(($(now) - started))
  bytes="$(stat -c %s "$file")"
  sum="$(sha256sum "$file" | cut -d' ' -f1)"
  tables="$(printf '%s\n' "$counts" | jq -R 'select(length > 0) | capture("^(?<t>.*)\\|(?<n>[0-9]+)$") | {(.t): (.n | tonumber)}' | jq -s 'add // {}')"
  jq -n --arg env "$env" --arg db "$db" --arg file "$(basename "$file")" --arg sha256 "$sum" \
    --argjson bytes "$bytes" --arg head "$head" --arg release "$(release_of "$env")" \
    --arg taken_at "$(date -u -d "@$started" +%Y-%m-%dT%H:%M:%SZ)" --argjson seconds "$took" \
    --argjson tables "$tables" \
    '{env: $env, database: $db, file: $file, sha256: $sha256, bytes: $bytes,
      migration_head: $head, release: $release, taken_at: $taken_at, seconds: $seconds, tables: $tables}' >"$meta"
  ITEMS+=("$(jq -c '{kind: "database"} + del(.tables) + {tables: (.tables | length)}' "$meta")")
  say "$env database: $file ($bytes bytes, ${took}s, migrations at $head)"
  keep_newest "$dir" 'nightly-*.dump' .json
}

snapshot_media() { # env
  local env="$1" src="$ROOT/$1/media" dir="$BACKUPS/$1/media" prev started took files
  if [[ ! -d "$src" ]]; then
    fail "$env media: $src does not exist"
    return
  fi
  install -d -m 700 "$dir"
  prev="$(find "$dir" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -printf '%f\n' | LC_ALL=C sort | tail -n 1)"
  started="$(now)"
  local link=()
  if [[ -n "$prev" ]]; then link=(--link-dest="$dir/$prev"); fi
  rm -rf "${dir:?}/$STAMP.partial"
  if ! "$RSYNC" -a --delete "${link[@]}" "$src/" "$dir/$STAMP.partial/" 2>"$dir/$STAMP.err"; then
    fail "$env media: rsync failed ($(tail -n 1 "$dir/$STAMP.err"))"
    rm -rf "${dir:?}/$STAMP.partial"
    return
  fi
  rm -f "$dir/$STAMP.err"
  mv -T "$dir/$STAMP.partial" "$dir/$STAMP"
  took=$(($(now) - started))
  files="$(find "$dir/$STAMP" -type f | wc -l)"
  ITEMS+=("$(jq -cn --arg env "$env" --arg dir "media/$STAMP" --argjson files "$files" --argjson seconds "$took" \
    '{kind: "media", env: $env, snapshot: $dir, files: $files, seconds: $seconds}')")
  say "$env media: $dir/$STAMP ($files files, ${took}s)"
  keep_newest "$dir" '20*Z'
}

offsite() {
  local target key port started dest
  target="$(value_in "$CONF" OFFSITE_TARGET)"
  if [[ -z "$target" ]]; then
    say "offsite: not set up (OFFSITE_TARGET in $CONF); every copy is on this server only"
    return
  fi
  key="$(value_in "$CONF" OFFSITE_SSH_KEY)"
  key="${key:-/root/.ssh/mycity-offsite}"
  port="$(value_in "$CONF" OFFSITE_PORT)"
  port="${port:-22}"
  # Always into a folder of our own under the target, so --delete can never reach anything else
  # there (a target of user@host: alone would otherwise be that user's whole home folder).
  dest="${target%/}"
  if [[ "$dest" == *: ]]; then dest="${dest}mycity-backups/"; else dest="$dest/mycity-backups/"; fi
  started="$(now)"
  # -H keeps the media snapshots' hard links, so the copy is the same size as the original.
  if "$RSYNC" -aH --delete --exclude='*.partial' --exclude='*.err' \
    -e "ssh -i $key -p $port -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20" \
    "$BACKUPS/" "$dest" 2>"$BACKUPS/offsite.err"; then
    rm -f "$BACKUPS/offsite.err"
    ITEMS+=("$(jq -cn --arg target "$dest" --argjson seconds "$(($(now) - started))" \
      '{kind: "offsite", target: $target, seconds: $seconds}')")
    say "offsite: copied to $dest in $(($(now) - started))s"
  else
    # ssh's own reason (host key, refused, no route) is more use than rsync's closing line.
    local why
    why="$(grep -m 1 -vE '^(rsync( error)?:|@+$)' "$BACKUPS/offsite.err" || true)"
    fail "offsite: rsync to $dest failed (${why:-$(tail -n 1 "$BACKUPS/offsite.err")})"
  fi
}

alert() { # text
  if [[ ! -f "$ALERT" ]]; then
    say "$ALERT is missing (re-run provisioning): nobody is told about this failure"
    return
  fi
  say "$(node "$ALERT" --settings="$ROOT/prod/shared/.env" "$1" 2>&1)"
}

# ---------------------------------------------------------------------------------------

[[ -d "$BACKUPS" ]] || {
  say "$BACKUPS does not exist; run ops/provision/provision.sh first"
  exit 1
}
say "started $STARTED for: ${ENVS[*]}"

for e in "${ENVS[@]}"; do dump_database "$e"; done
for e in "${ENVS[@]}"; do snapshot_media "$e"; done
offsite

ok=true
if ((${#FAILURES[@]})); then ok=false; fi
{
  printf '%s\n' "${ITEMS[@]}" | jq -s . >"$BACKUPS/.items.json" 2>/dev/null || echo '[]' >"$BACKUPS/.items.json"
  printf '%s\n' "${FAILURES[@]}" | jq -R . | jq -s 'map(select(length > 0))' >"$BACKUPS/.failures.json"
  jq -n --argjson ok "$ok" --arg started "$STARTED" --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --slurpfile items "$BACKUPS/.items.json" --slurpfile failures "$BACKUPS/.failures.json" \
    '{ok: $ok, started_at: $started, finished_at: $finished, items: $items[0], failures: $failures[0]}' \
    >"$BACKUPS/last-run.json"
  rm -f "$BACKUPS/.items.json" "$BACKUPS/.failures.json"
}

if [[ "$ok" == true ]]; then
  say "done: ${#ITEMS[@]} item(s) backed up"
  exit 0
fi
alert "MyCity backup FAILED on $(hostname) at $STARTED: $(printf '%s; ' "${FAILURES[@]}")see journalctl -u mycity-backup"
say "finished with ${#FAILURES[@]} failure(s)"
exit 1

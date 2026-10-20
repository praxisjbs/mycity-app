#!/usr/bin/env bash
# MyCity App · server provisioning for a fresh Ubuntu 24.04 (SYSTEM_ARCHITECTURE §1, §9.5;
# docs/runbooks/server-setup.md).
#
# One server carries production and staging side by side. This installs everything any
# milestone needs, so no later milestone is a server change:
#
#   Node 20 · PostgreSQL 16 + pgvector · Redis · Chrome (PDFs) · ffmpeg · ClamAV · fonts
#   nginx + Let's Encrypt for the four hosts · ufw · fail2ban · unattended upgrades · swap
#
# and lays out the two environments:
#
#   users      mycity-prod, mycity-stg (run the services; cannot read each other's files)
#              mycity-deploy (CI's only login; forced to deploy-gate by authorized_keys)
#   databases  mycity_prod (role mycity_prod_app), mycity_stg (role mycity_stg_app);
#              no cross-grants; extensions created by the superuser
#   redis      one instance, password, db 0 production, db 1 staging, noeviction (BullMQ)
#   files      /srv/mycity/<prod|stg>/{releases,shared/.env,media}, /srv/mycity/bin,
#              /srv/mycity/backups/<prod|stg>
#   systemd    mycity-{api,worker}-{prod,stg}, enabled; deploy-gate starts them
#              mycity-backup.timer (nightly) and mycity-restore-drill.timer (Sundays), started;
#              mycity-health-watch-{prod,stg}.timer (every 5 minutes) and mycity-host-stats.timer
#              (every 15 minutes, for Settings · Performance), started
#
# Run it from a checkout of the repository, as root:
#
#   sudo LE_EMAIL=ops@mycityapp.io bash ops/provision/provision.sh
#
# Optional settings (environment variables):
#   LE_EMAIL             Let's Encrypt account email. Without it, TLS is skipped.
#   MYCITY_PUBLIC_IP     this server's public IPv4, if detection gets it wrong.
#   STAGING_DEPLOY_KEY   public key CI's staging job deploys with  } both, or neither:
#   PROD_DEPLOY_KEY      public key CI's production job deploys with }  installs authorized_keys
#
# Safe to run again: nothing generated is regenerated (secrets live in /root/mycity-secrets),
# an existing .env is never overwritten, and a host whose DNS was not ready the first time
# gets its certificate on the next run.

set -euo pipefail
umask 022

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$OPS/.." && pwd)"
SECRETS=/root/mycity-secrets
ENVS=(prod stg)
declare -A APP_ENV=([prod]=production [stg]=staging)
declare -A HOSTS=([prod]="hub.mycityapp.io go.mycityapp.io" [stg]="hub.staging.mycityapp.io go.staging.mycityapp.io")
UNITS=(mycity-api-prod mycity-worker-prod mycity-api-stg mycity-worker-stg)
TIMERS=(mycity-backup mycity-restore-drill mycity-host-stats mycity-health-watch-prod mycity-health-watch-stg)
NODE_MAJOR=20
NODE_MIN=20.19.0

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\nprovision: %s\n' "$*" >&2; exit 1; }
LEFT=()
later() { LEFT+=("$*"); note "LATER: $*"; }

[[ $EUID -eq 0 ]] || die "run as root: sudo bash $0"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || die "written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}"
[[ "$(dpkg --print-architecture)" == amd64 ]] || die "Chrome is packaged for amd64 only"
for f in nginx/mycity.conf systemd/prod.env.template systemd/mycity-api-prod.service systemd/mycity-backup.timer ssh/authorized_keys.template; do
  [[ -s "$OPS/$f" ]] || die "ops/$f is missing or empty; run this from a full checkout"
done
export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
install -d -m 700 "$SECRETS"
cd /tmp # psql as postgres cannot read root's working directory

# A generated secret: hex of N random bytes, made once and reused on every later run.
secret() {
  local file="$SECRETS/$1"
  if [[ ! -s "$file" ]]; then
    openssl rand -hex "$2" >"$file"
    chmod 600 "$file"
  fi
  cat "$file"
}

apt_repo() { # name key-url line
  local key="/etc/apt/keyrings/$1.gpg"
  install -d -m 755 /etc/apt/keyrings
  [[ -s "$key" ]] || curl -fsSL "$2" | gpg --dearmor --yes -o "$key"
  printf '%s\n' "$3" >"/etc/apt/sources.list.d/$1.list"
}

# ---------------------------------------------------------------------------------------
step "1/12 Base system"
apt-get update -q
"${APT[@]}" upgrade
"${APT[@]}" install ca-certificates curl gnupg openssl git rsync jq acl \
  build-essential python3 ufw fail2ban unattended-upgrades
timedatectl set-ntp true || true
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
install -d /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/mycity.conf <<'CONF'
[Journal]
SystemMaxUse=2G
CONF
systemctl restart systemd-journald
if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  note "4 GB swap file added"
fi

# ---------------------------------------------------------------------------------------
step "2/12 Node $NODE_MAJOR"
if ! node -v 2>/dev/null | grep -q "^v$NODE_MAJOR\."; then
  apt_repo nodesource https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main"
  apt-get update -q
  "${APT[@]}" install nodejs
fi
node -e "const [a,b]=process.versions.node.split('.').map(Number),[x,y]='$NODE_MIN'.split('.').map(Number);process.exit(a===x&&b>=y?0:1)" ||
  die "Node $(node -v) is older than $NODE_MIN (package.json engines)"
note "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------------------------------
step "3/12 PostgreSQL 16 + pgvector, Redis, ffmpeg, ClamAV, nginx, certbot, fonts"
"${APT[@]}" install postgresql-16 postgresql-16-pgvector redis-server ffmpeg \
  clamav clamav-daemon clamav-freshclam nginx certbot \
  fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji fontconfig

# ---------------------------------------------------------------------------------------
step "4/12 Chrome for PDF rendering"
# Ubuntu's chromium is a snap, which cannot run as a service user under /srv. Google's
# package is a plain binary at /usr/bin/google-chrome-stable (CHROMIUM_PATH in the .env).
if [[ ! -x /usr/bin/google-chrome-stable ]]; then
  apt_repo google-chrome https://dl.google.com/linux/linux_signing_key.pub \
    "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main"
  apt-get update -q
  "${APT[@]}" install google-chrome-stable
fi
note "$(/usr/bin/google-chrome-stable --version)"
if compgen -G "$REPO/assets/fonts/*.[ot]tf" >/dev/null; then
  install -d /usr/local/share/fonts/mycity
  cp "$REPO"/assets/fonts/*.[ot]tf /usr/local/share/fonts/mycity/
  note "brand fonts installed from assets/fonts"
else
  later "assets/fonts is empty: PDFs use the fallback fonts until Geist is added and this is re-run"
fi
fc-cache -f >/dev/null

# ---------------------------------------------------------------------------------------
step "5/12 Users and directories"
for e in "${ENVS[@]}"; do
  id "mycity-$e" &>/dev/null ||
    useradd --system --user-group --home-dir "/srv/mycity/$e" --no-create-home --shell /usr/sbin/nologin "mycity-$e"
done
id mycity-deploy &>/dev/null ||
  useradd --user-group --create-home --home-dir /home/mycity-deploy --shell /bin/bash mycity-deploy
# deploy-gate reads both .env files (migrations, pre-deploy dumps) and writes both releases.
usermod -aG mycity-prod,mycity-stg mycity-deploy

install -d -m 755 -o root -g root /srv/mycity /srv/mycity/bin
install -d -m 750 -o mycity-deploy -g mycity-deploy /srv/mycity/backups
for e in "${ENVS[@]}"; do
  # deploy-gate switches the environment's `current` link, so it owns the environment's folder;
  # shared/ (the .env) stays root's, readable by the environment's group.
  install -d -m 750 -o mycity-deploy -g "mycity-$e" "/srv/mycity/$e"
  install -d -m 750 -o root -g "mycity-$e" "/srv/mycity/$e/shared"
  install -d -m 2750 -o mycity-deploy -g "mycity-$e" "/srv/mycity/$e/releases"
  install -d -m 750 -o "mycity-$e" -g "mycity-$e" "/srv/mycity/$e/media"
  install -d -m 700 -o mycity-deploy -g mycity-deploy "/srv/mycity/backups/$e"
done
# The server's own tools, root-owned in /srv/mycity/bin: deploy-gate (CI's forced command), the
# nightly backup and the restore drill (their timers are set up in step 10), the alert sender
# those two use, and the host figures Settings · Performance reads from /var/lib/mycity.
install -d -m 755 -o root -g root /var/lib/mycity
for tool in scripts/deploy/deploy-gate:deploy-gate scripts/db/backup.sh:mycity-backup \
  scripts/db/restore-drill.js:mycity-restore-drill src/shared/observability/alert.js:mycity-alert \
  ops/monitoring/host-stats.sh:mycity-host-stats; do
  if [[ -s "$REPO/${tool%%:*}" ]]; then
    install -m 755 -o root -g root "$REPO/${tool%%:*}" "/srv/mycity/bin/${tool##*:}"
    note "${tool##*:} installed"
  else
    later "${tool%%:*} is missing or empty: re-run this from a full checkout to install it"
  fi
done

# ---------------------------------------------------------------------------------------
step "6/12 PostgreSQL"
mem_gb=$(awk '/^MemTotal/ { printf "%d", $2 / 1048576 }' /proc/meminfo)
cat >/etc/postgresql/16/main/conf.d/mycity.conf <<CONF
# MyCity App (ops/provision/provision.sh). ${mem_gb} GB RAM shared with Redis, Chrome,
# ClamAV and four Node processes; pools are 20 per API and 10 per worker.
listen_addresses = 'localhost'
max_connections = 200
shared_buffers = $((mem_gb / 4))GB
effective_cache_size = $((mem_gb * 3 / 5))GB
work_mem = 16MB
maintenance_work_mem = 512MB
random_page_cost = 1.1
wal_compression = on
log_min_duration_statement = 1000
timezone = 'UTC'
# Settings · Performance, Slowest Queries: every statement's time, normalised ($1, never the
# values). Loaded at start, so the restart below is what turns it on.
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = top
pg_stat_statements.max = 5000
CONF
systemctl enable postgresql >/dev/null
systemctl restart postgresql

pg() { sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }
for e in "${ENVS[@]}"; do
  role="mycity_${e}_app"
  db="mycity_$e"
  pw="$(secret "db_$e" 24)"
  # The password goes in on stdin, never on a command line another user could see.
  if pg -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$role'" | grep -q 1; then
    printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$role" "$pw" | pg
  else
    printf "CREATE ROLE %s WITH LOGIN PASSWORD '%s';\n" "$role" "$pw" | pg
  fi
  pg -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1 ||
    sudo -u postgres createdb --owner="$role" --encoding=UTF8 --template=template0 --locale=C.UTF-8 "$db"
  # Only this environment's role may connect. The migrations run as that role, so it owns
  # the public schema; the extensions are created here because pgvector and
  # pg_stat_statements are not trusted extensions (migration 0001's CREATE EXTENSION IF NOT
  # EXISTS then finds vector; Settings · Performance reads pg_stat_statements if it is there).
  pg -d "$db" <<SQL
REVOKE ALL ON DATABASE $db FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE $db TO $role;
ALTER SCHEMA public OWNER TO $role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
  note "$db ready, owned by $role"
done

# ---------------------------------------------------------------------------------------
step "7/12 Redis"
redis_pw="$(secret redis 24)"
cat >/etc/redis/mycity.conf <<CONF
# MyCity App (ops/provision/provision.sh). db 0 production, db 1 staging; keys are also
# prefixed mycity:prod / mycity:stg. BullMQ requires noeviction: an evicted job key is a
# lost job.
bind 127.0.0.1 -::1
protected-mode yes
port 6379
supervised systemd
requirepass $redis_pw
maxmemory 2gb
maxmemory-policy noeviction
appendonly yes
appendfsync everysec
CONF
chown root:redis /etc/redis/mycity.conf
chmod 640 /etc/redis/mycity.conf
grep -qx 'include /etc/redis/mycity.conf' /etc/redis/redis.conf ||
  printf '\ninclude /etc/redis/mycity.conf\n' >>/etc/redis/redis.conf
systemctl enable redis-server >/dev/null
systemctl restart redis-server
REDISCLI_AUTH="$redis_pw" redis-cli ping | grep -q PONG || die "redis does not answer"

# ---------------------------------------------------------------------------------------
step "8/12 ClamAV"
# clamd will not start without signatures, so fetch them once before starting it.
if ! compgen -G "/var/lib/clamav/*.c[lv]d" >/dev/null; then
  systemctl stop clamav-freshclam || true
  freshclam --quiet || later "freshclam could not download signatures; clamd starts once it has them"
fi
systemctl enable --now clamav-freshclam >/dev/null
systemctl enable clamav-daemon >/dev/null
systemctl restart clamav-daemon || later "clamav-daemon did not start (signatures still downloading?): systemctl status clamav-daemon"

# ---------------------------------------------------------------------------------------
step "9/12 Environment files"
render() { # template target env
  local tmp
  tmp="$(mktemp)"
  sed -e "s|@@DB_PASSWORD@@|$(secret "db_$3" 24)|" \
    -e "s|@@REDIS_PASSWORD@@|$redis_pw|" \
    -e "s|@@JWT_ACCESS_SECRET@@|$(secret "jwt_access_$3" 48)|" \
    -e "s|@@JWT_REFRESH_SECRET@@|$(secret "jwt_refresh_$3" 48)|" \
    -e "s|@@ENCRYPTION_KEY@@|$(secret "encryption_$3" 32)|" \
    -e "s|@@METRICS_TOKEN@@|$(secret "metrics_$3" 24)|" \
    "$1" >"$tmp"
  if grep -q '@@' "$tmp"; then die "$1 has a placeholder this script does not fill"; fi
  install -m 640 -o root -g "mycity-$3" "$tmp" "$2"
  rm -f "$tmp"
}
for e in "${ENVS[@]}"; do
  target="/srv/mycity/$e/shared/.env"
  if [[ -e "$target" ]]; then
    note "$target exists, left as it is"
  else
    render "$OPS/systemd/$e.env.template" "$target" "$e"
    note "$target written"
  fi
  if grep -q '^SMTP_HOST=$' "$target" || grep -q '^SMTP_PASSWORD=$' "$target"; then
    later "fill SMTP_* in $target (${APP_ENV[$e]} refuses to boot without mail)"
  fi
  if ! grep -q '^MAIL_SEND_PER_HOUR=[1-9]' "$target"; then
    later "add MAIL_SEND_PER_HOUR to $target (production 40, staging 10; ${APP_ENV[$e]} refuses to boot without it)"
  fi
done

# ---------------------------------------------------------------------------------------
step "10/12 systemd units and deploy access"
for u in "${UNITS[@]}"; do
  install -m 644 "$OPS/systemd/$u.service" "/etc/systemd/system/$u.service"
done
for t in "${TIMERS[@]}"; do
  install -m 644 "$OPS/systemd/$t.service" "/etc/systemd/system/$t.service"
  install -m 644 "$OPS/systemd/$t.timer" "/etc/systemd/system/$t.timer"
done
systemctl daemon-reload
systemctl enable "${UNITS[@]/%/.service}" >/dev/null
note "units enabled; they start with the first deploy (no release in /srv/mycity/*/current yet)"
systemctl enable --now "${TIMERS[@]/%/.timer}" >/dev/null
note "backup nightly at 02:30, restore drill on Sundays at 04:00 (Lagos), health watch every 5 minutes, host figures every 15 minutes: systemctl list-timers 'mycity-*'"

# Where the nightly backup sends its offsite copy. Written once, commented out, for the operator
# to fill (docs/runbooks/backup-restore.md §2); never overwritten.
install -d -m 700 /etc/mycity
if [[ ! -e /etc/mycity/backup.env ]]; then
  cat >/etc/mycity/backup.env <<'CONF'
# MyCity nightly backup: the offsite copy (scripts/db/backup.sh, docs/runbooks/backup-restore.md).
# Until OFFSITE_TARGET is set, every backup lives on this server only.
#OFFSITE_TARGET=mycity-offsite@203.0.113.10:
#OFFSITE_SSH_KEY=/root/.ssh/mycity-offsite
#OFFSITE_PORT=22
CONF
  chmod 600 /etc/mycity/backup.env
fi
if ! grep -q '^OFFSITE_TARGET=.' /etc/mycity/backup.env; then
  later "offsite backups: set OFFSITE_TARGET in /etc/mycity/backup.env (docs/runbooks/backup-restore.md §2)"
fi

cat >/etc/sudoers.d/mycity-deploy <<'CONF'
# deploy-gate runs as mycity-deploy. It may restart the four MyCity units and run Node as an
# environment's own user (migrations, verification), and nothing else as root.
Cmnd_Alias MYCITY_UNITS = /usr/bin/systemctl restart mycity-api-prod.service, \
                          /usr/bin/systemctl restart mycity-worker-prod.service, \
                          /usr/bin/systemctl restart mycity-api-stg.service, \
                          /usr/bin/systemctl restart mycity-worker-stg.service, \
                          /usr/bin/systemctl is-active mycity-api-prod.service, \
                          /usr/bin/systemctl is-active mycity-worker-prod.service, \
                          /usr/bin/systemctl is-active mycity-api-stg.service, \
                          /usr/bin/systemctl is-active mycity-worker-stg.service
mycity-deploy ALL=(root) NOPASSWD: MYCITY_UNITS
mycity-deploy ALL=(mycity-prod,mycity-stg) NOPASSWD: /usr/bin/node
CONF
chmod 440 /etc/sudoers.d/mycity-deploy
visudo -cqf /etc/sudoers.d/mycity-deploy || { rm -f /etc/sudoers.d/mycity-deploy; die "sudoers rule did not validate"; }

ssh_dir=/home/mycity-deploy/.ssh
install -d -m 700 -o mycity-deploy -g mycity-deploy "$ssh_dir"
if [[ -n "${STAGING_DEPLOY_KEY:-}" && -n "${PROD_DEPLOY_KEY:-}" ]]; then
  sed -e "s|@@STAGING_DEPLOY_KEY@@|$STAGING_DEPLOY_KEY|" -e "s|@@PROD_DEPLOY_KEY@@|$PROD_DEPLOY_KEY|" \
    "$OPS/ssh/authorized_keys.template" >"$ssh_dir/authorized_keys"
  chown mycity-deploy:mycity-deploy "$ssh_dir/authorized_keys"
  chmod 600 "$ssh_dir/authorized_keys"
  note "deploy keys installed"
elif [[ ! -s "$ssh_dir/authorized_keys" ]]; then
  later "no deploy keys yet: re-run with STAGING_DEPLOY_KEY and PROD_DEPLOY_KEY when release.yml is set up"
fi

# ---------------------------------------------------------------------------------------
step "11/12 Firewall and SSH protection"
# Allow whatever port sshd really listens on before enabling the firewall, so a server
# with SSH on a custom port does not lock you out.
for p in $(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }'); do ufw allow "$p/tcp" >/dev/null; done
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null
note "ufw: ssh, 80 and 443 open; Postgres, Redis, clamd and the Node ports stay local"

# ---------------------------------------------------------------------------------------
step "12/12 nginx and TLS"
install -d -m 755 /var/www/letsencrypt
# The files listen on IPv4 and IPv6; on a server with IPv6 switched off the [::] lines would
# stop nginx from starting, so they are left out there.
nginx_conf() { # source target
  if [[ -e /proc/net/if_inet6 ]]; then
    install -m 644 "$1" "$2"
  else
    grep -v 'listen \[::\]' "$1" >"$2"
    chmod 644 "$2"
  fi
}
nginx_conf "$OPS/nginx/mycity.conf" /etc/nginx/conf.d/mycity.conf
rm -f /etc/nginx/sites-enabled/default
# Ubuntu's nginx.conf sets ssl_protocols (TLS 1.0 and 1.1 included) and ssl_prefer_server_ciphers
# itself; mycity.conf sets them in the same http block, which nginx refuses as a duplicate. The
# distribution's two lines are commented out, so ours (TLS 1.2 and 1.3 only) are the ones in force.
sed -i -E 's/^([[:space:]]*)(ssl_protocols|ssl_prefer_server_ciphers)([[:space:]])/\1# set in conf.d\/mycity.conf: \2\3/' /etc/nginx/nginx.conf
nginx -t -q || die "nginx refuses the configuration (sudo nginx -t shows why)"
systemctl enable nginx >/dev/null
systemctl reload-or-restart nginx

public_ip="${MYCITY_PUBLIC_IP:-$(curl -4fsS --max-time 5 https://api.ipify.org || true)}"
[[ -n "$public_ip" ]] || public_ip="$(ip -4 route get 1.1.1.1 | awk '{ for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1) }')"
note "this server: $public_ip"

install -d /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/mycity-reload-nginx <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/mycity-reload-nginx

for e in "${ENVS[@]}"; do
  for host in ${HOSTS[$e]}; do
    nginx_conf "$OPS/nginx/$host.conf" "/etc/nginx/sites-available/$host.conf"
    if [[ ! -s "/etc/letsencrypt/live/$host/fullchain.pem" ]]; then
      if ! getent ahostsv4 "$host" | awk '{ print $1 }' | grep -qx "$public_ip"; then
        later "DNS: $host does not point at $public_ip yet; add the A record, then re-run"
        continue
      fi
      if [[ -z "${LE_EMAIL:-}" ]]; then
        later "TLS for $host skipped: re-run with LE_EMAIL=<address>"
        continue
      fi
      certbot certonly --webroot -w /var/www/letsencrypt -d "$host" \
        --non-interactive --agree-tos -m "$LE_EMAIL" --quiet ||
        { later "certbot failed for $host: see /var/log/letsencrypt/letsencrypt.log"; continue; }
    fi
    ln -sf "/etc/nginx/sites-available/$host.conf" "/etc/nginx/sites-enabled/$host.conf"
    note "$host enabled"
  done
done
nginx -t -q || die "nginx refuses the configuration (sudo nginx -t shows why)"
systemctl reload nginx

# ---------------------------------------------------------------------------------------
step "Done"
note "node $(node -v) · $(psql --version | awk '{ print $1, $3 }') · redis $(redis-server --version | awk '{ print $3 }' | cut -d= -f2)"
note "$(/usr/bin/google-chrome-stable --version) · $(ffmpeg -version | awk 'NR == 1 { print $1, $3 }') · $(clamd --version | cut -d/ -f1) · $(nginx -v 2>&1 | cut -d: -f2 | tr -d ' ')"
note "secrets: $SECRETS (root only). Back that folder up somewhere safe: the encryption keys"
note "cannot be regenerated without losing every encrypted value."
if [[ -e /var/run/reboot-required ]]; then
  later "the upgrade wants a reboot: sudo reboot (the units come back on their own)"
fi
if ((${#LEFT[@]})); then
  printf '\n\033[1mStill to do:\033[0m\n'
  printf '   - %s\n' "${LEFT[@]}"
fi

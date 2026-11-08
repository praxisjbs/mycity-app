#!/usr/bin/env bash
# Chromium's system libraries for one screens job in CI (.github/workflows/ci.yml).
#
# Every screens job of a run needs the same .deb files from the runner's apt mirror, and the mirror
# serves some jobs in seconds and others slowly or not at all (06/11/2026: four jobs nine minutes,
# four under 25 seconds; 07/11/2026: three jobs could not fetch two font packages, in seconds). So
# the jobs race, and the first to have the set shares it with the rest of the run:
#
#   1. This runner image's set from the cache, when the cache holds it.
#   2. Otherwise every job installs from the mirror and, every 3 seconds while it does, looks for a
#      set another job of this run has shared. The moment one is there, the job stops its own
#      install and installs the shared files without going to the mirror.
#   3. A try that fails is tried once more, still watching; after the second, the job keeps
#      watching for up to WAIT_SHARED seconds before it gives up on the others.
#   4. Only then the last resort: Playwright's own list from a fresh package index with
#      --fix-missing, less the Japanese, Chinese and Thai fonts (OPTIONAL_FONTS), which no screen of
#      the hub or the public site uses.
#
# No job refuses to share. Whatever set a job installed itself (from the cache, the mirror or the
# last resort) is put in ~/chromium-share and named in $GITHUB_OUTPUT `share`; the next step
# uploads it as an artifact of the run at once: $SHARED for the whole set, $SHARED-lite for the
# last resort's. A job looking for a set takes the whole one first, the lite one when that is all
# there is. Only the whole set is kept in ~/chromium-debs, which the cache saves for the next run.
# Two jobs finishing at the same moment may both upload; the first artifact listed is taken.
#
# A try is capped at five minutes, and the apt-get it started is stopped before the next. apt itself
# retries a stalled fetch and waits for its lock (ci.yml's "apt retries a stalled mirror").
#
# Needs: SHARED (the artifact's name), GH_TOKEN (actions: read), GITHUB_RUN_ID, GITHUB_REPOSITORY,
# GITHUB_OUTPUT. Writes `source` (cache, mirror, shared, shared-lite, fallback) and `share`.
set -u

DEBS="$HOME/chromium-debs"
SHARE_DIR="$HOME/chromium-share"
POLL=3
WAIT_SHARED="${WAIT_SHARED:-240}"
out() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }

# Fonts Playwright lists for pages in other scripts; the gates render English, with emoji.
OPTIONAL_FONTS="fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf"

# Playwright's apt package list for Chromium, as its own install would ask for (its dry run).
playwright_packages() {
  npx playwright install-deps --dry-run chromium 2>/dev/null |
    sed -n 's/.*--no-install-recommends \(.*\)"$/\1/p' | tr ' ' '\n' | grep -v '^$'
}

# The apt-get an ended try left running holds the lock: stop it and let it go.
stop_apt() {
  sudo pkill -x apt-get || true
  for _ in $(seq 30); do pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null || break; sleep 2; done
  sudo dpkg --configure -a || true
}

# Hand a set this job installed to the next step, which uploads it as $1.
share() {
  rm -rf "$SHARE_DIR" && mkdir -p "$SHARE_DIR"
  cp "$2"/*.deb "$SHARE_DIR"/ 2>/dev/null || true
  if ls "$SHARE_DIR"/*.deb >/dev/null 2>&1; then out share "$1"; fi
}

# The newest debs apt downloaded, as a set to share (the cache's archive holds what this job fetched).
fetched() {
  rm -rf "$1" && mkdir -p "$1"
  cp /var/cache/apt/archives/*.deb "$1"/ 2>/dev/null || true
}

# A set another job of this run shared, unpacked in $1: the whole set first, else the lite one.
# Prints which it took (shared, shared-lite); fails while there is none.
find_shared() {
  local name id
  for name in "$SHARED" "$SHARED-lite"; do
    id=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts?name=$name" --jq '.artifacts | map(select(.expired | not)) | .[0].id // empty' 2>/dev/null)
    [ -n "$id" ] || continue
    rm -rf "$1" && mkdir -p "$1"
    gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$id/zip" > "$1.zip" 2>/dev/null || continue
    unzip -o -q "$1.zip" -d "$1" 2>/dev/null || continue
    rm -f "$1.zip"
    ls "$1"/*.deb >/dev/null 2>&1 || continue
    [ "$name" = "$SHARED" ] && echo shared || echo shared-lite
    return 0
  done
  return 1
}

# Install the shared set in $1 (taken as $2) and finish; a set that does not install is ignored.
use_shared() {
  if sudo apt-get install -y -q --no-download "$1"/*.deb; then
    if [ "$2" = shared ]; then rm -rf "$DEBS" && cp -r "$1" "$DEBS"; fi
    echo "Chromium's system libraries from another job of this run ($2)"
    out source "$2"
    exit 0
  fi
  echo "::warning::The shared set did not install here; carrying on with the mirror"
  return 1
}

# 1. This image's set from the cache. Shared too: a job of this run whose cache missed takes it.
if ls "$DEBS"/*.deb >/dev/null 2>&1 && sudo apt-get install -y -q --no-download "$DEBS"/*.deb; then
  echo "Chromium's system libraries from the cache"
  share "$SHARED" "$DEBS"
  out source cache
  exit 0
fi

got="$(mktemp -d)"
tried_shared=""
for attempt in 1 2; do
  # 2. From the mirror, watching for another job's set while it runs.
  timeout 300 npx playwright install-deps chromium &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ -z "$tried_shared" ] && which="$(find_shared "$got")"; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      stop_apt
      use_shared "$got" "$which" || tried_shared=1
      break
    fi
    sleep "$POLL"
  done
  if wait "$pid"; then
    # This job had the whole set first: keep it for the cache and hand it to the others.
    fetched "$DEBS"
    share "$SHARED" "$DEBS"
    echo "Chromium's system libraries from the mirror"
    out source mirror
    exit 0
  fi
  echo "::warning::Installing Chromium's system libraries did not finish (try $attempt of 2)"
  stop_apt
done

# 3. The mirror failed this job twice: another job may still get the set, so wait for it a while.
if [ -z "$tried_shared" ]; then
  for _ in $(seq $((WAIT_SHARED / POLL))); do
    if which="$(find_shared "$got")"; then use_shared "$got" "$which" || true; break; fi
    sleep "$POLL"
  done
fi

# 4. The last resort: everything but the optional fonts, from a fresh index; shared as the lite set.
packages="$(playwright_packages | grep -vxF -f <(tr ' ' '\n' <<<"$OPTIONAL_FONTS"))"
if [ -n "$packages" ]; then
  # shellcheck disable=SC2086 # one word a package
  if timeout 300 sudo apt-get update -q && timeout 300 sudo apt-get install -y -q --no-install-recommends --fix-missing $packages; then
    fetched "$got"
    share "$SHARED-lite" "$got"
    echo "::warning::Chromium's system libraries installed without the optional fonts ($OPTIONAL_FONTS): the runner's apt mirror could not serve them"
    out source fallback
    exit 0
  fi
  stop_apt
fi
echo "::error::Chromium's system libraries could not be installed: the runner's apt mirror could not serve them and no other job shared its set. Re-run the job."
exit 1

#!/usr/bin/env bash
# Chromium's system libraries for one screens job in CI (.github/workflows/ci.yml).
#
# Every screens job of a run needs the same .deb files from the runner's apt mirror, and the mirror
# is slow for some jobs and quick for others (06/11/2026: four jobs waited about nine minutes on it,
# four were done in under 25 seconds). So the jobs race, and the first to finish shares:
#
#   1. This runner image's set from the cache, when the cache holds it: done.
#   2. Otherwise each job installs from the mirror, and every 10 seconds looks for the run's shared
#      set (an artifact named $SHARED, one per runner image). Once it is there, the job downloads
#      it, stops its own install and installs the shared files without going to the mirror.
#   3. A job that finishes from the mirror first writes source=mirror to $GITHUB_OUTPUT; the next
#      step uploads its set as $SHARED for the others (and the cache keeps it for the next run).
#
# A try is capped at five minutes, and the apt-get it started is stopped before the next. apt itself
# retries a stalled fetch and waits for its lock (ci.yml's "apt retries a stalled mirror").
#
# Needs: SHARED (the artifact's name), GH_TOKEN (actions: read), GITHUB_RUN_ID, GITHUB_REPOSITORY,
# GITHUB_OUTPUT. Writes the set it used to ~/chromium-debs.
set -u

DEBS="$HOME/chromium-debs"
out() { echo "source=$1" >> "$GITHUB_OUTPUT"; }

# The apt-get an ended try left running holds the lock: stop it and let it go.
stop_apt() {
  sudo pkill -x apt-get || true
  for _ in $(seq 30); do pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null || break; sleep 2; done
  sudo dpkg --configure -a || true
}

# The shared set, once another job of this run has uploaded it: its files in $1, or a failure.
take_shared() {
  local n
  n=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts?name=$SHARED" --jq '.total_count' 2>/dev/null || echo 0)
  [ "${n:-0}" -gt 0 ] || return 1
  rm -rf "$1" && mkdir -p "$1"
  gh run download "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" --name "$SHARED" --dir "$1" >/dev/null 2>&1 || return 1
  ls "$1"/*.deb >/dev/null 2>&1
}

# 1. This image's set from the cache.
if ls "$DEBS"/*.deb >/dev/null 2>&1 && sudo apt-get install -y -q --no-download "$DEBS"/*.deb; then
  echo "Chromium's system libraries from the cache"
  out cache
  exit 0
fi

shared_dir="$(mktemp -d)"
for attempt in 1 2; do
  # 2. From the mirror, watching for another job's set while it runs.
  timeout 300 npx playwright install-deps chromium &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if take_shared "$shared_dir"; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      stop_apt
      if sudo apt-get install -y -q --no-download "$shared_dir"/*.deb; then
        rm -rf "$DEBS" && cp -r "$shared_dir" "$DEBS"
        echo "Chromium's system libraries from another job of this run ($SHARED)"
        out shared
        exit 0
      fi
      echo "::warning::The shared set did not install here; installing from the mirror"
      break
    fi
    sleep 10
  done
  # 3. This job finished first (or the shared set did not fit): keep its set to share.
  if wait "$pid"; then
    rm -rf "$DEBS" && mkdir -p "$DEBS"
    cp /var/cache/apt/archives/*.deb "$DEBS"/ 2>/dev/null || true
    echo "Chromium's system libraries from the mirror"
    out mirror
    exit 0
  fi
  echo "::warning::Installing Chromium's system libraries did not finish (try $attempt of 2)"
  stop_apt
done
echo "::error::Chromium's system libraries could not be installed in two tries: the runner's apt mirror stalled each time and no other job shared its set. Re-run the job."
exit 1

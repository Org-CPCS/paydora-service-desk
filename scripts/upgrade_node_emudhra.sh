#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# upgrade_node_emudhra.sh
#
# One-off: move this EC2 instance from Node 20 to Node 22 (22.23.4 or newer).
#
# Why: in October 2026 the private keys of eight eMudhra intermediate CAs were
# found to be recoverable from their public certificates, so anyone can forge a
# certificate for any domain that chains to "emSign ECC Root CA - G3". Node
# ships its own list of trusted roots and ignores Ubuntu's ca-certificates
# update. Node 20 is end-of-life: no Node 20 release drops that root or fixes
# the rest of the October 21, 2026 Node security release. 22.23.4 does both.
#
# Run it on the instance as the ubuntu user, after this file is deployed:
#   bash ~/paydora-service-desk/scripts/upgrade_node_emudhra.sh
# Add --yes to skip the confirmation prompt.
#
# What it does, stopping at the first failure:
#   1. Points the NodeSource apt source at node_22.x and installs nodejs.
#   2. Checks the new Node is 22.23.4+ and no longer trusts the emSign root.
#   3. Reinstalls the app's packages under the new Node (same step as
#      .github/workflows/deploy.yml).
#   4. Restarts PM2 itself (`pm2 update`) so the daemon, the app and
#      pm2-logrotate all run on the new binary, then saves the process list.
#   5. Waits for the app to come back on the new Node and stay up.
#
# Nothing restarts before step 4. Safe to re-run: it exits early once the
# running app is already on a fixed Node, and if an earlier run installed Node
# but failed later, it skips the apt steps and finishes the rest.
#
# The restart takes a few seconds, while the support bot stops answering.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── This app ─────────────────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-$HOME/paydora-service-desk}"
PM2_APP="paydora-support-bot"
RESTART_NOTE="The support bot stops answering for a few seconds."
# After the app first answers, wait this long and check it has not restarted.
# ecosystem.config.js waits 5s between restarts, so give a crash loop time to show.
STABLE_SECONDS=30

# Mirrors .github/workflows/deploy.yml.
REBUILD_STEPS="npm ci --omit=dev"

# The support bot has no HTTP server; staying up on the new Node is the check.
health_check() { return 0; }

# ── Shared ───────────────────────────────────────────────────────────────────
MIN_VERSION="22.23.4"
NODE_MAJOR="22"
BAD_ROOT="emSign ECC Root CA - G3"
KEYRING="/etc/apt/keyrings/nodesource.gpg"
SOURCE_LIST="/etc/apt/sources.list.d/nodesource.list"
LOG_FILE="$HOME/upgrade_node_emudhra.log"

ASSUME_YES=0
[[ "${1:-}" == "--yes" ]] && ASSUME_YES=1

BACKUP_DIR=""
OLD_PKG=""
SOURCE_SWITCHED=0
INSTALL_STARTED=0
NODE_INSTALLED=0
# The run that installs Node records how to go back here, so a re-run after a
# later failure still shows the way back to the original Node 20 package.
STATE_FILE="$HOME/upgrade_node_emudhra.rollback"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
die() { log "ERROR: $*"; exit 1; }

# version_at_least HAVE WANT: true when HAVE >= WANT.
version_at_least() {
  [[ -n "$1" ]] && [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$2" ]]
}

# Version of a running process, read from the binary it was started from. This
# still works after apt has replaced /usr/bin/node on disk.
running_version() {
  local pid="$1"
  [[ -n "$pid" && "$pid" != "0" && -e "/proc/$pid/exe" ]] || return 0
  "/proc/$pid/exe" --version 2>/dev/null | tr -d 'v' || true
}

app_pid() { pm2 pid "$PM2_APP" 2>/dev/null | tail -1 | tr -d '[:space:]' || true; }
daemon_pid() { cat "$HOME/.pm2/pm2.pid" 2>/dev/null || true; }

# Exit 0 when the given node binary still trusts the compromised root.
trusts_bad_root() {
  "$1" -e '
    const { X509Certificate } = require("crypto");
    const name = "CN=" + process.argv[1];
    const hit = require("tls").rootCertificates.some((p) => new X509Certificate(p).subject.includes(name));
    process.exit(hit ? 0 : 1);
  ' "$BAD_ROOT"
}

node_on_disk_ok() {
  local node_bin have
  node_bin="$(command -v node || true)"
  [[ -n "$node_bin" ]] || return 1
  have="$("$node_bin" --version | tr -d 'v')"
  version_at_least "$have" "$MIN_VERSION" && ! trusts_bad_root "$node_bin"
}

already_fixed() {
  node_on_disk_ok || return 1
  version_at_least "$(running_version "$(app_pid)")" "$MIN_VERSION" || return 1
  version_at_least "$(running_version "$(daemon_pid)")" "$MIN_VERSION"
}

show_state() {
  log "Node on disk:     $(command -v node || echo none) $(node --version 2>/dev/null || true)"
  log "PM2 daemon runs:  $(running_version "$(daemon_pid)")"
  log "$PM2_APP runs:  $(running_version "$(app_pid)")"
}

restore_apt_source() {
  [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]] || return 0
  log "Restoring the previous NodeSource apt source from $BACKUP_DIR"
  sudo rm -f "$SOURCE_LIST"
  sudo cp -p "$BACKUP_DIR"/* /etc/apt/sources.list.d/ 2>/dev/null || true
  sudo apt-get update -qq || true
}

print_rollback() {
  if [[ -z "$OLD_PKG" || -z "$BACKUP_DIR" ]]; then
    log "No record of the previous nodejs package, so no rollback commands to show."
    return 0
  fi
  cat <<EOF | tee -a "$LOG_FILE"

To go back to Node 20 (only if something is wrong):
  sudo rm -f $SOURCE_LIST
  sudo cp -p $BACKUP_DIR/* /etc/apt/sources.list.d/
  sudo apt-get update
  sudo apt-get install -y --allow-downgrades nodejs=$OLD_PKG
  cd $APP_DIR && $REBUILD_STEPS
  pm2 update && pm2 save
EOF
}

on_exit() {
  local code=$?
  [[ $code -ne 0 ]] || return 0
  if [[ $INSTALL_STARTED -eq 1 ]]; then
    # apt-get can fail after changing the package, so look before claiming
    # nothing changed.
    local now
    now="$(dpkg-query -W -f='${Version}' nodejs 2>/dev/null || true)"
    if [[ $NODE_INSTALLED -eq 0 && "$now" == "$OLD_PKG" ]]; then
      restore_apt_source
      log "apt-get install failed but left nodejs at $OLD_PKG. Nothing was restarted."
    else
      log "nodejs package is now ${now:-unknown}."
      print_rollback
    fi
  elif [[ $SOURCE_SWITCHED -eq 1 ]]; then
    restore_apt_source
    log "Nothing was installed or restarted."
  elif [[ -n "$OLD_PKG" && -n "$BACKUP_DIR" ]]; then
    # A re-run that skipped the apt steps, using the first run's record.
    print_rollback
  fi
}
trap on_exit EXIT

switch_apt_source() {
  BACKUP_DIR="/var/backups/nodesource-$(date +%Y%m%d-%H%M%S)"
  sudo mkdir -p "$BACKUP_DIR"
  # From here on, a failure puts the backed-up sources back (see on_exit).
  SOURCE_SWITCHED=1
  local f
  shopt -s nullglob
  for f in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    if grep -q "deb.nodesource.com" "$f"; then
      sudo cp -p "$f" "$BACKUP_DIR/"
      sudo rm -f "$f"
    fi
  done
  shopt -u nullglob
  log "Previous NodeSource apt source saved in $BACKUP_DIR"

  if [[ ! -s "$KEYRING" ]]; then
    log "Fetching the NodeSource signing key..."
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor --yes -o "$KEYRING"
  fi
  echo "deb [signed-by=$KEYRING] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    | sudo tee "$SOURCE_LIST" >/dev/null

  log "Updating apt package lists..."
  sudo apt-get update -qq

  local candidate
  candidate="$(apt-cache policy nodejs | awk '/Candidate:/ {print $2}' | cut -d- -f1)"
  version_at_least "$candidate" "$MIN_VERSION" \
    || die "NodeSource offers nodejs '${candidate:-none}', older than $MIN_VERSION. Try again later."
  log "NodeSource offers nodejs $candidate"
}

install_node() {
  log "Installing nodejs from node_${NODE_MAJOR}.x..."
  INSTALL_STARTED=1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
  NODE_INSTALLED=1
  printf 'OLD_PKG=%q\nBACKUP_DIR=%q\n' "$OLD_PKG" "$BACKUP_DIR" > "$STATE_FILE"
  hash -r
  local have
  have="$(node --version | tr -d 'v')"
  version_at_least "$have" "$MIN_VERSION" || die "node --version is $have after install, expected $MIN_VERSION or newer."
  if trusts_bad_root "$(command -v node)"; then
    die "Node $have still trusts $BAD_ROOT."
  fi
  log "Node $have installed. It no longer trusts $BAD_ROOT."
}

wait_for_app() {
  local i pid ver
  for i in $(seq 1 30); do
    pid="$(app_pid)"
    ver="$(running_version "$pid")"
    if version_at_least "$ver" "$MIN_VERSION" && health_check; then
      log "$PM2_APP is up (pid $pid) on Node $ver"
      # A crash loop would show up as a new pid; wait a little and compare.
      sleep "$STABLE_SECONDS"
      [[ "$(app_pid)" == "$pid" ]] || die "$PM2_APP restarted again after coming up. Check: pm2 logs $PM2_APP"
      return 0
    fi
    sleep 2
  done
  die "$PM2_APP did not come back healthy on Node $MIN_VERSION+ within 60s. Check: pm2 logs $PM2_APP"
}

check_boot_service() {
  local unit="pm2-$(id -un).service" exec_path
  if ! systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q .; then
    log "WARNING: no $unit, so PM2 will not start after a reboot. Set it up with 'pm2 startup'."
    return 0
  fi
  exec_path="$(systemctl show -p ExecStart --value "$unit" 2>/dev/null | grep -oE 'path=[^ ;]+' | head -1 | cut -d= -f2 || true)"
  if [[ -n "$exec_path" && ! -e "$exec_path" ]]; then
    log "WARNING: $unit starts $exec_path, which no longer exists. Regenerate it with 'pm2 startup'."
  else
    log "Boot service $unit is fine: it uses the same paths, so it will start the new Node."
  fi
}

main() {
  [[ $EUID -ne 0 ]] || die "Run this as the ubuntu user, not with sudo: PM2 runs as ubuntu."
  command -v apt-get >/dev/null || die "apt-get not found. This script is for Ubuntu."
  command -v pm2 >/dev/null || die "pm2 not found on PATH."
  [[ -d "$APP_DIR" ]] || die "App folder not found: $APP_DIR"
  sudo -n true 2>/dev/null || die "This needs passwordless sudo."
  [[ "$(command -v node || true)" == "/usr/bin/node" ]] \
    || die "Expected Node from apt at /usr/bin/node, found '$(command -v node || echo none)'. This script only upgrades the apt install."

  log "=== Node upgrade (eMudhra fix) started on $(hostname) ==="
  show_state

  if already_fixed; then
    log "Already fixed: PM2 and $PM2_APP run Node $MIN_VERSION+ without the emSign root. Nothing to do."
    exit 0
  fi

  if [[ $ASSUME_YES -ne 1 ]]; then
    echo
    echo "This moves Node to ${NODE_MAJOR}.x and restarts PM2 and $PM2_APP."
    echo "$RESTART_NOTE"
    read -r -p "Continue? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { log "Cancelled. Nothing changed."; exit 0; }
  fi

  if node_on_disk_ok; then
    # An earlier run installed Node and then failed (in the rebuild, say).
    # Switching the apt source again would record Node 22 as the version to
    # go back to, so reuse that run's record instead.
    log "Node $(node --version) is already installed and does not trust $BAD_ROOT. Skipping the apt steps."
    if [[ -s "$STATE_FILE" ]]; then
      # shellcheck source=/dev/null
      source "$STATE_FILE"
    fi
  else
    OLD_PKG="$(dpkg-query -W -f='${Version}' nodejs 2>/dev/null || true)"
    log "Current nodejs package: ${OLD_PKG:-not installed by apt}"
    switch_apt_source
    install_node
  fi

  log "Rebuilding $PM2_APP under Node $(node --version)..."
  (cd "$APP_DIR" && bash -c "$REBUILD_STEPS")

  log "Restarting PM2 on the new Node (pm2 update)..."
  pm2 update
  pm2 save

  wait_for_app
  log "PM2 daemon now runs Node $(running_version "$(daemon_pid)")"
  check_boot_service

  log "=== Done. ==="
  print_rollback
}

main "$@"

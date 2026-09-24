#!/usr/bin/env bash
# Restore the existing writable preview after a Car Thing reboot. No flashing.
set -euo pipefail
config="${HERTHING_DEVICE_SSH_CONFIG:-$HOME/.config/herthing/device-ssh.conf}"
device="${HERTHING_DEVICE_SSH_HOST:-carthing}"
ssh -o ControlMaster=no -o BatchMode=yes -F "$config" "$device" 'sh -s' <<'REMOTE'
set -eu
ui=/var/local/herthing/ui
mic=/var/local/herthing/microphone
test -f "$ui/index.html"
test -x "$mic/run"
test -x /var/local/herthing/bin/tinycap
if ! awk '$2 == "/etc/mira/ui" { found=1 } END { exit !found }' /proc/mounts; then
  mount --bind "$ui" /etc/mira/ui
  sv restart /etc/sv/mira-ui
  sv restart /etc/sv/chromium
fi
if ! sv status "$mic" >/dev/null 2>&1; then
  nohup runsv "$mic" </dev/null >>"$mic/service.log" 2>&1 &
fi
echo 'HerThing preview mounted; microphone supervisor requested.'
REMOTE

#!/usr/bin/env bash
# Stages throwaway disposable VMs for the showcase captures in docs/img, and
# removes them again. Run it on the desktop the captures are taken on.
#
#   docs/capture.sh --setup      create the demo VMs (refuses if any exist)
#   docs/capture.sh --teardown   remove exactly what --setup created, and put
#                                back the four saved config files
#   docs/capture.sh --shot NAME X,Y WxH
#                                crop one still into docs/img/NAME.png
#
# The owner's VMs are never touched: --setup refuses to run if any name it
# would use already exists, records every VM it creates, and --teardown
# removes only what that record lists. Nothing here writes to apps.nix: the
# permanent row in the captures is whatever machine the host already
# declares, and the four config files are saved before anything is changed
# and restored on teardown, byte for byte, symlink or not (cp -a).
#
# Surfaces are opened with the shell's IPC, and a shot is taken only once the
# surface's layer is up (hyprctl layers). Key-driven states and the recording
# need key input; AGENTS.md describes that part.
set -euo pipefail

img_dir="$(cd "$(dirname "$0")" && pwd)/img"
config="${XDG_CONFIG_HOME:-$HOME/.config}"
vms=(demo-shell demo-python)
# Made through the plugin itself during the create recording, not by --setup.
# --setup refuses if it already exists, so at teardown it can only be ours.
panel_vms=(demo-new)
saved=("$config/nixarchy/apps.nix" "$config/nixarchy/services.nix" "$config/omarchy/shell.json" "$config/omarchy/extensions/omarchy-menu.jsonc")
run_dir="${XDG_RUNTIME_DIR:-/tmp}/nixarchy-microvm-capture"
# One line per created thing, "kind name", read back by --teardown.
state="$run_dir/state"

made() { echo "$1 $2" >>"$state"; }

# Not grep -q: with pipefail, grep closing the pipe early can fail the list
# command and make a VM that exists look absent (demo-new survived one
# teardown that way).
exists() { nixarchy-vm list 2>/dev/null | grep -E "^\s*$1\s+template=" >/dev/null; }

refuse_collisions() {
  local v clash=0
  for v in "${vms[@]}" "${panel_vms[@]}"; do
    if exists "$v"; then echo "exists: VM $v" >&2; clash=1; fi
  done
  if [ -s "$state" ]; then echo "exists: $state (run --teardown first)" >&2; clash=1; fi
  if [ "$clash" -ne 0 ]; then
    echo "refusing: these names belong to something that is not this script's" >&2
    exit 1
  fi
}

setup() {
  mkdir -p "$run_dir"
  refuse_collisions
  : >"$state"
  local v f i=0
  for v in "${panel_vms[@]}"; do made vm "$v"; done
  for f in "${saved[@]}"; do
    if [ -e "$f" ] || [ -L "$f" ]; then
      cp -a "$f" "$run_dir/saved.$i"
      made saved "$i $f"
    fi
    i=$((i + 1))
  done
  nixarchy-vm create demo-shell --template shell >/dev/null
  made vm demo-shell
  nixarchy-vm create demo-python --template python >/dev/null
  made vm demo-python
}

teardown() {
  [ -f "$state" ] || { echo "nothing recorded; nothing to remove"; return; }
  local kind rest
  while read -r kind rest; do
    [ "$kind" = vm ] || continue
    # Only a name this script owns; a running one is stopped first.
    case $rest in demo-*) ;; *) continue ;; esac
    if exists "$rest"; then
      nixarchy-vm stop "$rest" >/dev/null 2>&1 || true
      nixarchy-vm rm "$rest" >/dev/null 2>&1 || true
    fi
  done <"$state"
  while read -r kind rest; do
    [ "$kind" = saved ] || continue
    local i=${rest%% *} f=${rest#* }
    rm -f -- "$f"
    cp -a "$run_dir/saved.$i" "$f"
  done <"$state"
  rm -rf -- "$run_dir"
}

shot() {
  local name=$1 pos=$2 size=$3
  mkdir -p "$img_dir"
  grim -g "$pos $size" "$img_dir/$name.png"
  echo "  $name.png ($size at $pos)"
}

case "${1:-}" in
  --setup) setup ;;
  --teardown) teardown ;;
  --shot) shift; shot "$@" ;;
  *) sed -n '2,9p' "$0" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
# Builds Open Battle at the committed HEAD and promotes it on Craftworld (vps-01), the NixOS
# host behind https://openbattle.thehivemind5.com. The NixOS side (users, services, nginx,
# coturn) is deploy/craftworld/openbattle.nix, copied into the infra repo as
# hosts/vps-01/apps/openbattle.nix. See deploy/craftworld/README.md.
#
#   deploy/craftworld/release.sh            # from a clean checkout, over Tailscale SSH
#
# Settings:
#   INFRA_REPO  the infra checkout, for the pinned host key (~/dev/personal/vps)
#   TARGET      ssh destination (root@vps-01.tailf51383.ts.net)
#   BUILD_ONLY  a directory: build the release into it and stop before uploading
set -euo pipefail

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
infra_repo="${INFRA_REPO:-$HOME/dev/personal/vps}"
target="${TARGET:-root@vps-01.tailf51383.ts.net}"
known_hosts="$infra_repo/hosts/vps-01/ssh_known_hosts"
build_only="${BUILD_ONLY:-}"
if [[ -z "$build_only" && ! -f "$known_hosts" ]]; then
  echo "No pinned host key at $known_hosts; set INFRA_REPO." >&2
  exit 1
fi

cd "$app_dir"
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Uncommitted changes: a release is built from the committed HEAD only.' >&2
  exit 1
fi
rev="$(git rev-parse --short=12 HEAD)"
name="$(date -u +%Y%m%dT%H%M%SZ)-$rev"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Build from a clean export of HEAD, so nothing local leaks into the release.
src="$work/src"
mkdir "$src"
git archive HEAD | tar -x -C "$src"
(
  cd "$src"
  pnpm install --frozen-lockfile --ignore-scripts
  # The app reads its relay and TURN logins from the site's /config.json at startup.
  VITE_SITE_CONFIG=config.json pnpm build
  pnpm build:host
)

out="$work/release"
mkdir -p "$out/server"
cp -R "$src/dist" "$src/dist-host" "$out/"
cp "$src/deploy/health.html" "$out/health.html"
cp "$src"/server/{relay,board,mailbox,seeder,host,webrtc}.mjs "$out/server/"

# Runtime dependencies at the app's pinned versions. node-datachannel's prebuilt library comes
# as an optional package per platform; ask for linux-x64 (glibc) whatever machine this runs on,
# so nothing installs or compiles on the host.
dep() { node -p "const p=require('$src/package.json'); (p.dependencies[process.argv[1]] ?? p.devDependencies[process.argv[1]])" "$1"; }
cat > "$out/package.json" <<JSON
{ "name": "open-battle-server", "private": true, "type": "module",
  "dependencies": {
    "@trystero-p2p/ws-relay": "$(dep @trystero-p2p/ws-relay)",
    "node-datachannel": "$(dep node-datachannel)"
  } }
JSON
(
  cd "$out"
  npm install --omit=dev --no-package-lock --no-audit --no-fund --ignore-scripts \
    --os=linux --cpu=x64 --libc=glibc
)
native="$(find "$out/node_modules/@node-datachannel/linux-x64-gnu" -name '*.node' -print -quit 2>/dev/null)"
[[ -n "$native" ]] || { echo 'node-datachannel has no prebuilt library.' >&2; exit 1; }
if command -v file >/dev/null && ! file "$native" | grep -q 'ELF 64-bit.*x86-64'; then
  echo "node-datachannel's library is not linux-x64: $(file "$native")" >&2
  exit 1
fi
[[ -f "$out/dist/index.html" && -f "$out/dist-host/rooms.mjs" ]] || { echo 'Build output missing.' >&2; exit 1; }
if [[ -n "$(find "$out/dist" \( -type l -o -name '.env*' -o -name '*.pem' -o -name '*.key' \) -print -quit)" ]]; then
  echo 'Release contains a symlink or private file; refusing upload.' >&2
  exit 1
fi
echo "$rev" > "$out/REVISION"
if [[ -n "$build_only" ]]; then
  mkdir -p "$build_only"
  cp -R "$out"/. "$build_only"/
  echo "Built Open Battle $name into $build_only"
  exit 0
fi

COPYFILE_DISABLE=1 tar --no-xattrs --exclude='._*' -czf "$work/release.tar.gz" -C "$out" .
digest="$( (command -v sha256sum >/dev/null && sha256sum || shasum -a 256) < "$work/release.tar.gz" | cut -d ' ' -f 1)"

ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" -o ConnectTimeout=15)
ssh "${ssh_opts[@]}" "$target" bash -s -- "$name" <<'REMOTE'
set -euo pipefail
release="/srv/openbattle/releases/$1"
install -d -m 0755 /srv/openbattle/releases
test ! -e "$release"
install -d -m 0755 "$release"
REMOTE
scp "${ssh_opts[@]}" "$work/release.tar.gz" "$target:/srv/openbattle/releases/$name/artifact.tar.gz"
ssh "${ssh_opts[@]}" "$target" bash -s -- "$name" "$digest" <<'REMOTE'
set -euo pipefail
name="$1"; digest="$2"
release="/srv/openbattle/releases/$name"
echo "$digest  $release/artifact.tar.gz" | sha256sum -c -
tar --no-same-owner -xzf "$release/artifact.tar.gz" -C "$release"
rm "$release/artifact.tar.gz"
chown -R root:root "$release"
chmod -R a+rX,go-w "$release"
ln -sfn "$release" /srv/openbattle/current.new
mv -Tf /srv/openbattle/current.new /srv/openbattle/current
units="openbattle-relay openbattle-mailbox openbattle-seeder openbattle-host"
if systemctl cat openbattle-relay.service >/dev/null 2>&1; then
  systemctl restart $units
  sleep 3
  systemctl is-active $units
  curl -fsS --max-time 5 http://127.0.0.1:4400/health.json; echo
else
  echo 'Release is in place; the NixOS module is not deployed yet, so no services were restarted.'
fi
# Keep the five newest releases.
ls -1dt /srv/openbattle/releases/*/ | tail -n +6 | xargs -r rm -rf
REMOTE
echo "Released Open Battle $name"

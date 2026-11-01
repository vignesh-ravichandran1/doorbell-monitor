#!/usr/bin/env bash
# Step 1 on Mac / Linux:  bash prepare.sh
# Checks this computer, installs Node.js 22 if it's missing or too old, installs the app's
# dependencies (including ffmpeg), then runs the machine checks. Safe to run again any time.
set -uo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

NODE_MAJOR_MIN=22
NODE_DIST=https://nodejs.org/dist/latest-v22.x

say "Checking this computer"
os=$(uname -s)
arch=$(uname -m)
case $os in
  Darwin)
    ver=$(sw_vers -productVersion)
    [[ ${ver%%.*} -ge 11 ]] || fail "macOS $ver is too old. Needs macOS 11 (Big Sur) or newer."
    ok "macOS $ver ($arch)" ;;
  Linux)
    ok "Linux ($arch)" ;;
  *)
    fail "Unsupported system: $os. On Windows, double-click prepare.bat instead." ;;
esac

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }

install_node() {
  local tmp sums file
  tmp=$(mktemp -d)
  sums=$(curl -fsSL "$NODE_DIST/SHASUMS256.txt") || fail "Can't download Node.js. Check the internet connection."
  if [[ $os == Darwin ]]; then
    file=$(echo "$sums" | awk '{print $2}' | grep -E '^node-v[0-9.]+\.pkg$' | head -1)
  else
    case $arch in
      x86_64) a=x64 ;; aarch64|arm64) a=arm64 ;; armv7l) a=armv7l ;; *) fail "No Node.js build for $arch." ;;
    esac
    file=$(echo "$sums" | awk '{print $2}' | grep -E "^node-v[0-9.]+-linux-$a\.tar\.xz$" | head -1)
  fi
  [[ -n $file ]] || fail "Couldn't find the Node.js download."
  echo "  Downloading $file ..."
  curl -fL --progress-bar -o "$tmp/$file" "$NODE_DIST/$file" || fail "Download failed."
  local want got
  want=$(echo "$sums" | grep " $file\$" | awk '{print $1}')
  if command -v shasum >/dev/null; then got=$(shasum -a 256 "$tmp/$file" | awk '{print $1}')
  else got=$(sha256sum "$tmp/$file" | awk '{print $1}'); fi
  [[ $want == "$got" ]] || fail "Download is corrupted (checksum mismatch). Run this again."
  ok "Download verified"
  echo "  Installing (your computer password may be asked for) ..."
  if [[ $os == Darwin ]]; then
    sudo installer -pkg "$tmp/$file" -target / >/dev/null || fail "Node.js install failed."
  else
    sudo tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 || fail "Node.js install failed."
  fi
  rm -rf "$tmp"
  hash -r
  export PATH="/usr/local/bin:$PATH"
}

say "Node.js"
major=$(node_major)
if [[ -n $major && $major -ge $NODE_MAJOR_MIN ]]; then
  ok "Node.js $(node -v) already installed"
else
  [[ -n $major ]] && echo "  Node.js $(node -v) is too old, installing Node.js 22 LTS"
  [[ -z $major ]] && echo "  Node.js not found, installing Node.js 22 LTS"
  install_node
  major=$(node_major)
  [[ -n $major && $major -ge $NODE_MAJOR_MIN ]] || fail "Node.js still not available. Open a new Terminal window and run this again."
  ok "Node.js $(node -v) installed"
fi

say "Installing the app (downloads ffmpeg too, ~1 minute)"
npm install --no-audit --no-fund || fail "npm install failed. Check the internet connection and run this again."
ok "App installed"

say "Machine checks"
node src/doctor.js --pre || fail "Fix the ✗ items above, then run: bash prepare.sh"

printf '\n\033[32mReady.\033[0m Next step:  \033[1mnpm run setup\033[0m\n\n'

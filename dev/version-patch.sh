#!/bin/bash
# Versionsnummer an allen Stellen setzen.
#
#   ./version-patch.sh            → Patch +1 mit -dev Suffix (z. B. 1.0.164-dev → 1.0.165-dev)
#   ./version-patch.sh --release  → -dev Suffix entfernen   (z. B. 1.0.165-dev → 1.0.165)
#
# Quelle der Wahrheit: APP_VERSION in config.js
set -euo pipefail
cd "$(dirname "$0")"

CURRENT=$(sed -nE 's/^const APP_VERSION = "([^"]+)";.*/\1/p' config.js)
if [[ ! "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-dev)?$ ]]; then
  echo "Ungültige APP_VERSION in config.js: '$CURRENT'" >&2
  exit 1
fi
major=${BASH_REMATCH[1]}; minor=${BASH_REMATCH[2]}; patch=${BASH_REMATCH[3]}

if [[ "${1:-}" == "--release" ]]; then
  NEW="$major.$minor.$patch"
else
  NEW="$major.$minor.$((patch + 1))-dev"
fi

V='[0-9]+\.[0-9]+\.[0-9]+(-dev)?'
perl -pi -e "s/const APP_VERSION = \"$V\";/const APP_VERSION = \"$NEW\";/" config.js
perl -pi -e "s/const CACHE_VERSION = \"v$V\";/const CACHE_VERSION = \"v$NEW\";/" service-worker.js
perl -pi -e "s/\"version\":\\s*\"$V\"/\"version\": \"$NEW\"/" package.json
perl -pi -e "s/\\?v=$V\"/?v=$NEW\"/g; s/id=\"version-badge\">v$V</id=\"version-badge\">v$NEW</" index.html
printf '{"version":"%s"}\n' "$NEW" > version.json

echo "$CURRENT → $NEW"

#!/bin/sh
# Copies herdr-linear into the Herdr app home. Never overwrites other layouts/mods.
set -e
H="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$H/layouts" "$H/mods" "$H/themes"
cp layouts/rex.json "$H/layouts/rex.json"
cp themes/rex.json "$H/themes/rex.json"
for m in mods/rex-*; do rm -rf "$H/mods/$(basename "$m")"; cp -R "$m" "$H/mods/"; done

# Keys: replace only the "layout:rex" section of keys.json (they apply while rex shows);
# every other section stays as it is. A backup is written next to it first.
if command -v python3 >/dev/null 2>&1; then
  [ -f "$H/keys.json" ] && cp "$H/keys.json" "$H/keys.json.bak-rex"
  python3 - "$H/keys.json" keys.rex.json <<'EOF'
import json, os, sys
dst, src = sys.argv[1], sys.argv[2]
keys = json.load(open(dst)) if os.path.exists(dst) else {}
keys["layout:rex"] = json.load(open(src))["layout:rex"]
json.dump(keys, open(dst, "w"), indent=2)
EOF
else
  echo "python3 not found: copy the \"layout:rex\" section of keys.rex.json into $H/keys.json yourself."
fi
echo "installed. switch: herdr-app do layout.switch '{\"name\":\"rex\"}'"

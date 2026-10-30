#!/usr/bin/env bash
# Install dsh-element-source into the default desktop profile.
# Idempotent: safe to re-run (updates the package).
set -euo pipefail

PROFILE="${DSH_PROFILE:-desktop}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "profile \"$PROFILE\" not found at $PROFILE_DIR" >&2
  echo "start the DSH desktop app once so the profile initializes, then retry" >&2
  exit 1
fi

cd "$PROFILE_DIR"

# pnpm >=10 blocks <24h-old packages; pre-allow this one so the first install
# never fails on release age. Insert the entry directly under the existing
# `minimumReleaseAgeExclude:` list (or append the block when the key is absent).
WORKSPACE_FILE=pnpm-workspace.yaml
if [ ! -f "$WORKSPACE_FILE" ]; then
  touch "$WORKSPACE_FILE"
fi
if ! grep -q '^  - dsh-element-source$' "$WORKSPACE_FILE"; then
  if grep -q '^minimumReleaseAgeExclude:' "$WORKSPACE_FILE"; then
    awk -v add='  - dsh-element-source' '
      /^minimumReleaseAgeExclude:/ && !done { print; print add; done = 1; next }
      { print }
    ' "$WORKSPACE_FILE" > "$WORKSPACE_FILE.tmp"
    mv "$WORKSPACE_FILE.tmp" "$WORKSPACE_FILE"
  else
    printf 'minimumReleaseAgeExclude:\n  - dsh-element-source\n' >> "$WORKSPACE_FILE"
  fi
fi

npx -y --package @deepseek-ai/dsh dsh plugin --profile "$PROFILE" add dsh-element-source

echo ""
echo "Installed. Restart the DSH desktop app or reload its window to load the client half."

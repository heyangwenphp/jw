#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-$(node -p "require('./package.json').version")}"
DIST_DIR="${2:-dist}"
shift $(( $# >= 2 ? 2 : $# ))
ARCHES=("$@")

if [ ${#ARCHES[@]} -eq 0 ]; then
  ARCHES=("arm64" "x64")
fi

package_arch() {
  local arch="$1"
  local release_dir="jedi-${VERSION}-macos-${arch}-installer"
  local output="${DIST_DIR}/jedi-${VERSION}-macos-${arch}-installer.tar.gz"
  local dmg="${DIST_DIR}/Jedi-${VERSION}-darwin-${arch}.dmg"

  echo "Packaging macOS ${arch} installer: ${output}..."

  if [ ! -f "$dmg" ]; then
    echo "ERROR: Missing DMG: ${dmg}"
    exit 1
  fi

  rm -rf "$release_dir"
  mkdir -p "$release_dir"

  cp "$dmg" "$release_dir/"
  cp scripts/install.sh "$release_dir/"
  printf '%s\n' "$arch" > "${release_dir}/installer-arch.txt"

  cat > "${release_dir}/README.md" << EOF
# Jedi ${VERSION} - macOS ${arch} Installer

## Quick Install (Recommended)

\`\`\`bash
bash install.sh
\`\`\`

This installer package will:
1. Verify your macOS architecture matches this package (${arch})
2. Check Node.js and Claude Code CLI
3. Install Jedi to /Applications

## Included Files

- \`Jedi-${VERSION}-darwin-${arch}.dmg\`
- \`install.sh\`

## Manual Install

Double-click \`Jedi-${VERSION}-darwin-${arch}.dmg\` and drag the app to /Applications.
EOF

  tar czf "$output" "$release_dir"
  rm -rf "$release_dir"

  echo "Done: ${output}"
}

for arch in "${ARCHES[@]}"; do
  package_arch "$arch"
done

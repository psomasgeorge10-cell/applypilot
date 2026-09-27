#!/bin/bash
# Double-click to start ApplyPilot on macOS. The first run installs what it
# needs and adds an ApplyPilot icon to your desktop.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Opening the download page: install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close this window." _
  exit 1
fi
node scripts/launch.mjs || read -r -p "ApplyPilot stopped with an error. Press Enter to close this window." _

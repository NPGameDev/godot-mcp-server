#!/usr/bin/env bash
# Extract the version from package.json (used by CI to validate version sync).
node -p "require('./package.json').version"

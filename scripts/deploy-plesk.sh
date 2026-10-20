#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
NODE_BIN="${NODE_BIN:-/opt/plesk/node/24/bin/node}"
if [ ! -x "$NODE_BIN" ]; then
  echo 'Configured Node.js executable is unavailable.' >&2
  exit 1
fi
PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH
echo 'Installing production dependencies from package-lock.json...'
npm ci --omit=dev --no-fund
echo 'Applying pending database migrations...'
"$NODE_BIN" scripts/migrate.js
echo 'Requesting a Passenger application restart...'
mkdir -p tmp
touch tmp/restart.txt
echo 'Deployment completed; Passenger will restart the application on the next request.'

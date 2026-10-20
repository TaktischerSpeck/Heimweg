#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_dir=$(mktemp -d)
trap 'rm -rf "$task_dir"' EXIT

export OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v26.10.0-debian
export NOMINATIM_IMAGE=mediagis/nominatim:5.3
export NOMINATIM_DB_PASSWORD=ci-only-not-for-production
docker compose -f deploy/osrm-docker/compose.yaml config --quiet
docker compose -f deploy/osrm-docker/compose.nominatim.yaml config --format json > "$task_dir/compose.json"
python3 - "$task_dir/compose.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    config = json.load(source)
service = config["services"]["nominatim"]
assert config["name"] == "heimweg-geocoding"
assert len(service["ports"]) == 1
port = service["ports"][0]
assert port["host_ip"] == "127.0.0.1"
assert str(port["published"]) == "8081" and port["target"] == 8080
assert service["volumes"][0]["target"] == "/var/lib/postgresql/16/main"
assert service["environment"]["IMPORT_STYLE"] == "address"
assert service["environment"]["UPDATE_MODE"] == "none"
PY
docker manifest inspect "$NOMINATIM_IMAGE" > /dev/null

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj /CN=osrm.internal -addext subjectAltName=DNS:osrm.internal \
  -keyout "$task_dir/server.key" -out "$task_dir/server.crt" > /dev/null 2>&1
printf 'heimweg:ci-only-password-hash\n' > "$task_dir/passwords"
for file in nginx-local.conf nginx-nominatim-local.conf nginx-nominatim-upstream.conf.example; do
  if [[ "$file" == *upstream* ]]; then
    {
      echo 'server { listen 80;'
      cat "deploy/osrm-docker/$file"
      echo '}'
    } > "$task_dir/nginx.conf"
  else
    cp "deploy/osrm-docker/$file" "$task_dir/nginx.conf"
  fi
  docker run --rm \
    -v "$task_dir/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$task_dir:/etc/nginx/osrm-tls:ro" \
    -v "$task_dir/server.crt:/etc/nginx/trust/osrm-ca.crt:ro" \
    -v "$task_dir/passwords:/etc/nginx/heimweg-osrm.htpasswd:ro" \
    -v "$task_dir/passwords:/etc/nginx/heimweg-nominatim.htpasswd:ro" \
    nginx:stable nginx -t
done
echo 'Map deployment configuration checks passed.'

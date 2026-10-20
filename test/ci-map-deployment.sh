#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_dir=$(mktemp -d)
trap 'rm -rf "$task_dir"' EXIT

export OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v26.10.0-debian
export NOMINATIM_IMAGE=mediagis/nominatim:5.3
export NOMINATIM_DB_PASSWORD=ci-only-not-for-production
docker compose -f deploy/osrm-docker/compose.yaml config --quiet
for file in deploy/osrm-docker/prepare-region.sh deploy/osrm-docker/prepare-osrm-region.sh; do
  bash -n "$file"
done
docker compose -f deploy/osrm-docker/compose.yaml \
  -f deploy/osrm-docker/compose.osrm.regional.yaml config --format json > "$task_dir/osrm-regional.json"
docker compose -f deploy/osrm-docker/compose.nominatim.yaml \
  -f deploy/osrm-docker/compose.nominatim.regional.yaml config --format json > "$task_dir/regional.json"
docker compose -f deploy/osrm-docker/compose.nominatim.yaml \
  -f deploy/osrm-docker/compose.nominatim.regional.yaml \
  -f deploy/osrm-docker/compose.nominatim.import.yaml config --format json > "$task_dir/import.json"
python3 - "$task_dir" <<'PY'
import json, pathlib, sys
directory = pathlib.Path(sys.argv[1])
def service(filename, name="nominatim"):
    return json.loads((directory / filename).read_text())["services"][name]
runtime = service("regional.json")
importing = service("import.json")
for config in (runtime, importing):
    assert config["environment"]["PBF_URL"] == ""
    assert config["environment"]["PBF_PATH"] == "/maps/region.osm.pbf"
    volumes = {v["target"]: v for v in config["volumes"]}
    assert len(volumes) == 2
    assert volumes["/var/lib/postgresql/16/main"]["source"] == "nominatim-regional-data"
    assert volumes["/maps"]["read_only"] is True
    assert volumes["/maps"]["source"].endswith("/geocoding-data")
    assert config["ports"][0]["host_ip"] == "127.0.0.1"
assert float(runtime["cpus"]) == 2 and runtime["mem_limit"] == 3 * 1024**3
assert float(importing["cpus"]) == 16 and importing["mem_limit"] == 14 * 1024**3
assert importing["environment"]["THREADS"] == "16"
assert runtime["environment"]["POSTGRES_SHARED_BUFFERS"] == "256MB"
assert importing["environment"]["POSTGRES_SHARED_BUFFERS"] == "2GB"
osrm = service("osrm-regional.json", "osrm")
assert len(osrm["volumes"]) == 1
assert osrm["volumes"][0]["source"].endswith("/osrm-regional-data")
assert osrm["volumes"][0]["read_only"] is True
PY
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

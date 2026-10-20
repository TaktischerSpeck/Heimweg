#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
test -s geocoding-data/region.osm.pbf
if [ -e osrm-regional-data ]; then
  echo 'Regional routing directory already exists; keep it or move it aside first.' >&2
  exit 1
fi
osrm_image=$(docker compose -f compose.yaml config --format json |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["osrm"]["image"])')
task_dir=$(mktemp -d "$PWD/.osrm-prepare-XXXXXX")
trap 'rm -rf "$task_dir"' EXIT
cp geocoding-data/region.osm.pbf "$task_dir/region.osm.pbf"
for operation in extract partition customize; do
  if [ "$operation" = extract ]; then
    docker run --rm --cpus 16 --memory 14g -v "$task_dir:/data" "$osrm_image" \
      osrm-extract --threads 16 -p /opt/car.lua /data/region.osm.pbf
  else
    docker run --rm --cpus 16 --memory 14g -v "$task_dir:/data" "$osrm_image" \
      "osrm-$operation" --threads 16 /data/region.osrm
  fi
done
rm "$task_dir/region.osm.pbf"
chmod -R a+rX "$task_dir"
mv "$task_dir" osrm-regional-data
echo 'Regional OSRM data built. Start with compose.yaml and compose.osrm.regional.yaml.'

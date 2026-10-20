#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
for tool in osmium curl python3; do command -v "$tool" >/dev/null; done
python3 -c 'import shapely, pyproj'
buffer_metres=${REGION_BUFFER_METRES:-5000}
mkdir -p geocoding-data
chmod 755 geocoding-data
if [ -e geocoding-data/region.osm.pbf ]; then
  echo 'Regional extract already exists; move it aside before preparing a new version.' >&2
  exit 1
fi
task_dir=$(mktemp -d "$PWD/geocoding-data/.prepare-XXXXXX")
trap 'rm -rf "$task_dir"' EXIT
# Download the source temporarily; only the extracted region is kept on success.
curl --fail --show-error --location --retry 3 \
  https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf \
  -o "$task_dir/hessen.osm.pbf"
osmium getid --add-referenced "$task_dir/hessen.osm.pbf" r62704 r62581 \
  -o "$task_dir/boundaries.osm"
python3 region-polygon.py "$task_dir/boundaries.osm" "$task_dir/region.geojson" "$buffer_metres"
osmium extract --polygon "$task_dir/region.geojson" --strategy smart \
  "$task_dir/hessen.osm.pbf" -o "$task_dir/region.osm.pbf"
osmium check-refs "$task_dir/region.osm.pbf"
osmium fileinfo "$task_dir/region.osm.pbf"
chmod 644 "$task_dir/region.osm.pbf" "$task_dir/region.geojson"
mv "$task_dir/region.geojson" geocoding-data/region.geojson
mv "$task_dir/region.osm.pbf" geocoding-data/region.osm.pbf
echo 'Regional extract ready. Temporary Hessen source removed on exit.'

#!/usr/bin/env python3
"""Build a buffered district/city polygon from complete OSM boundary relations."""
import json
import sys
import xml.etree.ElementTree as ET

from pyproj import Transformer
from shapely.geometry import LineString, mapping
from shapely.ops import polygonize_full, transform, unary_union


def boundary_polygon(root, relation_id):
    nodes = {n.attrib["id"]: (float(n.attrib["lon"]), float(n.attrib["lat"]))
             for n in root.findall("node")}
    ways = {w.attrib["id"]: [nodes[n.attrib["ref"]] for n in w.findall("nd")]
            for w in root.findall("way")}
    relation = next(r for r in root.findall("relation")
                    if r.attrib["id"] == str(relation_id))
    tags = {t.attrib["k"]: t.attrib["v"] for t in relation.findall("tag")}
    if tags.get("boundary") != "administrative" or tags.get("admin_level") != "6":
        raise ValueError(f"Unexpected administrative boundary: {relation_id}")
    polygons = {}
    for role in ("outer", "inner"):
        lines = [LineString(ways[m.attrib["ref"]]) for m in relation.findall("member")
                 if m.attrib["type"] == "way" and m.attrib.get("role", "") == role]
        if not lines:
            if role == "outer":
                raise ValueError(f"Missing outer boundary: {relation_id}")
            continue
        areas, cuts, dangles, invalid = polygonize_full(lines)
        if any(not geometry.is_empty for geometry in (cuts, dangles, invalid)):
            raise ValueError(f"Incomplete boundary ways: {relation_id}/{role}")
        polygons[role] = unary_union(areas)
    area = polygons["outer"]
    if "inner" in polygons:
        area = area.difference(polygons["inner"])
    if area.is_empty or not area.is_valid:
        raise ValueError(f"Invalid boundary: {relation_id}")
    return area


def build_region(root, buffer_metres):
    if not 0 <= buffer_metres <= 20000:
        raise ValueError("Buffer must be between 0 and 20000 metres")
    region = unary_union([boundary_polygon(root, 62704), boundary_polygon(root, 62581)])
    to_metric = Transformer.from_crs(4326, 32632, always_xy=True).transform
    to_geo = Transformer.from_crs(32632, 4326, always_xy=True).transform
    metric = transform(to_metric, region)
    if not 700e6 < metric.area < 1000e6:
        raise ValueError("Unexpected district/city area; inspect the boundary relations")
    return transform(to_geo, metric.buffer(buffer_metres))


if __name__ == "__main__":
    region = build_region(ET.parse(sys.argv[1]).getroot(), float(sys.argv[3]))
    with open(sys.argv[2], "w", encoding="utf-8") as target:
        json.dump({"type": "Feature", "properties": {
            "name": "Darmstadt-Dieburg + Darmstadt", "buffer_metres": float(sys.argv[3]),
            "source": "OpenStreetMap contributors; ODbL"
        }, "geometry": mapping(region)}, target)
    print(f"Regional polygon written to {sys.argv[2]}")

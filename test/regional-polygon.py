#!/usr/bin/env python3
"""Exercise fragmented boundaries, holes, buffering and incomplete-input rejection."""
import importlib.util
from pathlib import Path
import shutil
import sys
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

from pyproj import Transformer
from shapely.geometry import Point

spec = importlib.util.spec_from_file_location(
    "region_polygon", Path(__file__).parents[1] / "deploy/osrm-docker/region-polygon.py")
region = importlib.util.module_from_spec(spec)
spec.loader.exec_module(region)
to_geo = Transformer.from_crs(32632, 4326, always_xy=True).transform


def fixture():
    root = ET.Element("osm", version="0.6")
    # 800 square kilometres, including a 100-square-kilometre city enclave.
    rings = [[(470000, 5500000), (490000, 5500000), (490000, 5540000), (470000, 5540000)],
             [(475000, 5510000), (485000, 5510000), (485000, 5520000), (475000, 5520000)]]
    for index, ring in enumerate(rings):
        for offset, point in enumerate(ring):
            lon, lat = to_geo(*point)
            ET.SubElement(root, "node", id=str(index * 10 + offset + 1), lon=str(lon), lat=str(lat))
        for offset in range(4):
            way = ET.SubElement(root, "way", id=str(index * 10 + offset + 1))
            for node in (offset, (offset + 1) % 4):
                ET.SubElement(way, "nd", ref=str(index * 10 + node + 1))
    for relation_id in (62581, 62704):
        relation = ET.SubElement(root, "relation", id=str(relation_id))
        ET.SubElement(relation, "tag", k="boundary", v="administrative")
        ET.SubElement(relation, "tag", k="admin_level", v="6")
        if relation_id == 62704:
            for way in range(1, 5):
                ET.SubElement(relation, "member", type="way", ref=str(way), role="outer")
        for way in range(11, 15):
            ET.SubElement(relation, "member", type="way", ref=str(way),
                          role="inner" if relation_id == 62704 else "outer")
    return root


class RegionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("osmium"), "osmium-tool is required")
    def test_osmium_extract_pipeline(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            root = fixture()
            for element in root:
                element.set("version", "1")
            ET.ElementTree(root).write(directory / "source.osm")
            def osmium(*args):
                subprocess.run(["osmium", *map(str, args)], check=True)
            osmium("cat", directory / "source.osm", "-o", directory / "source.osm.pbf")
            osmium("getid", "--add-referenced", directory / "source.osm.pbf", "r62704", "r62581",
                   "-o", directory / "boundaries.osm")
            subprocess.run([sys.executable, spec.origin, str(directory / "boundaries.osm"),
                            str(directory / "region.geojson"), "5000"], check=True)
            osmium("extract", "--polygon", directory / "region.geojson", "--strategy", "smart",
                   directory / "source.osm.pbf", "-o", directory / "region.osm.pbf")
            osmium("check-refs", directory / "region.osm.pbf")
            self.assertGreater((directory / "region.osm.pbf").stat().st_size, 100)

    def test_fragmented_boundary_and_city_enclave(self):
        root = fixture()
        city_point = Point(*to_geo(480000, 5515000))
        district = region.boundary_polygon(root, 62704)
        self.assertFalse(district.contains(city_point))
        combined = region.build_region(root, 0)
        self.assertTrue(combined.contains(city_point))
        buffered = region.build_region(root, 5000)
        self.assertTrue(buffered.contains(Point(*to_geo(466000, 5520000))))
        self.assertFalse(buffered.contains(Point(*to_geo(460000, 5520000))))
        self.assertTrue(buffered.is_valid)

    def test_incomplete_boundary_is_rejected(self):
        root = fixture()
        relation = root.find("relation")
        relation.remove(relation.find("member"))
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            region.build_region(root, 5000)

    def test_unexpected_boundary_and_buffer_are_rejected(self):
        root = fixture()
        root.find("relation/tag[@k='admin_level']").set("v", "5")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            region.build_region(root, 5000)
        for buffer in (-1, 20001, float("nan")):
            with self.assertRaises(ValueError):
                region.build_region(fixture(), buffer)


if __name__ == "__main__":
    unittest.main()

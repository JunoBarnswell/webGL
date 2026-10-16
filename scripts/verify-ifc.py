"""IFC contract/oracle tool; the historical converter is used only as an isolated test reference."""
import hashlib
import json
import os
import pathlib
import resource
import struct
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULES = pathlib.Path(os.environ.get("STUDIO_IFC_MODULES", ROOT / ".local/tools/ifc"))
sys.path.insert(0, str(MODULES))
os.environ["OPENBLAS_NUM_THREADS"] = "1"
import numpy as np
import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.geom

EVIDENCE = ROOT / ".local/acceptance/studio-2.3/ifc"
FIXTURES = ROOT / ".local/fixtures/ifc"
EVIDENCE.mkdir(parents=True, exist_ok=True)
FIXTURES.mkdir(parents=True, exist_ok=True)


def synthetic():
    file = api.run("project.create_file", version="IFC4X3")
    project = api.run("root.create_entity", file, ifc_class="IfcProject", name="Studio IFC 4x3 contract")
    api.run("unit.assign_unit", file)
    context = api.run("context.add_context", file, context_type="Model")
    body = api.run("context.add_context", file, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=context)
    site = api.run("root.create_entity", file, ifc_class="IfcSite", name="Large coordinate site")
    building = api.run("root.create_entity", file, ifc_class="IfcBuilding", name="Building")
    storey = api.run("root.create_entity", file, ifc_class="IfcBuildingStorey", name="Floor")
    for parent, child in [(project, site), (site, building), (building, storey)]:
        api.run("aggregate.assign_object", file, products=[child], relating_object=parent)
    origin = np.eye(4)
    origin[:3, 3] = [100000000, 200000000, 100]
    for product in [site, building, storey]:
        api.run("geometry.edit_object_placement", file, product=product, matrix=origin.copy(), is_si=True)
    representation = api.run("geometry.add_wall_representation", file, context=body, length=10, height=3, thickness=.25)
    count = int(os.environ.get("STUDIO_IFC_FIXTURE_INSTANCES", "24"))
    members = []
    for index in range(count):
        product = api.run("root.create_entity", file, ifc_class="IfcPipeSegment", name="Shared segment " + str(index))
        api.run("spatial.assign_container", file, products=[product], relating_structure=storey)
        matrix = origin.copy()
        angle = (index % 3) * .2
        matrix[:3, :3] = [[np.cos(angle), -np.sin(angle), 0], [np.sin(angle), np.cos(angle), 0], [0, 0, 1]]
        matrix[0, 3] += index * 20
        api.run("geometry.edit_object_placement", file, product=product, matrix=matrix, is_si=True)
        api.run("geometry.assign_representation", file, product=product, representation=representation)
        members.append(product)
    valve = api.run("root.create_entity", file, ifc_class="IfcValve", name="Metadata without geometry")
    api.run("spatial.assign_container", file, products=[valve], relating_structure=storey)
    api.run("geometry.edit_object_placement", file, product=valve, matrix=origin.copy(), is_si=True)
    system = api.run("system.add_system", file, ifc_class="IfcDistributionSystem")
    system.Name = "Typed pipe network"
    api.run("system.assign_system", file, products=[*members, valve], system=system)
    a = api.run("system.add_port", file, element=members[0])
    b = api.run("system.add_port", file, element=members[1])
    api.run("system.connect_port", file, port1=a, port2=b, direction="SOURCE")
    pipe_type = api.run("root.create_entity", file, ifc_class="IfcPipeSegmentType", name="Shared segment type")
    api.run("type.assign_type", file, related_objects=members, relating_type=pipe_type)
    pset = api.run("pset.add_pset", file, product=pipe_type, name="Pset_Studio")
    pressure = file.create_entity("IfcSIUnit", UnitType="PRESSUREUNIT", Prefix="KILO", Name="PASCAL")
    temperature = file.create_entity("IfcSIUnit", UnitType="THERMODYNAMICTEMPERATUREUNIT", Name="DEGREE_CELSIUS")
    length = file.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")
    second = file.create_entity("IfcSIUnit", UnitType="TIMEUNIT", Name="SECOND")
    flow = file.create_entity("IfcDerivedUnit", Elements=[file.create_entity("IfcDerivedUnitElement", Unit=length, Exponent=3), file.create_entity("IfcDerivedUnitElement", Unit=second, Exponent=-1)], UnitType="VOLUMETRICFLOWRATEUNIT")
    pset.HasProperties = [file.create_entity("IfcPropertySingleValue", Name=name, NominalValue=file.create_entity(measure, value), Unit=unit) for name, measure, value, unit in [("Pressure", "IfcPressureMeasure", 101.325, pressure), ("Temperature", "IfcThermodynamicTemperatureMeasure", 20., temperature), ("Flow", "IfcVolumetricFlowRateMeasure", .5, flow)]]
    nullable = api.run("pset.add_pset", file, product=valve, name="Pset_Studio")
    nullable.HasProperties = [file.create_entity("IfcPropertySingleValue", Name="Nullable", NominalValue=None, Unit=length)]
    quantity = file.create_entity("IfcQuantityArea", Name="Area", AreaValue=12.5)
    qto = file.create_entity("IfcElementQuantity", GlobalId=ifcopenshell.guid.new(), Name="Qto_Studio", Quantities=[quantity])
    file.create_entity("IfcRelDefinesByProperties", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[members[0]], RelatingPropertyDefinition=qto)
    path = FIXTURES / "studio23-ifc4x3.ifc"
    file.write(str(path))
    return path


def run(args, log, threads=4):
    environment = {**os.environ, "STUDIO_IFC_MODULES": str(MODULES), "STUDIO_IFC_THREADS": str(threads)}
    start = time.perf_counter()
    with log.open("w") as output:
        process = subprocess.Popen(args, cwd=ROOT, env=environment, stdout=output, stderr=subprocess.STDOUT)
        _, status, usage = os.wait4(process.pid, 0)
        process.returncode = os.waitstatus_to_exitcode(status)
    if process.returncode:
        raise AssertionError("converter failed; see " + str(log))
    return {"wallSeconds": time.perf_counter() - start, "peakRssKiB": usage.ru_maxrss, "userSeconds": usage.ru_utime, "systemSeconds": usage.ru_stime}


def gltf(path):
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    definition = json.loads(data[20:20 + length])
    binary = data[28 + length:] if len(data) > 20 + length else b""
    origin = np.array(definition["asset"].get("extras", {}).get("localOriginGltfMetres", [0, 0, 0]))
    bounds = {}

    def accessor(index):
        spec = definition["accessors"][index]
        view = definition["bufferViews"][spec["bufferView"]]
        components = {"VEC3": 3, "SCALAR": 1}[spec["type"]]
        dtype = {5126: "<f4", 5125: "<u4"}[spec["componentType"]]
        return np.frombuffer(binary, dtype=dtype, count=spec["count"] * components, offset=view.get("byteOffset", 0) + spec.get("byteOffset", 0)).reshape((-1, components))

    def visit(index, parent):
        node = definition["nodes"][index]
        local = np.array(node["matrix"]).reshape((4, 4), order="F") if "matrix" in node else np.eye(4)
        world = parent @ local
        if "mesh" in node:
            low, high = np.full(3, np.inf), np.full(3, -np.inf)
            for primitive in definition["meshes"][node["mesh"]]["primitives"]:
                vertices = accessor(primitive["attributes"]["POSITION"]).astype(np.float64)
                points = vertices @ world[:3, :3].T + world[:3, 3] + origin
                low, high = np.minimum(low, points.min(axis=0)), np.maximum(high, points.max(axis=0))
                if "NORMAL" in primitive["attributes"]:
                    normals = accessor(primitive["attributes"]["NORMAL"])
                    assert np.isfinite(normals).all()
                    assert np.max(np.abs(np.linalg.norm(normals, axis=1) - 1)) < 1e-5
            identity = node["extras"].get("GlobalId")
            bounds[identity] = np.array([low, high])
        for child in node.get("children", []):
            visit(child, world)

    for index in definition["scenes"][definition.get("scene", 0)]["nodes"]:
        visit(index, np.eye(4))
    return definition, bounds


fixture = synthetic()
reference = ROOT / ".local/ifc-convert-2.2-reference.py"
if not reference.exists():
    reference.write_bytes(subprocess.check_output(["git", "show", "457eda90cba9b377216d17d6146835e00e8d6365:workers/ifc-convert.py"], cwd=ROOT))
results = []
for source in [FIXTURES / "Building-Architecture.ifc", FIXTURES / "IfcOpenShell-basic.ifc", fixture]:
    if not source.exists():
        raise FileNotFoundError("Licensed/public acceptance fixture is absent: " + str(source))
    prefix = EVIDENCE / source.stem
    prefix.mkdir(parents=True, exist_ok=True)
    old_output, output = prefix / "reference", prefix / "current"
    for directory in [old_output, output]:
        if directory.exists():
            import shutil
            shutil.rmtree(directory)
    with source.open("rb") as stream:
        file_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    source_sha = hashlib.sha256(("source\0" + source.name + "\0" + source.name + "\0" + file_sha + "\n").encode()).hexdigest()
    old_metrics = run([sys.executable, str(reference), str(source), str(old_output)], prefix / "reference.log")
    metrics = run([sys.executable, str(ROOT / "workers/ifc-convert.py"), str(source), str(output), source_sha], prefix / "current.log")
    old_definition, old_bounds = gltf(old_output / "derived.glb")
    definition, bounds = gltf(output / "derived.glb")
    assert set(old_bounds) == set(bounds), "geometry source identity coverage changed"
    deviation = max(float(np.abs(old_bounds[key] - bounds[key]).max()) for key in bounds)
    assert deviation <= .0005, "world bounds differ by more than 0.5 mm: " + str(deviation)
    assert all("NORMAL" in primitive["attributes"] for mesh in definition["meshes"] for primitive in mesh["primitives"])
    dataset = json.loads((output / "semantics.json").read_text())
    original = json.loads((old_output / "semantics.json").read_text())
    assert {record["sourceElementId"] for record in dataset["records"]} == {record["sourceElementId"] for record in original["records"]}
    assert len(definition["nodes"]) == len(dataset["records"]), "non-geometric identities must survive"
    report = json.loads((output / "ifc-report.json").read_text())
    assert report["geometryCount"] == len(bounds)
    if source == fixture:
        metadata = json.loads((output / "semantic-model.json").read_text())
        assert report["sharedGeometryInstances"] >= 2
        assert len(metadata["systems"]) == 1 and len(metadata["systems"][0]["connections"]) == 1
        assert len(metadata["systems"][0]["ports"]) == 2
        pressure = next(record["properties"]["Pset_Studio.Pressure"] for record in dataset["records"] if "Pset_Studio.Pressure" in record["properties"])
        assert pressure["unit"] == "kPa" and pressure["source"]["scope"] == "type" and pressure["source"]["rawValue"] == 101.325
        assert any(record["properties"].get("Pset_Studio.Nullable", {}).get("value", "absent") is None for record in dataset["records"])
        repeat = prefix / "single-thread"
        if repeat.exists():
            import shutil
            shutil.rmtree(repeat)
        run([sys.executable, str(ROOT / "workers/ifc-convert.py"), str(source), str(repeat), source_sha], prefix / "single-thread.log", 1)
        assert hashlib.sha256((repeat / "derived.glb").read_bytes()).digest() == hashlib.sha256((output / "derived.glb").read_bytes()).digest(), "geometry bytes depend on iterator completion order"
    results.append({"source": str(source.relative_to(ROOT)), "sourceFileSha256": file_sha, "sourceAssetSha256": source_sha, "schema": report["schema"], "reference": old_metrics, "current": metrics, "worldBoundsMaxDeviationMetres": deviation, "geometryInstances": report["geometryCount"], "uniqueMeshes": report["uniqueGeometryCount"], "semanticRecords": report["semanticRecords"], "geometryFailures": report["geometryFailures"], "propertyIssues": report["propertyIssues"]})
    print("Pass:", source.name, report["schema"], "world deviation", deviation, "m", flush=True)
(EVIDENCE / "results.json").write_text(json.dumps({"status": "Pass", "referenceCommit": "457eda90cba9b377216d17d6146835e00e8d6365", "referenceSourceSha256": hashlib.sha256(reference.read_bytes()).hexdigest(), "comparison": "same source files; complete old/new conversion processes; CPU/RSS only, no GPU assertion", "results": results}, indent=2))

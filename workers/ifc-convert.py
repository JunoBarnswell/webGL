"""Read-only IFC: multicore local tessellation, shared meshes, placements and typed semantics."""
import hashlib
import json
import math
import os
import pathlib
import shutil
import struct
import sys

if sys.platform == "linux":
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (800, 800))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024**3, 2 * 1024**3))
if os.environ.get("STUDIO_IFC_MODULES"):
    sys.path.insert(0, os.environ["STUDIO_IFC_MODULES"])
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
import numpy as np
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as element_util
import ifcopenshell.util.placement as placement_util
import ifcopenshell.util.shape as shape_util
import ifcopenshell.util.system as system_util
import ifcopenshell.util.unit as unit_util

source, output = map(pathlib.Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
spool = output / ".geometry"
spool.mkdir()
catalog_file = pathlib.Path(__file__).parent / "unit-catalog.json"
if not catalog_file.exists():
    catalog_file = pathlib.Path(__file__).parents[1] / "packages/scene-schema/unit-catalog.json"
catalog = json.loads(catalog_file.read_text())


def normalized(text):
    return "".join(text.strip().replace("²", "2").replace("³", "3").split())


units = {normalized(name): item for item in catalog["units"] for name in [item["id"], *item["aliases"]]}
with source.open("rb") as stream:
    file_sha = hashlib.file_digest(stream, "sha256").hexdigest()
source_sha = sys.argv[3]
if len(source_sha) != 64 or any(character not in "0123456789abcdef" for character in source_sha):
    raise ValueError("explicit immutable source asset SHA-256 is required")
model = ifcopenshell.open(str(source))
unit_scale = unit_util.calculate_unit_scale(model)
unit_util.cache_units(model)
products = sorted((item for item in model.by_type("IfcProduct") if getattr(item, "GlobalId", None)), key=lambda item: item.GlobalId)
by_guid = {item.GlobalId: item for item in products}
if len(by_guid) != len(products):
    raise ValueError("IFC source GlobalId values are not unique")
threads = int(os.environ.get("STUDIO_IFC_THREADS", min(4, os.cpu_count() or 1)))
if not 1 <= threads <= 16:
    raise ValueError("STUDIO_IFC_THREADS must be between 1 and 16")
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, False)
settings.set(settings.WELD_VERTICES, False)
geometries, placements, failures, property_issues, geometry_nodes = {}, {}, [], [], {}
bounds_min, bounds_max = np.full(3, np.inf), np.full(3, -np.inf)
conversion = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)
inverse_conversion = conversion.T

for entity in products:
    try:
        matrix = placement_util.get_local_placement(entity.ObjectPlacement).copy() if entity.ObjectPlacement else np.eye(4)
        matrix[:3, 3] *= unit_scale
        if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:3, :3])) < 1e-14:
            raise ValueError("non-finite or singular placement")
        placements[entity.GlobalId] = matrix
    except Exception as error:
        placements[entity.GlobalId] = np.eye(4)
        failures.append({"sourceElementId": "external:" + entity.GlobalId, "stage": "placement", "error": str(error)[:500]})

iterator = ifcopenshell.geom.iterator(settings, model, threads)
if iterator.initialize():
    while True:
        shape = iterator.get()
        guid = shape.guid
        if guid in by_guid:
            try:
                geometry = shape.geometry
                vertices = np.asarray(geometry.verts, dtype=np.float64).reshape((-1, 3))
                faces = np.asarray(geometry.faces, dtype=np.uint32).reshape((-1, 3))
                if not len(vertices) or not len(faces) or len(vertices) > 20000000:
                    raise ValueError("empty geometry or element vertex budget exceeded")
                if not np.isfinite(vertices).all() or int(faces.max()) >= len(vertices):
                    raise ValueError("non-finite coordinates or out-of-range indices")
                matrix = shape_util.get_shape_matrix(shape).copy()
                if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:3, :3])) < 1e-14:
                    raise ValueError("non-finite or singular placement")
                geometry_id = str(geometry.id)
                if geometry_id not in geometries:
                    centre = (vertices.min(axis=0) + vertices.max(axis=0)) / 2
                    normals = np.asarray(geometry.normals, dtype=np.float64)
                    if len(normals) != vertices.size:
                        normals = np.zeros_like(vertices)
                        triangles = vertices[faces]
                        face_normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
                        for corner in range(3):
                            np.add.at(normals, faces[:, corner], face_normals)
                    else:
                        normals = normals.reshape((-1, 3))
                    lengths = np.linalg.norm(normals, axis=1)
                    if not np.isfinite(normals).all():
                        raise ValueError("non-finite vertex normals")
                    invalid = lengths < 1e-14
                    normals[~invalid] /= lengths[~invalid, None]
                    if invalid.any():
                        normals[invalid] = [0, 0, 1]
                        failures.append({"sourceElementId": "external:" + guid, "stage": "normals", "error": "isolated or degenerate vertex normals", "count": int(invalid.sum())})
                    styles = []
                    for material in geometry.materials:
                        colour = [material.diffuse.r(), material.diffuse.g(), material.diffuse.b()]
                        alpha = 1 - (material.transparency if math.isfinite(material.transparency) else 0)
                        rgba = [min(1, max(0, value)) for value in [*colour, alpha]]
                        styles.append({"name": material.name or "IFC material", "pbrMetallicRoughness": {"baseColorFactor": rgba, "metallicFactor": 0, "roughnessFactor": .7}})
                    material_ids = np.asarray(geometry.material_ids, dtype=np.int32)
                    if len(material_ids) != len(faces):
                        material_ids = np.full(len(faces), -1, dtype=np.int32)
                    filename = spool / (hashlib.sha256(geometry_id.encode()).hexdigest() + ".npz")
                    np.savez(filename, vertices=vertices - centre, normals=normals, faces=faces, material_ids=material_ids)
                    geometries[geometry_id] = {"path": filename, "centre": centre, "styles": styles}
                geometry_nodes[guid] = geometry_id
                placements[guid] = matrix
                for start in range(0, len(vertices), 65536):
                    world = vertices[start:start + 65536] @ matrix[:3, :3].T + matrix[:3, 3]
                    bounds_min = np.minimum(bounds_min, world.min(axis=0))
                    bounds_max = np.maximum(bounds_max, world.max(axis=0))
            except Exception as error:
                failures.append({"sourceElementId": "external:" + guid, "stage": "geometry", "error": str(error)[:500]})
        if len(geometry_nodes) % 100 == 0:
            print(json.dumps({"stage": "IFC local geometry iterator", "progress": .1 + .45 * len(geometry_nodes) / max(1, len(products))}), flush=True)
        if not iterator.next():
            break

for entity in products:
    if entity.Representation and entity.GlobalId not in geometry_nodes:
        failures.append({"sourceElementId": "external:" + entity.GlobalId, "stage": "geometry", "error": "iterator did not yield supported tessellation"})
origin = np.floor(bounds_min / 1000) * 1000 if np.isfinite(bounds_min).all() else np.zeros(3)
origin_gltf = conversion[:3, :3] @ origin
views, accessors, meshes, materials, material_cache = [], [], [], [], {}
mesh_by_id = {}
binary_path = output / ".buffer.bin"
binary = binary_path.open("wb")


def buffer(values, component, kind, bounds=False):
    while binary.tell() % 4:
        binary.write(b"\0")
    values = np.asarray(values, dtype="<f4" if component == 5126 else "<u4")
    offset = binary.tell()
    binary.write(values.tobytes())
    views.append({"buffer": 0, "byteOffset": offset, "byteLength": binary.tell() - offset})
    accessor = {"bufferView": len(views) - 1, "componentType": component, "count": len(values), "type": kind}
    if bounds:
        accessor.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
    accessors.append(accessor)
    return len(accessors) - 1


for geometry_id, item in sorted(geometries.items()):
    with np.load(item["path"]) as arrays:
        position = buffer(arrays["vertices"] @ conversion[:3, :3].T, 5126, "VEC3", True)
        normal = buffer(arrays["normals"] @ conversion[:3, :3].T, 5126, "VEC3")
        primitives = []
        for material_id in sorted(set(arrays["material_ids"].tolist())):
            style = item["styles"][material_id] if 0 <= material_id < len(item["styles"]) else {"name": "IFC neutral", "pbrMetallicRoughness": {"baseColorFactor": [.65, .7, .74, 1], "metallicFactor": 0, "roughnessFactor": .7}}
            if style["pbrMetallicRoughness"]["baseColorFactor"][3] < 1:
                style["alphaMode"] = "BLEND"
            signature = json.dumps(style, sort_keys=True)
            if signature not in material_cache:
                material_cache[signature] = len(materials)
                materials.append(style)
            indices = arrays["faces"][arrays["material_ids"] == material_id].reshape(-1)
            primitives.append({"attributes": {"POSITION": position, "NORMAL": normal}, "indices": buffer(indices, 5125, "SCALAR"), "material": material_cache[signature]})
        mesh_by_id[geometry_id] = len(meshes)
        meshes.append({"primitives": primitives, "extras": {"sourceGeometryId": geometry_id}})
while binary.tell() % 4:
    binary.write(b"\0")
binary_size = binary.tell()
binary.close()

records, nodes, node_indices, world_matrices, parents, classes, systems, ports = [], [], {}, {}, {}, {}, {}, {}
schema = ifcopenshell.ifcopenshell_wrapper.schema_by_name(model.schema)


def safe_value(value):
    if isinstance(value, ifcopenshell.entity_instance):
        return "external:" + value.GlobalId if getattr(value, "GlobalId", None) else "express:" + str(value.id())
    if isinstance(value, (tuple, list)):
        return [safe_value(item) for item in value]
    if isinstance(value, dict):
        return {key: safe_value(item) for key, item in value.items()}
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def add_class(name):
    if name in classes:
        return
    parent = schema.declaration_by_name(name).supertype()
    classes[name] = {"id": name, "code": name, "name": name, "parentId": parent.name() if parent else "", "fields": []}
    if parent:
        add_class(parent.name())


def property_unit(unit):
    if not unit:
        return "", units[""]
    if not unit.is_a("IfcDerivedUnit"):
        symbol = unit_util.get_unit_symbol(unit)
        return symbol, units.get(normalized(symbol))
    components = []
    scale = 1
    for element in unit.Elements:
        symbol, definition = property_unit(element.Unit)
        components.append(symbol + "^" + str(element.Exponent))
        if not definition or definition["offset"]:
            return "*".join(components), None
        scale *= definition["scale"] ** element.Exponent
    quantity = {"VOLUMETRICFLOWRATEUNIT": "volumeFlow", "PRESSUREUNIT": "pressure", "LINEARVELOCITYUNIT": "velocity"}.get(unit.UnitType)
    canonical = next((item for item in catalog["units"] if item["quantity"] == quantity and math.isclose(item["scale"], scale, rel_tol=1e-12)), None)
    return "*".join(components), canonical


def properties_for(entity, owner, scope):
    result = {}
    for group, values in element_util.get_psets(owner, should_inherit=False, verbose=True).items():
        if not isinstance(values, dict):
            continue
        for name, description in values.items():
            if name == "id":
                continue
            path = group + "." + name
            raw = safe_value(description.get("value") if isinstance(description, dict) else description)
            prop = model.by_id(description["id"]) if isinstance(description, dict) and description.get("id") else None
            unit, raw_unit, canonical = None, "", units[""]
            if prop:
                try:
                    unit = unit_util.get_property_unit(prop, model, use_cache=True)
                    raw_unit, canonical = property_unit(unit)
                except Exception as error:
                    canonical = None
                    property_issues.append({"sourceElementId": "external:" + entity.GlobalId, "path": path, "error": str(error)[:300]})
            if canonical is None:
                property_issues.append({"sourceElementId": "external:" + entity.GlobalId, "path": path, "error": "unsupported unit retained: " + raw_unit})
            provenance = {"path": path, "rawValue": raw, "rawUnit": raw_unit, "modelRevision": source_sha, "sourceElementId": "external:" + entity.GlobalId, "origin": "source", "scope": scope, "ownerId": "external:" + owner.GlobalId if getattr(owner,"GlobalId",None) else "express:" + str(owner.id()), "expressId": prop.id() if prop else None, "unitDefinition": safe_value(unit.get_info(recursive=True)) if unit else None}
            result[path] = {"value": raw, "unit": canonical["id"] if canonical else raw_unit, "source": provenance}
            field_type = "boolean" if isinstance(raw, bool) else "number" if isinstance(raw, (int, float)) else "string"
            if raw is not None and not isinstance(raw, (list, dict)) and not any(field["id"] == path for field in classes[entity.is_a()]["fields"]):
                unit_id = canonical["id"] if canonical and field_type == "number" else ""
                classes[entity.is_a()]["fields"].append({"id": path, "name": path, "dataType": field_type, "unit": unit_id, "precision": 3, "required": False, "sourcePath": path, "sourceUnit": unit_id, "emptyPolicy": "keep", "defaultValue": ""})
    return result


for system in sorted(model.by_type("IfcSystem"), key=lambda item: item.GlobalId or ""):
    sid = "external:" + system.GlobalId
    members = ["external:" + entity.GlobalId for entity in system_util.get_system_elements(system) if getattr(entity, "GlobalId", None)]
    systems[sid] = {"id": sid, "name": system.Name or system.is_a(), "type": system.is_a(), "elementIds": sorted(set(members)), "ports": [], "connections": []}

for entity in products:
    guid = entity.GlobalId
    add_class(entity.is_a())
    properties = {"IfcClass": entity.is_a(), "GlobalId": guid, "Name": entity.Name or ""}
    type_owner = element_util.get_type(entity)
    for owner, scope in [(type_owner, "type"), (entity, "instance")]:
        if owner:
            try:
                properties.update(properties_for(entity, owner, scope))
            except Exception as error:
                property_issues.append({"sourceElementId": "external:" + guid, "scope": scope, "error": str(error)[:500]})
    links = []
    container, parent = element_util.get_container(entity), element_util.get_aggregate(entity)
    for kind, related in [("space", container), ("parent", parent)]:
        if related and getattr(related, "GlobalId", None):
            links.append({"kind": kind, "targetId": "external:" + related.GlobalId})
    chosen_parent = parent or container
    parents[guid] = chosen_parent.GlobalId if chosen_parent and getattr(chosen_parent, "GlobalId", None) in by_guid else None
    entity_ports = system_util.get_ports(entity)
    identities = {"external:" + guid, *("external:" + port.GlobalId for port in entity_ports)}
    member_systems = [sid for sid, system in systems.items() if identities.intersection(system["elementIds"])]
    record_ports = []
    for sid in member_systems:
        if "external:" + guid not in systems[sid]["elementIds"]:
            systems[sid]["elementIds"].append("external:" + guid)
    for port in entity_ports:
        pid = "external:" + port.GlobalId
        definition = {"id": pid, "name": port.Name or "Port", "elementId": "external:" + guid, "direction": {"SINK": "in", "SOURCE": "out", "SOURCEANDSINK": "both"}.get(port.FlowDirection, "unknown"), "type": getattr(port, "PredefinedType", None) or port.is_a(), "systemId": member_systems[0] if len(member_systems) == 1 else ""}
        record_ports.append(definition)
        ports[pid] = definition
        for sid in member_systems:
            systems[sid]["ports"].append({**definition, "systemId": sid})
    records.append({"id": guid, "sourceElementId": "external:" + guid, "name": entity.Name or entity.is_a(), "classId": entity.is_a(), "properties": properties, "links": links, "ports": record_ports, "systems": member_systems, "modelRevision": ""})
    centre = np.eye(4)
    if guid in geometry_nodes:
        centre[:3, 3] = geometries[geometry_nodes[guid]]["centre"]
    world_matrices[guid] = conversion @ placements[guid] @ centre @ inverse_conversion
    node = {"name": entity.Name or entity.is_a(), "extras": {"GlobalId": guid, "IfcClass": entity.is_a(), "sourceElementId": guid}}
    if guid in geometry_nodes:
        node["mesh"] = mesh_by_id[geometry_nodes[guid]]
    node_indices[guid] = len(nodes)
    nodes.append(node)

records_by_id = {record["sourceElementId"]: record for record in records}
for relation in sorted(model.by_type("IfcRelConnectsPorts"), key=lambda item: item.GlobalId):
    source_port, target_port = "external:" + relation.RelatingPort.GlobalId, "external:" + relation.RelatedPort.GlobalId
    if source_port not in ports or target_port not in ports:
        property_issues.append({"path": relation.GlobalId, "error": "connection references a port without an owning product"})
        continue
    a, b = ports[source_port], ports[target_port]
    if a["direction"] == "in" and b["direction"] == "out":
        source_port, target_port, a, b = target_port, source_port, b, a
    direction = "forward" if a["direction"] == "out" and b["direction"] == "in" else "both"
    connection = {"id": "external:" + relation.GlobalId, "fromPortId": source_port, "toPortId": target_port, "kind": "connects", "direction": direction}
    for system in systems.values():
        if a["elementId"] in system["elementIds"] and b["elementId"] in system["elementIds"]:
            system["connections"].append(connection)
    records_by_id[a["elementId"]]["links"].append({"kind": "connects", "targetId": b["elementId"], "sourcePortId": source_port, "targetPortId": target_port, "direction": direction})
    records_by_id[b["elementId"]]["links"].append({"kind": "connectedFrom", "targetId": a["elementId"], "sourcePortId": target_port, "targetPortId": source_port, "direction": direction})

roots = []
for guid, index in node_indices.items():
    parent = parents[guid]
    seen, cursor = {guid}, parent
    while cursor:
        if cursor in seen:
            raise ValueError("IFC semantic hierarchy cycle: " + guid)
        seen.add(cursor)
        cursor = parents.get(cursor)
    if parent:
        matrix = np.linalg.inv(world_matrices[parent]) @ world_matrices[guid]
        nodes[node_indices[parent]].setdefault("children", []).append(index)
    else:
        matrix = world_matrices[guid].copy()
        matrix[:3, 3] -= origin_gltf
        roots.append(index)
    nodes[index]["matrix"] = matrix.flatten(order="F").tolist()

asset = {"version": "2.0", "generator": "WebGL Studio 2.3 / IfcOpenShell 0.8.3.post2", "extras": {"sourceSchema": model.schema, "sourceUnitToMetre": unit_scale, "localOriginMetres": origin.tolist(), "localOriginGltfMetres": origin_gltf.tolist(), "sourceSha256": source_sha, "sourceFileSha256": file_sha, "readOnly": True}}
gltf = {"asset": asset, "scene": 0, "scenes": [{"nodes": roots}], "nodes": nodes}
if binary_size:
    gltf.update(meshes=meshes, materials=materials, buffers=[{"byteLength": binary_size}], bufferViews=views, accessors=accessors)
encoded = json.dumps(gltf, separators=(",", ":"), allow_nan=False).encode()
encoded += b" " * ((-len(encoded)) % 4)
with (output / "derived.glb").open("wb") as target:
    target.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(encoded) + (8 + binary_size if binary_size else 0)))
    target.write(struct.pack("<II", len(encoded), 0x4E4F534A))
    target.write(encoded)
    if binary_size:
        target.write(struct.pack("<II", binary_size, 0x004E4942))
        with binary_path.open("rb") as data:
            shutil.copyfileobj(data, target)
metadata = {"classes": sorted(classes.values(), key=lambda item: item["id"]), "systems": list(systems.values()), "propertyTemplates": [], "sourceSchema": model.schema, "sourceSha256": source_sha, "sourceFileSha256": file_sha, "unitCatalogVersion": catalog["version"]}
(output / "semantic-model.json").write_text(json.dumps(safe_value(metadata), allow_nan=False))
(output / "semantics.json").write_text(json.dumps(safe_value({"records": records, "sourceSchema": model.schema, "sourceSha256": source_sha, "sourceFileSha256": file_sha, "sourceUnitToMetre": unit_scale, "localOriginMetres": origin.tolist()}), allow_nan=False))
report = {"parser": "ifcopenshell@0.8.3.post2", "schema": model.schema, "threads": threads, "geometryMethod": "local multicore iterator", "products": len(products), "geometryCount": len(geometry_nodes), "uniqueGeometryCount": len(meshes), "sharedGeometryInstances": len(geometry_nodes) - len(meshes), "semanticRecords": len(records), "nonGeometryRecords": len(records) - len(geometry_nodes), "normalAttributes": len(meshes), "geometryFailures": failures, "propertyIssues": property_issues, "systems": len(systems), "ports": len(ports), "localOriginMetres": origin.tolist(), "sourceUnitToMetre": unit_scale, "worldBoundsIfcMetres": [bounds_min.tolist(), bounds_max.tolist()] if np.isfinite(bounds_min).all() else None, "status": "geometry-and-semantics" if geometry_nodes else "semantic-only", "limitations": ["Read-only tessellated geometry; not parametric CAD editing", "Rendering clipping is not CAD section area or volume", "Geometry and property issues are retained; missing tessellation is not measured hardware acceptance"]}
(output / "ifc-report.json").write_text(json.dumps(report, allow_nan=False))
binary_path.unlink()
shutil.rmtree(spool)
print(json.dumps({"stage": "IFC geometry and semantics ready", "progress": .8}), flush=True)

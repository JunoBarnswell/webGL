"""Read-only IFC -> glTF geometry + immutable semantic records. No CAD round trip."""
import json, os, sys, struct, pathlib
if sys.platform == "linux":
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (2*1024**3, 2*1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (800, 800))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2*1024**3, 2*1024**3))
if os.environ.get('STUDIO_IFC_MODULES'):
    sys.path.insert(0, os.environ['STUDIO_IFC_MODULES'])
os.environ["OPENBLAS_NUM_THREADS"]="1"
os.environ["OMP_NUM_THREADS"]="1"
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.unit
source, output = map(pathlib.Path, sys.argv[1:3])
model = ifcopenshell.open(str(source))
settings = ifcopenshell.geom.settings()
settings.set(settings.USE_WORLD_COORDS, True)
unit_scale = ifcopenshell.util.unit.calculate_unit_scale(model)
products = sorted(model.by_type('IfcProduct'), key=lambda e: getattr(e, 'GlobalId', ''))
binary = bytearray(); views = []; accessors = []; meshes = []; nodes = []; records = []; failures = []; origin = None
materials = [{'name': 'IFC neutral', 'pbrMetallicRoughness': {'baseColorFactor': [.65,.7,.74,1], 'metallicFactor': 0, 'roughnessFactor': .7}}]

def buffer(values, fmt, component, count, kind, bounds=None):
    while len(binary) % 4: binary.append(0)
    offset = len(binary)
    binary.extend(struct.pack('<' + fmt * len(values), *values))
    view = len(views); views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary)-offset})
    accessor = {'bufferView': view, 'componentType': component, 'count': count, 'type': kind}
    if bounds: accessor.update(min=bounds[0], max=bounds[1])
    accessors.append(accessor); return len(accessors)-1

for index, entity in enumerate(products):
    guid = getattr(entity, 'GlobalId', '')
    if not guid: continue
    properties = {'IfcClass': entity.is_a(), 'GlobalId': guid, 'Name': entity.Name or ''}
    for group, values in ifcopenshell.util.element.get_psets(entity).items():
        if isinstance(values, dict):
            for key, value in values.items():
                if key != 'id': properties[group + '.' + key] = value
    links = []
    container = ifcopenshell.util.element.get_container(entity)
    if container and getattr(container, 'GlobalId', None): links.append({'kind': 'space', 'targetId': 'external:' + container.GlobalId})
    parent = ifcopenshell.util.element.get_aggregate(entity)
    if parent and getattr(parent, 'GlobalId', None): links.append({'kind': 'parent', 'targetId': 'external:' + parent.GlobalId})
    records.append({'id': guid, 'sourceElementId': 'external:' + guid, 'name': entity.Name or entity.is_a(), 'classId': entity.is_a(), 'properties': properties, 'links': links, 'modelRevision': ''})
    if not entity.Representation: continue
    try:
        shape = ifcopenshell.geom.create_shape(settings, entity)
        vertices = list(shape.geometry.verts); faces = list(shape.geometry.faces)
        if not vertices or not faces: raise ValueError('empty geometry')
        if len(vertices)//3 > 20000000: raise ValueError('element geometry exceeds budget')
        if origin is None: origin = [vertices[0],vertices[1],vertices[2]]
        local = []
        for i in range(0,len(vertices),3):
            x,y,z = [vertices[i+j]-origin[j] for j in range(3)]
            local.extend([x,z,-y])
        lower = [min(local[i::3]) for i in range(3)]; upper = [max(local[i::3]) for i in range(3)]
        position = buffer(local,'f',5126,len(local)//3,'VEC3',(lower,upper))
        indices = buffer(faces,'I',5125,len(faces),'SCALAR')
        mesh = len(meshes); meshes.append({'primitives':[{'attributes':{'POSITION':position},'indices':indices,'material':0}]})
        nodes.append({'name': entity.Name or entity.is_a(), 'mesh':mesh, 'extras':{'GlobalId':guid,'IfcClass':entity.is_a()}})
    except Exception as error:
        failures.append({'sourceElementId':'external:'+guid,'class':entity.is_a(),'error':str(error)[:500]})
    if index % 100 == 0: print(json.dumps({'stage':'IFC geometry','progress':.1+.6*index/max(1,len(products))}),flush=True)

if not nodes: raise RuntimeError('IFC contains no supported renderable geometry; see parser/version coverage')
output.mkdir(parents=True, exist_ok=True)
gltf = {'asset':{'version':'2.0','generator':'WebGL Studio / IfcOpenShell 0.8.3.post2','extras':{'sourceSchema':model.schema,'sourceUnitToMetre':unit_scale,'localOriginMetres':origin,'localOriginGltfMetres':[origin[0],origin[2],-origin[1]],'readOnly':True}}, 'scene':0,'scenes':[{'nodes':list(range(len(nodes)))}], 'nodes':nodes,'meshes':meshes,'materials':materials,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
encoded = json.dumps(gltf,separators=(',',':')).encode(); encoded += b' '*((-len(encoded))%4)
binary.extend(b'\0'*((-len(binary))%4))
length = 12+8+len(encoded)+8+len(binary)
(output/'derived.glb').write_bytes(struct.pack('<III',0x46546C67,2,length)+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+struct.pack('<II',len(binary),0x004E4942)+binary)
(output/'semantics.json').write_text(json.dumps({'records':records,'sourceSchema':model.schema,'unit':'m','sourceUnitToMetre':unit_scale,'localOriginMetres':origin},default=str))
(output/'ifc-report.json').write_text(json.dumps({'parser':'ifcopenshell@0.8.3.post2','schema':model.schema,'products':len(products),'geometryCount':len(nodes),'semanticRecords':len(records),'geometryFailures':failures,'localOriginMetres':origin,'sourceUnitToMetre':unit_scale,'limitations':['Read-only tessellated geometry; not a parametric CAD editor','Unsupported representations are listed explicitly','IFC Z-up is converted to glTF Y-up; source world placement is retained by root translation','Large-coordinate origin is recorded; rendered coordinates are local metres']},default=str))

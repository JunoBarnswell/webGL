"""Discover explicitly installed converters; never download or execute project scripts."""
from pathlib import Path
import shutil,sys,shlex
root=Path(__file__).resolve().parents[1]
ktx=next((root/'.local/tools/ktx').rglob('toktx'),None) if (root/'.local/tools/ktx').exists() else None
values={'STUDIO_NODE':shutil.which('node') or 'node','STUDIO_IFC_PYTHON':sys.executable,'STUDIO_WORKER_ROOT':str(root/'artifacts/linux/workers')}
if (root/'.local/tools/ifc/ifcopenshell').is_dir():values['STUDIO_IFC_MODULES']=str(root/'.local/tools/ifc')
if ktx:values['STUDIO_TOKTX']=str(ktx)
target=root/'.local/converters.sh';target.parent.mkdir(exist_ok=True);target.write_text('\n'.join('export '+key+'='+shlex.quote(value) for key,value in values.items())+'\n')
print('Converter paths configured (no credentials)')

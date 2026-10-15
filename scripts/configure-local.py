#!/usr/bin/env python3
"""Create local-only configuration. Never print generated credentials."""
import json, pathlib, secrets, shlex
root=pathlib.Path(__file__).resolve().parents[1]
directory=root/'.local'
directory.mkdir(exist_ok=True)
config_path=directory/'config.json'
if config_path.exists():
    config=json.loads(config_path.read_text())
else:
    config={'adminUser':'admin','adminPassword':secrets.token_urlsafe(24),'jwtKey':secrets.token_hex(32),'mysqlPassword':secrets.token_urlsafe(24),'mysqlRootPassword':secrets.token_urlsafe(32),'s3AccessKey':'studio-admin','s3SecretKey':secrets.token_urlsafe(32)}
    config_path.write_text(json.dumps(config,indent=2)+'\n')
    config_path.chmod(0o600)
if 'mysqlRootPassword' not in config:
    import subprocess
    try:
        config['mysqlRootPassword']=subprocess.check_output(['docker','exec','webgl-studio-mysql','sh','-c','printf %s "$MYSQL_ROOT_PASSWORD"'],text=True)
    except (subprocess.CalledProcessError,FileNotFoundError):
        config['mysqlRootPassword']=secrets.token_urlsafe(32)
    config_path.write_text(json.dumps(config,indent=2)+'\n')
    config_path.chmod(0o600)
values={
 'STUDIO_ADMIN_USER':config['adminUser'],'STUDIO_ADMIN_PASSWORD':config['adminPassword'],'STUDIO_JWT_KEY':config['jwtKey'],
 'STUDIO_MYSQL':'Server=127.0.0.1;Port=13306;Database=webgl_studio;User ID=studio;Password='+config['mysqlPassword']+';Allow User Variables=True;Maximum Pool Size=20',
 'STUDIO_S3_ENDPOINT':'http://127.0.0.1:19000','STUDIO_S3_ACCESS_KEY':config['s3AccessKey'],'STUDIO_S3_SECRET_KEY':config['s3SecretKey'],'STUDIO_S3_BUCKET':'webgl-studio',
 'MYSQL_DATABASE':'webgl_studio','MYSQL_USER':'studio','MYSQL_PASSWORD':config['mysqlPassword'],'MYSQL_ROOT_PASSWORD':config['mysqlRootPassword'],
 'MINIO_ROOT_USER':config['s3AccessKey'],'MINIO_ROOT_PASSWORD':config['s3SecretKey']
}
for name,content in [('config.env',''.join(k+'='+v+'\n' for k,v in values.items())),('config.sh',''.join('export '+k+'='+shlex.quote(v)+'\n' for k,v in values.items()))]:
    path=directory/name
    path.write_text(content)
    path.chmod(0o600)
for name in ['data/mysql','data/minio','logs','cache/nuget','staging']:
    (directory/name).mkdir(parents=True,exist_ok=True)

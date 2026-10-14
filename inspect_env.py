import urllib.request
import re

url = 'https://itw-automotive.flux-cms.de/assets/js/index-MVzoL2DF.js'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=60) as resp:
    data = resp.read().decode('utf-8', errors='ignore')

# Check environment map
env_matches = re.findall(r'["\']([^"\']+\.(?:env|hdr|dds|jpg|png))["\']', data)
for m in set(env_matches):
    if any(k in m.lower() for k in ['env', 'sky', 'studio', 'light', 'diffuse', 'specular', 'lut', 'ground', 'shadow']):
        print('Env match:', m)

# Check gltf path prefix
gltf_sample = re.findall(r'["\']([^"\']*LuxurySUV[^"\']*)["\']', data)
print('LuxurySUV mentions:', set(gltf_sample))

# Check where files are hosted
base_urls = re.findall(r'https?://[^\s"\'<>()]+', data)
cdn_hosts = set()
for u in base_urls:
    if any(ext in u for ext in ['.gltf', '.glb', '.mp4', '.png']):
        print('Asset URL:', u)

import urllib.request
import re

url = 'https://itw-automotive.flux-cms.de/assets/js/index-MVzoL2DF.js'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=60) as resp:
    data = resp.read().decode('utf-8', errors='ignore')

# Babylon engine search
print('Babylon occurrences:', len(re.findall(r'babylonjs|@babylonjs', data, re.I)))
babylon_ver = re.findall(r'Babylon\.js\s*v([0-9\.]+)', data, re.I)
print('Babylon version:', babylon_ver)

# Look for camera
cameras = re.findall(r'ArcRotateCamera', data)
print('ArcRotateCamera count:', len(cameras))

# Look for environment files (.env)
envs = re.findall(r'["\']([^"\']+\.env)["\']', data)
print('Environment (.env) files:', set(envs))

# Look for image / texture assets
textures = re.findall(r'["\']([^"\']+\.(?:png|jpg|jpeg|webp))["\']', data)
print(f'Textures count: {len(textures)}, unique: {len(set(textures))}')
print('Sample textures:', list(set(textures))[:15])

# Look for UI framework (Vue 3, Pinia, React?)
is_vue3 = 'createApp' in data and '__v_isRef' in data
print('Is Vue 3:', is_vue3)
is_react = 'useState' in data and 'useRef' in data
print('Is React:', is_react)

# Look for hot spots / annotations / pins
pins = re.findall(r'["\']([^"\']*(?:hotspot|pin|annotation|marker|tag)[^"\']*)["\']', data, re.I)
print('Pins/Hotspots matches:', set(pins[:20]))

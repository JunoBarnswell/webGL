import urllib.request
import re

url = 'https://itw-automotive.flux-cms.de/assets/js/index-MVzoL2DF.js'
print("Fetching ITW JS bundle...")
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=60) as resp:
    data = resp.read().decode('utf-8', errors='ignore')

print("Loaded bytes:", len(data))

# Find frameworks
keywords = [
    'three', 'GLTFLoader', 'DRACOLoader', 'OrbitControls', 'EffectComposer',
    'UnrealBloomPass', 'CSS2DRenderer', 'CSS3DRenderer', 'MeshStandardMaterial',
    'MeshPhysicalMaterial', 'vue', 'react', 'pinia', 'vuex', 'redux', 'gsap',
    'tween', 'howler', 'animejs', 'lenis', 'locomotive'
]

for kw in keywords:
    matches = len(re.findall(kw, data, re.IGNORECASE))
    print(f"Keyword '{kw}': {matches} occurrences")

# Find gltf files and textures
gltfs = set(re.findall(r'["\']([^"\']+\.gltf)["\']', data))
print(f"\nGLTF files found ({len(gltfs)}):")
for g in sorted(list(gltfs))[:15]:
    print("  -", g)

glbs = set(re.findall(r'["\']([^"\']+\.glb)["\']', data))
print(f"\nGLB files found ({len(glbs)}):")
for g in sorted(list(glbs))[:15]:
    print("  -", g)

hdrs = set(re.findall(r'["\']([^"\']+\.hdr)["\']', data))
print(f"\nHDR files found ({len(hdrs)}):")
for h in sorted(list(hdrs)):
    print("  -", h)

# Check car chassis model
car_models = [g for g in gltfs | glbs if any(w in g.lower() for w in ['car', 'chassis', 'vehicle', 'ev', 'body', 'auto', 'base'])]
print(f"\nCar-related 3D models ({len(car_models)}):")
for c in car_models[:10]:
    print("  -", c)

# Check Vue/React component names or routing
routes = set(re.findall(r'path:\s*["\']([^"\']+)["\']', data))
print(f"\nRoutes found ({len(routes)}):", list(routes)[:10])

# Check situations or categories
situations = set(re.findall(r'SituationID[=:]\s*([0-9]+)', data))
print(f"Situation IDs:", situations)

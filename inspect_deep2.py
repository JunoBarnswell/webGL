import urllib.request
import re
import json

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'}

def get_text(url):
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return f"Error: {e}"

print("=== 1. FLASHV8 INSPECTION ===")
web_json = get_text('https://www.flashv8.com/testfiles/gsvh_n/m/Build/Web.json')
print("Web.json snippet:\n", web_json[:1000])

print("\n=== 2. NUMIX CONSTELLIUM INSPECTION ===")
main_js = get_text('https://constellium.automotive.numix.fr/TemplateData/main.js')
print("main.js:\n", main_js[:1500])
uf_js = get_text('https://constellium.automotive.numix.fr/TemplateData/UnityFunctions.js')
print("UnityFunctions.js snippet:\n", uf_js[:1500])

# Check if there is a json in Release/
release_json_url = 'https://constellium.automotive.numix.fr/Release/ConstelliumAutomotiveProducts_v1-3-1.json'
print("Checking release json:", get_text(release_json_url)[:500])

print("\n=== 3. ITW AUTOMOTIVE INSPECTION ===")
req = urllib.request.Request('https://itw-automotive.flux-cms.de/assets/js/index-MVzoL2DF.js', headers=headers)
with urllib.request.urlopen(req, timeout=30) as r:
    # Read first 1MB and search
    content = r.read().decode('utf-8', errors='ignore')

print("ITW JS total len:", len(content))

# Look for Framework signatures
patterns = {
    'Three.js': r'THREE|WebGLRenderer|PerspectiveCamera|GLTFLoader|OrbitControls',
    'Babylon.js': r'BABYLON|EngineStore|ArcRotateCamera|SceneLoader',
    'Vue': r'createApp|vue|__vue_app__|\.mount\(',
    'React': r'React|ReactDOM|useRef|useEffect|jsx',
    'Svelte': r'svelte',
    'GSAP': r'gsap|TweenMax|ScrollTrigger',
    'Postprocessing': r'EffectComposer|UnrealBloomPass|SSAO',
    'Cannon/Rapier': r'CANNON|RAPIER|ammo',
}

for name, pat in patterns.items():
    matches = re.findall(pat, content)
    print(f"{name}: {len(matches)} matches")

# Find gltf URLs or base paths
gltfs = re.findall(r'["\']([^"\']+\.gltf)["\']', content)
print("GLTF samples (count %d):" % len(gltfs), gltfs[:10])

# Find car models / scene models
scenes = re.findall(r'["\']([^"\']*(?:car|scene|vehicle|chassis|model|showroom|environ)[^"\']*\.(?:gltf|glb|bin|obj|fbx))["\']', content, re.IGNORECASE)
print("Car/scene model matches:", set(scenes))

# Look for renderer setup snippet
renderer_match = re.search(r'([a-zA-Z0-9_$]+\s*=\s*new\s+[a-zA-Z0-9_$]*WebGLRenderer\([^)]*\)[^;]*;)', content)
if renderer_match:
    print("Renderer setup match:", renderer_match.group(1))

camera_match = re.search(r'([a-zA-Z0-9_$]+\s*=\s*new\s+[a-zA-Z0-9_$]*PerspectiveCamera\([^)]*\)[^;]*;)', content)
if camera_match:
    print("Camera setup match:", camera_match.group(1))

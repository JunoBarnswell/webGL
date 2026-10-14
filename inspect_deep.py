import urllib.request
import re
import json
from urllib.parse import urljoin

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}

def fetch(url):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode('utf-8', errors='ignore')

# 1. Inspect flashv8 HTML
html1 = fetch('https://www.flashv8.com/testfiles/gsvh_n/m/')
print("=== FLASHV8 HTML SNIPPET ===")
print(html1[:1500])
# Look for Unity instantiation or build json
match_build = re.findall(r'UnityLoader\.instantiate\([^)]+\)', html1)
print("Unity Loader call:", match_build)
# Look for egret manifest
manifest_match = re.findall(r'manifest\.json|\.json', html1)
print("JSON mentions in HTML1:", manifest_match)

# 2. Inspect Numix Constellium HTML
html2 = fetch('https://constellium.automotive.numix.fr/')
print("\n=== NUMIX CONSTELLIUM HTML SNIPPET ===")
print(html2[:1500])
main_js = fetch('https://constellium.automotive.numix.fr/TemplateData/main.js')
print("Numix main.js snippet:\n", main_js[:1000])

# 3. Inspect ITW Automotive
html3 = fetch('https://itw-automotive.flux-cms.de/?SituationID=2')
print("\n=== ITW AUTOMOTIVE HTML SNIPPET ===")
print(html3)
js3_url = urljoin('https://itw-automotive.flux-cms.de/', './assets/js/index-MVzoL2DF.js')
js3 = fetch(js3_url)
print("ITW js3 length:", len(js3))
# search 3D libraries in js3
libs = ['three', 'babylon', 'canvas', 'webgl', 'gltf', 'spline', 'pixi', 'createjs', 'spritesheet', 'panorama', 'photo-sphere-viewer', 'marzipano', 'krpano', 'matter']
found_libs = [lib for lib in libs if lib in js3.lower()]
print("Found libs/keywords in ITW JS:", found_libs)

# Look for assets, gltf, json, image URLs in ITW js3
asset_matches = re.findall(r'["\']([^"\']+\.(?:glb|gltf|bin|png|jpg|jpeg|webp|json|hdr|mp4|webm))["\']', js3, re.IGNORECASE)
print("Assets found in ITW js3:", set(asset_matches[:30]))

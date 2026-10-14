import urllib.request
import re
import json

urls = [
    'https://www.flashv8.com/testfiles/gsvh_n/m/',
    'https://constellium.automotive.numix.fr/',
    'https://itw-automotive.flux-cms.de/?SituationID=2'
]

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}

for u in urls:
    print('='*60)
    print('URL:', u)
    try:
        req = urllib.request.Request(u, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
            print('Status:', resp.status)
            print('Length:', len(content))
            title = re.search(r'<title>(.*?)</title>', content, re.IGNORECASE)
            if title:
                print('Title:', title.group(1))
            scripts = re.findall(r'<script[^>]*src=["\']([^"\']+)["\']', content, re.IGNORECASE)
            print('Scripts count:', len(scripts))
            for s in scripts:
                print('  - Script:', s)
            
            # Look for keywords in content: three, babylon, playcanvas, webgl, unity, gltf, draco, etc.
            keywords = ['three', 'babylon', 'playcanvas', 'pixi', 'unity', 'unreal', 'cesium', 'sketchfab', 'spline', 'gltf', 'glb', 'draco', 'hdr', 'ktx2', 'meshopt', 'gsap', 'tween']
            found_kw = [kw for kw in keywords if kw in content.lower()]
            print('Keywords found in HTML:', found_kw)
    except Exception as e:
        print('Error:', e)

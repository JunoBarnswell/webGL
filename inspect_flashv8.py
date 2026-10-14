import urllib.request
import json
import re

headers = {'User-Agent': 'Mozilla/5.0'}

def get_url(url):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read()

# FlashV8
try:
    data = get_url('https://www.flashv8.com/testfiles/gsvh_n/m/Build/Web.json').decode('utf-8')
    print("=== FlashV8 Web.json ===")
    print(data)
except Exception as e:
    print("FlashV8 error:", e)

# Also let's check manifest.json for Egret
try:
    egret_manifest = get_url('https://www.flashv8.com/testfiles/gsvh_n/m/manifest.json').decode('utf-8')
    print("=== FlashV8 Egret manifest ===")
    print(egret_manifest)
except Exception as e:
    print("Egret manifest error:", e)

try:
    default_res = get_url('https://www.flashv8.com/testfiles/gsvh_n/m/resource/default.res.json').decode('utf-8')
    print("=== FlashV8 Egret default.res.json (snippet) ===")
    print(default_res[:500])
except Exception as e:
    print("Egret res error:", e)

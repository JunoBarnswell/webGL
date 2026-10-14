import urllib.request
import re

url = 'https://itw-automotive.flux-cms.de/assets/js/index-MVzoL2DF.js'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=60) as resp:
    data = resp.read().decode('utf-8', errors='ignore')

idx = data.find('addMeshTask')
while idx != -1:
    print(data[idx-50:idx+200])
    print('---')
    idx = data.find('addMeshTask', idx+1)

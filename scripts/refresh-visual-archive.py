"""Refresh rules from the existing archive and validate every proposed image URL."""
import argparse,concurrent.futures as cf,hashlib,io,json,pathlib,re,struct,time,urllib.request,urllib.error
from visual_asset_rules import propose_rule

ROOT=pathlib.Path(__file__).resolve().parents[1]
HEADERS={'User-Agent':'BindexCatalog/1.0 (+https://github.com/claudio-git-poke/pokemon-catalog)'}

def fetch_json(url):
 for attempt in range(2):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=20) as r:return json.load(r)
  except Exception:
   if attempt:raise
   time.sleep(1)

def inspect_image(data):
 if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>=24:return 'image/png',*struct.unpack('>II',data[16:24])
 # Read only literal attributes with regex; never resolve the SVG's DTD/entities.
 if b'<svg' in data[:1000] and b'<!ENTITY' not in data:
  text=data[:20000].decode('utf-8');tag=re.search(r'<svg\b[^>]*>',text).group()
  view=re.search(r'viewBox=[\"\']([^\"\']+)',tag)
  if view:
   values=re.split(r'[ ,]+',view[1].strip())
   if len(values)==4:return 'image/svg+xml',float(values[2]),float(values[3])
  dimensions=[]
  for key in ['width','height']:
   m=re.search(r'\b'+key+r'=[\"\']([0-9.]+)(?:px)?[\"\']',tag)
   if not m:raise ValueError('SVG dimensions unknown')
   dimensions.append(float(m[1]))
  return 'image/svg+xml',*dimensions
 if data.startswith(b'RIFF') and data[8:12]==b'WEBP':
  from PIL import Image
  image=Image.open(io.BytesIO(data));return 'image/webp',*image.size
 raise ValueError('Response is not a supported image')

def validate_url(url):
 for attempt in range(2):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=12) as response:
    if response.status!=200:raise ValueError('HTTP '+str(response.status))
    data=response.read(2*1024*1024+1)
    if len(data)>2*1024*1024:raise ValueError('Image exceeds 2 MiB')
    mime,w,h=inspect_image(data)
    if w<=0 or h<=0:raise ValueError('Invalid image dimensions')
    return {'status':200,'mime':mime,'width':w,'height':h,'sha256':hashlib.sha256(data).hexdigest(),'checked_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
  except Exception as error:
   if attempt: return {'error':str(error),'checked_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
   time.sleep(.4)

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--tags',required=True);parser.add_argument('--cache',required=True);parser.add_argument('--fallback-indexes');parser.add_argument('--reuse-checks',action='store_true');args=parser.parse_args()
 folder=ROOT/'data/visual-archive';files=sorted(folder.glob('[0-9]*.json'))
 rows=sum([json.loads(f.read_text()) for f in files],[])
 prior=json.loads((folder/'rules-verification.json').read_text()) if args.reuse_checks else None
 indexes=prior['indexes'] if prior else {};index_sources=prior['index_sources'] if prior else {};fallback=json.loads(pathlib.Path(args.fallback_indexes).read_text()) if args.fallback_indexes else {}
 for lang in ([] if prior else ['en','ja','de','ko']):
  try:indexes[lang]=fetch_json('https://api.tcgdex.net/v2/'+lang+'/sets');index_sources[lang]='live-tcgdex'
  except Exception:
   if lang not in fallback:raise
   indexes[lang]=fallback[lang];index_sources[lang]='previously-discovered-catalog-source-index'
  print('Index',lang,len(indexes[lang]),flush=True)
 tags=set(json.loads(pathlib.Path(args.tags).read_text()))
 rows=[propose_rule(row,indexes,tags) for row in rows]
 urls=sorted({r['image_url'] for r in rows if r['match_mode']})
 cache=pathlib.Path(args.cache);cache.mkdir(parents=True,exist_ok=True)
 report=cache/'image-checks.json';checks=json.loads(report.read_text()) if report.exists() else {}
 pending=[url for url in urls if url not in checks or ('error' in checks[url] and (not args.reuse_checks or checks[url]['error']=='Response is not a supported image'))]
 with cf.ThreadPoolExecutor(8) as pool:
  for i,(url,result) in enumerate(zip(pending,pool.map(validate_url,pending))):
   checks[url]=result
   if i%25==0:
    report.write_text(json.dumps(checks,ensure_ascii=False));print('Checked',i+1,'/',len(pending),flush=True)
 report.write_text(json.dumps(checks,ensure_ascii=False))
 failed=[];enabled=0
 for row in rows:
  if not row['match_mode']:continue
  check=checks[row['image_url']];reason=check.get('error')
  if not reason and row['kind']=='set_symbol' and ((check['mime']=='image/png' and max(check['width'],check['height'])>600) or max(check['width'],check['height'])>3*min(check['width'],check['height'])):reason='not-a-compact-symbol'
  if reason:
   failed.append({'asset_key':row['asset_key'],'url':row['image_url'],'reason':reason})
   row['provenance']['rule_exclusion']=reason;row['match_mode']=None;row['tag_code']=None;row['tag_codes']=[];row['match_code']=None
   if reason in {'not-a-compact-symbol','Image exceeds 2 MiB'} and row['kind']=='set_symbol':row['scope']='reference'
   if 'HTTP Error 404' in reason or 'HTTP Error 410' in reason:
    row['provenance']['unavailable_image_url']=row['image_url'];row['image_url']=None;row['availability']='local-only'
  else:
   row['provenance'].pop('rule_exclusion',None)
   if row['image_sha256']!=check['sha256']:row['provenance'].setdefault('archive_image_sha256',row['image_sha256'])
   row['image_sha256']=check['sha256'];row['mime_type']=check['mime']
   row['provenance']['image_validation']={k:check[k] for k in ['status','width','height','checked_at']};enabled+=1
 for n in range(0,len(rows),100):
  (folder/f'{n//100:03}.json').write_text(json.dumps(rows[n:n+100],ensure_ascii=False,separators=(',',':'))+'\n')
 summary=json.loads((folder/'summary.json').read_text());summary.update(rules=enabled,validated_rule_urls=len(urls),disabled_image_rules=len(failed),
  available=sum(r['availability']=='available' for r in rows),**{'local-only':sum(r['availability']=='local-only' for r in rows)},
  validated_unique_image_hashes=len({r['image_sha256'] for r in rows if r['match_mode']}))
 (folder/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
 excluded=[{'asset_key':r['asset_key'],'reason':r['provenance']['rule_exclusion']} for r in rows if r['provenance'].get('rule_exclusion')]
 (folder/'rules-verification.json').write_text(json.dumps({'checked_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'enabled_references':enabled,'checked_urls':len(urls),'disabled_references':failed,'excluded_references':excluded,'tag_codes':sorted(tags),'indexes':indexes,'index_sources':index_sources},ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps(summary),flush=True)

if __name__=='__main__':main()

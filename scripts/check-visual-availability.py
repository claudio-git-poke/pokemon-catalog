"""GET reported asset URLs; only definitive failures change availability. Never change a rule."""
import argparse,concurrent.futures as cf,datetime,json,pathlib,re,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
def image_bytes(body):
 prefix=re.sub(br'^(?:\s|\xef\xbb\xbf|<\?xml[^>]*\?>|<!--.*?-->)*',b'',body[:2000],flags=re.S)
 return (body.startswith(b'\x89PNG\r\n\x1a\n') and len(body)>=24) or body.startswith(b'\xff\xd8\xff') or body.startswith((b'GIF87a',b'GIF89a')) or (body.startswith(b'RIFF') and body[8:12]==b'WEBP') or (prefix.startswith(b'<svg') and b'<!ENTITY' not in body)
def check_url(url):
 at=datetime.datetime.now(datetime.timezone.utc).isoformat()
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'BindexCatalog/1.0'}),timeout=15) as r:
   body=r.read(2*1024*1024)
   valid=bool(image_bytes(body));content_type=r.headers.get('Content-Type','')
   if not valid and content_type.startswith('image/'):return {'status':r.status,'image':None,'error':'Unsupported image format; review required','content_type':content_type,'checked_at':at}
   return {'status':r.status,'image':valid,'content_type':content_type,'checked_at':at}
 except urllib.error.HTTPError as e:return {'status':e.code,'image':False,'checked_at':at}
 except Exception as e:return {'error':str(e),'checked_at':at}
def definitive_missing(result):
 return result.get('status') in (404,410) or(result.get('status')==200 and result.get('image') is False)
def apply_check(row,result):
 if row['match_mode'] is not None or not definitive_missing(result):return row
 return {**row,'availability':'missing','image_url':None,'provenance':{**row['provenance'],
  'unavailable_image_url':row['image_url'],'availability_check':result}}
def main():
 p=argparse.ArgumentParser();p.add_argument('--urls',required=True);p.add_argument('--report',required=True);p.add_argument('--apply',action='store_true');args=p.parse_args()
 urls=json.loads(pathlib.Path(args.urls).read_text());checks={}
 with cf.ThreadPoolExecutor(max_workers=8) as pool:
  for url,result in zip(urls,pool.map(check_url,urls)):checks[url]=result
 pathlib.Path(args.report).write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
 changed=0
 if args.apply:
  for path in sorted((ROOT/'data/visual-archive').glob('[0-9]*.json')):
   rows=json.loads(path.read_text());updated=[]
   for row in rows:
    revised=apply_check(row,checks[row['image_url']]) if row['image_url'] in checks else row
    changed+=revised!=row;updated.append(revised)
   if rows!=updated:path.write_text(json.dumps(updated,ensure_ascii=False,separators=(',',':'))+'\n')
  rows=sum([json.loads(f.read_text()) for f in (ROOT/'data/visual-archive').glob('[0-9]*.json')],[])
  path=ROOT/'data/visual-archive/summary.json';summary=json.loads(path.read_text())
  for value in ('available','missing','local-only'):summary[value]=sum(r['availability']==value for r in rows)
  path.write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps({'checked':len(checks),'definitive_missing':sum(map(definitive_missing,checks.values())),'changed':changed,'deferred':sum('error'in r or r.get('status') not in (200,404,410) for r in checks.values())}),flush=True)
if __name__=='__main__':main()

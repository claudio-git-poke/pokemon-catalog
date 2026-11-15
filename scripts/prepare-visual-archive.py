"""Read the supplied archive as data; never execute its downloader or HTML."""
import sys,zipfile,json,hashlib,pathlib,urllib.parse,struct,collections
archive=pathlib.Path(sys.argv[1]);root=pathlib.Path(__file__).resolve().parents[1]
pack='pokemon-symbols-v8-2026-11-15'
cache={};records=[];stats=collections.Counter()
def https(value):
 try:
  u=urllib.parse.urlsplit(value or '')
  return value if u.scheme=='https' and u.hostname and not u.username and not u.password else None
 except ValueError:return None
with zipfile.ZipFile(archive) as z:
 prefix=next(n[:-len('inventario.json')] for n in z.namelist() if n.endswith('/Pokemon_TCG_Simboli/inventario.json'))
 rows=json.loads(z.read(prefix+'inventario.json'))['record'];names=set(z.namelist())
 for row in rows:
  local=row.get('file_locale','');p=pathlib.PurePosixPath(local)
  if p.is_absolute() or '..' in p.parts or '\\' in local:raise ValueError('Unsafe archive path')
  if local not in cache:
   data=z.read(prefix+local) if prefix+local in names else None
   sha=hashlib.sha256(data).hexdigest() if data else None
   mime='image/png' if data and data.startswith(b'\x89PNG\r\n\x1a\n') else 'image/webp' if data and data.startswith(b'RIFF') and data[8:12]==b'WEBP' else 'image/svg+xml' if data and b'<svg' in data[:1000] else None
   cache[local]=(sha,mime,data)
  sha,mime,data=cache[local]
  valid=bool(sha and mime and (not row.get('sha256') or row['sha256']==sha))
  stats['references']+=1
  kind=row['categoria'];scope='digital' if kind.startswith('pocket_') else 'reference' if kind in ['set_logo','japanese_set','retailer_reference','anniversary_reference'] else 'physical'
  image=https(row.get('url_origine')) or https(row.get('url'));source=image
  if image and any(x in urllib.parse.urlsplit(image).path.lower() for x in ['/tcgp/','/pocket/']):scope='digital'
  matcher=None;tag=None
  lang=row.get('lingua','non_specificata');lang=lang if lang!='non_specificata' else 'und'
  if scope=='physical' and valid and kind=='promo_stamp' and row.get('tipo_asset')=='timbro_isolato' and row['id'] in ['1st-edition','trick-or-trade']:
   suffix='.png' if mime=='image/png' else '.webp';target=root/'public/visual-symbols'/(sha+suffix);target.write_bytes(data)
   image='https://pokemon-catalog-zeta.vercel.app/visual-symbols/'+target.name
   matcher='tag';tag='stamp:'+row['id']
  elif scope=='physical' and valid and kind=='set_symbol' and row['fonte']=='TCGdex' and row.get('fonte_immagine_effettiva')=='TCGdex' and image and '/univ/' in image and mime=='image/png' and row['id']!='base1':matcher='tcgdex-set'
  if not valid:image=None;matcher=None
  status='available' if valid and image else 'local-only' if valid else 'missing'
  identity=[row['fonte'],kind,row['id'],lang,local]
  key=hashlib.sha256(json.dumps(identity,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()[:32]
  records.append(dict(asset_key=key,kind=kind,source_code=row['id'],source_language=lang,name=row.get('nome') or row['id'],scope=scope,image_url=image,source_url=source,image_sha256=sha if valid else None,mime_type=mime if valid else None,availability=status,match_mode=matcher,tag_code=tag,original_path=local,source_pack=pack,provenance={'source':row['fonte'],'effective_source':row.get('fonte_immagine_effettiva'),'reported_status':row.get('stato'),'note':row.get('nota','')}))
  stats[status]+=1
 stats['local_files']=sum(bool(x[0] and x[1]) for x in cache.values());stats['unique_image_hashes']=len(set(x[0] for x in cache.values() if x[0] and x[1]));stats['rules']=sum(bool(r['match_mode']) for r in records)
 folder=root/'data/visual-archive'
 for n in range(0,len(records),100):(folder/f'{n//100:03}.json').write_text(json.dumps(records[n:n+100],ensure_ascii=False,separators=(',',':'))+'\n')
 (folder/'summary.json').write_text(json.dumps(dict(stats),indent=2)+'\n')
 print(json.dumps(stats))

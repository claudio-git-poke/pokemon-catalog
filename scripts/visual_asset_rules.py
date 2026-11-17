"""Conservative, deterministic visual rules. Card data is never changed here."""
import re,urllib.parse

RARITIES={
 'common':['common','c'],'uncommon':['uncommon','u'],'rare':['rare','r'],
 'double-rare':['double-rare','rr'],'ultra-rare':['ultra-rare','sr'],
 'illustration-rare':['illustration-rare','ar'],'special-illustration-rare':['special-illustration-rare','sar'],
 'hyper-rare':['hyper-rare','ur'],'mega-hyper-rare':['mega-hyper-rare','mur'],
 'mega-attack-rare':['mega-attack-rare'],'promo':['promo'],
 'shiny-rare':['shiny-rare','s'],'shiny-ultra-rare':['shiny-ultra-rare','ssr'],
}
TYPES={'colorless','darkness','dragon','fairy','fighting','fire','grass','lightning','metal','psychic','water'}
SET_SOURCES={'TCGdex','PokemonSymbols','Xero_Community','1niceroli_AssetRepo','SilphGhost','PokemonTCG_Storico'}

def norm(value):
 return re.sub('[^a-z0-9]','',str(value).lower().replace('&','and'))

def resolve_set(row,sets):
 """Require a unique answer at the strongest matching level; never choose a collision."""
 code=norm(row['source_code'])
 levels=[[(s['id'],norm(s['id'])) for s in sets],
         [(s['id'],norm(re.sub(r'(?<=[a-z])0+(?=\d)','',s['id'].lower()).replace('.','pt'))) for s in sets]]
 for pairs in levels:
  matches={key for key,value in pairs if value==code}
  if matches:return (next(iter(matches)),'id' if pairs is levels[0] else 'alternate-id') if len(matches)==1 else (None,'ambiguous')
 names={norm(row['source_code']),norm(row.get('name',''))}-{''}
 matches={s['id'] for s in sets if norm(s.get('name','')) in names}
 return (next(iter(matches)),'source-name') if len(matches)==1 else (None,'ambiguous' if matches else 'unmapped')

def propose_rule(row,indexes,available_tags):
 prior_tag=row.get('tag_code')
 row={**row,'provenance':dict(row.get('provenance') or {}),'match_code':None,'tag_codes':[]}
 row['match_mode']=None;row['tag_code']=None
 kind,code=row['kind'],row['source_code']
 if kind=='set_symbol' and row.get('mime_type')=='image/svg+xml' and row['provenance'].get('rule_exclusion')=='not-a-compact-symbol':
  row['scope']='physical';row['provenance'].pop('rule_exclusion',None)
 if kind=='set_symbol' and norm(code)=='base1':
  row['scope']='reference';row['provenance']['rule_exclusion']='base-set-has-no-printed-symbol';return row
 if row['scope']!='physical' or row['availability']!='available' or not row.get('image_sha256') or not row.get('image_url'):return row
 if kind=='promo_stamp' and code in {'1st-edition','trick-or-trade'} and '/visual-symbols/' in row['image_url']:
  row['match_mode']='tag';row['tag_code']='stamp:'+code;row['tag_codes']=[row['tag_code']];return row
 if kind=='rarity' and code in RARITIES:
  tags=['rarity:'+t for t in RARITIES[code]]
 elif kind=='energy' and code.removeprefix('tcg-') in TYPES:
  tags=['type:'+code.removeprefix('tcg-')]
  tags=[t for t in tags if t in available_tags]
 else:tags=[]
 if tags:
  row.update(match_mode='tag',tag_code=prior_tag if prior_tag in tags else tags[0],tag_codes=tags);return row
 if kind!='set_symbol' or row['provenance'].get('source') not in SET_SOURCES:return row
 u=urllib.parse.urlsplit(row['image_url'])
 if u.hostname=='raw.githubusercontent.com' and re.fullmatch('/1niceroli/ptcg-assets/main/sv0?9/symbol.png',u.path):
  row['scope']='reference';row['provenance']['rule_exclusion']='text-placeholder-sv9';return row
 if row['provenance'].get('source')=='TCGdex':
  if row['provenance'].get('effective_source')!='TCGdex':return row
  # Keep the exact source identifier and language. Do not translate regional set codes.
  match,method=code,'original-tcgdex-id'
  row['image_url']=row['image_url'].replace('/univ/','/en/')
 else:
  lang=row['source_language'] if row['source_language']!='und' else 'en'
  match,method=resolve_set(row,indexes.get(lang,[]))
 if match and norm(match)=='base1':
  row['scope']='reference';row['provenance']['rule_exclusion']='base-set-has-no-printed-symbol';return row
 if match:
  row.update(match_mode='tcgdex-set',match_code=match)
  row['provenance']['set_match']={'code':match,'method':method,'language':row['source_language'] if row['source_language']!='und' else 'en'}
 return row

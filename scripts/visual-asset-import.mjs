const stable=v=>JSON.stringify(v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k])??'null')])):Array.isArray(v)?v.map(x=>JSON.parse(stable(x)??'null')):v)
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
export async function importVisualAssetBatch(db,rows){
 const old=await check(db.from('catalog_visual_assets').select('*').in('asset_key',rows.map(r=>r.asset_key)))
 const before=new Map(old.map(r=>[r.asset_key,r]))
 const updates=rows.map(row=>{
  const previous=before.get(row.asset_key),locks=previous?.manual_overrides||{},payload={...row}
  for(const field of Object.keys(locks))if(Object.hasOwn(previous,field))payload[field]=previous[field]
  // Keep image metadata consistent with a manually chosen image.
  if(['image_url','image_sha256','mime_type','availability'].some(k=>Object.hasOwn(locks,k)))
   for(const field of ['image_url','image_sha256','mime_type','availability'])payload[field]=previous[field]
  if(Object.hasOwn(locks,'tag_code')&&!Object.hasOwn(locks,'tag_codes'))payload.tag_codes=previous.tag_codes||[]
  if(Object.hasOwn(locks,'source_code')&&!Object.hasOwn(locks,'match_code'))payload.match_code=previous.match_code||null
  return payload
 }).filter(row=>!before.has(row.asset_key)||Object.keys(row).some(k=>stable(before.get(row.asset_key)[k])!==stable(row[k])))
 if(!updates.length)return {changed:0}
 const saved=await check(db.from('catalog_visual_assets').upsert(updates,{onConflict:'asset_key'}).select('*'))
 for(const row of saved)if(before.has(row.asset_key)&&before.get(row.asset_key).image_sha256!==row.image_sha256)
  await check(db.from('catalog_visual_links').update({image_match_status:'candidate'}).eq('asset_key',row.asset_key))
 return {changed:updates.length}
}

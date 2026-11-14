// Reserve four fifths of each batch for sets never successfully imported.
// Refreshes still receive a quota, so future releases and corrections stay discoverable.
export function fairSetBatch(initial,refresh,limit){
 const freshQuota=Math.ceil(limit*0.8),fresh=initial.slice(0,freshQuota),old=refresh.slice(0,limit-fresh.length)
 return [...fresh,...old,...initial.slice(fresh.length)].slice(0,limit)
}
export async function dueSetBatch({db,provider,at,limit}){
 const base=()=>db.from('catalog_sync_sets').select('*').eq('provider',provider).neq('set_id','__index__').lte('next_sync_at',at).order('next_sync_at').order('source_uid')
 const [initial,refresh]=await Promise.all([base().is('last_sync_at',null).limit(limit),base().not('last_sync_at','is',null).limit(limit)])
 for(const result of [initial,refresh])if(result.error)throw Error(result.error.message)
 return fairSetBatch(initial.data,refresh.data,limit)
}

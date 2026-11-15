// Only transient transport/database failures should pause the batch.
// Permission, validation and uniqueness errors still need investigation.
export function databaseError(error){
 const result=new Error(error?.message||String(error))
 result.code=error?.code
 result.database=true
 return result
}
export function isTransientDatabaseError(error){
 return error?.database===true&&(/^(57014|55P03|40P01|40001|53300|57P0[123]|08\w{3})$/.test(error.code||'')||/statement timeout|lock timeout|deadlock detected|connection (?:reset|refused|terminated)|fetch failed|network|socket|timed? ?out|too many connections|bad gateway|service unavailable/i.test(error.message||''))
}

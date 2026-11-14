export async function linkCardmarket({db,log=console.log}){
 const {data,error}=await db.rpc('catalog_link_cardmarket',{batch_size:1000})
 if(error){await log(`Cardmarket: collegamento rimandato: ${error.message}`);return {errors:1}}
 await log(`Cardmarket: ${data.published} link nel catalogo pubblicato, ${data.printings} stampe esaminate, ${data.cards} schede collegate. Le varianti senza ID restano in attesa.`)
 return {...data,errors:0}
}

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {postgresClient} from './helpers/postgres-client.mjs'
import {importVisualAssetBatch} from '../scripts/visual-asset-import.mjs'
test('visual import is idempotent with extra database columns and preserves manual fields and image metadata',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table catalog_visual_assets(asset_key text primary key,name text,image_url text,image_sha256 text,mime_type text,availability text,tag_code text,tag_codes text[],source_code text,match_code text,manual_overrides jsonb default '{}');
   create table catalog_visual_links(asset_key text,image_match_status text);
   insert into catalog_visual_links values('a','verified');`)
  const db=postgresClient(pg),source={asset_key:'a',name:'Source',image_url:'https://source.test/a.png',image_sha256:'first',mime_type:'image/png',availability:'available',tag_code:'rarity:common',tag_codes:['rarity:common'],source_code:'sv02',match_code:'sv02'}
  assert.equal((await importVisualAssetBatch(db,[source])).changed,1)
  assert.equal((await importVisualAssetBatch(db,[source])).changed,0,'an extra manual_overrides column does not cause perpetual imports')
  await pg.exec(`update catalog_visual_assets set name='Manual',image_url='https://manual.test/a.png',tag_code='rarity:uncommon',manual_overrides='{"name":"Manual","image_url":"https://manual.test/a.png","tag_code":"rarity:uncommon"}'`)
  await importVisualAssetBatch(db,[{...source,image_sha256:'second',tag_codes:['rarity:common','rarity:c']}])
  const row=(await pg.query('select * from catalog_visual_assets')).rows[0]
  assert.equal(row.name,'Manual');assert.equal(row.image_url,'https://manual.test/a.png');assert.equal(row.image_sha256,'first');assert.equal(row.tag_code,'rarity:uncommon');assert.deepEqual(row.tag_codes,['rarity:common'])
  assert.equal((await pg.query('select image_match_status from catalog_visual_links')).rows[0].image_match_status,'verified','a protected image does not invalidate its associations')
  await pg.exec("update catalog_visual_assets set manual_overrides='{}'")
  await importVisualAssetBatch(db,[{...source,image_sha256:'third'}])
  assert.equal((await pg.query('select image_match_status from catalog_visual_links')).rows[0].image_match_status,'candidate','an actual automatic image change invalidates unprotected image verification')
 }finally{await pg.close()}
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {disposablePostgresConfiguration} from '../scripts/turso-worker-runtime.mjs'
test('native worker setup cannot point schema restoration at Supabase, a remote database or an ordinary local database',()=>{
 const env={CATALOG_DISPOSABLE_POSTGRES:'1',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'catalog_worker_123',PGUSER:'postgres',PGPASSWORD:'local-test-only'}
 assert.equal(disposablePostgresConfiguration(env).database,'catalog_worker_123')
 for(const patch of [{PGHOST:'db.example.supabase.co'},{PGDATABASE:'postgres'},{PGHOSTADDR:'203.0.113.1'},{PGSERVICE:'production'},{CATALOG_DISPOSABLE_POSTGRES:'0'},{PGPORT:'1'}])assert.throws(()=>disposablePostgresConfiguration({...env,...patch}),/temporaneo/)
})

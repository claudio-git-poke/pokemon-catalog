import {test} from 'node:test'
import assert from 'node:assert/strict'
import {tursoConfiguration,safeTursoError} from '../scripts/turso-client.mjs'
test('remote Turso clients require separate credentials and select the proper engine',()=>{
 assert.equal(tursoConfiguration({TURSO_DATABASE_URL:'libsql://catalog.example.turso.io',TURSO_AUTH_TOKEN:'secret'}).engine,'libsql')
 assert.equal(tursoConfiguration({TURSO_DATABASE_URL:'turso://catalog.example.turso.io',TURSO_AUTH_TOKEN:'secret'}).engine,'turso')
 assert.throws(()=>tursoConfiguration({}),/Configurare/)
 for(const url of ['file:test.db','http://catalog.example','https://user:pass@catalog.example','https://catalog.example?token=secret'])assert.throws(()=>tursoConfiguration({TURSO_DATABASE_URL:url,TURSO_AUTH_TOKEN:'secret'}))
})
test('connection diagnostics redact credentials and authorization headers',()=>{
 const env={TURSO_DATABASE_URL:'libsql://private.turso.io',TURSO_AUTH_TOKEN:'a-private-secret',SUPABASE_SERVICE_ROLE_KEY:'old-private-secret'}
 const message=safeTursoError(Error('a-private-secret old-private-secret libsql://private.turso.io Bearer another-secret'),env)
 for(const value of [...Object.values(env),'another-secret'])assert.ok(!message.includes(value))
})

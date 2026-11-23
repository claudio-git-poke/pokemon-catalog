import test from 'node:test'
import assert from 'node:assert/strict'
import {createSourceReader} from '../scripts/turso-source-reader.mjs'
test('the source reader accepts only https, or loopback http when explicitly allowed', ()=>{
 assert.throws(()=>createSourceReader({url:'http://127.0.0.1:54321',key:'k'}),/non valida/)
 assert.throws(()=>createSourceReader({url:'http://example.com',key:'k',allowLoopback:true}),/non valida/)
 assert.throws(()=>createSourceReader({url:'http://localhost:54321',key:'k',allowLoopback:true}),/non valida/)
 assert.doesNotThrow(()=>createSourceReader({url:'http://127.0.0.1:54321',key:'k',allowLoopback:true}))
 assert.doesNotThrow(()=>createSourceReader({url:'https://x.supabase.co',key:'k'}))
})

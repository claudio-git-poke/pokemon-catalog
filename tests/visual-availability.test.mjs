import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,readdir} from 'node:fs/promises'
test('reported failures are archived as missing without changing a linked rule or the provenance hash',async()=>{
 const urls=JSON.parse(await readFile('data/visual-archive/reported-unavailable-2026-11-17.json','utf8'))
 const report=JSON.parse(await readFile('data/visual-archive/availability-check-2026-11-17.json','utf8'))
 const rows=(await Promise.all((await readdir('data/visual-archive')).filter(f=>/^\d+\.json$/.test(f)).map(async f=>JSON.parse(await readFile('data/visual-archive/'+f,'utf8'))))).flat()
 const missing=rows.filter(r=>urls.includes(r.provenance.unavailable_image_url))
 assert.equal(urls.length,225);assert.equal(missing.length,225)
 for(const r of missing){assert.equal(r.availability,'missing');assert.equal(r.image_url,null);assert.equal(r.match_mode,null);assert.ok(r.image_sha256);assert.equal(report[r.provenance.unavailable_image_url].status,404)}
 execFileSync('python3',['-c',`
import importlib.util
s=importlib.util.spec_from_file_location('availability','scripts/check-visual-availability.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
for r in [{'error':'network timeout'},{'status':503,'image':False},{'status':403,'image':False},{'status':429,'image':False}]: assert not m.definitive_missing(r)
assert m.definitive_missing({'status':200,'image':False})
row={'match_mode':'tag','image_url':'https://example.test/icon.png'}
assert m.apply_check(row,{'status':404})==row
assert not m.image_bytes(b'<html>error</html>')
assert not m.image_bytes(b'<html><svg>error icon</svg></html>')
assert m.image_bytes(b'\\x89PNG\\r\\n\\x1a\\n'+bytes(24))
`])
})

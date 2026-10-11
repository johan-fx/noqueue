import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playbackSpans, editedAt, durationOf } from './adaptive-video.mjs'
test('real footage is continuous; only wait interiors accelerated',()=>{
 const c={duration:200,waits:[{start:10,end:150,speed:12}]}
 const s=playbackSpans(c)
 assert.deepEqual(s,[{start:0,end:12,speed:1},{start:12,end:147,speed:20},{start:147,end:200,speed:1}])
 assert.equal(editedAt(s,200),durationOf(s))
 assert.equal(editedAt(s,10),10)
 assert.deepEqual(playbackSpans(c,false),[{start:0,end:200,speed:1}])
})
test('short waits stay normal, multiple waits preserve all frames',()=>{
 const s=playbackSpans({duration:120,waits:[{start:5,end:15,speed:12},{start:30,end:100,speed:12}]})
 assert.equal(s[0].start,0);assert.equal(s.at(-1).end,120)
 for(let i=1;i<s.length;i++)assert.equal(s[i-1].end,s[i].start)
})
test('invalid editorial waits fail rather than hide evidence',()=>{
 assert.throws(()=>playbackSpans({duration:100,waits:[{start:1,end:110,speed:12}]}))
 assert.throws(()=>playbackSpans({duration:100,waits:[{start:1,end:90,speed:2}]}))
 assert.throws(()=>playbackSpans({duration:100,waits:[{start:1,end:40,speed:12},{start:39,end:60,speed:12}]}))
 assert.throws(()=>playbackSpans({duration:100,waits:[{start:NaN,end:40,speed:12}]}))
})
test('review findings are never hidden by accelerated playback',()=>{
 const s=playbackSpans({duration:270,waits:[{start:170,end:249,speed:12}],reviewFindings:[{at:244.8}]})
 const visible=s.find(p=>p.start<=244.8&&p.end>=244.8)
 assert.equal(visible.speed,1)
 assert.ok(visible.start<=240.8)
})

// Integration check for a running review server. Does not freeze/update baselines.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {get} from 'node:http';
const origin = process.env.FLOW_REVIEW_URL ?? 'http://127.0.0.1:4318';
async function api(path, body) {
 const response=await fetch(origin+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal(response.status,200,`${path}: ${await response.clone().text()}`);return response.json();
}
const {cases}=await api('/api/cases');
assert.equal(cases.length,663);
assert.equal(new Set(cases.map(item=>item.id)).size,cases.length);
assert.equal(new Set(cases.map(item=>item.reviewId)).size,cases.length);
assert.equal(cases.filter(item=>item.feedbackReason).length,3);
for(const item of cases)assert.match(item.reviewId,/^FR-[A-F0-9]{10}$/);
for(const [id,signature]of [
 ['browser-signature-reset-remote','remote function refresh'],
 ['browser-signature-reset-method','function formatOrder'],
 ['browser-reference-scope-away','resource function get second'],
]){
 const detail=await api(`/api/cases/${id}`);
 assert.ok(detail.function?.text.startsWith(signature),`${id} final displayed source`);
 assert.ok(detail.capture?.imageUrl);
 assert.equal(detail.capture.format,'svg');
 const preview=await fetch(new URL(detail.capture.imageUrl,origin));
 assert.match(preview.headers.get('content-type'),/^text\/html/);
 assert.match(await preview.text(),/<svg[\s>]/i);
 const raw=await fetch(new URL(detail.capture.svgUrl,origin));
 assert.match(raw.headers.get('content-type'),/^image\/svg\+xml/);
 assert.match(await raw.text(),/<svg[\s>]/i);
}
const selected=cases.find(item=>item.id==='example-design-critique-fn-4353aabe1e-signature');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100}});
try{
 await page.goto(`${origin}/?case=${selected.reviewId}&mode=development`);
 await page.waitForFunction(()=>document.querySelector('#source-code')?.textContent.includes('function calculate'));
 assert.ok((await page.locator('#case-title').textContent()).includes(selected.reviewId));
 await page.waitForFunction(()=>document.querySelector('#images iframe')?.dataset.loaded==='true');
 assert.equal(await page.locator('.case-item').count(),663);
 const firstPreview=page.locator('#images iframe');
 assert.equal(await firstPreview.getAttribute('sandbox'),'allow-same-origin');
 assert.ok((await firstPreview.getAttribute('title')).includes(selected.reviewId));
 assert.equal(await firstPreview.getAttribute('aria-describedby'),await page.locator('#images figcaption').getAttribute('id'));
 assert.equal(await firstPreview.evaluate(frame=>frame.contentDocument.querySelectorAll('svg').length),1);
 await page.locator('#view-side').click();
 assert.equal(await page.locator('#images iframe').count(),2);
 await page.waitForFunction(()=>[...document.querySelectorAll('#images iframe')].every(frame=>frame.dataset.loaded==='true'));
 assert.equal(new Set(await page.locator('#images figcaption').evaluateAll(nodes=>nodes.map(node=>node.id))).size,2);
 await page.locator('#filter').selectOption('feedback');
 assert.equal(await page.locator('.case-item').count(),3);
 assert.match(await page.locator('.feedback-dot').first().textContent(),/Historical screenshot/);
 assert.ok((await page.locator('#images figcaption').first().textContent()).includes(selected.reviewId));
 await page.locator('#filter').selectOption('all');
 assert.equal(await page.locator('.case-item').count(),663);
 await page.locator('#search').fill(selected.reviewId);
 assert.equal(await page.locator('.case-item').count(),1);
 // Exercise actual feedback saving, then restore the original status/note.
 const original=(await api(`/api/cases/${selected.id}`)).review;
 try{
  await page.locator('#review-status').selectOption('needs-work');
  await page.locator('#note').fill('SMOKE TEST: per-case feedback round trip');
  await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('Saved'));
  const saved=(await api('/api/feedback')).reviews.find(item=>item.id===selected.id);
  assert.equal(saved.reviewId,selected.reviewId);assert.equal(saved.note,'SMOKE TEST: per-case feedback round trip');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#note')?.value==='SMOKE TEST: per-case feedback round trip');
 }finally{await api(`/api/cases/${selected.id}/review`,{status:original.status,note:original.note});}
 // A real state-only capture intentionally has no SVG, including its repeat.
 const absent=await api('/api/cases/state-pending-initial');
 assert.equal(absent.capture.format,'svg');
 assert.equal(absent.capture.svgUrl,undefined);
 await page.goto(`${origin}/?case=${absent.case.reviewId}&mode=development`);
 await page.waitForFunction(()=>document.querySelector('#images iframe')?.dataset.result==='absent');
 assert.match(await page.locator('#images figcaption').textContent(),/SVG absent — no diagram for this view/);
 assert.doesNotMatch(await page.locator('#render-state').textContent(),/could not be loaded|Capture failed/);
 if(absent.capture.repeatImageUrl){
  await page.locator('#view-side').click();
  await page.waitForFunction(()=>document.querySelectorAll('#images iframe').length===2&&[...document.querySelectorAll('#images iframe')].every(frame=>frame.dataset.loaded==='true'&&frame.dataset.result==='absent'));
  assert.doesNotMatch(await page.locator('#render-state').textContent(),/could not be loaded|Capture failed/);
  await page.locator('#view-repeat').click();
  await page.waitForFunction(()=>document.querySelector('#images iframe')?.dataset.result==='absent');
  assert.match(await page.locator('#images figcaption').textContent(),/Repeat capture.*SVG absent/);
 }
 const crossOrigin=await fetch(origin+`/api/cases/${selected.id}/review`,{method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:JSON.stringify({status:'looks-good',note:'must not save'})});
 assert.equal(crossOrigin.status,403);
 const foreignHost=await new Promise((accept,reject)=>{get(origin+'/api/cases',{headers:{Host:'untrusted.invalid'}},response=>{response.resume();accept(response.statusCode);}).on('error',reject);});assert.equal(foreignHost,403);
 console.log('PASS: 663 unique IDs, final-selection source pairs, sandboxed first/repeat SVG previews, deep links, filters, feedback save/reload/export, request isolation.');
}finally{await browser.close();}

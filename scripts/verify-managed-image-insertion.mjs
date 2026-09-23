import assert from 'node:assert/strict';
import { ManagedImageInsertion, managedImageMarkdown } from '../src/core/managedImageInsertion.ts';
let checks = 0;
function check(fn) { fn(); checks++; }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  let target = { scope: 'paper:p1:note:n1', epoch: 1, from: 3, to: 4 };
  const commits = [], writes = [];
  const insertion = new ManagedImageInsertion();
  const options = {
    images: ['one'], current: () => target,
    write: async (scope, image) => { writes.push({ scope, image }); return { reference: 'note-assets/abc-123.png', alt: '截图' }; },
    commit: (at, markdown) => commits.push({ at, markdown }),
  };
  return { insertion, options, commits, writes, set: value => { target = value; }, get: () => target };
}
check(() => assert.equal(managedImageMarkdown('summary-assets/a.webp'), '![图片](<summary-assets/a.webp>)'));
check(() => assert.equal(managedImageMarkdown('论文.assets/a.jpg', 'a]\n[b'), '![a\\] \\[b](<%E8%AE%BA%E6%96%87.assets/a.jpg>)'));
for (const ref of ['../a.png','/x.assets/a.png','x.assets/../a.png','file://a.png','https://x/a.png','data:image/png;base64,abc','note-assets/%2e%2e.png','note-assets/a.svg','note-assets/a.png?x','x.assets\\a.png','x:assets/a.png','other/a.png','note-assets/.hidden.png']) {
  check(() => assert.throws(() => managedImageMarkdown(ref), /安全/));
}
{
  const f = fixture(); await f.insertion.insert(f.options);
  check(() => assert.equal(f.commits.length, 1));
  check(() => assert.equal(f.writes[0].scope, 'paper:p1:note:n1'));
  check(() => assert.equal(f.commits[0].at.from, 3));
  check(() => assert.equal(f.insertion.isPending(), false));
}
for (const change of [t => ({...t, scope:'paper:p2:note:n1'}), t => ({...t, epoch:t.epoch+1}), t => ({...t, from:9}), t => ({...t, to:10}), () => null]) {
  const f = fixture(), d = deferred(); f.options.write = () => d.promise;
  const promise = f.insertion.insert(f.options); f.set(change(f.get())); d.resolve({reference:'note-assets/abc.png'});
  await assert.rejects(promise, /已变化/); checks++;
  check(() => assert.equal(f.commits.length, 0));
  check(() => assert.equal(f.insertion.isPending(), false));
}
{
  const f = fixture(), d = deferred(); f.options.write = () => d.promise;
  const promise = f.insertion.insert(f.options);
  await assert.rejects(f.insertion.insert(f.options), /正在保存/); checks++;
  d.reject(new Error('disk full'));
  await assert.rejects(promise, /disk full/); checks++;
  check(() => assert.equal(f.commits.length, 0));
  check(() => assert.equal(f.insertion.isPending(), false));
  f.options.write = async () => ({reference:'note-assets/retry.png'});
  await f.insertion.insert(f.options); check(() => assert.equal(f.commits.length, 1));
}
{
  const f = fixture(); f.options.images = ['one', 'two']; f.options.text = '保留纯文本';
  await f.insertion.insert(f.options);
  check(() => assert.equal(f.commits.length, 1));
  check(() => assert.equal(f.writes.length, 2));
  check(() => assert.match(f.commits[0].markdown, /^保留纯文本\n/));
}
{
  const f = fixture(); f.options.images = ['one', 'bad'];
  f.options.write = async (_, image) => { if (image === 'bad') throw new Error('invalid MIME'); return {reference:'note-assets/one.png'}; };
  await assert.rejects(f.insertion.insert(f.options), /invalid MIME/); checks++;
  check(() => assert.equal(f.commits.length, 0));
}
{
  const f = fixture(); f.options.write = async () => ({reference:'../bad.png'});
  await assert.rejects(f.insertion.insert(f.options), /安全/); checks++;
  check(() => assert.equal(f.commits.length, 0));
}
{
  const f = fixture(), d = deferred(), original = f.get(); f.options.write = () => d.promise;
  const promise = f.insertion.insert(f.options);
  // Undo/redo or leave/return must advance the epoch even if content and selection match.
  f.set({...original, epoch:original.epoch+2}); d.resolve({reference:'note-assets/a.png'});
  await assert.rejects(promise, /已变化/); checks++;
  check(() => assert.equal(f.commits.length, 0));
}
for (const images of [[], new Array(9).fill('x')]) {
  const f = fixture(); f.options.images = images;
  await assert.rejects(f.insertion.insert(f.options), /1至8/); checks++;
  check(() => assert.equal(f.writes.length, 0));
}
console.log(`Managed image insertion: ${checks} checks passed (pure transaction tests only; no backend/UI claim).`);

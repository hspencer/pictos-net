// Browser check for library media round trips (F0). IndexedDB does not exist in
// Node, so this runs in a real browser against the Vite dev server.
//
//   npx vite --port 3123 --strictPort
//   open http://localhost:3123/libraries/index.json   (a static page: the app does not start)
//   paste this file into the DevTools console
//
// Use a dedicated port: it is a separate origin with its own IndexedDB, so the
// libraries created here never mix with real local work. Prints PASS or FAIL lines.

(async () => {
  const lib = await import('/services/libraryService.ts');
  const idb = await import('/services/indexedDBService.ts');
  const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s ?? '')))]
    .slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  const media = async id => JSON.stringify(await Promise.all((await lib.getLibraryRowsWithMedia(id))
    .map(async r => `${r.id}:${await sha(r.bitmap)}/${await sha(r.rawSvg)}/${await sha(r.structuredSvg)}`)));
  const check = (name, ok) => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // Media only in IndexedDB, no template behind it.
  const A = lib.createLibrary(`media check ${Date.now()}`);
  lib.saveLibraryRows(A.id, [{ id: 'R1', UTTERANCE: 'quiero agua' }, { id: 'R2', UTTERANCE: 'me duele' }]);
  await idb.saveBitmapsBatch([
    { id: 'R1', bitmap: 'data:image/jpeg;base64,/9j/R1', libraryId: A.id },
    { id: 'R2', bitmap: 'data:image/jpeg;base64,/9j/R2', libraryId: A.id },
  ]);
  await idb.saveSvgs('R1', { rawSvg: '<svg id="raw"/>', structuredSvg: '<svg id="structured"/>' }, A.id);
  const original = await media(A.id);

  const json = await lib.exportLibraryJson(A.id);
  check('export carries bitmaps and SVGs', JSON.parse(json).rows.every(r => r.bitmap) && JSON.parse(json).rows[0].rawSvg);
  const B = await lib.importLibraryJson(json);           // same row ids as A
  const C = await lib.duplicateLibrary(A.id);            // same row ids again
  check('import reproduces the media', await media(B.id) === original);
  check('duplicate reproduces the media', await media(C.id) === original);
  check('copies leave the original intact', await media(A.id) === original);
  await idb.deleteSvgs('R1', B.id);
  check('deleting in one copy leaves the others intact', await media(A.id) === original && await media(C.id) === original);
  check('backup ZIP carries every copy', ((await (await lib.backupAllLibraries()).text()).match(/\/9j\/R1/g) || []).length >= 3);

  for (const id of [A.id, B.id, C.id]) {
    lib.deleteLibrary(id);
    await idb.deleteBitmapsForLibrary(id);
    await idb.deleteSvgsForLibrary(id);
  }
})();

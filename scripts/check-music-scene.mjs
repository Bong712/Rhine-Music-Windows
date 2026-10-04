import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { setMusicAlbums, records, archiveColumns, columnFiles, fileAtSlot, fileLocation } from '../src/data.ts';
import { fileAtCell, selectionCell, visibleCell, cellKey, LOOP_COLUMNS, LOOP_ROWS, wrap } from '../src/archive-loop.ts';
import { CoverAtlas, containCover } from '../src/cover-atlas.ts';

for (const genreCount of [1, 2, 7]) for (const albumCount of [1, 3, 40]) {
  const genres = Array.from({ length: genreCount }, (_, i) => ({ id: `g${i}`, name: `流派 ${i}` }));
  const albums = genres.flatMap((genre) => Array.from({ length: albumCount }, (_, i) => ({ id: `${genre.id}-${i}`, title: `${genre.name} / ${i}`, artist: '测试', genreId: genre.id, rawGenres: [], folder: '', tracks: [], producers: [], offline: false })));
  setMusicAlbums(albums, genres);
  assert.equal(archiveColumns.length, genreCount);
  for (let index = 0; index < records.length; index++) {
    const location = fileLocation(index);
    assert.equal(fileAtSlot(location.slot), index, 'slots must not collide for > 20 albums');
    assert.equal(fileAtCell(location), index);
    for (const direction of [-1, 1]) {
      const files = columnFiles(location.lane);
      const nextIndex = files[wrap(files.indexOf(index) + direction, files.length)];
      const next = selectionCell(nextIndex, location, { axis: 'row', direction });
      assert.equal(next.row - location.row, direction, 'boundary crossing preserves motion direction');
      assert.equal(fileAtCell(next), nextIndex);
      const nextLane = wrap(location.lane + direction, genreCount);
      const targetIndex = columnFiles(nextLane)[0];
      const laneCell = selectionCell(targetIndex, location, { axis: 'lane', direction });
      assert.equal(laneCell.lane - location.lane, direction);
      assert.equal(fileAtCell(laneCell), targetIndex);
    }
  }
  for (const center of [{ lane: -300.3, row: -111.2 }, { lane: 0, row: 12 }, { lane: 301.6, row: 10000.8 }]) {
    const cells = Array.from({ length: LOOP_COLUMNS * LOOP_ROWS }, (_, i) => visibleCell(i, center));
    assert.equal(new Set(cells.map(cellKey)).size, LOOP_COLUMNS * LOOP_ROWS);
    assert.ok(cells.every((cell) => Number.isFinite(cell.row) && records[fileAtCell(cell)]));
  }
}
setMusicAlbums([], []);
assert.equal(records.length, 0);
assert.equal(fileAtCell({ lane: -1, row: -1 }), -1);
assert.equal(fileAtSlot(12), -1);
assert.ok(Object.values(selectionCell(0, { lane: 0, row: 12 })).every(Number.isFinite));
const sceneSource = await readFile(new URL('../src/scene.ts', import.meta.url), 'utf8');
const atlasSource = await readFile(new URL('../src/cover-atlas.ts', import.meta.url), 'utf8');
const musicAppSource = await readFile(new URL('../src/music-app.ts', import.meta.url), 'utf8');
const musicStyleSource = await readFile(new URL('../src/music.css', import.meta.url), 'utf8');
const themeSwitchSource = await readFile(new URL('../src/music-theme-switch.css', import.meta.url), 'utf8');
assert.ok(sceneSource.includes('this.light.shadow.camera.layers.enable(1)'), 'the shadow camera must include the shadow-only layer');
assert.ok(sceneSource.includes('shadowOnly.layers.set(1)'), 'off-camera casters must not enter the main camera layer');
assert.ok(sceneSource.includes('this.renderer.capabilities.maxTextureSize'), 'atlas pages must honor the active WebGL2 texture-size limit');
assert.ok(atlasSource.includes('new THREE.DataTexture'), 'cover atlas pages must use ordinary 2D textures');
assert.ok(atlasSource.includes('vMapUv = vMapUv * coverTile.zw + coverTile.xy'), 'each cover must map into its own 2D atlas cell');
assert.ok(atlasSource.includes('copyTextureToTexture'), 'cover updates must copy only the changed atlas cell to the GPU');
assert.ok(!atlasSource.includes('uniform highp sampler2DArray map'), 'cover shader must use Three.js standard 2D texture sampling');
assert.ok(musicAppSource.includes('if (!albums.length) $("#music-empty").hidden = false;'), 'the bundled demo-cover entry must remain visible when the local music service is unavailable');
assert.ok(musicAppSource.includes('id="music-lyric-dock"'), 'current synchronized lyrics must be visible on the primary player screen');
assert.ok(musicAppSource.includes('player.playbackTime'), 'the lyric view must read the live audio clock');
assert.ok(musicAppSource.includes('activeRenderedLyric = -2;'), 'rebuilding lyric rows must force the current line to be reapplied');
assert.ok(musicAppSource.includes('id="transport-lyric-status"'), 'missing LRC status must stay beside the current track title');
assert.ok(musicAppSource.includes('id="transport-lyrics-open"'), 'the full lyrics panel must remain reachable when an LRC is missing');
assert.ok(musicAppSource.includes('current.getAnimations().forEach((animation) => animation.cancel())'), 'lyric line changes must cancel stale transitions');
assert.ok(musicAppSource.includes('window.matchMedia("(prefers-reduced-motion: reduce)").matches'), 'lyric transitions must honor the operating-system reduced-motion setting');
assert.ok(musicAppSource.includes('duration: 200, easing: "ease-out"'), 'lyric line animation must stay within the short transition budget');
assert.ok(musicAppSource.includes('type Theme = "day" | "dusk" | "night"'), 'the tested dusk scene theme must be selectable in the app');
assert.ok(!musicAppSource.includes('music-lyric-previous'), 'the primary lyric view must not retain a third previous-line row');
assert.ok(!musicAppSource.includes('LIVE LYRICS'), 'the primary lyric view must not retain the large bilingual card heading');
assert.ok(musicStyleSource.includes('font-size: clamp(18px, 1.2vw, 25px)'), 'the primary lyric text must remain legible at desktop resolutions');
assert.ok(musicStyleSource.includes('width: min(1080px, 78vw)'), 'the subtitle band must keep a bounded responsive width');
assert.ok(musicStyleSource.includes('.music-app[data-lyrics-visible="true"][data-mode="detail"] #album-detail-content'), 'detail scrolling must reserve space for visible lyrics');
assert.ok(themeSwitchSource.includes('.music-app[data-theme="dusk"] .theme-switch::before'), 'the top theme selector must place its active pill on dusk');
assert.ok(themeSwitchSource.includes('translateX(calc(200% + 8px))'), 'the top theme selector must place its active pill on night');
const mainCamera = new THREE.PerspectiveCamera();
const shadowCamera = new THREE.OrthographicCamera();
shadowCamera.layers.enable(1);
const offCameraCaster = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
offCameraCaster.layers.set(1);
const visibleCaster = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
assert.equal(offCameraCaster.layers.test(mainCamera.layers), false, 'shadow-only casters must be culled from the main render');
assert.equal(offCameraCaster.layers.test(shadowCamera.layers), true, 'shadow-only casters must remain in the shadow render');
assert.equal(visibleCaster.layers.test(shadowCamera.layers), true, 'normal layer-0 casters must remain in the shadow render');
const atlasWrites = [[], []];
const atlasPages = atlasWrites.map((writes) => ({
  visible: true,
  count: 2,
  instanceMatrix: { needsUpdate: false },
  setMatrixAt(slot, matrix) { writes.push([slot, matrix.clone()]); },
}));
const atlas = Object.create(CoverAtlas.prototype);
const visibleCoverMatrix = new THREE.Matrix4().makeTranslation(2, 3, 4);
Object.assign(atlas, {
  arrays: atlasPages,
  instancesPerPage: 2,
  slotMatrices: Array.from({ length: 4 }, () => new THREE.Matrix4()),
  visibleSlots: new Uint8Array(4),
  hiddenMatrix: new THREE.Matrix4().makeScale(0, 0, 0),
});
atlas.hideArrayPages();
atlas.setVisibleMatrixAt(0, visibleCoverMatrix, true);
atlas.setVisibleMatrixAt(1, new THREE.Matrix4().makeTranslation(9, 9, 9), false);
atlas.setVisibleMatrixAt(2, new THREE.Matrix4().makeTranslation(8, 8, 8), false);
atlas.commitMatrices();
assert.equal(atlasPages[0].visible, true);
assert.equal(atlasPages[0].instanceMatrix.needsUpdate, true);
assert.deepEqual(atlasWrites[0].map(([slot]) => slot), [0, 1]);
assert.ok(atlasWrites[0][0][1].equals(visibleCoverMatrix));
assert.ok(atlasWrites[0][1][1].elements.slice(0, 15).every((value) => value === 0));
assert.equal(atlasWrites[0][1][1].elements[15], 1, 'off-camera cover slots in a visible page must use a zero-scale matrix');
assert.equal(atlasPages[1].visible, false);
assert.equal(atlasPages[1].instanceMatrix.needsUpdate, false);
assert.equal(atlasWrites[1].length, 0, 'off-camera atlas pages must not upload instance matrices');
let offscreenRecordLookups = 0;
const deferredAtlas = Object.create(CoverAtlas.prototype);
deferredAtlas.recordKey = () => { offscreenRecordLookups++; return ''; };
deferredAtlas.setSlot(0, undefined, false);
assert.equal(offscreenRecordLookups, 0, 'off-camera cover tiles must defer record lookup and atlas painting');
const pageUploadData = new Uint8Array(4 * 4 * 4);
let textureNeedsUpdate = false;
const mockTexture = { set needsUpdate(value) { textureNeedsUpdate = value; } };
const topDownPixels = new Uint8ClampedArray([
  255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 255, 255, 255, 255, 0, 255,
]);
const fakeCanvas = { getContext: () => ({ getImageData: () => ({ data: topDownPixels }) }) };
const tileUploadData = new Uint8Array(2 * 2 * 4);
const atlasUpload = Object.assign(Object.create(CoverAtlas.prototype), {
  tileWidth: 2, tileHeight: 2, pageColumns: 2, pageRows: 2,
  tileData: tileUploadData, renderer: undefined,
});
atlasUpload.writeCanvasData(fakeCanvas, tileUploadData, 2, 2);
atlasUpload.writePageTile({ data: pageUploadData, texture: mockTexture }, 1);
assert.equal(textureNeedsUpdate, true, 'a cover update must upload the atlas page when no renderer is supplied');
assert.ok(pageUploadData.slice(0, 8).every((value) => value === 0), 'other atlas cells must retain their data');
assert.deepEqual([...pageUploadData.slice(8, 16)], [
  0, 0, 255, 255, 255, 255, 0, 255,
], 'the first atlas row must contain the bottom canvas row');
assert.deepEqual([...pageUploadData.slice(24, 32)], [
  255, 0, 0, 255, 0, 255, 0, 255,
], 'the next atlas row must contain the top canvas row');

const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
const fakeCoverColors = new Map([
  ['cover:sun', [240, 36, 72, 255]],
  ['cover:night', [24, 78, 226, 255]],
  ['cover:mountain', [32, 204, 122, 255]],
]);
class FakeCanvasContext {
  pixel = [0, 0, 0, 0];
  setTransform() {}
  clearRect() { this.pixel = [0, 0, 0, 0]; }
  drawImage(image) {
    this.pixel = image.pixel ?? image.getContext('2d').pixel;
  }
  fillRect() { this.pixel = [120, 120, 120, 255]; }
  stroke() {}
  beginPath() {}
  arc() {}
  fillText() {}
  createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; }
  putImageData(image) { this.pixel = [...image.data.slice(0, 4)]; }
  getImageData(_x, _y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) data.set(this.pixel, index);
    return { data };
  }
}
class FakeCanvas {
  width = 0;
  height = 0;
  context = new FakeCanvasContext();
  getContext() { return this.context; }
}
class FakeImage {
  src = '';
  crossOrigin = '';
  naturalWidth = 8;
  naturalHeight = 8;
  pixel = [0, 0, 0, 0];
  async decode() { this.pixel = fakeCoverColors.get(this.src) ?? [0, 0, 0, 0]; }
}
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new FakeCanvas() } });
Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
try {
  const imageAtlas = new CoverAtlas(3, 512, 1);
  const imageRecords = [
    { id: 'album-sun', title: '日光留声', album: { coverUrl: 'cover:sun' } },
    { id: 'album-night', title: '夜间航线', album: { coverUrl: 'cover:night' } },
    { id: 'album-mountain', title: '远山来信', album: { coverUrl: 'cover:mountain' } },
  ];
  imageRecords.forEach((record, slot) => imageAtlas.setSlot(slot, record));
  await Promise.all(imageRecords.map((record) => imageAtlas.loadImage(record.album.coverUrl)));
  const coverDiagnostics = imageAtlas.diagnostics();
  assert.equal(coverDiagnostics.albums.length, 3);
  assert.ok(coverDiagnostics.albums.every((album) => album.imageStatus === 'decoded'));
  assert.equal(new Set(coverDiagnostics.albums.map((album) => album.layerHash)).size, 3, 'distinct decoded covers must occupy distinct atlas layer contents');
  assert.deepEqual(coverDiagnostics.albums.map((album) => [album.page, album.layer]), [[0, 0], [0, 1], [0, 2]], 'global slots must map to separate 2D atlas cells');
  imageAtlas.dispose();
} finally {
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else delete globalThis.document;
  if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage);
  else delete globalThis.Image;
}
for (const [width, height] of [[1000, 1000], [600, 1000], [1200, 500]]) {
  const box = containCover(width, height, 1024, 768);
  assert.ok(Math.abs(box.width / box.height - width / height) < 1e-10);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1024 && box.y + box.height <= 768);
}
console.log('Music scene checks passed: 1/2/7 genres × 1/3/40 albums, independent atlas cells, cover orientation, empty library, uncropped image aspect ratios.');

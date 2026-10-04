import assert from "node:assert/strict";
import {
  normalizeQuality,
  qualityPresets,
  matchingPreset,
  renderDimensions,
  auxiliaryResolutionScale,
  transmissionResolutionScale,
} from "../src/render-quality.ts";

assert.deepEqual(normalizeQuality(null), qualityPresets.original);
const legacy = normalizeQuality(undefined, false);
assert.equal(legacy.pixelRatio, 1);
assert.equal(legacy.aoSamples, 0);
assert.equal(legacy.depthOfField, 0);
assert.equal(legacy.shadows, 2048, "Migration preserves old low-mode shadows");
assert.equal(legacy.transmission, 1, "Migration preserves old low-mode glass");
for (const bad of [
  null,
  false,
  "ultra",
  [],
  {
    scale: NaN,
    pixelRatio: 99,
    antialias: "injected",
    shadows: -1,
    aoSamples: Infinity,
  },
]) {
  assert.deepEqual(normalizeQuality(bad), qualityPresets.original);
}
assert.equal(normalizeQuality({ scale: 99999 }).scale, 200);
assert.equal(normalizeQuality({ scale: -1 }).scale, 50);
assert.equal(normalizeQuality({ depthOfField: 99999 }).depthOfField, 150);
for (const [name, quality] of Object.entries(qualityPresets)) {
  assert.equal(matchingPreset(normalizeQuality(quality)), name);
  const reloaded = normalizeQuality(JSON.parse(JSON.stringify(quality)));
  assert.deepEqual(reloaded, quality);
}
assert.equal(matchingPreset({ ...qualityPresets.ultra, scale: 145 }), "custom");
for (const width of [640, 1920, 3840, 7680]) {
  for (const dpr of [1, 1.5, 2, 3]) {
    for (const max of [2048, 4096, 16384]) {
      const dimensions = renderDimensions(
        normalizeQuality({ scale: 200, pixelRatio: 3 }),
        1920,
        1080,
        width / 1920,
        dpr,
        max,
      );
      assert.ok(dimensions.width * dimensions.height <= 8_294_400);
      assert.ok(dimensions.width <= max && dimensions.height <= max);
      assert.ok(dimensions.ratio > 0);
    }
  }
}
const native = renderDimensions(
  qualityPresets.original,
  1920,
  1080,
  1,
  1,
  16384,
);
const ultra = renderDimensions(qualityPresets.ultra, 1920, 1080, 1, 1, 16384);
assert.equal(native.width, 1920);
const native4kAt200Percent = renderDimensions(
  qualityPresets.original,
  1920,
  1080,
  1,
  2,
  16384,
);
assert.deepEqual(
  [native4kAt200Percent.width, native4kAt200Percent.height],
  [3840, 2160],
  "original quality renders the full 4K back buffer on a 200%-scaled display",
);
const native4kAt100Percent = renderDimensions(
  qualityPresets.original,
  3840,
  2160,
  1,
  1,
  16384,
);
assert.deepEqual(
  [native4kAt100Percent.width, native4kAt100Percent.height],
  [3840, 2160],
  "original quality preserves a native 4K buffer at 100% display scaling",
);
assert.equal(
  transmissionResolutionScale(
    qualityPresets.original,
    native4kAt200Percent.width,
    native4kAt200Percent.height,
  ),
  0.5,
  "4K final output limits the secondary transmission capture to about 2 MP",
);
assert.equal(
  transmissionResolutionScale(
    { ...qualityPresets.original, transmission: 0.25 },
    native4kAt200Percent.width,
    native4kAt200Percent.height,
  ),
  0.25,
  "the user selected transmission setting can request a lower scale",
);
assert.equal(
  transmissionResolutionScale(qualityPresets.original, 1920, 1080),
  1,
  "native 1080p transmission keeps the selected full scale",
);
assert.equal(auxiliaryResolutionScale(1, 3840, 2160), 0.5);
assert.equal(auxiliaryResolutionScale(0.25, 3840, 2160), 0.25);
assert.equal(auxiliaryResolutionScale(1, 1920, 1080), 1);
assert.equal(ultra.width, 2880);
assert.equal(
  (ultra.width * ultra.height) / (native.width * native.height),
  2.25,
);
assert.equal(
  renderDimensions(qualityPresets.ultra, 1920, 1080, 2, 2, 16384).limited,
  true,
);
console.log(
  "Quality checks passed: migration, invalid storage, presets, supersampling and 48 device-limit combinations.",
);

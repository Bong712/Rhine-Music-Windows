import * as THREE from "three";
import type { ThemeTransition } from "./theme-transition.ts";

// Reuse the existing Blender shell. Its source bounds are 4.3 × 3.7 × 0.26;
// normalise baked geometry once, keeping the extraction/camera centre unchanged.
export const MUSIC_MODEL = {
  width: 4.45,
  height: 3.35,
  depth: 0.14,
  center: { x: 0, y: 1.85, z: 0 },
} as const;

// The artwork is a surface print in front of every glass vertex (max z=.07).
// Keep its native proportions and a visible glass border on all four sides.
export const MUSIC_COVER = {
  width: 2.98,
  height: 2.98,
  x: 0.14,
  y: MUSIC_MODEL.center.y,
  z: MUSIC_MODEL.depth / 2 + 0.012,
} as const;

type GlassFinish = Pick<THREE.MeshPhysicalMaterial,
  "transmission" | "thickness" | "roughness" | "attenuationDistance">;
const MUSIC_GLASS_FINISH: Record<string, {
  baseline: GlassFinish;
  day: GlassFinish;
  dayColor: string;
}> = {
  Frosted_Polymer: {
    baseline: { transmission: 0.96, thickness: 0.026, roughness: 0.4, attenuationDistance: 4.5 },
    day: { transmission: 0.88, thickness: 0.10, roughness: 0.48, attenuationDistance: 1.2 },
    dayColor: "#f3f0e9",
  },
  Ivory_Edges: {
    baseline: { transmission: 0.84, thickness: 0.06, roughness: 0.25, attenuationDistance: 4.5 },
    day: { transmission: 0.66, thickness: 0.10, roughness: 0.34, attenuationDistance: 1.2 },
    dayColor: "#e6ddd1",
  },
  Optical_Diffuser: {
    baseline: { transmission: 0.66, thickness: 0.035, roughness: 0.4, attenuationDistance: 4.5 },
    day: { transmission: 0.56, thickness: 0.07, roughness: 0.46, attenuationDistance: 1.2 },
    dayColor: "#eee8df",
  },
};

export function normalizeMusicGeometry(geometry: THREE.BufferGeometry) {
  if (geometry.userData.musicDimensions) return geometry;
  geometry.translate(0, -MUSIC_MODEL.center.y, 0);
  geometry.scale(MUSIC_MODEL.width / 4.3, MUSIC_MODEL.height / 3.7, MUSIC_MODEL.depth / 0.26);
  geometry.translate(0, MUSIC_MODEL.center.y, 0);
  geometry.userData.musicDimensions = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** All three music contexts share soft frosted glass beneath a sharp surface print. */
export function configureMusicGlass(surface: string, material: THREE.MeshPhysicalMaterial) {
  material.color.set("#fffdfa");
  material.metalness = 0;
  material.envMapIntensity = 0.65;
  material.ior = 1.46;
  material.attenuationColor.set("#f3e9db");
  material.attenuationDistance = 4.5;
  material.clearcoat = 0.16;
  material.clearcoatRoughness = 0.2;
  material.transparent = false;
  material.opacity = 1;
  const finish = MUSIC_GLASS_FINISH[surface];
  if (finish) Object.assign(material, finish.baseline);
  material.userData.musicShell = true;
}

/** Pale backgrounds need a little more body density and a readable matte rim. */
export function setMusicGlassTheme(
  surface: string,
  material: THREE.MeshPhysicalMaterial,
  day: boolean,
  transition: ThemeTransition,
) {
  const finish = MUSIC_GLASS_FINISH[surface];
  if (!material.userData.musicShell || !finish) return;
  const target = day ? finish.day : finish.baseline;
  for (const key of ["transmission", "thickness", "roughness", "attenuationDistance"] as const)
    transition.number(material, key, target[key]);
  // Night/dusk colors stay under the existing palette's theme control.
  if (day) transition.color(material.color, finish.dayColor);
}

export function musicAssemblyPart(surface: string) {
  if (surface === "Frosted_Polymer") return "cover";
  if (surface === "Optical_Diffuser") return "substrate";
  return "carrier";
}

/** Clarity applies to the glass substrate only; the cover never enters this path. */
export function setMusicGlassClarity(material: THREE.MeshPhysicalMaterial, clarity: number, warmth = 0) {
  // Inspection softens the frosting slightly; it never becomes polished plastic.
  // The image sits ahead of this material and remains completely independent.
  const daylight = THREE.MathUtils.clamp(warmth, 0, 1);
  material.roughness = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(MUSIC_GLASS_FINISH.Frosted_Polymer.baseline.roughness,
      MUSIC_GLASS_FINISH.Frosted_Polymer.day.roughness, daylight),
    THREE.MathUtils.lerp(0.3, 0.44, daylight),
    THREE.MathUtils.clamp(clarity, 0, 1),
  );
}

export function createAlbumPrintMaterial(map: THREE.Texture) {
  // Matte ink receives the same diffuse lights and shadows as the archive.
  // It has no specular lobe, glow or glass layer to bleach the printed colours.
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.025,
    toneMapped: false,
    fog: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      // Keep strong key lighting within the print's original colour range.
      // A zero/weak diffuse light still produces a zero/dim print, unlike Basic.
      "outgoingLight = min(outgoingLight, diffuseColor.rgb);\n#include <opaque_fragment>",
    );
  };
  material.customProgramCacheKey = () => "album-diffuse-print-v1";
  return material;
}

import * as THREE from "three";
import type { MusicSelectionLighting } from "./music-lighting";
import type { ArchiveRecord } from "./data";
import { MUSIC_COVER, createAlbumPrintMaterial } from "./music-model.ts";

// Print on the glass surface. No transmitting/frosted layer sits over the image.
export const COVER_SIZE = MUSIC_COVER;
type CoverImage = { source: HTMLCanvasElement; width: number; height: number };
type CoverDiagnosticAlbum = {
  id: string;
  title: string;
  coverUrl: string | null;
  slot: number;
  page: number;
  layer: number;
  layerHash: string;
  imageStatus: "decoded" | "failed" | "pending" | "missing";
  imageError?: string;
  cpuSample?: number[];
};
type AtlasPage = {
  data: Uint8Array;
  texture: THREE.DataTexture;
  geometry: THREE.PlaneGeometry;
  slotKeys: (string | undefined)[];
  keyToTile: Map<string, number>;
  slotTiles: Uint16Array;
  tileReferences: Uint16Array;
  renderedKeys: (string | undefined)[];
  contentStates: Uint8Array;
};
const COVER_PAINT_SIZE = 1024;
// Use the same UV margin at every texture resolution. A fixed two-pixel inset
// made the 256px atlas artwork smaller than its 1024px lifted/returning copy.
export const COVER_INSET = 1 / 128;
const COVER_PAINT_MARGIN = COVER_PAINT_SIZE * COVER_INSET;

export function containCover(
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
) {
  const scale = Math.min(
    boxWidth / Math.max(1, width),
    boxHeight / Math.max(1, height),
  );
  const drawnWidth = width * scale,
    drawnHeight = height * scale;
  return {
    x: (boxWidth - drawnWidth) / 2,
    y: (boxHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
}

function paintCover(
  canvas: HTMLCanvasElement,
  record: ArchiveRecord | undefined,
  image?: CoverImage,
) {
  const context = canvas.getContext("2d")!;
  // Paint in one logical coordinate space, including fallback art and labels.
  // Ownership can move between atlas/selection/snapshot without rescaling art.
  const width = COVER_PAINT_SIZE,
    height = COVER_PAINT_SIZE,
    margin = COVER_PAINT_MARGIN;
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  context.clearRect(0, 0, width, height);
  if (image) {
    const box = containCover(image.width, image.height, width - margin * 2, height - margin * 2);
    context.drawImage(
      image.source,
      box.x + margin,
      box.y + margin,
      box.width,
      box.height,
    );
    return;
  }
  // A missing cover is explicit and never substituted with another album's art.
  const size = height - margin * 2,
    left = (width - size) / 2;
  context.fillStyle = "#c9c9c4";
  context.fillRect(left, margin, size, size);
  context.strokeStyle = "#f8f7f1";
  context.lineWidth = Math.max(1, height / 180);
  context.beginPath();
  context.arc(width / 2, height * 0.43, height * 0.2, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(width / 2, height * 0.43, height * 0.04, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#3f4849";
  context.textAlign = "center";
  context.font = `500 ${Math.max(12, height * 0.045)}px sans-serif`;
  context.fillText(
    record?.title ?? "暂无专辑封面",
    width / 2,
    height * 0.8,
    height * 0.83,
  );
  context.font = `${Math.max(9, height * 0.025)}px sans-serif`;
  context.fillText(
    "LOCAL COLLECTION / NO COVER",
    width / 2,
    height * 0.87,
    height * 0.83,
  );
}

/** One fixed-size atlas for the visible pool, regardless of total library size. */
export class CoverAtlas {
  readonly arrays: THREE.InstancedMesh[] = [];
  readonly selected: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private readonly selectedCanvas = document.createElement("canvas");
  private readonly tileCanvas = document.createElement("canvas");
  private readonly selectedContext: CanvasRenderingContext2D;
  private readonly tileContext: CanvasRenderingContext2D;
  private readonly pages: AtlasPage[] = [];
  private readonly arrayGeometry: THREE.PlaneGeometry;
  private readonly selectedTexture: THREE.CanvasTexture;
  private readonly tileSource: THREE.CanvasTexture;
  private readonly pendingImages = new Map<string, Promise<CoverImage | undefined>>();
  private readonly decodedImages = new Map<string, CoverImage | undefined>();
  private readonly imageErrors = new Map<string, string>();
  private readonly slotKeys: (string | undefined)[];
  private readonly slotRecords: (ArchiveRecord | undefined)[];
  private readonly slotMatrices: THREE.Matrix4[];
  private readonly visibleSlots: Uint8Array;
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly recordKeys = new WeakMap<ArchiveRecord, string>();
  private selectedRecord?: ArchiveRecord;
  private selectedKey?: string;
  private selectedCanvasKey?: string;
  private generation = 0;
  private disposed = false;
  private readonly instancesPerPage: number;
  private readonly tileWidth: number;
  private readonly tileHeight: number;
  private readonly pageColumns: number;
  private readonly pageRows: number;
  private readonly renderer?: THREE.WebGLRenderer;
  private readonly atlasCopyRegion: THREE.Box2;
  private readonly atlasCopyPosition = new THREE.Vector2();
  private readonly profilePhase?: (name: string, durationMs: number) => void;

  constructor(count: number, maxTextureSize: number, anisotropy: number, lighting?: MusicSelectionLighting, renderer?: THREE.WebGLRenderer, profilePhase?: (name: string, durationMs: number) => void) {
    this.renderer = renderer;
    this.profilePhase = profilePhase;
    this.tileWidth = Math.min(256, Math.max(1, maxTextureSize));
    this.tileHeight = this.tileWidth;
    // Use ordinary 2D texture pages: WebGL's normal map path is well tested by
    // CanvasTexture on the target adapter, while custom sampler2DArray sampling
    // produced scrambled cover fragments despite correct uploaded layer data.
    this.pageColumns = Math.max(1, Math.min(16, Math.floor(maxTextureSize / this.tileWidth)));
    this.pageRows = Math.max(1, Math.min(8, Math.floor(maxTextureSize / this.tileHeight)));
    this.instancesPerPage = this.pageColumns * this.pageRows;
    this.tileCanvas.width = this.tileWidth;
    this.tileCanvas.height = this.tileHeight;
    this.selectedCanvas.width = COVER_PAINT_SIZE;
    this.selectedCanvas.height = COVER_PAINT_SIZE;
    // Interactive atlas updates upload this canvas directly to WebGL. Keep the
    // normal accelerated 2D context; forcing frequent CPU reads here pins it to
    // software and makes canvas-to-texture uploads much slower.
    this.tileContext = this.tileCanvas.getContext("2d")!;
    this.selectedContext = this.selectedCanvas.getContext("2d")!;
    this.atlasCopyRegion = new THREE.Box2(
      new THREE.Vector2(0, 0),
      new THREE.Vector2(this.tileWidth, this.tileHeight),
    );
    this.tileSource = new THREE.CanvasTexture(this.tileCanvas);
    this.tileSource.colorSpace = THREE.NoColorSpace;
    this.tileSource.generateMipmaps = false;
    this.tileSource.magFilter = THREE.LinearFilter;
    this.tileSource.minFilter = THREE.LinearFilter;
    this.tileSource.unpackAlignment = 1;
    this.slotKeys = Array(count);
    this.slotRecords = Array(count);
    this.slotMatrices = Array.from({ length: count }, () => new THREE.Matrix4());
    this.visibleSlots = new Uint8Array(count);
    this.selectedTexture = this.createCanvasTexture(this.selectedCanvas, Math.min(8, anisotropy));
    this.arrayGeometry = new THREE.PlaneGeometry(
      COVER_SIZE.width,
      COVER_SIZE.height,
    ).translate(COVER_SIZE.x, COVER_SIZE.y, COVER_SIZE.z);
    const tileUvs = new Float32Array(Math.min(count, this.instancesPerPage) * 4);
    for (let i = 0; i < tileUvs.length / 4; i++) this.writeTileUv(tileUvs, i * 4, i);
    this.arrayGeometry.setAttribute("coverTile", new THREE.InstancedBufferAttribute(tileUvs, 4));
    // Instances, selected art and snapshots use one matte diffuse material and
    // one moving light field; no ownership-specific brightness/scale switches.
    const makePrint = (texture: THREE.Texture) => {
      const print = createAlbumPrintMaterial(texture);
      const compile = print.onBeforeCompile;
      print.onBeforeCompile = (shader, renderer) => {
        compile.call(print, shader, renderer);
        lighting?.shadePrint(shader);
      };
      print.customProgramCacheKey = () => `album-diffuse-print-${Boolean(lighting)}-v1`;
      return print;
    };
    const mapAtlasTiles = (material: THREE.MeshLambertMaterial) => {
      const compileAtlas = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        compileAtlas.call(material, shader, renderer);
        shader.vertexShader = "attribute vec4 coverTile;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <uv_vertex>",
          "#include <uv_vertex>\nvMapUv = vMapUv * coverTile.zw + coverTile.xy;",
        );
      };
      material.customProgramCacheKey = () => `album-diffuse-2d-atlas-${Boolean(lighting)}-v1`;
    };
    const pageCount = Math.ceil(count / this.instancesPerPage);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const instanceCount = Math.min(this.instancesPerPage, count - pageIndex * this.instancesPerPage);
      const width = this.pageColumns * this.tileWidth;
      const height = this.pageRows * this.tileHeight;
      const data = new Uint8Array(width * height * 4);
      const texture = this.createTexture(data, width, height, Math.min(4, anisotropy));
      // Canvas uploads are top-down; preserve the old CPU flip so atlas UVs
      // retain the same orientation when a tile is copied directly from canvas.
      texture.flipY = true;
      const pageUvs = new Float32Array(instanceCount * 4);
      for (let localSlot = 0; localSlot < instanceCount; localSlot++)
        this.writeTileUv(pageUvs, localSlot * 4, localSlot);
      const geometry = this.arrayGeometry.clone();
      const pageTileAttribute = new THREE.InstancedBufferAttribute(pageUvs, 4);
      pageTileAttribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("coverTile", pageTileAttribute);
      const page: AtlasPage = {
        data,
        texture,
        geometry,
        slotKeys: Array(instanceCount),
        keyToTile: new Map(),
        slotTiles: new Uint16Array(instanceCount),
        tileReferences: new Uint16Array(instanceCount),
        renderedKeys: Array(instanceCount),
        contentStates: new Uint8Array(instanceCount),
      };
      this.pages.push(page);

      const material = makePrint(texture);
      mapAtlasTiles(material);
      const array = new THREE.InstancedMesh(geometry, material, instanceCount);
      array.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      array.frustumCulled = false;
      array.visible = false;
      array.name = `Album cover atlas page ${pageIndex + 1}`;
      array.receiveShadow = true;
      this.arrays.push(array);
    }
    const selectedGeometry = new THREE.PlaneGeometry(COVER_SIZE.width, COVER_SIZE.height).translate(
        COVER_SIZE.x,
        COVER_SIZE.y,
        COVER_SIZE.z,
      );
    const selectedTile = new Float32Array(selectedGeometry.getAttribute("position").count * 4);
    for (let vertex = 0; vertex < selectedTile.length / 4; vertex++) this.writeFullTextureUv(selectedTile, vertex * 4);
    selectedGeometry.setAttribute("coverTile", new THREE.BufferAttribute(selectedTile, 4));
    const selectedMaterial = makePrint(this.selectedTexture);
    mapAtlasTiles(selectedMaterial);
    this.selected = new THREE.Mesh(selectedGeometry, selectedMaterial);
    this.selected.userData.albumCover = true;
    this.selected.visible = false;
    this.selected.name = "Selected album cover";
    this.selected.receiveShadow = true;
  }

  private cachedImage(url?: string) {
    if (!url || !this.decodedImages.has(url)) return undefined;
    const image = this.decodedImages.get(url);
    this.decodedImages.delete(url);
    this.decodedImages.set(url, image);
    return image;
  }

  private createTexture(data: Uint8Array, width: number, height: number, anisotropy: number, colorSpace: typeof THREE.SRGBColorSpace | typeof THREE.NoColorSpace = THREE.SRGBColorSpace) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = colorSpace;
    texture.generateMipmaps = false;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.anisotropy = anisotropy;
    texture.unpackAlignment = 1;
    return texture;
  }

  private createCanvasTexture(canvas: HTMLCanvasElement, anisotropy: number) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.anisotropy = anisotropy;
    texture.unpackAlignment = 1;
    return texture;
  }

  private writeCanvasData(canvas: HTMLCanvasElement, data: Uint8Array, width: number, height: number) {
    const startedAt = this.profilePhase ? performance.now() : 0;
    const context = canvas === this.tileCanvas
      ? this.tileContext
      : canvas === this.selectedCanvas
        ? this.selectedContext
        : canvas.getContext("2d", { willReadFrequently: true })!;
    const pixels = context.getImageData(0, 0, width, height).data;
    if (this.profilePhase) this.profilePhase("atlas-canvas-readback", performance.now() - startedAt);
    const rowBytes = width * 4;
    // Keep canvas's top-left row order in sync with CanvasTexture's flipY path.
    for (let row = 0; row < height; row++)
      data.set(pixels.subarray((height - 1 - row) * rowBytes, (height - row) * rowBytes), row * rowBytes);
  }

  private writeTileUv(target: Float32Array, offset: number, slot: number) {
    const x = (slot % this.pageColumns) * this.tileWidth;
    const y = Math.floor(slot / this.pageColumns) * this.tileHeight;
    // Clamp to texel centers to prevent linear filtering from sampling the next
    // album's artwork at internal page boundaries.
    target.set([
      (x + 0.5) / (this.pageColumns * this.tileWidth),
      (y + 0.5) / (this.pageRows * this.tileHeight),
      (this.tileWidth - 1) / (this.pageColumns * this.tileWidth),
      (this.tileHeight - 1) / (this.pageRows * this.tileHeight),
    ], offset);
  }

  private writeFullTextureUv(target: Float32Array, offset: number) {
    target.set([0, 0, 1, 1], offset);
  }

  private writePageTile(page: AtlasPage, slot: number) {
    const x = (slot % this.pageColumns) * this.tileWidth;
    const y = Math.floor(slot / this.pageColumns) * this.tileHeight;
    if (this.renderer) {
      const uploadStartedAt = this.profilePhase ? performance.now() : 0;
      this.atlasCopyPosition.set(x, y);
      this.renderer.copyTextureToTexture(
        this.tileSource,
        page.texture,
        this.atlasCopyRegion,
        this.atlasCopyPosition,
      );
      if (this.profilePhase) this.profilePhase("atlas-texture-upload", performance.now() - uploadStartedAt);
    } else {
      // Keep the non-renderer fallback correct for lightweight diagnostics.
      // The interactive WebGL path never reads pixels back from this canvas.
      page.texture.flipY = false;
      const pixels = this.tileContext.getImageData(0, 0, this.tileWidth, this.tileHeight).data;
      const atlasWidth = this.pageColumns * this.tileWidth;
      const rowBytes = this.tileWidth * 4;
      for (let row = 0; row < this.tileHeight; row++) {
        const source = (this.tileHeight - 1 - row) * rowBytes;
        const destination = ((y + row) * atlasWidth + x) * 4;
        page.data.set(pixels.subarray(source, source + rowBytes), destination);
      }
      page.texture.needsUpdate = true;
    }
  }

  /** Map a scene instance to one canonical copy of its cover inside the page. */
  private assignPageSlot(page: AtlasPage, localSlot: number, key: string) {
    const previousKey = page.slotKeys[localSlot];
    if (previousKey === key) return page.slotTiles[localSlot];

    const previousTile = previousKey === undefined ? undefined : page.keyToTile.get(previousKey);
    let tile = page.keyToTile.get(key);
    let reusedPreviousTile = false;
    if (tile === undefined) {
      if (previousTile !== undefined && page.tileReferences[previousTile] === 1) {
        tile = previousTile;
        page.keyToTile.delete(previousKey!);
        page.tileReferences[tile] = 0;
        page.renderedKeys[tile] = undefined;
        page.contentStates[tile] = 0;
        reusedPreviousTile = true;
      } else {
        tile = page.tileReferences.findIndex((references) => references === 0);
        if (tile < 0) throw new Error("Cover atlas page has no unreferenced tile for a new cover.");
      }
      page.keyToTile.set(key, tile);
    }

    if (previousKey !== undefined && previousTile !== undefined && !reusedPreviousTile) {
      page.tileReferences[previousTile]--;
      if (page.tileReferences[previousTile] === 0) {
        page.keyToTile.delete(previousKey);
        page.renderedKeys[previousTile] = undefined;
        page.contentStates[previousTile] = 0;
      }
    }

    page.slotKeys[localSlot] = key;
    page.slotTiles[localSlot] = tile;
    page.tileReferences[tile]++;
    const attribute = page.geometry.getAttribute("coverTile") as THREE.BufferAttribute;
    this.writeTileUv(attribute.array as Float32Array, localSlot * 4, tile);
    attribute.needsUpdate = true;
    return tile;
  }

  private drawPageTile(
    pageIndex: number,
    tile: number,
    key: string,
    record: ArchiveRecord | undefined,
    image: CoverImage | undefined,
    generation: number,
  ) {
    const page = this.pages[pageIndex];
    if (
      !page ||
      this.disposed ||
      generation !== this.generation ||
      page.keyToTile.get(key) !== tile ||
      page.renderedKeys[tile] !== key && page.contentStates[tile] !== 0 ||
      (image ? page.contentStates[tile] === 2 : page.contentStates[tile] !== 0)
    ) return;

    const paintStartedAt = this.profilePhase ? performance.now() : 0;
    if (image) paintCover(this.tileCanvas, record, image);
    else if (!this.copyCover(this.tileCanvas, key))
      paintCover(this.tileCanvas, record?.album?.coverUrl ? undefined : record);
    if (this.profilePhase) this.profilePhase("atlas-tile-paint", performance.now() - paintStartedAt);

    this.writePageTile(page, tile);
    page.renderedKeys[tile] = key;
    // 1 is the temporary cover placeholder; 2 is final artwork/fallback art.
    page.contentStates[tile] = image ? 2 : record?.album?.coverUrl ? 1 : 2;
    if (this.selectedKey === key) {
      const selectedSlot = this.slotKeys.indexOf(key);
      if (selectedSlot >= 0) this.selectAtlasSlot(selectedSlot);
    }
  }

  private updateSelectedTexture() {
    // Let WebGL upload the canvas source directly. Reading back a 1024² canvas
    // into JS pixels first stalls the main thread on a cold album selection.
    this.selectedTexture.needsUpdate = true;
  }

  private loadImage(url?: string) {
    if (!url) return Promise.resolve(undefined);
    if (this.decodedImages.has(url)) return Promise.resolve(this.cachedImage(url));
    let pending = this.pendingImages.get(url);
    if (!pending) {
      const generation = this.generation;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = url;
      pending = image
        .decode()
        .then(() => {
          // Retain bounded thumbnails, not decoded multi-megapixel source art.
          const width = image.naturalWidth,
            height = image.naturalHeight;
          const scale = Math.min(1, 1024 / Math.max(width, height));
          const source = document.createElement("canvas");
          source.width = Math.max(1, Math.round(width * scale));
          source.height = Math.max(1, Math.round(height * scale));
          source
            .getContext("2d")!
            .drawImage(image, 0, 0, source.width, source.height);
          image.src = "";
          return { source, width, height };
        })
        .catch((error: unknown) => {
          this.imageErrors.set(url, error instanceof Error ? error.message : String(error));
          return undefined;
        })
        .then((decoded) => {
          if (!this.disposed && generation === this.generation) {
            this.decodedImages.set(url, decoded);
            if (decoded) this.imageErrors.delete(url);
            if (this.decodedImages.size > 48)
              this.decodedImages.delete(this.decodedImages.keys().next().value!);
          }
          if (this.pendingImages.get(url) === pending) this.pendingImages.delete(url);
          return decoded;
        });
      // Share every in-flight decode across the pool; only completed images
      // enter the bounded LRU, so cycling slots cannot evict pending requests.
      this.pendingImages.set(url, pending);
    }
    return pending;
  }

  private recordKey(record: ArchiveRecord | undefined) {
    // Description/metadata refreshes replace record objects without changing
    // their print. Cache only the visual identity, not the object reference.
    let key = record ? this.recordKeys.get(record) : "";
    if (record && key === undefined) {
      // Artwork is the visual identity of a printed cover. Albums pointing at
      // the same image can share a resident atlas tile even when metadata IDs
      // and titles differ. Keep title-specific identity only for generated
      // fallback cards that have no image URL.
      key = record.album?.coverUrl
        ? JSON.stringify(["cover", record.album.coverUrl])
        : JSON.stringify([record.id, null, record.title]);
      this.recordKeys.set(record, key);
    }
    return key!;
  }

  private copyCover(canvas: HTMLCanvasElement, key: string) {
    if (canvas !== this.selectedCanvas && this.selectedCanvasKey === key) {
      const context = canvas.getContext("2d")!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(this.selectedCanvas, 0, 0, canvas.width, canvas.height);
      return true;
    }
    const record = this.slotRecords.find((item, slot) => item && this.slotKeys[slot] === key)
      ?? (this.selectedKey === key ? this.selectedRecord : undefined);
    const image = record?.album?.coverUrl ? this.decodedImages.get(record.album.coverUrl) : undefined;
    if (!record || !image) return false;
    paintCover(canvas, record, image);
    return true;
  }

  private selectAtlasSlot(slot: number) {
    this.selectedCanvasKey = undefined;
    const pageIndex = Math.floor(slot / this.instancesPerPage);
    const localSlot = slot % this.instancesPerPage;
    const page = this.pages[pageIndex];
    if (!page) return;
    const tile = page.slotTiles[localSlot];
    const geometry = this.selected.geometry;
    const attribute = geometry.getAttribute("coverTile") as THREE.BufferAttribute;
    const offsets = attribute.array as Float32Array;
    for (let vertex = 0; vertex < offsets.length / 4; vertex++)
      this.writeTileUv(offsets, vertex * 4, tile);
    attribute.needsUpdate = true;
    (this.selected.material as THREE.MeshLambertMaterial).map = page.texture;
  }

  private selectFallbackTexture() {
    const attribute = this.selected.geometry.getAttribute("coverTile") as THREE.BufferAttribute;
    const offsets = attribute.array as Float32Array;
    for (let vertex = 0; vertex < offsets.length / 4; vertex++)
      this.writeFullTextureUv(offsets, vertex * 4);
    attribute.needsUpdate = true;
    (this.selected.material as THREE.MeshLambertMaterial).map = this.selectedTexture;
  }

  /** Hide atlas pages with no camera-visible album during this scene update. */
  hideArrayPages() {
    this.visibleSlots.fill(0);
    for (const array of this.arrays) array.visible = false;
  }

  setVisibleMatrixAt(slot: number, matrix: THREE.Matrix4, visible: boolean) {
    const array = this.arrays[Math.floor(slot / this.instancesPerPage)];
    if (!array || !visible) return;
    this.slotMatrices[slot].copy(matrix);
    this.visibleSlots[slot] = 1;
    array.visible = true;
  }

  commitMatrices() {
    for (let pageIndex = 0; pageIndex < this.arrays.length; pageIndex++) {
      const array = this.arrays[pageIndex];
      if (!array.visible) continue;
      const firstSlot = pageIndex * this.instancesPerPage;
      for (let localSlot = 0; localSlot < array.count; localSlot++) {
        const slot = firstSlot + localSlot;
        array.setMatrixAt(localSlot, this.visibleSlots[slot] ? this.slotMatrices[slot] : this.hiddenMatrix);
      }
      array.instanceMatrix.needsUpdate = true;
    }
  }

  setSlot(slot: number, record: ArchiveRecord | undefined, visible = true) {
    // Camera-hidden tiles cannot affect the current image. Keep their previous
    // contents until they enter view, avoiding canvas repaints and atlas uploads
    // while the camera moves across unrelated shelf pages.
    if (!visible) return;
    const key = this.recordKey(record);
    this.slotRecords[slot] = record;
    if (this.slotKeys[slot] === key) return;
    const pageIndex = Math.floor(slot / this.instancesPerPage);
    const localSlot = slot % this.instancesPerPage;
    const page = this.pages[pageIndex];
    if (!page) return;
    const tile = this.assignPageSlot(page, localSlot, key);
    this.slotKeys[slot] = key;
    const generation = this.generation;
    const image = this.cachedImage(record?.album?.coverUrl);
    this.drawPageTile(pageIndex, tile, key, record, image, generation);
    if (this.selectedKey === key) this.selectAtlasSlot(slot);
    if (!image && record?.album?.coverUrl)
      void this.loadImage(record.album.coverUrl).then((loaded) => {
        if (loaded) this.drawPageTile(pageIndex, tile, key, record, loaded, generation);
      });
  }

  async select(record: ArchiveRecord | undefined) {
    this.selectedRecord = record;
    const key = this.recordKey(record);
    if (this.selectedKey === key) {
      const currentSlot = this.slotKeys.indexOf(key);
      if (currentSlot >= 0) this.selectAtlasSlot(currentSlot);
      return;
    }
    const generation = this.generation;
    this.selectedKey = key;
    const slot = this.slotKeys.indexOf(key);
    if (slot >= 0) {
      // The selected cover is already resident in the shelf atlas. Rebind its
      // page and UV tile instead of copying/uploading a separate 1024² texture
      // on the first frame of the lift animation.
      this.selectAtlasSlot(slot);
    } else {
      const cached = this.cachedImage(record?.album?.coverUrl);
      if (cached) paintCover(this.selectedCanvas, record, cached);
      else if (!this.copyCover(this.selectedCanvas, key))
        paintCover(this.selectedCanvas, record?.album?.coverUrl ? undefined : record);
      this.selectedCanvasKey = key;
      this.selectFallbackTexture();
      this.updateSelectedTexture();
    }
    if (this.cachedImage(record?.album?.coverUrl)) return;
    const image = await this.loadImage(record?.album?.coverUrl);
    if (
      !image ||
      this.disposed ||
      generation !== this.generation ||
      this.selectedKey !== key
    )
      return;
    const currentSlot = this.slotKeys.indexOf(key);
    if (currentSlot >= 0) {
      this.selectAtlasSlot(currentSlot);
      return;
    }
    paintCover(this.selectedCanvas, record, image);
    this.selectedCanvasKey = key;
    this.selectFallbackTexture();
    this.updateSelectedTexture();
  }

  snapshot(mesh: THREE.Mesh) {
    // The lifted print already has a stable tile in the visible-pool array.
    // Point the outgoing copy at its atlas cell instead of uploading a duplicate.
    const slot = this.selectedKey ? this.slotKeys.indexOf(this.selectedKey) : -1;
    if (slot >= 0) {
      const pageIndex = Math.floor(slot / this.instancesPerPage);
      const localSlot = slot % this.instancesPerPage;
      const page = this.pages[pageIndex];
      const geometry = mesh.geometry.clone();
      const offsets = new Float32Array(geometry.getAttribute("position").count * 4);
      for (let vertex = 0; vertex < offsets.length / 4; vertex++)
        this.writeTileUv(offsets, vertex * 4, page.slotTiles[localSlot]);
      geometry.setAttribute("coverTile", new THREE.Float32BufferAttribute(offsets, 4));
      mesh.geometry = geometry;
      const atlasMaterial = this.arrays[pageIndex].material as THREE.MeshLambertMaterial;
      const material = atlasMaterial.clone();
      material.onBeforeCompile = atlasMaterial.onBeforeCompile;
      material.customProgramCacheKey = atlasMaterial.customProgramCacheKey;
      mesh.material = material;
      mesh.userData.coverUsesAtlas = true;
      mesh.userData.coverOwnsGeometry = true;
      mesh.userData.coverDisposed = false;
      return;
    }

    // A just-selected album may not have reached a display tile yet. Keep the
    // original exact-copy path as a cold-start fallback for that rare case.
    const canvas = document.createElement("canvas");
    canvas.width = this.selectedCanvas.width;
    canvas.height = this.selectedCanvas.height;
    canvas.getContext("2d")!.drawImage(this.selectedCanvas, 0, 0);
    const texture = this.createCanvasTexture(canvas, this.selectedTexture.anisotropy);
    mesh.geometry = mesh.geometry.clone();
    mesh.userData.coverOwnsGeometry = true;
    mesh.material = this.selected.material.clone();
    mesh.material.onBeforeCompile = this.selected.material.onBeforeCompile;
    mesh.material.customProgramCacheKey = this.selected.material.customProgramCacheKey;
    (mesh.material as THREE.MeshLambertMaterial).map = texture;
    const record = this.selectedRecord;
    mesh.userData.coverDisposed = false;
    void this.loadImage(record?.album?.coverUrl).then((image) => {
      if (!image || mesh.userData.coverDisposed || this.disposed) return;
      paintCover(canvas, record, image);
      texture.needsUpdate = true;
    });
  }

  reset() {
    this.generation++;
    this.slotKeys.fill(undefined);
    this.slotRecords.fill(undefined);
    for (const page of this.pages) {
      page.slotKeys.fill(undefined);
      page.keyToTile.clear();
      page.slotTiles.fill(0);
      page.tileReferences.fill(0);
      page.renderedKeys.fill(undefined);
      page.contentStates.fill(0);
    }
    this.selectedRecord = undefined;
    this.selectedKey = undefined;
    this.selectedCanvasKey = undefined;
    this.pendingImages.clear();
    this.decodedImages.clear();
    this.imageErrors.clear();
  }

  /** On-demand runtime diagnostics for the isolated EXE repro harness. */
  diagnostics() {
    const albums = new Map<string, CoverDiagnosticAlbum>();
    const samplesByVisualKey = new Map<string, { layerHash: string; cpuSample: number[] }>();
    this.slotKeys.forEach((key, slot) => {
      const record = this.slotRecords[slot];
      if (!key || !record) return;
      const { id, title } = record;
      const coverUrl = record.album?.coverUrl ?? null;
      if (albums.has(id)) return;
      let contentSample = samplesByVisualKey.get(key);
      if (!contentSample) {
        const image = coverUrl ? this.decodedImages.get(coverUrl) : undefined;
        if (image) paintCover(this.tileCanvas, record, image);
        else paintCover(this.tileCanvas, coverUrl ? undefined : record);
        const startedAt = this.profilePhase ? performance.now() : 0;
        const pixels = this.tileContext.getImageData(0, 0, this.tileWidth, this.tileHeight).data;
        if (this.profilePhase) this.profilePhase("atlas-diagnostic-readback", performance.now() - startedAt);
        let hash = 2166136261;
        for (let row = 0; row < this.tileHeight; row += 4) {
          for (let column = 0; column < this.tileWidth; column += 4) {
            const offset = (row * this.tileWidth + column) * 4;
            hash = Math.imul(hash ^ pixels[offset], 16777619);
          }
        }
        const center = (Math.floor(this.tileHeight / 2) * this.tileWidth + Math.floor(this.tileWidth / 2)) * 4;
        contentSample = {
          layerHash: (hash >>> 0).toString(16).padStart(8, "0"),
          cpuSample: [...pixels.subarray(center, center + 4)],
        };
        samplesByVisualKey.set(key, contentSample);
      }
      const pageIndex = Math.floor(slot / this.instancesPerPage);
      const localSlot = slot % this.instancesPerPage;
      const page = this.pages[pageIndex];
      if (!page) return;
      const decoded = coverUrl ? this.decodedImages.get(coverUrl) : undefined;
      albums.set(id, {
        id,
        title,
        coverUrl,
        slot,
        page: pageIndex,
        layer: page.slotTiles[localSlot],
        layerHash: contentSample.layerHash,
        cpuSample: contentSample.cpuSample,
        imageStatus: !coverUrl ? "missing" : this.pendingImages.has(coverUrl) ? "pending" : decoded ? "decoded" : this.decodedImages.has(coverUrl) ? "failed" : "pending",
        imageError: coverUrl ? this.imageErrors.get(coverUrl) : undefined,
      });
    });
    const gpuReadback = this.renderer ? this.readBackVisibleAlbumTiles(albums) : undefined;
    return {
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      pageColumns: this.pageColumns,
      pageRows: this.pageRows,
      instancesPerPage: this.instancesPerPage,
      pendingImages: this.pendingImages.size,
      decodedImages: [...this.decodedImages.entries()].map(([url, image]) => ({
        url,
        status: image ? "decoded" : "failed",
        width: image?.width ?? 0,
        height: image?.height ?? 0,
        error: this.imageErrors.get(url),
      })),
      albums: [...albums.values()],
      gpuReadback,
    };
  }

  private readBackVisibleAlbumTiles(albums: Map<string, CoverDiagnosticAlbum>) {
    const internalRenderer = this.renderer as THREE.WebGLRenderer & {
      properties?: { get(texture: THREE.Texture): { __webglTexture?: WebGLTexture } };
    };
    const gl = this.renderer!.getContext() as WebGL2RenderingContext;
    const createFramebuffer = gl.createFramebuffer.bind(gl);
    const framebuffer = createFramebuffer();
    if (!framebuffer) return { status: "framebuffer-allocation-failed" };
    const previousReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousDrawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousReadBuffer = gl.getParameter(gl.READ_BUFFER) as number;
    const samples: { id: string; layer: number; status: string; cpu: number[]; gpu: number[] }[] = [];
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      for (const album of albums.values()) {
        const page = this.pages[album.page];
        const texture = page?.texture;
        const gpuTexture = texture
          ? (internalRenderer.properties?.get(texture) as { __webglTexture?: WebGLTexture } | undefined)?.__webglTexture
          : undefined;
        if (!page || !gpuTexture) {
          samples.push({ id: album.id, layer: album.layer, status: "texture-not-uploaded", cpu: [], gpu: [] });
          continue;
        }
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gpuTexture, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          samples.push({ id: album.id, layer: album.layer, status: `framebuffer-${status}`, cpu: [], gpu: [] });
          continue;
        }
        const localX = Math.floor(this.tileWidth / 2);
        const localY = Math.floor(this.tileHeight / 2);
        const x = (album.layer % this.pageColumns) * this.tileWidth + localX;
        const y = Math.floor(album.layer / this.pageColumns) * this.tileHeight + localY;
        const cpu = album.cpuSample ?? [];
        const gpuBytes = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, gpuBytes);
        samples.push({
          id: album.id,
          layer: album.layer,
          status: cpu.length === 4 ? "ok" : "cpu-reference-unavailable",
          cpu,
          gpu: [...gpuBytes],
        });
      }
      return { status: "ok", samples };
    } catch (error) {
      return { status: "readback-failed", error: error instanceof Error ? error.message : String(error), samples };
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
      gl.readBuffer(previousReadBuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDrawFramebuffer);
      gl.deleteFramebuffer(framebuffer);
    }
  }

  /** Return a CPU-side PNG for an isolated visual decode/render diagnostic. */
  previewSelectedDataUrl() {
    const canvas = document.createElement("canvas");
    canvas.width = this.selectedCanvas.width;
    canvas.height = this.selectedCanvas.height;
    const key = this.selectedKey;
    if (key && this.copyCover(canvas, key)) return canvas.toDataURL("image/png");
    canvas.getContext("2d")!.drawImage(this.selectedCanvas, 0, 0);
    return canvas.toDataURL("image/png");
  }

  dispose() {
    this.disposed = true;
    this.pendingImages.clear();
    this.decodedImages.clear();
    for (const page of this.pages) page.texture.dispose();
    this.tileSource.dispose();
    this.selectedTexture.dispose();
    this.arrayGeometry.dispose();
    for (const page of this.pages) page.geometry.dispose();
    for (const array of this.arrays) (array.material as THREE.Material).dispose();
    this.selected.geometry.dispose();
    this.selected.material.dispose();
  }
}

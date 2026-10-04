import "@kitlangton/rolling-number/styles.css";
import "./style.css";
import "./quality-settings.css";
import "./document-decryption.css";
import "./decryption.css";
import "./music.css";
import "./music-playlists.css";
import "./music-navigation-motion.css";
import "./music-navigation-ruler.css";
import "./music-transport-title.css";
import "./music-theme.css";
import "./music-theme-switch.css";
import { DocumentDecryption } from "./document-decryption";
import { ContentTransition, SurfaceTransition } from "./ui-transitions";
import { qualityMarkup, syncQualityUI } from "./quality-settings";
import { ArchiveScene } from "./scene";
import {
  records,
  archiveColumns,
  columnFiles,
  fileLocation,
  musicLibrary,
  setMusicAlbums,
  orderMusicAlbums,
  type MusicSortMode,
} from "./data";
import { wrap, type ArchiveNavigation } from "./archive-loop";
import {
  normalizeQuality,
  qualityPresets,
  type QualityPreset,
  type RenderQuality,
} from "./render-quality";
import { MusicPlayer, type MusicPlayerState } from "./music-player";
import { ModelViewer } from "./model-viewer";
import { TerminalAudio } from "./audio";
import type {
  MusicAlbum,
  MusicGenre,
  MusicLibrary,
  MusicPlaylist,
  MusicTrack,
  GenreRules,
} from "./music-types";
import { demoAlbums, demoGenres } from "./demo-library";
import { escapeHtml as esc } from "./html";
import { albumTitleMarkup, setupMusicTitleLayout } from "./music-title";
import { setupMusicTextMotion } from "./music-text-motion";
import { setupTransportTitle } from "./music-transport-title";
import { setupMusicTicks } from "./music-ticks";
import { setupMusicRuler } from "./music-ruler";
import { MusicPresentation, type AlbumSelection } from "./music-presentation";
import { MusicTrackFocus } from "./music-track-focus";
import { MusicBoot } from "./music-boot";
import { viewportLayout } from "./viewport-layout";
import { probeGpuCapability } from "./gpu-capability";
import { BUILD_VERSION } from "./build-version";
import { activeLyricIndex, parseLrc, type LyricLine } from "./lyrics";

type Theme = "day" | "dusk" | "night";
type Panel = "library" | "search" | "settings" | "playlists" | "queue" | "lyrics" | null;
document.title = `Rhine Music ${BUILD_VERSION}`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const icons = {
  play: svg('<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1"/>'),
  search: svg(
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  ),
  playlist: svg('<path d="M4 6h12M4 12h12M4 18h8"/><path d="M19 15v6l-2-1.2-2 1.2v-6a2 2 0 1 1 4 0Z"/>'),
  queue: svg('<path d="M4 6h16M4 12h16M4 18h9"/><path d="m17 16 4 2-4 2v-4Z" fill="currentColor" stroke="none"/>'),
  settings: svg(
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="var(--surface)"/><circle cx="15" cy="17" r="2.5" fill="var(--surface)"/>',
  ),
  folder: svg('<path d="M3 7V5h6l2 2h10v13H3Z"/>'),
};
const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const preferences = {
  ...{
    theme: "day" as Theme,
    sortMode: "genre" as MusicSortMode,
    quality: "original" as QualityPreset,
    reduced: false,
    volume: 0.65,
    songFade: true,
    bgm: true,
    bgmVolume: 0.18,
    sound: true,
    soundVolume: 0.22,
    renderQuality: undefined as RenderQuality | undefined,
  },
  ...read<
    Partial<{
      theme: Theme;
      sortMode: MusicSortMode;
      quality: QualityPreset;
      reduced: boolean;
      volume: number;
      songFade: boolean;
      bgm: boolean;
      bgmVolume: number;
      sound: boolean;
      soundVolume: number;
      renderQuality: RenderQuality;
    }>
  >("rhine-music-preferences", {}),
};
let renderQuality = normalizeQuality(
  preferences.quality === "original" &&
    preferences.renderQuality?.pixelRatio === 1.5 &&
    Object.entries(qualityPresets.original).every(([key, value]) =>
      key === "pixelRatio" || preferences.renderQuality?.[key as keyof RenderQuality] === value,
    )
    ? qualityPresets.original
    : preferences.renderQuality || qualityPresets[preferences.quality],
);
if (preferences.quality === "original" && preferences.renderQuality?.pixelRatio === 1.5) {
  preferences.renderQuality = renderQuality;
  save("rhine-music-preferences", preferences);
}
if (!["day", "dusk", "night"].includes(preferences.theme)) {
  preferences.theme = "day";
  save("rhine-music-preferences", preferences);
}
if (!Object.hasOwn(qualityPresets, preferences.quality))
  preferences.quality = "original";
const gpuCapability = probeGpuCapability();
if (!["genre", "artist", "album"].includes(preferences.sortMode))
  preferences.sortMode = "genre";
const sortLabels: Record<MusicSortMode, { name: string; column: string; code: string }> = {
  genre: { name: "按流派", column: "流派", code: "GENRE" },
  artist: { name: "按歌手名字", column: "歌手", code: "ARTIST" },
  album: { name: "按专辑名字", column: "分组", code: "ALBUMS" },
};
const sortLabel = sortLabels[preferences.sortMode];
let libraryReceived = false,
  scanSubmitting = false;
let scanRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let library: MusicLibrary = {
  version: 1,
  albums: [],
  genres: [],
  roots: [],
  scan: { running: false },
  onlineEnabled: false,
};
let albums: MusicAlbum[] = [],
  genres: MusicGenre[] = [],
  demo = false,
  selected = 0;
let mode: "archive" | "detail" = "archive",
  activeTab: "tracks" | "about" = "tracks",
  panel: Panel = null;
let scene: ArchiveScene | undefined,
  ready = false,
  apiAvailable = true,
  refreshing = false;
let introductionsStarting = false,
  libraryStateVersion = 0,
  introductionRequestError = "";
let viewer: ModelViewer | undefined;
let boot: MusicBoot | undefined;
const effects = new TerminalAudio();
effects.configure({
  sound: preferences.sound,
  music: false,
  soundVolume: preferences.soundVolume,
  musicVolume: 0,
});
document.addEventListener("pointerdown", () => void effects.unlock(), {
  once: true,
});
document.addEventListener("keydown", () => void effects.unlock(), {
  once: true,
});
let toastTimer: ReturnType<typeof setTimeout>,
  pollTimer: ReturnType<typeof setTimeout> | undefined;
let columnMemory = new Map<string, string>();
let playerState: MusicPlayerState;
let playlists: MusicPlaylist[] = [];
let selectedPlaylistId = "";
let pendingPlaylistTrackId = "";
let lyricTrackId: string | null = null;
let lyricRequestVersion = 0;
let lyricLines: LyricLine[] = [];
let lyricStateText = "尚未载入歌词。";
let activeRenderedLyric = -2;
let activeDockLyric = -2;
let lyricClockFrame = 0;
const player = new MusicPlayer({
  volume: preferences.volume,
  songFadeEnabled: preferences.songFade,
  bgmEnabled: preferences.bgm,
  bgmVolume: preferences.bgmVolume,
});
const themeNames: Record<Theme, string> = {
  day: "暖昼",
  dusk: "薄暮",
  night: "深夜",
};
const themeDescriptions: Record<Theme, string> = {
  day: "暖白玻璃与日光",
  dusk: "雾蓝暮色与柔光",
  night: "极简星空与透光白卡",
};
const stage = $("#stage");
stage.className = "music-app";
stage.dataset.mode = "archive";
stage.dataset.theme = preferences.theme;
stage.innerHTML = `
  <div id="three-scene" class="three-scene"></div>
  <div class="music-vignette" aria-hidden="true"></div>
  <header class="music-header">
    <div class="music-identity"><a class="music-brand" href="/" aria-label="Rhine Music 音乐库"><strong>RHINE LAB</strong><span>MUSIC ARCHIVE <i>／</i> 私人音乐终端</span></a></div>
    <nav class="music-topnav" aria-label="音乐终端导航">
      <button data-action="library" aria-label="音乐库">${icons.folder}<span>音乐库</span></button>
      <button data-action="search" aria-label="搜索">${icons.search}<span>搜索</span></button>
      <button data-action="playlists" aria-label="我的歌单">${icons.playlist}<span>歌单</span></button>
      <button data-action="queue" aria-label="播放队列">${icons.queue}<span>队列</span><small id="queue-count">0</small></button>
      <div class="theme-switch" role="group" aria-label="主题">${(["day", "dusk", "night"] as Theme[]).map((t) => `<button data-theme="${t}" title="${themeNames[t]}主题" aria-label="${themeNames[t]}主题" aria-pressed="${preferences.theme === t}"><i class="theme-dot ${t}"></i><span>${themeNames[t]}</span></button>`).join("")}</div>
      <button data-action="settings" class="icon-button" aria-label="播放与画质设置">${icons.settings}</button>
      <div class="minimal-transport" role="group" aria-label="音乐播放"><button type="button" data-action="locate-playing" id="transport-track" class="transport-track" aria-label="定位当前歌曲" aria-hidden="true" disabled><span id="transport-track-label"></span></button><span id="transport-lyric-status" class="transport-lyric-status" role="status" aria-live="polite" hidden></span><button type="button" id="transport-lyrics-open" class="transport-lyrics-open" data-action="lyrics-panel" hidden>歌词 ↗</button><button data-action="play-pause" id="play-pause" aria-label="播放" aria-pressed="false"><span class="transport-glyph transport-play" aria-hidden="true">${icons.play}</span><span class="transport-glyph transport-pause" aria-hidden="true">${icons.pause}</span></button><button data-action="stop" id="stop-playback" aria-label="停止">${icons.stop}</button></div>
    </nav>
  </header>
  <aside id="music-lyric-dock" class="music-lyric-dock" aria-label="实时同步歌词" hidden>
    <div class="music-lyric-copy">
      <strong id="music-lyric-current" class="music-lyric-current" aria-live="polite"></strong>
      <span id="music-lyric-next" class="music-lyric-next" aria-hidden="true"></span>
    </div>
    <button type="button" data-action="lyrics-panel" aria-label="打开完整歌词">完整歌词 ↗</button>
  </aside>
  <div id="library-status" class="library-status"><i></i><span>正在读取本地音乐索引</span></div>
  <section id="music-browse" class="music-browse" aria-label="专辑浏览">
    <div class="music-browse-veil" aria-hidden="true"></div>
    <div class="album-callout"><p class="music-eyebrow">MUSIC ARCHIVE <span>／</span> <span id="selection-genre"></span></p>
      <div class="selection-rule"><span id="selection-code">ALBUM <span id="selection-code-number">001</span></span><span id="selection-format"></span></div>
      <h1 id="selection-title"></h1><p id="selection-artist" class="selection-artist"></p>
      <div class="selection-meta" id="selection-meta"></div>
      <button class="open-album" data-action="open">打开专辑 <span>↗</span></button>
    </div>
    <div class="music-navigation">
      <div class="music-counter"><span class="music-eyebrow">ALBUM / SELECT</span><div><b id="selection-number">01</b><span>/ <i id="selection-total">00</i></span></div></div>
      <div class="album-stepper"><button data-action="prev" aria-label="上一个专辑">↑</button><div id="album-ticks"></div><button data-action="next" aria-label="下一个专辑">↓</button></div>
      <div class="genre-stepper"><button data-action="genre-prev" aria-label="上一个${sortLabel.column}">←</button><div><small id="genre-position">${sortLabel.code} <span id="genre-index">01</span> / <span id="genre-total">00</span></small><button data-action="genres" id="genre-name"></button></div><button data-action="genre-next" aria-label="下一个${sortLabel.column}">→</button></div>
    </div>
    <div class="music-keyhint">← → ${sortLabel.column} <span>／</span> ↑ ↓ 专辑 <span>／</span> ENTER 打开专辑</div>
  </section>
  <section id="music-detail" class="music-detail" aria-label="专辑详情" hidden>
    <button class="music-back" data-action="back">← 返回专辑架 <kbd>ESC</kbd></button>
    <div class="card-caption"><span id="detail-card-id"></span><small>拖动卡片，查看完整封面</small></div>
    <article id="album-detail-content" tabindex="-1"></article>
  </section>
  <div id="music-empty" class="music-empty" hidden><small>YOUR PRIVATE COLLECTION</small><h1>让音乐进入这座档案馆。</h1><p>选择本地音乐文件夹，专辑封面会出现在每一张卡片上。</p><button data-action="library">设置音乐文件夹 ↗</button><button data-action="demo" class="subtle">先查看演示封面</button></div>
  <div class="music-bottomline"><span>LOCAL COLLECTION <i>·</i> <span id="library-count">0 ALBUMS</span></span><span id="runtime-info">THREE.JS / LOCAL</span></div>
  <div id="music-panel-root"></div><div id="music-toast" role="status" aria-live="polite"></div>
  <div id="music-loading"><span class="loading-orbit"></span><strong>OPENING THE ARCHIVE</strong><small>正在载入三维专辑架</small></div>
`;
const titleMotion = setupMusicTitleLayout(stage);
const textMotion = setupMusicTextMotion(stage);
// Keep the previous navigation available while the ruler version is on trial.
const tickMotion = new URLSearchParams(location.search).get("nav") === "previous"
  ? setupMusicTicks($("#album-ticks"))
  : setupMusicRuler($("#album-ticks"));
let selectionInitialized = false;
const selectionMotionEnabled = () =>
  ready &&
  !boot?.active &&
  mode === "archive" &&
  !$("#music-browse").hidden &&
  !preferences.reduced;
function syncSelectionMotion() {
  // Build static reels during the hidden camera movement, before the text fades in.
  const enabled = selectionMotionEnabled() ||
    (mode === "archive" && !!albums.length && !preferences.reduced);
  textMotion.setEnabled(enabled);
  if (!enabled) titleMotion.finish();
  else {
    const album = currentAlbum();
    if (album) titleMotion.update(album.title, true);
  }
}

function notify(message: string) {
  $("#music-toast").textContent = message;
  $("#music-toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => $("#music-toast").classList.remove("visible"),
    5500,
  );
}
function time(value: number) {
  const n = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
function genreName(id: string) {
  return genres.find((g) => g.id === id)?.name || "未分类";
}
function currentAlbum() {
  return albums.find((a) => a.id === records[selected]?.id);
}
function formatList(a: MusicAlbum) {
  return (
    [
      ...new Set(
        a.tracks.map((t) => (t.codec ? `${t.format} / ${t.codec}` : t.format)),
      ),
    ].join(" · ") || (demo ? "封面演示" : "未提供")
  );
}
function albumDuration(a: MusicAlbum) {
  return a.tracks.reduce((sum, t) => sum + t.duration, 0);
}
function valueRange(
  values: (number | undefined)[],
  format: (n: number) => string,
) {
  const n = [
    ...new Set(values.filter((v): v is number => !!v && Number.isFinite(v))),
  ].sort((a, b) => a - b);
  return n.length
    ? n.length === 1
      ? format(n[0])
      : `${format(n[0])}–${format(n[n.length - 1])}`
    : "未提供";
}
function cover(a: MusicAlbum, className = "") {
  return a.coverUrl
    ? `<img class="${className}" src="${esc(a.coverUrl)}" alt="${esc(a.title)}专辑封面" loading="lazy">`
    : `<span class="cover-placeholder">♪</span>`;
}
const documentDecryption = new DocumentDecryption(
  "h1, .detail-artist, .album-facts span, .track-name strong, .album-about p",
  0.35,
);
const tabTransition = new ContentTransition();
const detailTransition = new SurfaceTransition(
  $("#music-detail"),
  $("#album-detail-content"),
  360,
  240,
  "right",
);
const browseTransition = new SurfaceTransition(
  $("#music-browse"),
  undefined,
  // Keep the existing reveal timing, but fade each overlay in its own layer.
  // Fading the parent traps its text below the night vignette until opacity=1.
  720,
  140,
  "up",
  "cubic-bezier(0.45, 0, 0.25, 1)",
  [$(".music-browse-veil"), $(".album-callout"), $(".music-navigation"), $(".music-keyhint")],
);
let detailIdentity = "",
  pendingDetailFocus = false;
const trackFocus = new MusicTrackFocus();
let pendingTrackReveal: { albumId: string; trackId: string } | undefined;
function cancelTrackReveal() {
  pendingTrackReveal = undefined;
  trackFocus.cancel();
}
// The pane is interactive while its entrance is finishing. Cancel a queued
// reveal too, so a click/scroll in that interval is never pulled back later.
for (const event of ["wheel", "pointerdown", "touchstart", "keydown"] as const) {
  $("#album-detail-content").addEventListener(event, () => {
    if (pendingTrackReveal) cancelTrackReveal();
  }, { passive: true });
}
let libraryRebuilding = false;
type LibraryIntent = AlbumSelection & { openAfter: boolean } |
  { mode: "archive" | "detail" };
let libraryIntent: LibraryIntent | undefined;
const presentation = new MusicPresentation({
  presentationReady: () => scene?.musicPresentationReady ?? false,
  archiveReady: () => scene?.musicArchiveReady ?? false,
  archiveInteractive: () => scene?.musicArchiveInteractive ?? false,
  enterCamera: () => {
    scene?.setMode("detail");
    effects.setScene("detail");
    effects.play("open");
  },
  returnCamera: () => {
    scene?.setMode("archive");
    effects.setScene("archive");
    effects.play("back");
  },
  select: ({ index, navigation }) => commitSelection(index, navigation),
  switchDetail: ({ index, navigation }) => commitSelection(index, navigation, true),
  mode: (next) => {
    mode = next;
    stage.dataset.mode = next;
    syncSelectionMotion();
    syncLyricDockVisibility();
  },
  prepareMenu: () => {
    activeTab = "tracks";
    detailTransition.hide(true);
    renderDetail();
    const content = $("#album-detail-content");
    content.style.removeProperty("opacity");
    content.style.removeProperty("transform");
    $("#music-detail").inert = true;
    $("#music-detail").setAttribute("aria-hidden", "true");
  },
  showMenu: () => {
    const detail = $("#music-detail"), content = $("#album-detail-content");
    detailTransition.show(preferences.reduced);
    detail.inert = !!panel;
    detail.setAttribute("aria-hidden", "false");
    content.inert = false;
    content.scrollTop = 0;
    documentDecryption.reset(content, preferences.reduced);
    pendingDetailFocus = true;
  },
  hideMenu: (done) => {
    trackFocus.cancel();
    pendingDetailFocus = false;
    tabTransition.cancel();
    $("#music-detail").inert = true;
    $("#music-detail").setAttribute("aria-hidden", "true");
    detailTransition.hide(preferences.reduced, done);
  },
  hideBrowse: (done) => {
    $("#music-browse").inert = true;
    $("#music-browse").setAttribute("aria-hidden", "true");
    browseTransition.hide(preferences.reduced, done);
  },
  showBrowse: showBrowseSurface,
});
boot = new MusicBoot(stage, {
  reduced: () => preferences.reduced,
  onStart: () => {
    cancelTrackReveal();
    presentation.reset();
    detailTransition.hide(true);
    browseTransition.hide(true);
    scene?.setMode("hidden");
    syncSelectionMotion();
  },
  onComplete: (reason) => {
    const now = performance.now() / 1000;
    if (reason === "skip") scene?.showMusicArchiveImmediately(now);
    else scene?.finishMusicIntro(now);
    effects.setScene("archive");
    showBrowseSurface();
  },
});
function showBrowseSurface() {
  if (!albums.length || boot?.active) return;
  browseTransition.show(preferences.reduced);
  $("#music-browse").inert = !!panel;
  $("#music-browse").setAttribute("aria-hidden", "false");
  syncSelectionMotion();
  if (!panel) $("[data-action=open]").focus({ preventScroll: true });
}
function savePrefs() {
  save("rhine-music-preferences", preferences);
}
function setTheme(theme: Theme) {
  if (theme !== "day" && theme !== "dusk" && theme !== "night") theme = "day";
  if (theme === preferences.theme) return;
  preferences.theme = theme;
  stage.dataset.theme = theme;
  scene?.setTheme(theme, !preferences.reduced);
  viewer?.setTheme(theme);
  document
    .querySelectorAll<HTMLButtonElement>("button[data-theme]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.theme === theme)),
    );
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      theme === "night" ? "#0a1220" : theme === "dusk" ? "#cbd6df" : "#e8e5e1",
    );
  savePrefs();
}
function fit() {
  // Use the same stage dimensions and aspect boundary as the scene framing.
  stage.dataset.layout = viewportLayout(stage.clientWidth, stage.clientHeight, false).kind;
  scene?.resize();
  viewer?.resize();
  if (mode === "detail") {
    syncTabIndicator(false);
    documentDecryption.refresh();
  }
}
window.addEventListener("resize", fit);

async function request<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(
    url,
    body === undefined && method === undefined
      ? {}
      : {
          method: method || "POST",
          ...(body === undefined ? {} : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          }),
        },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(data?.error || `本地服务请求失败 (${response.status})`);
  return data as T;
}
async function loadLibrary(force = false) {
  // Keep the selected cards and cover atlas stable for the opening shot.
  if (boot?.active) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void loadLibrary(force), 1000);
    return;
  }
  if (refreshing) return;
  refreshing = true;
  const stateVersion = libraryStateVersion;
  try {
    const next = await request<MusicLibrary>("/api/library");
    apiAvailable = true;
    if (stateVersion === libraryStateVersion && !boot?.active) await receiveLibrary(next, force);
  } catch (error) {
    apiAvailable = false;
    // The bundled demo is local and does not depend on the music service.
    // Keep its entry point available when an empty library cannot be fetched.
    if (!albums.length) $("#music-empty").hidden = false;
    updateStatus();
    updateIntroductionStatus();
    if (force)
      notify(
        `${(error as Error).message}。请使用 npm run music 启动本地音乐服务。`,
      );
  } finally {
    refreshing = false;
  }
  clearTimeout(pollTimer);
  pollTimer = setTimeout(
    () => void loadLibrary(),
    library.scan.running ||
      library.enrich?.running ||
      library.introductions?.running
      ? 1400
      : 12000,
  );
}
async function receiveLibrary(next: MusicLibrary, force = false) {
  const previousScan = library.scan;
  const scanCompleted = libraryReceived && !next.scan.running && !next.scan.error &&
    !!next.scan.finishedAt && next.scan.finishedAt !== previousScan.finishedAt;
  const scanFailed = libraryReceived && previousScan.running && !next.scan.running && !!next.scan.error;
  libraryReceived = true;
  const previousIntroductionRun = library.introductions;
  const changed =
    JSON.stringify(next.albums) !== JSON.stringify(library.albums) ||
    JSON.stringify(next.genres) !== JSON.stringify(library.genres);
  library = next;
  if (library.introductions?.running) introductionRequestError = "";
  if (changed || force) await applyLibrary();
  updateStatus();
  if (panel === "library") updateScanStatus();
  updateIntroductionStatus();
  if (
    previousIntroductionRun?.running &&
    library.introductions &&
    !library.introductions.running
  ) {
    const result = library.introductions;
    notify(
      result.error ||
        `专辑介绍查询完成：更新 ${result.updated} 张，未找到可靠资料 ${result.notFound} 张，查询失败 ${result.failed} 张。`,
    );
  }
  if (scanFailed) notify(`音乐库扫描失败：${next.scan.error}`);
  if (scanCompleted && !scanRefreshTimer) {
    notify("音乐库扫描完成，2 秒后自动刷新页面。");
    scanRefreshTimer = setTimeout(() => location.reload(), 2000);
  }
}
async function applyLibrary() {
  const hadAlbums = albums.length > 0;
  const previousId = currentAlbum()?.id;
  const previousDetail = JSON.stringify(currentAlbum());
  const visualKey = (items: MusicAlbum[], groups: MusicGenre[]) =>
    JSON.stringify([
      items.map((a) => [a.id, a.title, a.artist, a.genreId, a.coverUrl]),
      groups.map((g) => [g.id, g.name]),
    ]);
  const oldVisual = visualKey(albums, genres);
  if (library.albums.length) demo = false;
  let visualSamples = demoAlbums;
  if (demo && new URLSearchParams(location.search).get("profile") === "1") {
    const requestedCount = Number(new URLSearchParams(location.search).get("stress"));
    const count = Number.isInteger(requestedCount) ? Math.max(0, Math.min(500, requestedCount)) : 0;
    if (count > demoAlbums.length) {
      visualSamples = Array.from({ length: count }, (_, index) => {
        const source = demoAlbums[index % demoAlbums.length];
        return {
          ...source,
          id: `${source.id}-stress-${index + 1}`,
          title: `${source.title} ${String(index + 1).padStart(2, "0")}`,
          folder: `${source.folder} · 合成压力样本`,
        };
      });
    }
  }
  albums = orderMusicAlbums(demo ? visualSamples : library.albums, preferences.sortMode);
  genres = demo ? demoGenres : library.genres;
  setMusicAlbums(albums, genres, preferences.sortMode);
  selected = Math.max(
    0,
    records.findIndex((r) => r.id === previousId),
  );
  columnMemory = new Map(
    archiveColumns.map((name, lane) => [
      name,
      records[columnFiles(lane)[0]]?.id,
    ]),
  );
  if (scene && ready && oldVisual !== visualKey(albums, genres)) {
    const reopen = presentation.openingOrDetail;
    cancelTrackReveal();
    libraryRebuilding = true;
    libraryIntent = undefined;
    presentation.reset();
    detailTransition.hide(true);
    browseTransition.hide(true);
    try {
      if (scene.isMusicLibraryScene !== musicLibrary) {
        scene.dispose();
        scene = new ArchiveScene($("#three-scene"));
        if (new URLSearchParams(location.search).get("lighting") !== "baseline")
          scene.enableSelectionLighting();
        await Promise.all([
          scene.load(),
          document.fonts.load("400 20px MiSans"),
          document.fonts.load("600 20px MiSans"),
        ]);
        ready = true;
        $("#three-scene canvas").setAttribute(
          "aria-label",
          `三维专辑阵列，左右切${sortLabel.column}，上下切专辑`,
        );
        stage.classList.toggle("reduce-motion", preferences.reduced);
        scene.setTheme(preferences.theme);
        scene.setQuality(renderQuality);
        scene.setReduced(preferences.reduced);
        bindSceneNavigation(scene);
      }
      await scene.refreshLibrary(selected);
    }
    finally { libraryRebuilding = false; }
    const intent = libraryIntent as LibraryIntent | undefined;
    libraryIntent = undefined;
    scene.setMode("archive");
    if (intent && "index" in intent)
      select(intent.index, intent.navigation, intent.openAfter, intent.route);
    else if ((intent ? intent.mode === "detail" : reopen) && albums.length)
      presentation.open();
    else showBrowseSurface();
  }
  if (!albums.length) {
    cancelTrackReveal();
    presentation.reset();
  }
  stage.dataset.mode = mode;
  syncLyricDockVisibility();
  $("#music-empty").hidden = albums.length > 0;
  // Ordinary index refreshes must not reveal a page while its peer is exiting.
  if (!ready || !hadAlbums || !albums.length) {
    if (albums.length && mode === "archive") browseTransition.show(true);
    else browseTransition.hide(true);
    // Detail is revealed exclusively by the camera completion gate.
    if (presentation.phase !== "detail") detailTransition.hide(true);
    $("#music-browse").inert = !albums.length || mode !== "archive" || !!panel;
    $("#music-detail").inert = !albums.length || mode !== "detail" || !!panel;
    $("#music-browse").setAttribute(
      "aria-hidden",
      String(!albums.length || mode !== "archive"),
    );
    $("#music-detail").setAttribute(
      "aria-hidden",
      String(!albums.length || mode !== "detail"),
    );
  }
  updateSelection();
  if (mode === "detail" && previousDetail !== JSON.stringify(currentAlbum()))
    renderDetail();
  updateStatus();
}
function updateStatus() {
  const n = library.albums.length,
    tracks = library.albums.reduce((sum, a) => sum + a.tracks.length, 0);
  const label = !apiAvailable
    ? "本地音乐服务尚未连接"
    : library.scan.running
      ? "正在扫描音乐库…"
      : library.enrich?.running
        ? `补充在线资料 ${library.enrich.completed}/${library.enrich.total}`
        : library.introductions?.running
          ? `查询专辑介绍 ${library.introductions.completed}/${library.introductions.total}`
          : demo
            ? "演示专辑 · 加入音乐后显示真实封面"
            : "";
  $("#library-status span").textContent = label;
  $("#library-status").hidden = !label;
  $("#library-status").classList.toggle(
    "working",
    !!library.scan.running ||
      !!library.enrich?.running ||
      !!library.introductions?.running,
  );
  $("#library-count").textContent = demo
    ? "DEMONSTRATION"
    : `${n} ALBUMS / ${tracks} TRACKS`;
}
function updateSelection(navigation?: ArchiveNavigation) {
  const a = currentAlbum();
  if (!a) {
    selectionInitialized = false;
    textMotion.finish();
    titleMotion.finish();
    return;
  }
  const location = fileLocation(selected),
    files = columnFiles(location.lane),
    idx = files.indexOf(selected);
  const animated = selectionInitialized && selectionMotionEnabled();
  selectionInitialized = true;
  textMotion.update(
    {
      number: idx + 1,
      total: files.length,
      genresTotal: archiveColumns.length,
      code: selected + 1,
      genreIndex: location.lane + 1,
      genre: archiveColumns[location.lane],
      genreName: archiveColumns[location.lane],
      format: demo
        ? "DEMO"
        : [...new Set(a.tracks.map((t) => t.format))].join(" / "),
      artist: a.artist,
      meta: [
        a.year ? String(a.year) : "年份未提供",
        demo ? "演示封面" : `${a.tracks.length} 首曲目`,
        a.tracks.length ? time(albumDuration(a)) : "",
      ]
        .filter(Boolean)
        .join("  /  "),
    },
    animated,
    navigation,
  );
  titleMotion.update(a.title, animated);
  $("#selection-title").title = a.title;
  tickMotion.update(
    files.map((index) => ({ index, id: records[index].id, title: records[index].title })),
    selected,
    preferences.reduced,
    navigation,
  );
  $("#detail-card-id").textContent =
    `ALBUM / ${String(selected + 1).padStart(3, "0")}`;
  // Hidden archive content can prepare its static reels before the reveal.
  if (!animated) syncSelectionMotion();
}
function commitSelection(index: number, navigation?: ArchiveNavigation, keepDetail = false) {
  selected = wrap(index, records.length);
  columnMemory.set(
    archiveColumns[fileLocation(selected).lane],
    records[selected].id,
  );
  if (keepDetail) scene?.switchMusicAlbum(selected, navigation);
  else scene?.select(selected, navigation);
  updateSelection(navigation);
  effects.play(
    navigation && "axis" in navigation && navigation.axis === "lane"
      ? "column"
      : "tick",
  );
}
function select(index: number, navigation?: ArchiveNavigation, openAfter = presentation.openingOrDetail, route?: AlbumSelection["route"]) {
  if (!records.length || !ready || boot?.active || index < 0) return;
  if (route !== "archive") cancelTrackReveal();
  const pending = libraryRebuilding && libraryIntent && "index" in libraryIntent
    ? libraryIntent : presentation.pendingSelection;
  const previous = pending?.navigation;
  if (pending) {
    // Coalesced key presses still reach the matching physical loop cell.
    navigation = previous && navigation && "axis" in previous && "axis" in navigation && previous.axis === navigation.axis
      ? { axis: navigation.axis, direction: previous.direction + navigation.direction }
      : undefined;
  }
  if (libraryRebuilding) {
    libraryIntent = { index: wrap(index, records.length), navigation, openAfter, route };
    return;
  }
  presentation.select({ index: wrap(index, records.length), navigation, route }, openAfter);
}
function bindSceneNavigation(target: ArchiveScene) {
  target.onSelect = (index, cell) => {
    if (!boot?.active && presentation.phase === "archive" && !panel)
      select(index, cell ? { cell } : undefined);
  };
  target.onNavigate = (axis, direction) => {
    if (!boot?.active && presentation.phase === "archive" && !panel)
      axis === "lane" ? stepGenre(direction) : stepAlbum(direction);
  };
}
/** Playback can reuse its open album; other targets take the archive route. */
function revealAlbum(albumId: string, trackId?: string, options: { reuseOpenAlbum?: boolean } = {}) {
  closePanel(() => {
    cancelTrackReveal();
    if (!ready || boot?.active) return;
    const index = records.findIndex((record) => record.id === albumId);
    const album = albums.find((item) => item.id === albumId);
    if (index < 0 || !album || (trackId && !album.tracks.some((track) => track.id === trackId))) {
      notify("这张专辑或歌曲已不在当前音乐库中，请刷新音乐库后重试。");
      return;
    }
    if (options.reuseOpenAlbum && trackId && !libraryRebuilding &&
      currentAlbum()?.id === albumId && presentation.openingOrDetail &&
      !presentation.pendingSelection &&
      ["detail", "opening", "switching"].includes(presentation.phase)) {
      // Preserve the camera and current scroll position. If the album is still
      // entering, the usual detail gate below will wait before revealing it.
      setTab("tracks");
      pendingTrackReveal = { albumId, trackId };
      return;
    }
    if (trackId) pendingTrackReveal = { albumId, trackId };
    select(index, undefined, true, "archive");
  });
}
function navigationSelection() {
  if (libraryRebuilding && libraryIntent && "index" in libraryIntent) return libraryIntent.index;
  return presentation.pendingSelection?.index ?? selected;
}
function stepAlbum(direction: number) {
  if (!records.length) return;
  const cursor = navigationSelection();
  const files = columnFiles(fileLocation(cursor).lane);
  if (files.length > 1)
    select(files[wrap(files.indexOf(cursor) + direction, files.length)], {
      axis: "row",
      direction,
    });
}
function stepGenre(direction: number) {
  if (!records.length || archiveColumns.length < 2) return;
  const lane = wrap(
    fileLocation(navigationSelection()).lane + direction,
    archiveColumns.length,
  );
  const remembered = columnMemory.get(archiveColumns[lane]);
  const index = records.findIndex((r) => r.id === remembered);
  select(index >= 0 ? index : columnFiles(lane)[0], {
    axis: "lane",
    direction,
  });
}
function setMode(next: "archive" | "detail") {
  if (boot?.active) return;
  if (next === "archive") cancelTrackReveal();
  if (libraryRebuilding) { libraryIntent = { mode: next }; return; }
  if (next === "detail") {
    if (currentAlbum()) presentation.open();
  } else presentation.back();
}
function syncTabIndicator(animate = true) {
  const button = document.querySelector<HTMLElement>(`#tab-${activeTab}`);
  const indicator = document.querySelector<HTMLElement>(".music-tab-indicator");
  if (!button || !indicator) return;
  indicator.style.transition = animate && !preferences.reduced ? "" : "none";
  indicator.style.transform = `translateX(${button.offsetLeft}px) scaleX(${button.offsetWidth})`;
}
function setTab(tab: "tracks" | "about") {
  if (activeTab === tab) return;
  cancelTrackReveal();
  activeTab = tab;
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  syncTabIndicator();
  const a = currentAlbum();
  if (!a) return;
  const content = $("#album-tab-content");
  content.innerHTML =
    tab === "tracks" ? trackList(a, a.discCount || 1) : albumAbout(a);
  content.setAttribute("aria-labelledby", `tab-${tab}`);
  documentDecryption.refresh();
  tabTransition.reveal(content, preferences.reduced);
  updatePlayingRows();
  effects.play("ui-tick");
}
function renderDetail() {
  const a = currentAlbum();
  if (!a) return;
  trackFocus.cancel();
  const discs =
    a.discCount || Math.max(1, ...a.tracks.map((t) => t.discNumber || 1));
  const bits =
    a.tracks.length && a.tracks.every((t) => t.lossless === false)
      ? "有损编码"
      : valueRange(
          a.tracks.map((t) => t.bitsPerSample),
          (n) => `${n} bit`,
        );
  const rate = valueRange(
    a.tracks.map((t) => t.sampleRate),
    (n) => `${Number((n / 1000).toFixed(1))} kHz`,
  );
  const bitrate = valueRange(
    a.tracks.map((t) => t.bitrate),
    (n) => `${Math.round(n / 1000)} kbps`,
  );
  const fields = [
    ["RELEASE / 发行年份", a.year || "未提供"],
    ["ARTIST / 歌手", a.artist],
    ["GENRE / 流派", genreName(a.genreId)],
    ["VOLUMES / 内含 CD", demo ? "—" : `${discs} CD · ${a.tracks.length} 首`],
    ["FORMAT / 文件格式", formatList(a)],
    ["RESOLUTION / 位深与采样率", `${bits} / ${rate}`],
    ["BITRATE / 码率", bitrate],
    ["DURATION / 总时长", time(albumDuration(a))],
  ];
  const article = $("#album-detail-content"),
    sameAlbum = detailIdentity === a.id,
    scroll = sameAlbum ? article.scrollTop : 0;
  detailIdentity = a.id;
  article.innerHTML = `<div class="detail-overline"><span>ALBUM ${String(selected + 1).padStart(3, "0")}</span><div class="detail-album-navigation" role="group" aria-label="切换专辑"><button data-action="prev" aria-label="上一张专辑">↑ 上一张</button><button data-action="next" aria-label="下一张专辑">下一张 ↓</button></div></div>
    <h1 title="${esc(a.title)}">${albumTitleMarkup(a.title)}</h1><p class="detail-artist">${esc(a.artist)}${a.offline ? '<span class="offline-badge">目录离线</span>' : ""}</p>
    <div class="album-facts">${fields.map(([name, value]) => `<div><small>${name}</small><span>${esc(String(value))}</span></div>`).join("")}</div>
    <div class="music-tabs" role="tablist" aria-label="专辑信息"><button role="tab" id="tab-tracks" data-tab="tracks" tabindex="${activeTab === "tracks" ? 0 : -1}" aria-selected="${activeTab === "tracks"}" aria-controls="album-tab-content"><span>01</span> 歌单</button><button role="tab" id="tab-about" data-tab="about" tabindex="${activeTab === "about" ? 0 : -1}" aria-selected="${activeTab === "about"}" aria-controls="album-tab-content"><span>02</span> 专辑介绍</button><i class="music-tab-indicator" aria-hidden="true"></i></div>
    <div id="album-tab-content" role="tabpanel" aria-labelledby="tab-${activeTab}">${activeTab === "tracks" ? trackList(a, discs) : albumAbout(a)}</div>`;
  article.scrollTop = scroll;
  syncTabIndicator(false);
  documentDecryption.reset(
    article,
    preferences.reduced || scene?.decryptionFrame.phase === "clear",
  );
  updatePlayingRows();
}
function trackList(a: MusicAlbum, discs: number) {
  if (!a.tracks.length)
    return `<div class="empty-tracks"><strong>${demo ? "这是一张封面演示卡片" : "这个专辑还没有可播放曲目"}</strong><p>${demo ? "用于检查封面原始比例与卡片材质。扫描本地音乐库后，这里会显示真实曲目。" : "请检查音乐文件是否完整，并重新扫描音乐库。"}</p><button data-action="library">打开音乐库设置 ↗</button></div>`;
  let disc = -1;
  return `<div class="track-list" aria-label="专辑歌曲列表">${a.tracks
    .map((t, index) => {
      const discNo = t.discNumber || 1;
      const head =
        discs > 1 && discNo !== disc
          ? `<div class="disc-heading">DISC ${String(discNo).padStart(2, "0")}</div>`
          : "";
      disc = discNo;
      return `${head}<div class="track-item"><button class="track-row" data-track="${esc(t.id)}" ${t.offline ? "disabled" : ""} aria-label="播放 ${esc(t.title)}"><span class="track-number">${String(t.trackNumber || index + 1).padStart(2, "0")}</span><span class="track-name"><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></span><span class="track-format">${esc(t.format)}${!t.browserPlayable ? '<i title="需要兼容的播放内核"> ↗</i>' : ""}</span><span class="track-duration">${time(t.duration)}</span></button>${!demo ? `<div class="track-tools"><button data-action="enqueue-track" data-track-id="${esc(t.id)}" ${t.offline ? "disabled" : ""} aria-label="加入播放队列：${esc(t.title)}" title="加入播放队列">＋</button><button data-action="choose-playlist" data-track-id="${esc(t.id)}" aria-label="加入歌单：${esc(t.title)}" title="加入歌单">♫</button></div>` : ""}</div>`;
    })
    .join("")}</div>${producerBlock(a)}`;
}
function albumAbout(a: MusicAlbum) {
  return `<section class="album-about"><small>ABOUT THIS ALBUM</small>
    ${a.description ? `<p>${esc(a.description)}</p>${a.descriptionSource ? `<a class="text-button" href="${esc(a.descriptionSource.url)}" target="_blank" rel="noopener">来源：${esc(a.descriptionSource.name)} ↗</a>${a.descriptionSource.license ? `<small class="introduction-license">${esc(a.descriptionSource.license)}</small>` : ""}` : ""}` : `<h3>专辑介绍待补充</h3><p>从公开百科核对专辑与歌手后读取介绍，附上来源并保存在本机。无法确认对应专辑时保留空白。</p>`}
    ${!demo ? `<button data-action="introduction-album" class="text-button" ${introductionsStarting || library.introductions?.running ? "disabled" : ""}>${a.description ? "更新" : "查询"}专辑介绍 ↗</button><p class="introduction-feedback" data-introduction-feedback="${esc(a.id)}" role="status">${esc(introductionAlbumStatus(a))}</p>` : ""}
    <div class="source-note"><span>本地目录</span><code>${esc(a.folder)}</code></div><div class="genre-tags">${a.rawGenres.map((g) => `<span>${esc(g)}</span>`).join("")}</div></section>${producerBlock(a)}`;
}
function introductionAlbumStatus(a: MusicAlbum) {
  const lookup = a.introduction;
  if (lookup?.status === "error")
    return `介绍查询失败：${lookup.error || "资料来源暂时无法访问，请稍后重试。"}${a.description ? " 已有介绍仍然保留。" : ""}`;
  if (lookup?.status === "uncertain")
    return `找到可能的同名专辑，尚无法可靠确认，暂未采用介绍。${a.description ? " 已保留原有介绍。" : ""}`;
  if (lookup?.status === "not-found")
    return a.description
      ? "本次未找到可靠更新，已保留原有介绍。"
      : "未找到可核实的专辑介绍，可以稍后重试。";
  if (a.description) return "介绍已保存在本机，可离线阅读。";
  return "尚未查询专辑介绍。";
}
function updateIntroductionStatus() {
  const job = library.introductions;
  const running = introductionsStarting || !!job?.running;
  const button = document.querySelector<HTMLButtonElement>(
    "#introduction-refresh",
  );
  if (button) {
    button.disabled = running || !apiAvailable || !library.albums.length;
    button.textContent = running
      ? "正在查询专辑介绍…"
      : "查询 / 更新专辑介绍 ↗";
  }
  for (const control of document.querySelectorAll<HTMLButtonElement>(
    '[data-action="introduction-album"]',
  ))
    control.disabled = running || !apiAvailable;
  for (const feedback of document.querySelectorAll<HTMLElement>(
    "[data-introduction-feedback]",
  )) {
    const album = albums.find(
      (a) => a.id === feedback.dataset.introductionFeedback,
    );
    if (album)
      feedback.textContent = running
        ? "正在查询专辑介绍，已有资料仍可阅读。"
        : introductionAlbumStatus(album);
  }
  const progress = document.querySelector<HTMLProgressElement>(
    "#introduction-progress",
  );
  if (progress) {
    progress.hidden = !running;
    progress.max = Math.max(1, job?.total || 0);
    progress.value = job?.completed || 0;
    if (introductionsStarting && !job?.running)
      progress.removeAttribute("value");
  }
  const missing = library.albums.filter((album) => !album.description?.trim());
  const coverage = document.querySelector<HTMLElement>(
    "#introduction-coverage",
  );
  if (coverage)
    coverage.textContent = `已有介绍 ${library.albums.length - missing.length} / ${library.albums.length} 张 · 尚缺 ${missing.length} 张`;
  const status = document.querySelector<HTMLElement>("#introduction-status");
  if (status)
    status.textContent = !apiAvailable
      ? "本地音乐服务尚未连接，连接后可查询介绍。"
      : introductionRequestError
        ? `无法开始查询：${introductionRequestError}`
        : !library.albums.length
          ? "扫描本地音乐文件夹后，即可查询专辑介绍。"
          : introductionsStarting
            ? "正在提交专辑介绍查询…"
            : job?.running
              ? `已处理 ${job.completed} / ${job.total} 张 · 更新 ${job.updated} 张${job.currentAlbum ? `\n正在查询：${job.currentAlbum}` : ""}`
              : job?.error
                ? `查询未完成：${job.error}`
                : job && job.total > 0
                  ? `上次查询：处理 ${job.completed} / ${job.total} 张 · 更新 ${job.updated} 张 · 未找到可靠资料 ${job.notFound} 张 · 查询失败 ${job.failed} 张`
                  : "查询会核对专辑、歌手与年份；无法确认的结果不会覆盖已有介绍。";
  const details = document.querySelector<HTMLDetailsElement>(
    "#introduction-missing",
  );
  if (details) {
    details.hidden = !missing.length;
    details.querySelector("summary")!.textContent =
      `查看尚缺介绍的 ${missing.length} 张专辑`;
    details.querySelector("ul")!.innerHTML = missing
      .map(
        (album) =>
          `<li><strong>${esc(album.title)}</strong><span>${esc(album.artist)} · ${esc(introductionAlbumStatus(album))}</span></li>`,
      )
      .join("");
  }
}
function producerBlock(a: MusicAlbum) {
  return `<section class="producer-section"><div><small>ALBUM CREDITS / 制作人员</small>${!demo ? '<button data-action="enrich-album">补充在线资料 ↗</button>' : ""}</div>${a.producers.length ? `<dl>${a.producers.map((p) => `<div><dt>${esc(p.role)}${p.trackTitle ? ` · ${esc(p.trackTitle)}` : ""}</dt><dd>${esc(p.name)}</dd></div>`).join("")}</dl>` : "<p>暂无制作资料。本地标签优先，MusicBrainz 资料可查询并缓存在本机。</p>"}${a.online?.status === "uncertain" ? "<p>找到多个可能的发行版本，暂未自动采用资料。</p>" : ""}${a.online?.error ? `<p>${esc(a.online.error)}</p>` : ""}</section>`;
}
function updatePlayingRows() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-track]")
    .forEach((row) => {
      const active = row.dataset.track === playerState?.currentTrack?.id;
      row.classList.toggle("playing", active);
      row.setAttribute("aria-current", String(active));
    });
}
let lastPlayerError = "";
const transportTitleMotion = setupTransportTitle(
  $<HTMLButtonElement>("#transport-track"),
  $("#transport-track-label"),
);
transportTitleMotion.setReduced(preferences.reduced);
player.subscribe((state) => {
  playerState = state;
  if ((state.currentTrack?.id ?? null) !== lyricTrackId)
    void loadLyrics(state.currentTrack);
  else syncLyricsPosition(player.playbackTime);
  syncLyricDockVisibility();
  syncLyricClock();
  updateLyricsPanel();
  syncQueuePanel();
  const titleVisible = !!state.currentTrack &&
    (state.transport === "playing" || state.transport === "paused" || state.transport === "loading");
  transportTitleMotion.update(state.currentTrack?.title ?? "", titleVisible);
  $("#play-pause").setAttribute("aria-pressed", String(state.playing));
  $("#play-pause").setAttribute(
    "aria-label",
    state.playing ? "暂停" : "播放",
  );
  $("#play-pause").title = state.currentTrack
    ? `${state.playing ? "暂停" : "播放"}：${state.currentTrack.title}`
    : "播放当前专辑";
  if (state.error && state.error !== lastPlayerError) notify(state.error);
  lastPlayerError = state.error || "";
  updatePlayingRows();
});

let panelFocus: HTMLElement | null = null;
let panelTransition: SurfaceTransition | undefined,
  panelClosing = false,
  pendingPanelAfter: (() => void) | undefined;
function closePanel(after?: () => void) {
  if (!panel) {
    after?.();
    return;
  }
  pendingPanelAfter = after;
  if (panelClosing) return;
  panelClosing = true;
  panelTransition?.hide(preferences.reduced, () => {
    panel = null;
    panelClosing = false;
    panelTransition?.dispose();
    panelTransition = undefined;
    $("#music-panel-root").innerHTML = "";
    for (const node of [
      $("#music-browse"),
      $("#music-detail"),
      $(".music-header"),
      $("#three-scene"),
    ])
      node.inert = false;
    $("#music-browse").inert = presentation.phase !== "archive";
    $("#music-detail").inert = presentation.phase !== "detail";
    panelFocus?.focus({ preventScroll: true });
    const next = pendingPanelAfter;
    pendingPanelAfter = undefined;
    next?.();
  });
}
function openPanel(next: Panel) {
  if (!next) return closePanel();
  cancelTrackReveal();
  panelTransition?.dispose();
  pendingPanelAfter = undefined;
  panelClosing = false;
  if (!panel) panelFocus = document.activeElement as HTMLElement;
  panel = next;
  const titles = {
    library: ["MUSIC LIBRARY", "本地音乐库"],
    search: ["FIND MUSIC", "搜索专辑与歌曲"],
    settings: ["SYSTEM SETTINGS", "播放与画质"],
    playlists: ["YOUR PLAYLISTS", "我的歌单"],
    queue: ["UP NEXT", "播放队列"],
    lyrics: ["SYNCHRONIZED LYRICS", "同步歌词"],
  };
  $("#music-panel-root").innerHTML =
    `<div class="music-panel-scrim" data-action="dismiss-panel"><section class="music-panel" role="dialog" aria-modal="true" aria-labelledby="music-panel-title"><div class="panel-heading"><div><small>${titles[next][0]}</small><h2 id="music-panel-title">${titles[next][1]}</h2></div><button data-action="close-panel" aria-label="关闭">×</button></div><div id="panel-body"></div></section></div>`;
  for (const node of [
    $("#music-browse"),
    $("#music-detail"),
    $(".music-header"),
    $("#three-scene"),
  ])
    node.inert = true;
  const scrim = $(".music-panel-scrim");
  scrim.hidden = true;
  panelTransition = new SurfaceTransition(scrim, $(".music-panel"));
  panelTransition.show(preferences.reduced);
  effects.play("page-open");
  if (next === "library") renderLibraryPanel();
  if (next === "search") renderSearchPanel();
  if (next === "settings") renderSettingsPanel();
  if (next === "playlists") renderPlaylistPanel();
  if (next === "queue") renderQueuePanel();
  if (next === "lyrics") renderLyricsPanel();
  (
    document.querySelector<HTMLElement>("#album-search") ||
    $("#music-panel-root button")
  )?.focus({ preventScroll: true });
}
function renderLibraryPanel() {
  $("#panel-body").innerHTML =
    `<p class="panel-intro">根目录中的每首单曲各是一张卡片，优先使用自身内嵌封面。子文件夹按专辑展示，优先使用文件夹封面。</p><label class="field-label" for="music-roots">音乐文件夹<span>多个目录各占一行</span></label><textarea id="music-roots" rows="3" placeholder="/Users/你的用户名/Music">${esc(library.roots.map((r) => r.path).join("\n"))}</textarea><div class="panel-actions"><button class="primary-button" data-action="scan">保存目录并扫描 ↗</button><button data-action="rescan">重新扫描</button></div><div id="scan-status" class="scan-status"></div><div class="library-metrics"><div><b>${library.albums.length}</b><span>专辑</span></div><div><b>${library.albums.reduce((n, a) => n + a.tracks.length, 0)}</b><span>曲目</span></div><div><b>${library.genres.filter((g) => library.albums.some((a) => a.genreId === g.id)).length}</b><span>流派</span></div></div><section class="panel-section"><h3>在线资料与本地分类</h3><p>向 MusicBrainz 查询专辑名称与艺术家，补充流派和制作人员；音乐文件留在本机。已有资料使用缓存，人工分类优先保留。</p><button data-action="enrich-library" class="text-button">补充缺失的在线资料 ↗</button><button data-action="edit-genres" class="text-button">编辑流派归并规则 ↗</button></section><section class="panel-section"><h3>封面显示</h3><p>方形、竖版、横版封面均保持原始比例，完整放入卡片正面。没有封面时显示专辑名称占位，不使用其他专辑的图片。</p>${!library.albums.length ? '<button data-action="demo" class="text-button">查看演示封面 ↗</button>' : ""}</section>`;
  updateScanStatus();
  const configSection = document.createElement("section");
  configSection.className = "panel-section";
  configSection.id = "online-config";
  $("#panel-body").append(configSection);
  void (async () => {
    try {
      const config = await request<{
        musicBrainzContact?: string;
        musicBrainzConfigured?: boolean;
        onlineEnabled?: boolean;
      }>("/api/config");
      if (!configSection.isConnected) return;
      configSection.innerHTML = `<h3>资料库连接</h3><label class="field-label" for="metadata-contact">MusicBrainz 联系邮箱或项目网址</label><input id="metadata-contact" type="text" value="${esc(config.musicBrainzContact || "")}" placeholder="你的联系邮箱或公开项目网址"><p>按 MusicBrainz 要求用于标识本应用的资料请求，不用于注册或订阅。</p><label class="settings-row"><span>扫描后自动补充新专辑资料<small>已有缓存不重复查询；断网仍可浏览与播放</small></span><input type="checkbox" id="online-enabled" ${config.onlineEnabled ? "checked" : ""}></label><button class="text-button" data-action="save-online">保存资料库设置 ↗</button><p>${config.musicBrainzConfigured ? "资料库请求标识已配置。" : "尚未配置；本地曲库和播放已可使用。"}</p>`;
    } catch (error) {
      if (configSection.isConnected)
        configSection.innerHTML = `<p>${esc((error as Error).message)}</p>`;
    }
  })();
}
function updateScanStatus() {
  const el = document.querySelector("#scan-status");
  if (el)
    el.textContent = library.scan.running
      ? "正在扫描，已有曲库可以继续浏览…"
      : library.scan.error ||
        library.roots
          .filter((r) => r.status === "offline")
          .map((r) => `${r.path} 暂时离线，原索引已保留。`)
          .join("\n") ||
        (library.scan.finishedAt
          ? `上次扫描 ${new Date(library.scan.finishedAt).toLocaleString("zh-CN")}`
          : "尚未扫描音乐目录。");
}
function renderSearchPanel() {
  $("#panel-body").innerHTML =
    `<input class="album-search" id="album-search" type="search" placeholder="专辑、歌曲、歌手、流派…" aria-label="搜索专辑与歌曲"><div class="genre-filters"><button data-filter="" class="active">全部</button>${genres
      .filter((g) => albums.some((a) => a.genreId === g.id))
      .map((g) => `<button data-filter="${esc(g.id)}">${esc(g.name)}</button>`)
      .join("")}</div><div id="album-results"></div>`;
  renderSearchResults();
}
let searchGenre = "";
function renderSearchResults() {
  const query = ($<HTMLInputElement>("#album-search")?.value || "")
    .trim()
    .toLocaleLowerCase();
  const results: string[] = [];
  for (const a of albums) {
    if (searchGenre && a.genreId !== searchGenre) continue;
    if (!query || `${a.title} ${a.artist} ${genreName(a.genreId)}`.toLocaleLowerCase().includes(query)) {
      results.push(`<button class="album-result" data-album="${esc(a.id)}"><span class="result-cover">${cover(a)}</span><span class="result-copy"><strong>${esc(a.title)}</strong><small>${esc(a.artist)} · ${esc(genreName(a.genreId))}</small></span><em>专辑</em><i>↗</i></button>`);
    }
    if (!query) continue;
    for (const track of a.tracks) {
      if (!`${track.title} ${track.artist}`.toLocaleLowerCase().includes(query)) continue;
      // Preserve the exact song identity; selecting a result navigates without playing.
      results.push(`<button class="album-result song-result" data-album="${esc(a.id)}" data-search-track="${esc(track.id)}" aria-label="定位歌曲 ${esc(track.title)}，${esc(a.title)}"><span class="result-cover">${cover(a)}</span><span class="result-copy"><strong>${esc(track.title)}</strong><small>${esc(track.artist)} · ${esc(a.title)}</small></span><em>歌曲</em><i>↗</i></button>`);
    }
  }
  $("#album-results").innerHTML = results.length
    ? results.join("")
    : '<div class="no-results">没有找到专辑或歌曲。</div>';
}
function renderSettingsPanel() {
  $("#panel-body").innerHTML =
    `<section class="panel-section"><h3>外观主题</h3><div class="theme-cards">${(["day", "dusk", "night"] as Theme[]).map((t) => `<button data-theme="${t}" aria-pressed="${preferences.theme === t}" class="${t}"><i></i><strong>${themeNames[t]}</strong><span>${themeDescriptions[t]}</span></button>`).join("")}</div></section>
    <section class="panel-section"><h3>音乐库排列</h3><label class="settings-row"><span>排列方式<small>切换后自动刷新页面</small></span><select id="music-sort" aria-label="音乐库排列方式">${(["genre", "artist", "album"] as MusicSortMode[]).map((value) => `<option value="${value}" ${preferences.sortMode === value ? "selected" : ""}>${sortLabels[value].name}</option>`).join("")}</select></label><p>按歌手时，同一歌手的专辑放在同一列；按专辑名时，按拼音或字母顺序排列，每 12 张一列。</p></section>
    <section class="panel-section" id="introduction-settings"><h3>专辑介绍</h3><p>从公开百科查询并更新专辑介绍，附上资料来源。介绍保存在本机，不需要配置 MusicBrainz 联系信息；音乐文件不会上传。</p><p id="introduction-coverage"></p><button class="primary-button" id="introduction-refresh" data-action="introductions-library">查询 / 更新专辑介绍 ↗</button><progress id="introduction-progress" aria-label="专辑介绍查询进度" max="1" value="0" hidden></progress><p id="introduction-status" class="scan-status" role="status" aria-live="polite"></p><details id="introduction-missing" hidden><summary></summary><ul></ul></details></section>
    ${qualityMarkup(renderQuality)}
    <section class="panel-section"><h3>动效与显示</h3><label class="settings-row"><span>减少动态效果<small>简化镜头、文字加载和页签过渡</small></span><input type="checkbox" id="reduced-motion" ${preferences.reduced ? "checked" : ""}></label><button class="text-button" data-action="fullscreen">切换全屏 ↗</button></section>
    <section class="panel-section"><h3>声音</h3><label class="settings-row"><span>歌曲音量</span><input type="range" id="volume" aria-label="歌曲音量" min="0" max="100" value="${Math.round(preferences.volume * 100)}"></label><label class="settings-row"><span>切歌淡入淡出<small>当前歌曲先淡出，再淡入下一首</small></span><input type="checkbox" id="song-fade-setting" ${preferences.songFade ? "checked" : ""}></label><label class="settings-row"><span>界面音效<small>玻璃卡片与终端操作</small></span><input type="checkbox" id="sound-setting" ${preferences.sound ? "checked" : ""}></label><label class="settings-row"><span>音效音量</span><input type="range" id="sound-volume" aria-label="音效音量" min="0" max="100" value="${Math.round(preferences.soundVolume * 100)}"></label><label class="settings-row"><span>氛围 BGM<small>专辑开始前淡出，停止后淡入</small></span><input type="checkbox" id="bgm-setting" ${preferences.bgm ? "checked" : ""}></label><label class="settings-row"><span>BGM 音量</span><input type="range" id="bgm-volume" aria-label="BGM 音量" min="0" max="100" value="${Math.round(preferences.bgmVolume * 100)}"></label><button class="text-button" data-action="sound-preview">试听界面音效 ↗</button><p>当前版本支持 Windows 与 macOS，使用浏览器播放本地音乐。DSF / DFF 暂不支持播放，其他格式取决于浏览器解码能力。</p></section>
    <section class="panel-section"><h3>开发与资源</h3><p>Rhine Music · Windows 桌面版 · WebView2 / WebGL 2（ANGLE）图形渲染。</p><p>Windows 版开发者：<a href="https://github.com/Bong712" target="_blank" rel="noopener">Bong712 ↗</a><br>特别鸣谢：<a href="https://github.com/RonaldDeng/Rhine-Music-Demo" target="_blank" rel="noopener">RonaldDeng ↗</a><br>原版界面：<a href="https://github.com/LBEILC/RhineLabUI" target="_blank" rel="noopener">LBEILC / RhineLabUI ↗</a></p><p><a href="/licenses/project-mit.txt" target="_blank" rel="noopener">代码 MIT 许可 ↗</a> · <a href="https://github.com/Bong712/Rhine-Music-Windows/blob/main/NOTICE.md" target="_blank" rel="noopener">版权与资源说明 ↗</a></p><a href="/?original=1&scene=archive" target="_blank" rel="noopener">打开原版档案界面 ↗</a><p><a href="/fonts/MiSans-license.pdf" target="_blank" rel="noopener">MiSans 字体许可 ↗</a></p></section>`;
  updateQuality();
  updateIntroductionStatus();
}

function renderPlaylistPanel() {
  $("#panel-body").innerHTML = `<p class="panel-intro">歌单只保存曲目路径和显示信息，不复制、移动或修改音乐文件。移除歌曲后，歌单会保留缺失项目并标明不可用。</p>
    <div class="playlist-create"><label class="field-label" for="playlist-new-name">新建歌单</label><div><input id="playlist-new-name" type="text" maxlength="100" placeholder="例如：夜间驾驶"><button class="primary-button" data-action="create-playlist">创建</button></div></div>
    <p id="playlist-status" class="scan-status" role="status" aria-live="polite">正在读取歌单…</p><div id="playlist-list"></div>`;
  void loadPlaylistPanel();
}

async function loadPlaylistPanel() {
  const status = document.querySelector<HTMLElement>("#playlist-status");
  try {
    const result = await request<{ version: number; playlists: MusicPlaylist[] }>("/api/playlists");
    playlists = result.playlists;
    if (!playlists.some((playlist) => playlist.id === selectedPlaylistId))
      selectedPlaylistId = playlists[0]?.id || "";
    renderPlaylistList();
    if (status?.isConnected)
      status.textContent = pendingPlaylistTrackId
        ? "选择一个歌单来添加这首歌曲。"
        : `${playlists.length} 个歌单 · 歌单保存在本机。`;
  } catch (error) {
    if (status?.isConnected) status.textContent = `读取歌单失败：${(error as Error).message}`;
  }
}

function renderPlaylistList() {
  const container = document.querySelector<HTMLElement>("#playlist-list");
  if (!container) return;
  if (!playlists.length) {
    container.innerHTML = '<div class="playlist-empty">还没有歌单。先创建一个，再从专辑曲目旁添加歌曲。</div>';
    return;
  }
  container.innerHTML = playlists.map((playlist) => {
    const availableCount = playlist.tracks.filter((track) => track.available).length;
    const selected = selectedPlaylistId === playlist.id;
    const entries = selected
      ? `<div class="playlist-track-list">${playlist.tracks.length ? playlist.tracks.map((track, index) => `<div class="playlist-track ${track.available ? "" : "unavailable"}"><button class="playlist-track-play" data-action="play-playlist-track" data-playlist-id="${esc(playlist.id)}" data-track-id="${esc(track.trackId)}" ${track.available ? "" : "disabled"}><span class="playlist-track-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${esc(track.title)}</strong><small>${esc(track.artist)} · ${esc(track.album || "未知专辑")}</small></span><em>${track.available ? time(track.duration) : "文件不可用"}</em></button><div class="playlist-track-actions"><button data-action="move-playlist-track" data-playlist-id="${esc(playlist.id)}" data-item-id="${esc(track.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="上移 ${esc(track.title)}">↑</button><button data-action="move-playlist-track" data-playlist-id="${esc(playlist.id)}" data-item-id="${esc(track.id)}" data-direction="1" ${index === playlist.tracks.length - 1 ? "disabled" : ""} aria-label="下移 ${esc(track.title)}">↓</button><button data-action="remove-playlist-track" data-playlist-id="${esc(playlist.id)}" data-item-id="${esc(track.id)}" aria-label="从歌单移除 ${esc(track.title)}">×</button></div></div>`).join("") : '<p class="playlist-empty">歌单里还没有歌曲。</p>'}</div>`
      : "";
    return `<article class="playlist-card ${selected ? "selected" : ""}" data-playlist-card="${esc(playlist.id)}"><div class="playlist-card-heading"><button class="playlist-select" data-action="select-playlist" data-playlist-id="${esc(playlist.id)}" aria-expanded="${selected}"><strong>${esc(playlist.name)}</strong><small>${playlist.tracks.length} 首 · ${availableCount} 首可播放</small></button><button data-action="play-playlist" data-playlist-id="${esc(playlist.id)}" ${availableCount ? "" : "disabled"} aria-label="播放歌单 ${esc(playlist.name)}">${icons.play}</button>${pendingPlaylistTrackId ? `<button data-action="add-pending-playlist" data-playlist-id="${esc(playlist.id)}">添加歌曲</button>` : ""}</div><div class="playlist-card-edit"><input type="text" maxlength="100" value="${esc(playlist.name)}" data-playlist-name="${esc(playlist.id)}" aria-label="修改歌单名称"><button data-action="rename-playlist" data-playlist-id="${esc(playlist.id)}">重命名</button><button data-action="delete-playlist" data-playlist-id="${esc(playlist.id)}">删除歌单</button></div>${entries}</article>`;
  }).join("");
}

async function createPlaylist() {
  const input = document.querySelector<HTMLInputElement>("#playlist-new-name");
  if (!input) return;
  try {
    const result = await request<{ playlist: MusicPlaylist }>("/api/playlists", { name: input.value });
    selectedPlaylistId = result.playlist.id;
    if (pendingPlaylistTrackId) await addPendingTrack(result.playlist.id);
    else {
      await loadPlaylistPanel();
      input.value = "";
      notify("歌单已创建并保存在本机。");
    }
  } catch (error) {
    notify(`创建歌单失败：${(error as Error).message}`);
  }
}

async function addPendingTrack(playlistId: string) {
  const trackId = pendingPlaylistTrackId;
  if (!trackId) return;
  try {
    const result = await request<{ added: number; skipped: number }>(`/api/playlists/${playlistId}/tracks`, { trackIds: [trackId] });
    pendingPlaylistTrackId = "";
    await loadPlaylistPanel();
    notify(result.added ? "歌曲已加入歌单。" : result.skipped ? "歌曲当前不在曲库中，暂时无法加入。" : "这首歌曲已在歌单里。");
  } catch (error) {
    notify(`添加歌曲失败：${(error as Error).message}`);
  }
}

async function renamePlaylist(id: string) {
  const input = document.querySelector<HTMLInputElement>(`[data-playlist-name="${CSS.escape(id)}"]`);
  if (!input) return;
  try {
    await request(`/api/playlists/${id}`, { name: input.value }, "PATCH");
    await loadPlaylistPanel();
    notify("歌单名称已更新。");
  } catch (error) {
    notify(`重命名失败：${(error as Error).message}`);
  }
}

async function deletePlaylist(id: string) {
  const playlist = playlists.find((entry) => entry.id === id);
  if (!playlist || !window.confirm(`删除歌单“${playlist.name}”？音乐文件不会受到影响。`)) return;
  try {
    await request(`/api/playlists/${id}`, undefined, "DELETE");
    if (selectedPlaylistId === id) selectedPlaylistId = "";
    await loadPlaylistPanel();
    notify("歌单已删除。");
  } catch (error) {
    notify(`删除歌单失败：${(error as Error).message}`);
  }
}

async function movePlaylistTrack(playlistId: string, itemId: string, direction: -1 | 1) {
  const playlist = playlists.find((entry) => entry.id === playlistId);
  if (!playlist) return;
  const itemIds = playlist.tracks.map((track) => track.id);
  const index = itemIds.indexOf(itemId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= itemIds.length) return;
  [itemIds[index], itemIds[next]] = [itemIds[next], itemIds[index]];
  try {
    await request(`/api/playlists/${playlistId}/tracks`, { itemIds }, "PUT");
    await loadPlaylistPanel();
  } catch (error) {
    notify(`调整歌单顺序失败：${(error as Error).message}`);
  }
}

async function removePlaylistTrack(playlistId: string, itemId: string) {
  try {
    await request(`/api/playlists/${playlistId}/tracks/${itemId}`, undefined, "DELETE");
    await loadPlaylistPanel();
  } catch (error) {
    notify(`移除歌曲失败：${(error as Error).message}`);
  }
}

function playPlaylist(playlistId: string, selectedTrackId?: string) {
  const playlist = playlists.find((entry) => entry.id === playlistId);
  const tracks = playlist?.tracks.filter((entry) => entry.available && entry.track).map((entry) => entry.track!) ?? [];
  if (!tracks.length) {
    notify("这个歌单里没有当前可播放的歌曲。");
    return;
  }
  player.setQueue(tracks);
  void player.play(tracks.some((track) => track.id === selectedTrackId) ? selectedTrackId! : tracks[0].id);
}

function renderQueuePanel() {
  $("#panel-body").innerHTML = `<div class="queue-toolbar"><span id="queue-current-status"></span><div><button data-action="queue-prev" aria-label="上一首">上一首</button><button data-action="play-pause" aria-label="播放或暂停">${playerState.playing ? "暂停" : "播放"}</button><button data-action="queue-next" aria-label="下一首">下一首</button><button data-action="lyrics-panel">同步歌词 ↗</button></div></div><div id="queue-list" class="queue-list"></div>`;
  syncQueuePanel(true);
}

function syncQueuePanel(force = false) {
  const list = document.querySelector<HTMLElement>("#queue-list");
  const count = document.querySelector<HTMLElement>("#queue-count");
  if (count) count.textContent = String(playerState?.queue.length ?? 0);
  if (!list || !playerState) return;
  const signature = playerState.queue.map((track) => track.id).join("\0");
  if (force || list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.innerHTML = playerState.queue.length
      ? playerState.queue.map((track, index) => `<div class="queue-track" data-queue-track="${esc(track.id)}"><button class="queue-track-main" data-action="play-queue-track" data-track-id="${esc(track.id)}"><span class="playlist-track-index">${String(index + 1).padStart(2, "0")}</span><span><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></span><em>${time(track.duration)}</em></button><div class="queue-track-actions"><button data-action="move-queue-track" data-track-id="${esc(track.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="上移 ${esc(track.title)}">↑</button><button data-action="move-queue-track" data-track-id="${esc(track.id)}" data-direction="1" ${index === playerState.queue.length - 1 ? "disabled" : ""} aria-label="下移 ${esc(track.title)}">↓</button><button data-action="remove-queue-track" data-track-id="${esc(track.id)}" ${playerState.currentTrack?.id === track.id ? "disabled" : ""} aria-label="从队列移除 ${esc(track.title)}">×</button></div></div>`).join("")
      : '<div class="playlist-empty">队列为空。打开专辑后点击曲目旁的“＋”即可排队。</div>';
  }
  list.querySelectorAll<HTMLElement>("[data-queue-track]").forEach((row) => {
    const current = row.dataset.queueTrack === playerState.currentTrack?.id;
    row.classList.toggle("current", current);
    const remove = row.querySelector<HTMLButtonElement>('[data-action="remove-queue-track"]');
    if (remove) remove.disabled = current;
  });
  const status = document.querySelector<HTMLElement>("#queue-current-status");
  if (status) status.textContent = playerState.currentTrack ? `正在播放：${playerState.currentTrack.title}` : "尚未播放歌曲";
  const playButton = document.querySelector<HTMLButtonElement>('.queue-toolbar [data-action="play-pause"]');
  if (playButton) playButton.textContent = playerState.playing ? "暂停" : "播放";
  const previousButton = document.querySelector<HTMLButtonElement>('.queue-toolbar [data-action="queue-prev"]');
  const nextButton = document.querySelector<HTMLButtonElement>('.queue-toolbar [data-action="queue-next"]');
  if (previousButton) previousButton.disabled = !playerState.currentTrack;
  if (nextButton) nextButton.disabled = playerState.currentIndex < 0 || playerState.currentIndex >= playerState.queue.length - 1;
}

function renderLyricsPanel() {
  $("#panel-body").innerHTML = `<div class="lyrics-header"><div><small>NOW PLAYING</small><strong id="lyrics-track-title">—</strong><span id="lyrics-track-artist"></span></div><button data-action="queue-panel">播放队列 ↗</button></div><div class="lyrics-seek-row"><span id="lyrics-time-current">0:00</span><input id="lyrics-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="歌曲播放进度"><span id="lyrics-time-total">0:00</span></div><p id="lyrics-status" class="lyrics-status" role="status" aria-live="polite"></p><div id="lyrics-current" class="lyrics-current" aria-live="polite"></div><div id="lyrics-lines" class="lyrics-lines"></div>`;
  activeRenderedLyric = -2;
  renderLyricRows();
  updateLyricsPanel();
  syncLyricsPosition(player.playbackTime);
  if (playerState.currentTrack && lyricTrackId !== playerState.currentTrack.id) void loadLyrics(playerState.currentTrack);
}

async function loadLyrics(track: MusicTrack | null) {
  lyricTrackId = track?.id ?? null;
  const requestVersion = ++lyricRequestVersion;
  lyricLines = [];
  lyricStateText = track ? "正在查找与歌曲同名的 .lrc 文件…" : "请先播放一首歌曲，再查看同步歌词。";
  activeRenderedLyric = -2;
  activeDockLyric = -2;
  renderLyricRows();
  updateLyricsPanel();
  updateLyricsDock(-1);
  syncLyricClock();
  if (!track) return;
  try {
    const result = await request<{ found: boolean; text: string }>(`/api/lyrics/${encodeURIComponent(track.id)}`);
    if (requestVersion !== lyricRequestVersion || lyricTrackId !== track.id) return;
    lyricLines = result.found ? parseLrc(result.text) : [];
    lyricStateText = !result.found ? "歌曲所在文件夹里没有同名 LRC 歌词。" : lyricLines.length ? "点击歌词可跳转到对应时间。" : "LRC 文件没有可识别的时间戳歌词。";
    activeRenderedLyric = -2;
    activeDockLyric = -2;
    renderLyricRows();
    updateLyricsPanel();
    syncLyricsPosition(player.playbackTime);
    syncLyricClock();
  } catch (error) {
    if (requestVersion !== lyricRequestVersion) return;
    lyricStateText = `读取歌词失败：${(error as Error).message}`;
    activeRenderedLyric = -2;
    activeDockLyric = -2;
    renderLyricRows();
    updateLyricsPanel();
    updateLyricsDock(-1);
  }
}

function renderLyricRows() {
  const list = document.querySelector<HTMLElement>("#lyrics-lines");
  if (!list) return;
  list.replaceChildren();
  if (!lyricLines.length) {
    list.textContent = lyricStateText;
    return;
  }
  const fragment = document.createDocumentFragment();
  lyricLines.forEach((line, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "lyric-line";
    row.dataset.action = "seek-lyric";
    row.dataset.lyricIndex = String(index);
    row.textContent = line.text;
    row.setAttribute("aria-current", "false");
    fragment.append(row);
  });
  list.append(fragment);
}

function updateLyricsPanel() {
  const track = playerState?.currentTrack;
  const title = document.querySelector<HTMLElement>("#lyrics-track-title");
  const artist = document.querySelector<HTMLElement>("#lyrics-track-artist");
  const status = document.querySelector<HTMLElement>("#lyrics-status");
  const seek = document.querySelector<HTMLInputElement>("#lyrics-seek");
  const current = document.querySelector<HTMLElement>("#lyrics-time-current");
  const total = document.querySelector<HTMLElement>("#lyrics-time-total");
  if (title) title.textContent = track?.title || "没有正在播放的歌曲";
  if (artist) artist.textContent = track ? track.artist : "";
  if (status) status.textContent = lyricStateText;
  if (seek) {
    seek.max = String(Math.max(0, playerState.duration || track?.duration || 0));
    seek.value = String(Math.min(Number(seek.max), playerState.currentTime));
    seek.disabled = !track || Number(seek.max) <= 0;
  }
  if (current) current.textContent = time(playerState.currentTime);
  if (total) total.textContent = time(playerState.duration || track?.duration || 0);
}

function syncLyricsPosition(currentTime: number) {
  const index = activeLyricIndex(lyricLines, currentTime);
  if (index !== activeDockLyric) {
    activeDockLyric = index;
    updateLyricsDock(index);
  }
  if (panel !== "lyrics" || index === activeRenderedLyric) return;
  activeRenderedLyric = index;
  document.querySelectorAll<HTMLElement>(".lyric-line[aria-current='true']").forEach((row) => {
    row.setAttribute("aria-current", "false");
    row.classList.remove("active");
  });
  const active = index >= 0 ? document.querySelector<HTMLElement>(`.lyric-line[data-lyric-index="${index}"]`) : null;
  const current = document.querySelector<HTMLElement>("#lyrics-current");
  if (active) {
    active.setAttribute("aria-current", "true");
    active.classList.add("active");
    current?.replaceChildren(document.createTextNode(active.textContent || ""));
    active.scrollIntoView({ block: "center", behavior: preferences.reduced ? "auto" : "smooth" });
  } else if (current) current.textContent = "";
}

function updateLyricsDock(index: number) {
  const dock = document.querySelector<HTMLElement>("#music-lyric-dock");
  const current = document.querySelector<HTMLElement>("#music-lyric-current");
  const next = document.querySelector<HTMLElement>("#music-lyric-next");
  if (!dock || !current || !next) return;
  const nextIndex = index >= 0 ? index + 1 : -1;
  current.textContent = index >= 0 ? lyricLines[index]?.text ?? "" : "";
  next.textContent = nextIndex >= 0 ? lyricLines[nextIndex]?.text ?? "" : "";
  current.dataset.lyricIndex = String(index);
  if (
    index >= 0 &&
    !preferences.reduced &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    current.getAnimations().forEach((animation) => animation.cancel());
    current.animate(
      [
        { opacity: 0, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 200, easing: "ease-out" },
    );
  }
  syncLyricDockVisibility();
}

function syncLyricDockVisibility() {
  const dock = document.querySelector<HTMLElement>("#music-lyric-dock");
  const status = document.querySelector<HTMLElement>("#transport-lyric-status");
  const openLyrics = document.querySelector<HTMLButtonElement>("#transport-lyrics-open");
  if (!dock || !status || !openLyrics) return;
  const state = playerState;
  const track = state?.currentTrack;
  const transportActive = !!track &&
    (state.transport === "playing" || state.transport === "paused" || state.transport === "loading");
  const hasActiveLine = activeDockLyric >= 0 && !!lyricLines[activeDockLyric];
  dock.hidden = !transportActive || !hasActiveLine;
  status.hidden = !transportActive || lyricLines.length > 0;
  openLyrics.hidden = status.hidden;
  const statusText = lyricStateText.startsWith("正在查找")
    ? "查找歌词…"
    : lyricStateText.startsWith("读取歌词失败")
      ? "歌词读取失败"
      : "暂无歌词";
  if (status.textContent !== statusText) status.textContent = statusText;
  stage.dataset.lyricsVisible = String(!dock.hidden);
}

function syncLyricClock() {
  if (!playerState?.playing || !lyricLines.length || document.hidden) {
    if (lyricClockFrame) cancelAnimationFrame(lyricClockFrame);
    lyricClockFrame = 0;
    return;
  }
  if (lyricClockFrame) return;
  const tick = () => {
    lyricClockFrame = 0;
    if (!playerState?.playing || !lyricLines.length || document.hidden) return;
    syncLyricsPosition(player.playbackTime);
    lyricClockFrame = requestAnimationFrame(tick);
  };
  lyricClockFrame = requestAnimationFrame(tick);
}

document.addEventListener("visibilitychange", syncLyricClock);

function updateQuality() {
  renderQuality = normalizeQuality(renderQuality);
  preferences.renderQuality = renderQuality;
  scene?.setQuality(renderQuality);
  viewer?.setQuality(renderQuality);
  syncQualityUI(renderQuality);
  const summary = document.querySelector("#quality-summary");
  if (summary)
    summary.textContent = `渲染 ${renderQuality.scale}% · 像素上限 ${renderQuality.pixelRatio}× · ${renderQuality.antialias === "off" ? "原始抗锯齿" : "SMAA"}`;
  savePrefs();
}
async function editGenres() {
  const body = document.querySelector("#panel-body");
  try {
    const rules = await request<GenreRules>("/api/genre-rules");
    if (!body?.isConnected || panel !== "library") return;
    body.innerHTML = `<p class="panel-intro">这里编辑展示流派、别名和专辑人工分类。保存后重新归并本地索引，不修改音频标签。</p><label class="field-label" for="genre-json">本地流派规则</label><textarea id="genre-json" class="json-editor" spellcheck="false">${esc(JSON.stringify(rules, null, 2))}</textarea><div class="panel-actions"><button data-action="save-genres" class="primary-button">保存并应用</button><button data-action="library">返回音乐库</button></div><p id="genre-error" role="alert"></p>`;
  } catch (error) {
    notify((error as Error).message);
  }
}
async function scan(saveRoots = false) {
  if (scanSubmitting || library.scan.running) return;
  scanSubmitting = true;
  clearTimeout(scanRefreshTimer);
  scanRefreshTimer = undefined;
  ++libraryStateVersion;
  const scanStartedAt = performance.now();
  try {
    const roots = saveRoots
      ? $<HTMLTextAreaElement>("#music-roots")
          .value.split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const next = await request<MusicLibrary>("/api/library/scan", roots ? { roots } : {});
    scene?.recordProfileScan(performance.now() - scanStartedAt);
    ++libraryStateVersion; // Discard polls started before this accepted scan.
    notify("开始扫描音乐库，已有专辑可以继续浏览。");
    await receiveLibrary(next);
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void loadLibrary(), 600);
  } catch (error) {
    notify((error as Error).message);
  } finally {
    scanSubmitting = false;
  }
}
async function enrich(one = false) {
  if (demo) return;
  try {
    await request(
      "/api/library/enrich",
      one ? { albumIds: [currentAlbum()!.id] } : {},
    );
    notify("已开始补充流派和制作资料，结果将缓存在本机。");
    await loadLibrary();
  } catch (error) {
    notify((error as Error).message);
  }
}
async function queryIntroductions(one = false) {
  const album = currentAlbum();
  if (demo || !library.albums.length || (one && !album)) return;
  if (introductionsStarting || library.introductions?.running) {
    notify("专辑介绍正在查询，进度可在设置中查看。");
    return;
  }
  introductionsStarting = true;
  introductionRequestError = "";
  updateIntroductionStatus();
  try {
    const next = await request<MusicLibrary>("/api/library/introductions", {
      ...(one ? { albumIds: [album!.id] } : {}),
      force: true,
    });
    // A GET started before this accepted job must not restore an older snapshot.
    libraryStateVersion++;
    apiAvailable = true;
    await receiveLibrary(next);
    const job = next.introductions;
    notify(
      job?.running
        ? `${one ? "这张专辑" : "音乐库"}的介绍查询已开始，可在设置中查看进度。`
        : job?.error ||
            (job && job.total > 0
              ? `专辑介绍查询完成：更新 ${job.updated} 张，未找到可靠资料 ${job.notFound} 张，查询失败 ${job.failed} 张。`
              : "当前没有需要查询的专辑。"),
    );
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void loadLibrary(), 800);
  } catch (error) {
    introductionRequestError = (error as Error).message;
    notify(introductionRequestError);
  } finally {
    introductionsStarting = false;
    updateIntroductionStatus();
  }
}
function playAlbum(id?: string) {
  const a = currentAlbum();
  const tracks = a?.tracks.filter((track) => !track.offline) ?? [];
  if (!tracks.length) return;
  void player.play(id || tracks[0].id, tracks);
}

document.addEventListener("click", (e) => {
  if (boot?.active) return;
  const target = (e.target as HTMLElement).closest<HTMLElement>(
    "button, [data-action]",
  );
  if (!target) return;
  if (target.dataset.action === "dismiss-panel" && e.target !== target) return;
  if (target.dataset.theme) {
    setTheme(target.dataset.theme as Theme);
    return;
  }
  if (target.dataset.track) {
    playAlbum(target.dataset.track);
    return;
  }
  if (target.dataset.select) {
    const rulerStep = Number(target.dataset.rulerStep);
    select(Number(target.dataset.select),
      target.dataset.rulerStep !== undefined && Number.isInteger(rulerStep)
        ? { axis: "row", direction: rulerStep } : undefined);
    return;
  }
  if (target.dataset.album) {
    revealAlbum(target.dataset.album, target.dataset.searchTrack);
    return;
  }
  if (target.dataset.tab) {
    setTab(target.dataset.tab as "tracks" | "about");
    return;
  }
  if (target.dataset.filter !== undefined) {
    searchGenre = target.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) =>
        b.classList.toggle(
          "active",
          (b as HTMLElement).dataset.filter === searchGenre,
        ),
      );
    renderSearchResults();
    return;
  }
  const action = target.dataset.action;
  if (["library", "search", "settings", "playlists", "queue"].includes(action || "")) {
    searchGenre = "";
    openPanel(action as Panel);
    return;
  }
  switch (action) {
    case "choose-playlist":
      pendingPlaylistTrackId = target.dataset.trackId || "";
      openPanel("playlists");
      break;
    case "enqueue-track": {
      const track = library.albums.flatMap((album) => album.tracks).find((entry) => entry.id === target.dataset.trackId);
      if (!track || track.offline) notify("这首歌曲当前不可用。");
      else notify(player.enqueue([track]) ? "已加入播放队列。" : "这首歌曲已在播放队列中。");
      break;
    }
    case "create-playlist":
      void createPlaylist();
      break;
    case "select-playlist":
      selectedPlaylistId = target.dataset.playlistId || "";
      renderPlaylistList();
      break;
    case "add-pending-playlist":
      if (target.dataset.playlistId) void addPendingTrack(target.dataset.playlistId);
      break;
    case "play-playlist":
      if (target.dataset.playlistId) playPlaylist(target.dataset.playlistId);
      break;
    case "play-playlist-track":
      if (target.dataset.playlistId && target.dataset.trackId)
        playPlaylist(target.dataset.playlistId, target.dataset.trackId);
      break;
    case "rename-playlist":
      if (target.dataset.playlistId) void renamePlaylist(target.dataset.playlistId);
      break;
    case "delete-playlist":
      if (target.dataset.playlistId) void deletePlaylist(target.dataset.playlistId);
      break;
    case "move-playlist-track":
      if (target.dataset.playlistId && target.dataset.itemId)
        void movePlaylistTrack(target.dataset.playlistId, target.dataset.itemId, target.dataset.direction === "-1" ? -1 : 1);
      break;
    case "remove-playlist-track":
      if (target.dataset.playlistId && target.dataset.itemId)
        void removePlaylistTrack(target.dataset.playlistId, target.dataset.itemId);
      break;
    case "play-queue-track":
      if (target.dataset.trackId) void player.play(target.dataset.trackId);
      break;
    case "move-queue-track":
      if (target.dataset.trackId)
        player.moveQueuedTrack(target.dataset.trackId, target.dataset.direction === "-1" ? -1 : 1);
      break;
    case "remove-queue-track":
      if (target.dataset.trackId && !player.removeQueuedTrack(target.dataset.trackId))
        notify("正在播放的歌曲会保留在队列中。");
      break;
    case "lyrics-panel":
      openPanel("lyrics");
      break;
    case "queue-panel":
      openPanel("queue");
      break;
    case "seek-lyric": {
      const index = Number(target.dataset.lyricIndex);
      if (Number.isInteger(index) && lyricLines[index]) player.seek(lyricLines[index].time);
      break;
    }
    case "queue-prev":
      void player.previous();
      break;
    case "queue-next":
      void player.next();
      break;
    case "locate-playing": {
      const track = playerState.currentTrack;
      if (track) revealAlbum(track.albumId, track.id, { reuseOpenAlbum: true });
      break;
    }
    case "close-panel":
    case "dismiss-panel":
      closePanel();
      break;
    case "open":
      setMode("detail");
      break;
    case "back":
      setMode("archive");
      break;
    case "model-viewer":
      // Temporarily unavailable for the simplified CD shell (no inner assembly).
      break;
    case "sound-preview":
      effects.play("page-open");
      break;
    case "fullscreen":
      void (
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen()
      ).catch(() => notify("当前浏览器无法进入全屏。"));
      break;
    case "prev":
      stepAlbum(-1);
      break;
    case "next":
      stepAlbum(1);
      break;
    case "genre-prev":
      stepGenre(-1);
      break;
    case "genre-next":
      stepGenre(1);
      break;
    case "genres":
      openPanel("search");
      break;
    case "play-pause":
      playerState.currentTrack || playerState.queue.length ? void player.toggle() : playAlbum();
      break;
    case "stop":
      player.stop();
      break;
    case "scan":
      void scan(true);
      break;
    case "rescan":
      void scan();
      break;
    case "enrich-album":
      void enrich(true);
      break;
    case "enrich-library":
      void enrich();
      break;
    case "introduction-album":
      void queryIntroductions(true);
      break;
    case "introductions-library":
      void queryIntroductions();
      break;
    case "edit-genres":
      void editGenres();
      break;
    case "save-online":
      void (async () => {
        try {
          await request("/api/config", {
            musicBrainzContact:
              $<HTMLInputElement>("#metadata-contact").value.trim(),
            onlineEnabled: $<HTMLInputElement>("#online-enabled").checked,
          });
          notify("资料库设置已保存。可以开始补充专辑资料。");
        } catch (error) {
          notify((error as Error).message);
        }
      })();
      break;
    case "save-genres":
      void (async () => {
        const editor = $<HTMLTextAreaElement>("#genre-json");
        try {
          const body = JSON.parse(editor.value);
          await request("/api/genre-rules", body);
          await loadLibrary(true);
          notify("分类规则已保存并应用。");
          if (editor.isConnected && panel === "library") renderLibraryPanel();
        } catch (error) {
          const errorNode = document.querySelector("#genre-error");
          if (editor.isConnected && errorNode)
            errorNode.textContent = (error as Error).message;
          else notify((error as Error).message);
        }
      })();
      break;
    case "demo":
      demo = true;
      closePanel(() => void applyLibrary());
      break;
  }
});
document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "lyrics-seek") player.seek(Number(el.value));
  if (el.dataset.quality && el.type === "range") {
    renderQuality = normalizeQuality({
      ...renderQuality,
      [el.dataset.quality]: Number(el.value),
    });
    updateQuality();
  }
  if (el.id === "bgm-volume") {
    preferences.bgmVolume = Number(el.value) / 100;
    player.setBgmVolume(preferences.bgmVolume);
    savePrefs();
  }
  if (el.id === "sound-volume") {
    preferences.soundVolume = Number(el.value) / 100;
    effects.configure({
      sound: preferences.sound,
      music: false,
      soundVolume: preferences.soundVolume,
      musicVolume: 0,
    });
    savePrefs();
  }
  if (el.id === "album-search") renderSearchResults();
  if (el.id === "volume") {
    preferences.volume = Number(el.value) / 100;
    player.setVolume(preferences.volume);
    savePrefs();
  }
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "music-sort" && ["genre", "artist", "album"].includes(el.value)) {
    if (preferences.sortMode === el.value) return;
    preferences.sortMode = el.value as MusicSortMode;
    savePrefs();
    location.reload();
    return;
  }
  if (el.id === "quality-preset") {
    preferences.quality = el.value as QualityPreset;
    renderQuality = normalizeQuality(qualityPresets[preferences.quality]);
    updateQuality();
  }
  if (el.dataset.quality) {
    renderQuality = normalizeQuality({
      ...renderQuality,
      [el.dataset.quality]:
        el.dataset.quality === "antialias" ? el.value : Number(el.value),
    });
    updateQuality();
  }
  if (el.id === "sound-setting") {
    preferences.sound = el.checked;
    effects.configure({
      sound: el.checked,
      music: false,
      soundVolume: preferences.soundVolume,
      musicVolume: 0,
    });
    savePrefs();
  }
  if (el.id === "song-fade-setting") {
    preferences.songFade = el.checked;
    player.setSongFadeEnabled(el.checked);
    savePrefs();
  }
  if (el.id === "reduced-motion") {
    preferences.reduced = el.checked;
    transportTitleMotion.setReduced(el.checked);
    if (el.checked) {
      browseTransition.finish();
      detailTransition.finish();
    }
    syncSelectionMotion();
    scene?.setReduced(el.checked);
    stage.classList.toggle("reduce-motion", el.checked);
    updateSelection();
    savePrefs();
  }
  if (el.id === "bgm-setting") {
    preferences.bgm = el.checked;
    player.setBgmEnabled(el.checked);
    savePrefs();
  }
});
document.addEventListener("keydown", (e) => {
  if (boot?.active) return;
  if (viewer?.isOpen) return;
  if (e.key === "Escape") {
    panel ? closePanel() : setMode("archive");
    return;
  }
  if (panel) {
    if (e.key === "Tab") {
      const items = [
        ...document.querySelectorAll<HTMLElement>(
          "#music-panel-root button:not([disabled]), #music-panel-root input, #music-panel-root textarea, #music-panel-root select, #music-panel-root a",
        ),
      ];
      if (!items.length) return;
      const first = items[0],
        last = items.at(-1)!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    return;
  }
  if (
    (e.target as HTMLElement).matches("[role=tab]") &&
    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
  ) {
    e.preventDefault();
    setTab(
      e.key === "Home"
        ? "tracks"
        : e.key === "End"
          ? "about"
          : activeTab === "tracks"
            ? "about"
            : "tracks",
    );
    $(`#tab-${activeTab}`).focus();
    return;
  }
  if (
    (e.target as HTMLElement).matches(
      "input, textarea, select, [contenteditable=true]",
    )
  )
    return;
  if (e.key === "/") {
    e.preventDefault();
    searchGenre = "";
    openPanel("search");
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    stepGenre(-1);
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    stepGenre(1);
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    stepAlbum(-1);
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    stepAlbum(1);
  }
  if (e.key === "Enter" && !(e.target as HTMLElement).closest("button, a")) {
    e.preventDefault();
    setMode("detail");
  }
  if (e.code === "Space" && !(e.target as HTMLElement).closest("button, a")) {
    e.preventDefault();
    playerState.currentTrack ? void player.toggle() : playAlbum();
  }
});

let lastFrame = 0,
  frameCount = 0;
function frame(ms: number) {
  if (!document.hidden && scene) {
    const frameStartedAt = performance.now();
    const opening = boot?.update(ms / 1000);
    if (!viewer?.isOpen) scene.update(ms / 1000, opening?.cinema);
    viewer?.update(ms / 1000);
    if (!viewer?.isOpen && !boot?.active) presentation.update();
    const phase = presentation.phase;
    if (stage.dataset.presentation !== phase) stage.dataset.presentation = phase;
    const cameraPhase = scene.musicPresentationPhase;
    if (stage.dataset.cameraPhase !== cameraPhase) stage.dataset.cameraPhase = cameraPhase;
    if (presentation.phase === "detail") {
      documentDecryption.update(
        ms / 1000,
        scene.decryptionFrame,
        preferences.reduced,
        !viewer?.isOpen,
      );
      if (pendingDetailFocus && !panel && !viewer?.isOpen) {
        $("#album-detail-content").focus({ preventScroll: true });
        pendingDetailFocus = false;
      }
      if (pendingTrackReveal && !panel && !viewer?.isOpen &&
        $("#music-detail").dataset.transition === "open" &&
        currentAlbum()?.id === pendingTrackReveal.albumId) {
        const content = $("#album-detail-content");
        const trackId = pendingTrackReveal.trackId;
        pendingTrackReveal = undefined;
        const row = Array.from(content.querySelectorAll<HTMLButtonElement>(".track-row"))
          .find((item) => item.dataset.track === trackId);
        if (row) trackFocus.reveal(content, row, preferences.reduced);
      }
    }
    frameCount++;
    if (ms - lastFrame > 1500) {
      const buffer = document.querySelector<HTMLCanvasElement>("#three-scene canvas");
      $("#runtime-info").textContent =
        `rAF诊断 ${Math.round((frameCount * 1000) / (ms - lastFrame))} FPS / ${buffer?.width ?? 0}×${buffer?.height ?? 0} / ${themeNames[preferences.theme]} / ${gpuCapability.api}${gpuCapability.mode === "software" ? " 软件渲染" : gpuCapability.mode === "hardware" ? " 显卡加速" : ""}`;
      // Keep read-only render diagnostics alongside the existing resolution
      // attributes, without adding controls or per-frame DOM work.
      if (!viewer?.isOpen) {
        const { drawCalls, triangles, selectionLight } = scene.getStats();
        const sceneElement = $("#three-scene");
        sceneElement.dataset.renderStats = JSON.stringify({
          drawCalls,
          triangles,
        });
        sceneElement.dataset.selectionLight =
          JSON.stringify(selectionLight);
        if (new URLSearchParams(location.search).get("profile") === "1") {
          const profile = scene.getPerformanceProfile();
          sceneElement.dataset.performanceProfile = JSON.stringify(profile);
          const latestSwitch = profile.albumSwitches.at(-1);
          const canvas = sceneElement.querySelector("canvas");
          if (latestSwitch && canvas) {
            const format = (value: number | null) =>
              value === null ? "n/a" : `${value.toFixed(2)} ms`;
            canvas.setAttribute(
              "aria-description",
              `Switch ${latestSwitch.previousIndex} to ${latestSwitch.index}; ` +
                `selection ${format(latestSwitch.synchronousMs)}; ` +
                `cover selection ${format(latestSwitch.coverSelectSynchronousMs)}; ` +
                `cover ready ${format(latestSwitch.coverReadyAfterMs)}; ` +
                `rAF P95/P99 ${format(latestSwitch.rafP95Ms)} / ${format(latestSwitch.rafP99Ms)}; ` +
                `GPU P95/P99 ${format(latestSwitch.gpuP95Ms)} / ${format(latestSwitch.gpuP99Ms)} ` +
                `(${latestSwitch.gpuSamples} samples); ` +
                `buffer ${profile.viewport.backBufferWidth}x${profile.viewport.backBufferHeight}`,
            );
          }
        }
      }
      frameCount = 0;
      lastFrame = ms;
    }
    scene.recordProfileFrame(ms, performance.now() - frameStartedAt);
  } else {
    frameCount = 0;
    lastFrame = ms;
  }
  requestAnimationFrame(frame);
}
async function start() {
  $("#three-scene").dataset.gpuCapability = JSON.stringify(gpuCapability);
  // This local application owns its live index. An old archive PWA must not serve stale UI.
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  }
  await loadLibrary(true);
  try {
    fit();
    scene = new ArchiveScene($("#three-scene"));
    // Keep a direct visual comparison URL without adding another user setting.
    if (new URLSearchParams(location.search).get("lighting") !== "baseline")
      scene.enableSelectionLighting();
    await Promise.all([
      scene.load(),
      document.fonts.load("400 20px MiSans"),
      document.fonts.load("600 20px MiSans"),
    ]);
    ready = true;
    $("#three-scene canvas").setAttribute(
      "aria-label",
      `三维专辑阵列，左右切${sortLabel.column}，上下切专辑`,
    );
    stage.classList.toggle("reduce-motion", preferences.reduced);
    await scene.refreshLibrary(selected);
    scene.setTheme(preferences.theme);
    scene.setQuality(renderQuality);
    scene.setReduced(preferences.reduced);
    bindSceneNavigation(scene);
    $("#music-loading").remove();
    updateSelection();
    if (albums.length && new URLSearchParams(location.search).get("scene") !== "archive") {
      boot?.start(performance.now() / 1000);
    } else {
      scene.showMusicArchiveImmediately(performance.now() / 1000);
      effects.setScene("archive");
      if (albums.length) showBrowseSurface();
      else browseTransition.hide(true);
      $("#music-browse").inert = !albums.length;
      $("#music-browse").setAttribute("aria-hidden", String(!albums.length));
    }
    syncSelectionMotion();
    requestAnimationFrame((ms) => {
      stage.classList.add("theme-motion-ready");
      frame(ms);
    });
  } catch (error) {
    console.error(error);
    $("#music-loading").innerHTML =
      `<strong>三维资源未能加载</strong><small>${esc((error as Error).message)}</small><button data-action="library">检查音乐库</button>`;
  }
}
void start();
Object.assign(window, {
  rhineMusic: {
    get library() {
      return library;
    },
    get selectedAlbum() {
      return currentAlbum();
    },
    get player() {
      return player.state;
    },
    get playbackTime() {
      return player.playbackTime;
    },
    stats: () => scene?.getStats(),
    profile: () => ({
      version: BUILD_VERSION,
      gpuCapability,
      renderer: scene?.getPerformanceProfile(),
      scene: scene?.getStats(),
    }),
    coverDiagnostics: () => scene?.getCoverDiagnostics(),
    coverPreviewDataUrl: () => scene?.getCoverPreviewDataUrl(),
    get presentation() {
      return { phase: presentation.phase, cameraPhase: scene?.musicPresentationPhase,
        pendingIndex: presentation.pendingSelection?.index,
        menuVisible: !$("#music-detail").hidden,
        cameraReady: scene?.musicPresentationReady,
        archiveReady: scene?.musicArchiveReady };
    },
  },
});

export type FrameMetric = { rafGapMs: number; sceneCpuMs: number };
type GpuQueryExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
type PendingGpuQuery = { query: WebGLQuery; startedAtMs: number; metric: string };
type AlbumSwitchSample = {
  startedAtMs: number;
  index: number;
  previousIndex: number;
  lift: number;
  clonedOutgoing: boolean;
  synchronousMs?: number;
  coverSelectSynchronousMs?: number;
  coverReadyAfterMs?: number;
  rafGapMs: number[];
  sceneCpuMs: number[];
  gpuMs: number[];
  gpuPassMs: Record<string, number[]>;
};

const ALBUM_SWITCH_SAMPLE_WINDOW_MS = 15_000;

const percentile = (input: number[], quantile: number) => {
  if (!input.length) return 0;
  const sorted = [...input].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
};

export class FrameProfiler {
  private readonly frameMetrics: FrameMetric[] = [];
  private readonly scenePhaseTimes = new Map<string, number[]>();
  private readonly longTasks: { startMs: number; durationMs: number }[] = [];
  private readonly gpuTimesMs: number[] = [];
  private readonly pending: PendingGpuQuery[] = [];
  private readonly albumSwitches: AlbumSwitchSample[] = [];
  private readonly passGpuTimes = new Map<string, number[]>();
  private readonly extension: GpuQueryExtension | null;
  private lastRafMs = 0;
  private activeQuery: WebGLQuery | null = null;
  private activeQueryMetric = "";
  private activeQueryStartedAtMs = 0;
  private frameCount = 0;
  private active = false;
  private measurePassesThisFrame = false;
  private scanCount = 0;
  private lastScanMs = 0;
  private longTaskObserver?: PerformanceObserver;

  constructor(private readonly gl: WebGL2RenderingContext, readonly enabled: boolean) {
    this.extension = enabled
      ? gl.getExtension("EXT_disjoint_timer_query_webgl2") as GpuQueryExtension | null
      : null;
    if (enabled && "PerformanceObserver" in window) {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.longTasks.push({ startMs: entry.startTime, durationMs: entry.duration });
            if (this.longTasks.length > 512) this.longTasks.shift();
          }
        });
      } catch { /* Long Task API is optional. */ }
    }
  }

  /** Start after the first scene render so asset loading and shader warm-up do
   * not contaminate interactive frame and album-switch measurements. */
  start() {
    if (!this.enabled || this.active) return;
    this.active = true;
    try { this.longTaskObserver?.observe({ type: "longtask" }); }
    catch { /* Long Task API is optional. */ }
  }

  dispose() {
    this.active = false;
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = undefined;
    if (this.activeQuery) this.gl.deleteQuery(this.activeQuery);
    this.activeQuery = null;
    this.activeQueryMetric = "";
    for (const pending of this.pending) this.gl.deleteQuery(pending.query);
    this.pending.length = 0;
  }

  beginSceneRender() {
    if (!this.enabled || !this.active || !this.extension) return;
    this.measurePassesThisFrame = this.frameCount % 6 !== 0;
    if (this.measurePassesThisFrame) return;
    this.beginGpuQuery("scene-total");
  }

  endSceneRender() {
    if (this.activeQueryMetric === "scene-total") this.endGpuQuery("scene-total");
    this.measurePassesThisFrame = false;
  }

  beginGpuPass(name: string) {
    if (this.measurePassesThisFrame) this.beginGpuQuery(`pass:${name}`);
  }

  endGpuPass(name: string) {
    const metric = `pass:${name}`;
    if (this.activeQueryMetric === metric) this.endGpuQuery(metric);
  }

  private beginGpuQuery(metric: string) {
    if (!this.extension || this.activeQuery || this.pending.length >= 32) return;
    try {
      const query = this.gl.createQuery();
      if (!query) return;
      this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
      this.activeQuery = query;
      this.activeQueryMetric = metric;
      this.activeQueryStartedAtMs = performance.now();
    } catch { this.activeQuery = null; }
  }

  private endGpuQuery(metric: string) {
    if (!this.activeQuery || !this.extension || this.activeQueryMetric !== metric) return;
    try {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending.push({ query: this.activeQuery, startedAtMs: this.activeQueryStartedAtMs, metric });
    } catch { this.gl.deleteQuery(this.activeQuery); }
    this.activeQuery = null;
    this.activeQueryMetric = "";
  }

  recordFrame(rafMs: number, sceneCpuMs: number) {
    if (!this.enabled || !this.active) return;
    if (!this.lastRafMs) {
      this.lastRafMs = rafMs;
      this.frameCount++;
      this.pollGpuQueries();
      return;
    }
    const rafGapMs = this.lastRafMs ? rafMs - this.lastRafMs : 0;
    this.frameMetrics.push({ rafGapMs, sceneCpuMs });
    this.lastRafMs = rafMs;
    this.frameCount++;
    if (this.frameMetrics.length > 1800) this.frameMetrics.shift();
    const now = performance.now();
    for (const sample of this.albumSwitches) {
      if (rafMs < sample.startedAtMs || rafMs > sample.startedAtMs + ALBUM_SWITCH_SAMPLE_WINDOW_MS) continue;
      if (rafGapMs > 0) sample.rafGapMs.push(rafGapMs);
      sample.sceneCpuMs.push(sceneCpuMs);
    }
    while (this.albumSwitches.length > 8 ||
      (this.albumSwitches.length && now - this.albumSwitches[0].startedAtMs > ALBUM_SWITCH_SAMPLE_WINDOW_MS + 1000))
      this.albumSwitches.shift();
    this.pollGpuQueries();
  }

  beginAlbumSwitch(index: number, previousIndex: number, lift: number, clonedOutgoing: boolean) {
    if (!this.enabled || !this.active) return undefined;
    const sample: AlbumSwitchSample = {
      startedAtMs: performance.now(),
      index,
      previousIndex,
      lift,
      clonedOutgoing,
      rafGapMs: [],
      sceneCpuMs: [],
      gpuMs: [],
      gpuPassMs: {},
    };
    this.albumSwitches.push(sample);
    return sample;
  }

  finishAlbumSwitch(sample: AlbumSwitchSample | undefined, synchronousMs: number, coverSelectSynchronousMs: number) {
    if (!sample) return;
    sample.synchronousMs = synchronousMs;
    sample.coverSelectSynchronousMs = coverSelectSynchronousMs;
  }

  finishAlbumCover(sample: AlbumSwitchSample | undefined) {
    if (sample) sample.coverReadyAfterMs = performance.now() - sample.startedAtMs;
  }

  recordScan(durationMs: number) {
    this.scanCount++;
    this.lastScanMs = durationMs;
  }

  recordScenePhase(name: string, durationMs: number) {
    if (!this.enabled || !this.active || !Number.isFinite(durationMs)) return;
    const values = this.scenePhaseTimes.get(name) ?? [];
    values.push(Math.max(0, durationMs));
    if (values.length > 1800) values.shift();
    this.scenePhaseTimes.set(name, values);
  }

  snapshot() {
    const gl = this.gl;
    const intervals = this.frameMetrics.map((frame) => frame.rafGapMs).filter((value) => value > 0);
    const sceneCpu = this.frameMetrics.map((frame) => frame.sceneCpuMs);
    const canvas = gl.canvas as HTMLCanvasElement;
    const longTaskTotal = this.longTasks.reduce((total, task) => total + task.durationMs, 0);
    return {
      timestamp: new Date().toISOString(),
      note: "rAF intervals describe main-thread scheduling only; use DXGI/ETW for actual presented frames.",
      viewport: { cssWidth: innerWidth, cssHeight: innerHeight, dpr: devicePixelRatio, backBufferWidth: canvas.width, backBufferHeight: canvas.height },
      gpuTimer: { status: this.extension ? "EXT_disjoint_timer_query_webgl2" : this.enabled ? "unavailable" : "disabled", meanMs: this.average(this.gpuTimesMs), p95Ms: percentile(this.gpuTimesMs, .95), p99Ms: percentile(this.gpuTimesMs, .99), samples: this.gpuTimesMs.length },
      gpuPasses: Object.fromEntries([...this.passGpuTimes].map(([name, values]) => [name, { meanMs: this.average(values), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), samples: values.length }])),
      scenePhases: Object.fromEntries([...this.scenePhaseTimes].map(([name, values]) => [name, { meanMs: this.average(values), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), samples: values.length }])),
      mainThread: { rafP95Ms: percentile(intervals, .95), rafP99Ms: percentile(intervals, .99), sceneCpuP95Ms: percentile(sceneCpu, .95), sceneCpuP99Ms: percentile(sceneCpu, .99), frames: this.frameCount, longTaskCount: this.longTasks.length, longTaskTotalMs: longTaskTotal, recentLongTasks: this.longTasks.slice(-20) },
      albumSwitches: this.albumSwitches.slice(-8).map((sample) => {
        const switchLongTasks = this.longTasks.filter((task) =>
          task.startMs >= sample.startedAtMs && task.startMs <= sample.startedAtMs + ALBUM_SWITCH_SAMPLE_WINDOW_MS);
        return {
          index: sample.index,
          previousIndex: sample.previousIndex,
          lift: sample.lift,
          clonedOutgoing: sample.clonedOutgoing,
          synchronousMs: sample.synchronousMs ?? null,
          coverSelectSynchronousMs: sample.coverSelectSynchronousMs ?? null,
          coverReadyAfterMs: sample.coverReadyAfterMs ?? null,
          sampledFrames: sample.rafGapMs.length,
          rafP95Ms: percentile(sample.rafGapMs, .95),
          rafP99Ms: percentile(sample.rafGapMs, .99),
          sceneCpuP95Ms: percentile(sample.sceneCpuMs, .95),
          sceneCpuP99Ms: percentile(sample.sceneCpuMs, .99),
          gpuP95Ms: percentile(sample.gpuMs, .95),
          gpuP99Ms: percentile(sample.gpuMs, .99),
          gpuSamples: sample.gpuMs.length,
          gpuPasses: Object.fromEntries(Object.entries(sample.gpuPassMs).map(([name, values]) => [name, { p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), samples: values.length }])),
          longTasksMs: switchLongTasks.map((task) => task.durationMs),
        };
      }),
      library: { scanCount: this.scanCount, lastScanMs: this.lastScanMs },
      webgl: { renderer: gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION), vendor: gl.getParameter(gl.VENDOR) },
    };
  }

  private pollGpuQueries() {
    if (!this.extension) return;
    try {
      while (this.pending.length) {
        const pending = this.pending[0];
        if (!this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT_AVAILABLE)) break;
        const nanoseconds = Number(this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT));
        if (!this.gl.getParameter(this.extension.GPU_DISJOINT_EXT) && Number.isFinite(nanoseconds) && nanoseconds >= 0)
          {
            const durationMs = nanoseconds / 1e6;
            const passName = pending.metric.startsWith("pass:") ? pending.metric.slice(5) : null;
            if (passName) {
              const values = this.passGpuTimes.get(passName) ?? [];
              values.push(durationMs);
              if (values.length > 1800) values.shift();
              this.passGpuTimes.set(passName, values);
            } else {
              this.gpuTimesMs.push(durationMs);
            }
            for (const sample of this.albumSwitches) {
              if (pending.startedAtMs < sample.startedAtMs || pending.startedAtMs > sample.startedAtMs + ALBUM_SWITCH_SAMPLE_WINDOW_MS) continue;
              if (passName) (sample.gpuPassMs[passName] ??= []).push(durationMs);
              else sample.gpuMs.push(durationMs);
            }
          }
        this.gl.deleteQuery(pending.query);
        this.pending.shift();
        if (this.gpuTimesMs.length > 1800) this.gpuTimesMs.shift();
      }
    } catch { /* Context loss or unsupported query state. */ }
  }

  private average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }
}

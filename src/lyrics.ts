export interface LyricLine {
  time: number;
  text: string;
}

const MAX_LYRIC_LINES = 20_000;
const TIMESTAMP = /\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
const OFFSET = /^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/i;

function fractionalSeconds(value: string | undefined): number {
  if (!value) return 0;
  return Number(value) / 10 ** value.length;
}

/** Parse common LRC timestamps without ever treating lyric text as markup. */
export function parseLrc(source: string): LyricLine[] {
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  let offsetMs = 0;
  for (const line of lines) {
    const match = OFFSET.exec(line);
    if (match) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value)) offsetMs = value;
    }
  }
  const output: Array<LyricLine & { order: number }> = [];
  let order = 0;
  for (const line of lines) {
    if (OFFSET.test(line)) continue;
    const times: number[] = [];
    TIMESTAMP.lastIndex = 0;
    for (const match of line.matchAll(TIMESTAMP)) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = fractionalSeconds(match[3]);
      times.push(minutes * 60 + seconds + fraction);
    }
    if (!times.length) continue;
    const lyric = line.replace(TIMESTAMP, "").replace(/\[[^\]]*\]/g, "").trim();
    if (!lyric) continue;
    for (const time of times) {
      output.push({ time: Math.max(0, time + offsetMs / 1000), text: lyric, order: order++ });
      if (output.length >= MAX_LYRIC_LINES) break;
    }
    if (output.length >= MAX_LYRIC_LINES) break;
  }
  output.sort((a, b) => a.time - b.time || a.order - b.order);
  return output.map(({ time, text }) => ({ time, text }));
}

/** Return the last lyric line whose timestamp is at or before playback time. */
export function activeLyricIndex(lines: readonly LyricLine[], currentTime: number): number {
  if (!Number.isFinite(currentTime) || !lines.length || currentTime < lines[0].time) return -1;
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].time <= currentTime) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

// ビジュアライザーの設定・保存・音量変換・描画。配信表示と操作パネルで共有します。
import type { ObsConn } from './obs';

export type Shape = 'drops' | 'dots' | 'bars' | 'wave';

export interface LineSettings {
  /** 参照するOBSの音声ソース名 */
  source: string;
  shape: Shape;
  /** 音が弱いときの色 */
  colorLow: string;
  /** 音が強いときの色 */
  colorHigh: string;
  /** これより小さい音は無視する（dB、マイナス値） */
  threshold: number;
  /** 並べる数 */
  count: number;
  /** 反応の大きさ */
  gain: number;
}

export const DEFAULTS: LineSettings = {
  source: '',
  shape: 'drops',
  colorLow: '#4dabf7',
  colorHigh: '#ff6b9d',
  threshold: -50,
  count: 32,
  gain: 1,
};

export const SETTINGS_KEY = 'streamtools:audio-visualizer:settings';
export const CONN_KEY = 'streamtools:audio-visualizer:conn';
export const CUSTOM_EVENT_TYPE = 'streamtools-av-settings';

const SHAPES: Shape[] = ['drops', 'dots', 'bars', 'wave'];
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 外から来た値（保存データ・URL・イベント）を安全な設定に整える */
export function sanitize(input: Partial<Record<keyof LineSettings, unknown>> | null | undefined): LineSettings {
  const s = input ?? {};
  return {
    source: typeof s.source === 'string' ? s.source : DEFAULTS.source,
    shape: SHAPES.includes(s.shape as Shape) ? (s.shape as Shape) : DEFAULTS.shape,
    colorLow: typeof s.colorLow === 'string' && HEX.test(s.colorLow) ? s.colorLow : DEFAULTS.colorLow,
    colorHigh: typeof s.colorHigh === 'string' && HEX.test(s.colorHigh) ? s.colorHigh : DEFAULTS.colorHigh,
    threshold: clamp(num(s.threshold, DEFAULTS.threshold), -90, -5),
    count: Math.round(clamp(num(s.count, DEFAULTS.count), 8, 64)),
    gain: clamp(num(s.gain, DEFAULTS.gain), 0.3, 4),
  };
}

export function loadSettings(): LineSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: LineSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

export function loadConn(): ObsConn | null {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (typeof c.host !== 'string' || !c.host) return null;
    return { host: c.host, port: num(c.port, 4455), password: String(c.password ?? '') };
  } catch {
    return null;
  }
}

export function saveConn(c: ObsConn) {
  try {
    localStorage.setItem(CONN_KEY, JSON.stringify(c));
  } catch {
    /* 同上 */
  }
}

/** URLのハッシュ（#host=...&port=...&pw=...&shape=...）から接続情報・設定を読む */
export function fromHash(hash: string): { conn: ObsConn | null; settings: Partial<LineSettings> } {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const settings: Partial<Record<keyof LineSettings, unknown>> = {};
  for (const k of ['source', 'shape', 'colorLow', 'colorHigh', 'threshold', 'count', 'gain'] as const) {
    if (p.has(k)) settings[k] = p.get(k);
  }
  const host = p.get('host');
  const conn = host ? { host, port: num(p.get('port'), 4455), password: p.get('pw') ?? '' } : null;
  return { conn, settings: settings as Partial<LineSettings> };
}

export function toHash(conn: ObsConn, s: LineSettings): string {
  const p = new URLSearchParams({
    host: conn.host,
    port: String(conn.port),
    pw: conn.password,
    source: s.source,
    shape: s.shape,
    colorLow: s.colorLow,
    colorHigh: s.colorHigh,
    threshold: String(s.threshold),
    count: String(s.count),
    gain: String(s.gain),
  });
  return '#' + p.toString();
}

/**
 * OBSの音量(線形 0〜1)を 0〜1 の見た目の強さに変換する。
 * thresholdDb（例: -50）以下は0、0dBで1。
 */
export function levelToNorm(mul: number, thresholdDb: number): number {
  if (!(mul > 0)) return 0;
  const db = 20 * Math.log10(mul);
  const span = -Math.min(thresholdDb, -1);
  return clamp((db - thresholdDb) / span, 0, 1);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixColor(low: string, high: string, t: number): string {
  const k = clamp(t, 0, 1);
  const a = hexToRgb(low);
  const b = hexToRgb(high);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** デモ用のそれっぽい「話し声」の強さ（0〜1） */
export function demoLevel(seconds: number): number {
  const talk = Math.max(0, Math.sin(seconds * 1.7) + 0.35) / 1.35;
  const syllable = 0.5 + 0.5 * Math.sin(seconds * 9.3 + Math.sin(seconds * 2.1) * 2);
  return clamp(talk * (0.25 + 0.75 * syllable), 0, 1);
}

const TICK_MS = 45;

export class LineRenderer {
  private ctx: CanvasRenderingContext2D;
  private level = 0;
  private history: number[] = [];
  private lastTick = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /**
   * 1フレーム描く。
   * @param target 現在の音の強さ(0〜1、しきい値・感度は適用済み)
   */
  frame(now: number, target: number, s: LineSettings) {
    // 立ち上がりは速く、減衰はゆっくり
    const k = target > this.level ? 0.6 : 0.12;
    this.level += (target - this.level) * k;

    const half = Math.ceil(s.count / 2) + 1;
    if (now - this.lastTick >= TICK_MS) {
      this.lastTick = now;
      this.history.unshift(this.level);
    }
    if (this.history.length > half) this.history.length = half;
    while (this.history.length < half) this.history.push(0);

    this.draw(s);
  }

  private draw(s: LineSettings) {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth));
    const h = Math.max(1, Math.floor(canvas.clientHeight));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const n = s.count;
    const slot = w / n;
    const center = (n - 1) / 2;
    // 中央が最新、左右の端へ向かって過去の音になる
    const valueAt = (i: number) => this.history[Math.min(this.history.length - 1, Math.round(Math.abs(i - center)))] ?? 0;
    const color = (v: number) => mixColor(s.colorLow, s.colorHigh, v);

    if (s.shape === 'wave') return this.drawWave(w, h, n, slot, valueAt, s);

    const r0 = Math.min(slot * 0.3, h * 0.12);
    const baseY = s.shape === 'bars' ? h / 2 : h * 0.72;

    if (s.shape !== 'bars') {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = color(0.15);
      ctx.lineWidth = Math.max(2, r0 * 0.25);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(slot * 0.3, baseY + r0);
      ctx.lineTo(w - slot * 0.3, baseY + r0);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < n; i++) {
      const v = valueAt(i);
      const x = slot * (i + 0.5);
      const c = color(v);
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = v * r0 * 1.6;

      if (s.shape === 'bars') {
        const bw = slot * 0.6;
        const bh = Math.max(bw * 0.5, v * h * 0.85);
        ctx.beginPath();
        ctx.roundRect(x - bw / 2, baseY - bh / 2, bw, bh, bw / 2);
        ctx.fill();
      } else if (s.shape === 'dots') {
        const r = r0 * (0.7 + v * 0.9);
        const y = baseY - v * h * 0.4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // drops（しずく型）
        const r = r0 * (0.7 + v * 0.9);
        const y = baseY - v * h * 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.9);
        ctx.bezierCurveTo(x + r * 1.1, y - r * 0.6, x + r, y + r, x, y + r);
        ctx.bezierCurveTo(x - r, y + r, x - r * 1.1, y - r * 0.6, x, y - r * 1.9);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  }

  private drawWave(
    w: number,
    h: number,
    n: number,
    slot: number,
    valueAt: (i: number) => number,
    s: LineSettings,
  ) {
    const { ctx } = this;
    const mid = h / 2;
    const amp = h * 0.45;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, s.colorLow);
    g.addColorStop(0.5, s.colorHigh);
    g.addColorStop(1, s.colorLow);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let i = 0; i < n; i++) ctx.lineTo(slot * (i + 0.5), mid - Math.max(1, valueAt(i) * amp));
    ctx.lineTo(w, mid);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(slot * (i + 0.5), mid + Math.max(1, valueAt(i) * amp));
    ctx.closePath();
    ctx.fill();
  }
}

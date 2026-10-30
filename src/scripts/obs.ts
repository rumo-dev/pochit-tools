// OBS WebSocket (v5) の最小クライアント。
// 音声ソースの音量メーター(InputVolumeMeters)の受信と、カスタムイベントの送受信だけを行います。
// プロトコル: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

export interface ObsConn {
  host: string;
  port: number;
  password: string;
}

export type ObsState = 'connecting' | 'connected' | 'closed' | 'error';

// イベント購読ビット: General(1) | InputVolumeMeters(1 << 16)
const EVENT_SUBSCRIPTIONS = 1 | (1 << 16);

async function sha256Base64(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** obs-websocket v5 の認証文字列を作る */
export async function makeAuth(password: string, salt: string, challenge: string): Promise<string> {
  const secret = await sha256Base64(password + salt);
  return sha256Base64(secret + challenge);
}

export class ObsClient {
  /** 入力名 → 音量(0〜1の線形値)。メーターイベントのたびに呼ばれます */
  onMeters: (levels: Record<string, number>) => void = () => {};
  /** BroadcastCustomEvent で送られてきたデータ */
  onCustom: (data: unknown) => void = () => {};
  onState: (state: ObsState, message?: string) => void = () => {};

  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private identified = false;
  private requestId = 0;

  constructor(
    private getConn: () => ObsConn | null,
    private autoReconnect = true,
  ) {}

  get connected() {
    return this.identified;
  }

  connect() {
    this.stopped = false;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    this.identified = false;
    ws?.close();
    this.onState('closed');
  }

  /** 接続中の全クライアントへ、任意のオブジェクトを送る */
  broadcast(eventData: Record<string, unknown>) {
    if (!this.ws || !this.identified) return;
    this.ws.send(
      JSON.stringify({
        op: 6,
        d: {
          requestType: 'BroadcastCustomEvent',
          requestId: `bc-${++this.requestId}`,
          requestData: { eventData },
        },
      }),
    );
  }

  private open() {
    clearTimeout(this.retryTimer);
    const conn = this.getConn();
    if (!conn) {
      this.onState('closed', '接続情報がありません');
      return;
    }
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.identified = false;
    this.onState('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${conn.host}:${conn.port}`);
    } catch (e) {
      this.onState('error', String((e as Error).message ?? e));
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onmessage = async (ev) => {
      let msg: { op: number; d: any };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const d = msg.d;
      switch (msg.op) {
        case 0: {
          // Hello
          const identify: Record<string, unknown> = {
            rpcVersion: 1,
            eventSubscriptions: EVENT_SUBSCRIPTIONS,
          };
          if (d?.authentication) {
            identify.authentication = await makeAuth(
              conn.password,
              d.authentication.salt,
              d.authentication.challenge,
            );
          }
          if (this.ws === ws) ws.send(JSON.stringify({ op: 1, d: identify }));
          break;
        }
        case 2: // Identified
          this.identified = true;
          this.onState('connected');
          break;
        case 5: {
          // Event
          if (d?.eventType === 'InputVolumeMeters') {
            const levels: Record<string, number> = {};
            for (const input of d.eventData?.inputs ?? []) {
              let peak = 0;
              for (const ch of input.inputLevelsMul ?? []) {
                // ch = [magnitude, peak, input-peak]
                peak = Math.max(peak, Number(ch[1]) || 0);
              }
              levels[input.inputName] = peak;
            }
            this.onMeters(levels);
          } else if (d?.eventType === 'CustomEvent') {
            this.onCustom(d.eventData);
          }
          break;
        }
      }
    };

    ws.onerror = () => {
      // 詳細は onclose 側で扱う
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // 自分で閉じた古い接続
      this.ws = null;
      this.identified = false;
      if (this.stopped) return;
      // 4009 = 認証失敗。再試行しても無駄なので止める
      if (ev.code === 4009) {
        this.onState('error', '認証に失敗しました。パスワードを確認してください。');
        return;
      }
      this.onState('error', 'OBSに接続できません。WebSocketサーバーが有効か確認してください。');
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.stopped || !this.autoReconnect) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), 3000);
  }
}

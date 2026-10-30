// サイト全体の設定。名前や説明はここを書き換えてください。
export const SITE = {
  name: 'ぽちっとツール',
  tagline: 'POCHIT TOOLS',
  description: 'OBSなどの配信で使える、ブラウザだけで動く小さなツール集。',
};

export const CATEGORIES = ['画面演出'] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Tool {
  slug: string;
  title: string;
  description: string;
  category: Category;
  tags: string[];
  /** false のものは一覧に「準備中」として表示され、リンクされません */
  ready: boolean;
  /** 無料で使えるか */
  free: boolean;
  /** カード上の絵文字アイコン */
  emoji: string;
  /** カード背景色 */
  color: string;
}

// ツールを追加するときは、ここに1件足して
// src/pages/tools/<slug>/index.astro を作るだけです。
export const TOOLS: Tool[] = [
  {
    slug: 'audio-visualizer',
    title: 'オーディオビジュアライザー',
    description: 'OBSの音声ソースの音量に合わせて動くライン。URLをOBSに貼るだけで使えます。',
    category: '画面演出',
    tags: ['オーディオ', 'ビジュアライザー', '音', 'ライン', 'OBS', 'WebSocket'],
    ready: true,
    free: true,
    emoji: '🎚️',
    color: '#e3e6fb',
  },
];

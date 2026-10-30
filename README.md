# ぽちっとツール

Astro + GitHub Pages で作った、配信（OBSなど）向けの小さなツール集サイトです。
検索・カテゴリ絞り込み付きの一覧と、ツールごとのページを備えています。

## 開発

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/ に静的ファイルを出力
```

## GitHub Pages で公開する

1. GitHub にリポジトリを作り、このフォルダを `main` ブランチに push します。
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にします。
3. push するたびに `.github/workflows/deploy.yml` が走り、自動で公開されます。

公開URLは `https://ユーザー名.github.io/リポジトリ名/` になります。
`SITE` / `BASE` はワークフロー内で自動設定されるので、ふだんは触る必要はありません。

- ユーザーページ（`ユーザー名.github.io` というリポジトリ名）や独自ドメインで公開する場合は、
  `deploy.yml` の `BASE` を空（`BASE: ''`）にしてください。

## オーディオビジュアライザーの仕組み

OBS WebSocket（v5）で、OBSの音声ソースの音量メーターを受け取って描画します。

- `tools/audio-visualizer/display/` … 配信表示（ブラウザソース用、背景透明）
- `tools/audio-visualizer/panel/` … 操作パネル（カスタムブラウザドック用）
- `src/scripts/obs.ts` … OBS WebSocketの最小クライアント（認証・音量メーター・カスタムイベント）
- `src/scripts/line.ts` … 設定・音量変換・描画

操作パネルで接続情報と設定を保存し、設定の変更はOBSのカスタムイベント経由で配信表示へ送ります。
パスワードはブラウザのlocalStorageに保存されます（外部には送信しません）。
GitHub Pagesの `ユーザー名.github.io` 配下では、同じユーザーの他のPagesサイトからも
同じlocalStorageが見える点に注意してください（独自ドメインでの公開がより安全です）。

## ツールを追加する

1. `src/data/site.ts` の `TOOLS` に1件追加します（`ready: true` にすると一覧からリンクされます）。
2. `src/pages/tools/<slug>/index.astro` を作ります。

OBSのブラウザソースに使うページは、`Base` レイアウトに `bare` を渡すと背景が透明になり、
ヘッダー・フッターが消えます（`audio-visualizer/view.astro` を参考にしてください）。

## サイト名・カテゴリの変更

`src/data/site.ts` の `SITE` と `CATEGORIES` を編集します。

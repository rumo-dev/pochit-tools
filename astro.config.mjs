import { defineConfig } from 'astro/config';

// GitHub Pages 用の設定。
// 環境変数 SITE / BASE は GitHub Actions から渡されます（.github/workflows/deploy.yml）。
// ローカル開発では未設定のままで動きます。
//
// 例）https://ユーザー名.github.io/リポジトリ名/ で公開する場合
//   SITE=https://ユーザー名.github.io  BASE=/リポジトリ名
// 独自ドメイン or ユーザーページ（ユーザー名.github.io）の場合
//   BASE は空（/）のままにします。
export default defineConfig({
  site: process.env.SITE || 'http://localhost:4321',
  base: process.env.BASE || '/',
  trailingSlash: 'always',
});

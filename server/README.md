# APIサーバー

CopiCopiと同じく、ソースを `src/`、設定と依存をこの `server/`、ビルド成果物を `dist/` に分ける。
入口は `src/index.ts`、本への質問処理は `src/bookKnowledgeRoutes.ts`。
本の索引は `/api/book/embed` に本文テキストだけを送る。全ページ画像のAI文字起こしは提供せず、旧 `/api/book/ocr` は410を返してAIを呼ばない。
画像だけのPDFはPDF24などで事前OCRする。選択画像についての質問 `/api/book/ask` と、手書き質問の読み取り `/api/book/read-question` は利用できる。
本の回答に添える参考図の検索は `src/bookReferenceMedia.ts` の `/api/book/reference-media` で扱う。
Wikimedia CommonsのAPIから出典・作者・ライセンス付きの資料を取得し、Geminiで関連性を選ぶ。追加の検索APIキーは不要。
参考資料の検索は回答APIから独立し、検索失敗は `status: unavailable` として返す。
共有の採点定義は兄弟サブモジュール `home-teacher-common` を参照するため、サブモジュールも初期化しておく。

## ローカル起動

このディレクトリで実行する。Windowsで必要な場合は `npm.cmd` を使う。

```sh
npm ci
cp .env.example .env
# .env に GEMINI_API_KEY を設定する
npm run dev
```

既定のポートは3003。アプリ直下からの `npm run dev:server` もこの起動処理を呼ぶ。
環境変数は実行環境の値が最優先、次に `server/.env`、次に互換用のアプリ直下 `.env` を読む。
既存のアプリ直下 `.env` は引き続き利用できる。秘密情報はGitへコミットしない。
`FIREBASE_SERVICE_ACCOUNT` は絶対パスを使える。相対パスは `server/`、従来のアプリ直下の順で探す。

## ビルドと検証

```sh
npm run build
npm start
npm test
```

`build` は専用の `tsconfig.json` で型を確認し、共通の採点定義もまとめて `dist/index.js` を生成する。
フロント用の依存をインストールせず、サーバーの依存だけでビルド・起動できる。
`test` は設定の互換性、開発ソースとビルド後のAPIの起動・入力検証を確認する。AIや決済の外部APIは呼ばない。

## Cloud Run

Dockerfileは `server/Dockerfile` に置く。共通の採点定義も必要なため、
アプリ直下の `npm run prepare:server` が必要なソースを `.cloud-run` に集める。
Dockerのビルド対象は `.cloud-run`。詳細と公開元のルールは [DEPLOYMENT.md](DEPLOYMENT.md) を参照。

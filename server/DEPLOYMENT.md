# Cloud Run API

TutoTutoとDoriDoriは同じ `hometeacher-api` を使用する。
通常の本番更新はTutoTuto側から実行する。CopiCopiのAPIは別サービス。

アプリのディレクトリで実行する（Windowsでは `npm.cmd` も使用可能）。

```sh
npm run prepare:server
npm run deploy:server:staging
# stagingの /api/health と /api/models、および採点を確認した後:
npm run deploy:server
```

`deploy:server` と `deploy:server:staging` はどちらも先にソースを準備する。
既存のシェルスクリプトもこのコマンドを呼ぶ。
Google Cloud CLIで対象プロジェクトへのログインとデプロイ権限が必要。
APIキー等は既存のSecret Managerから取得する。既存の他の環境変数は維持する。

`prepare:server` は生成用ディレクトリ `.cloud-run` を作り直し、
サーバー、共通の採点定義、専用の依存定義・lockfile、Dockerfileのみをコピーする。
共通定義は兄弟サブモジュールの現在のチェックアウトから取得する。
公開時はメタリポジトリが固定しているコミットを確認すること。
ルートの `gcloud run deploy --source .` は使用せず、
必ず `--source .cloud-run` を使用する。`.env` や認証ファイルはコピーされない。

Docker内で `npm ci` とビルドを実行し、共通定義をサーバーへまとめる。
実行イメージはサーバー用依存だけを含み、TypeScript実行ツールやフロント資産を必要としない。
依存を更新する場合は `server/package.json` を変更し、
`npm install --package-lock-only --prefix server` でlockfileも更新する。

Dockerを利用できる環境でのローカル確認:

```sh
npm run prepare:server
docker build -t hometeacher-api-check .cloud-run
docker run --rm -p 8080:8080 --env GEMINI_API_KEY hometeacher-api-check
```

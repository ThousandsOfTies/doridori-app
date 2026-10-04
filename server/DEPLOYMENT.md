# Cloud Run API

TutoTutoとDoriDoriは同じ `hometeacher-api` を使用する。
本番とstagingの公開元は **TutoTutoの `repos/tutotuto-app`** に一本化する。CopiCopiのAPIは別サービス。

DoriDoriの `deploy:server` と `deploy:server:staging` は案内を表示して終了コード1で停止する。
既存の `deploy-cloud-run*.sh` も同じ停止処理を通る。アップロード用ソースの生成やGoogle Cloudへの接続は行わない。
DoriDoriのローカルサーバーにはTutoTutoの `/api/ask-question` がないため、共有サービスを上書きしてはいけない。

共有APIを更新する際は、DoriDoriのサーバー変更をTutoTuto側へ必要な範囲で反映し、
`/api/grade-work`、`/api/ask-question`、`/api/book/*` が揃っていることを確認する。
TutoTuto側でstagingを検証してから本番へ公開する。
手順はTutoTutoの `repos/tutotuto-app/server/DEPLOYMENT.md` を参照。
DoriDori側から `gcloud run deploy` を直接実行しない。

## ローカルサーバーの検証

DoriDori側の `npm run dev:server` はローカル開発に使用できる。
`npm run prepare:server` もDockerによるローカル検証用に残しているが、生成物は共有Cloud Runへ公開しない。

`prepare:server` は生成用ディレクトリ `.cloud-run` を作り直し、
サーバーの `src/`・`tsconfig.json`・依存定義・lockfileと、共通の採点定義、`server/Dockerfile` のみをコピーする。
共通定義は兄弟サブモジュールの現在のチェックアウトから取得する。
検証時はメタリポジトリが固定しているコミットを確認すること。`.env` や認証ファイルはコピーされない。

Docker内の `server/` で `npm ci` とビルドを実行し、共通定義を `dist/index.js` にまとめる。
実行イメージはサーバー用依存だけを含み、TypeScript実行ツールやフロント資産を必要としない。
依存を更新する場合は `server/package.json` を変更し、
`npm install --package-lock-only --prefix server` でlockfileも更新する。

Dockerを利用できる環境でのローカル確認:

```sh
npm run prepare:server
docker build -t hometeacher-api-check .cloud-run
docker run --rm -p 8080:8080 --env GEMINI_API_KEY hometeacher-api-check
```

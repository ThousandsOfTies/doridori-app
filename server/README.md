# APIの移行先

サーバー本体は兄弟サブモジュール [home-teacher-api](https://github.com/ThousandsOfTies/home-teacher-api/blob/main/README.md) へ移りました。
このディレクトリには実装を保持しません。既存のローカル `server/.env` と認証ファイルは、アプリから `npm run dev:server` を実行した場合に引き続き参照できます。

APIの依存を `../home-teacher-api` で `npm ci` により用意してください。ビルド・テスト・公開手順は移行先のREADMEを参照してください。

# 共有APIの移行先

サーバー本体・依存・公開手順は、兄弟サブモジュール [home-teacher-api](https://github.com/ThousandsOfTies/home-teacher-api) にあります。

メタリポジトリ直下の `repos/home-teacher-api` で `npm ci` を実行し、アプリ直下の `npm run dev:server` で起動できます。
この起動方法では、従来のローカル `server/.env` と認証ファイルも互換用に参照します。

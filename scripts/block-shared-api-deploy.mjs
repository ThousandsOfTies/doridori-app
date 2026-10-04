// DoriDori's local server does not include TutoTuto's /api/ask-question route.
// Stop before preparing an upload or contacting Google Cloud in either environment.
console.error(`DoriDoriから共有Cloud Run APIへのデプロイは停止しました。
hometeacher-api / hometeacher-api-staging の公開元は TutoTuto/repos/tutotuto-app です。
DoriDoriのサーバーで上書きすると、TutoTutoの /api/ask-question が失われます。
TutoTuto側でDoriDoriの /api/book/* も含むサーバーを確認し、次の順で更新してください:
  npm run deploy:server:staging
  （採点・追加質問・本の質問の各APIを検証）
  npm run deploy:server
手順: TutoTuto/repos/tutotuto-app/server/DEPLOYMENT.md`)
process.exitCode = 1

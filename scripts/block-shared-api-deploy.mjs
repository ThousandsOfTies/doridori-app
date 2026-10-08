console.error('共有APIの公開元は独立リポジトリ home-teacher-api へ移りました。\n' +
  '../home-teacher-api で npm run deploy:staging を検証してから npm run deploy:production を実行してください。\n' +
  '手順: ../home-teacher-api/DEPLOYMENT.md\n' +
  '採点 /api/grade-work・追加質問 /api/ask-question・本の質問 /api/book/* は同じ共有APIで提供します。')
process.exitCode = 1

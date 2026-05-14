## 概要

<!-- 変更内容と目的を簡潔に書いてください。 -->

## 確認事項

- [ ] `.github/devin-automation.yml` の `quality.commands` がこのプロジェクトに合っている
- [ ] `PR Quality Gate` が通る
- [ ] `Risk Gate` が通る
- [ ] Devin Reviewの指摘を確認した

## Risk Gate確認

以下に該当する場合、Risk Gateが自動マージを停止する可能性があります。

- [ ] `.github/workflows/**` を変更していない、または人間確認が必要な変更として認識している
- [ ] `package.json` / lockfileを変更していない、または依存関係リスクを説明できる
- [ ] migration / schemaを変更していない、またはDB影響を説明できる
- [ ] auth / authorizationを変更していない、またはセキュリティ影響を説明できる
- [ ] payment / billingを変更していない、または金銭影響を説明できる
- [ ] terraform / infraを変更していない、または本番環境影響を説明できる
- [ ] `.env*` / secrets関連を変更していない
- [ ] テストを削除していない、または削除理由を説明できる
- [ ] 変更ファイル数と差分行数が閾値以内である

## Autofix

Devin Autofixが実行された場合は以下を確認してください。

- [ ] Autofix commitの内容を確認した
- [ ] Autofix後にCIが再実行された
- [ ] Autofix後にDevin Reviewが再実行された
- [ ] Autofixが複数回発生していない、または人間確認へ切り替えた

## 補足

<!-- レビュー担当者が知るべき制約、未対応事項、確認してほしい観点があれば書いてください。 -->

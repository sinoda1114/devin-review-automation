# Devin Review PR Automation Kit

Devin Review Native First、Risk-Gated Autonomy、Human in the loop on exception を前提にした、汎用PR自動化キットです。

このリポジトリを中央管理リポジトリとして置き、各プロジェクト側は小さな呼び出しworkflowと設定ファイルだけを持ちます。毎回 `scripts/` をコピーする運用ではなく、中央の reusable workflow を呼び出す形です。

## 使い方

対象プロジェクトで初期化します。

```bash
npx devin-review-automation init --automation-repository OWNER/devin-review-automation
```

npmに公開しない場合は、GitHubから直接実行できます。

```bash
npx github:OWNER/devin-review-automation init --automation-repository OWNER/devin-review-automation
```

生成されるファイルは2つだけです。

```text
.github/workflows/devin-automation.yml
.github/devin-automation.yml
```

`.github/devin-automation.yml` の `quality.commands` をプロジェクトに合わせて調整します。

```yaml
quality:
  allowEmpty: false
  commands:
    - name: Test
      run: npm test --if-present
```

## 中央リポジトリ側

このリポジトリには次が含まれます。

- `.github/workflows/devin-pr-automation.yml`
  - 各プロジェクトから呼び出す reusable workflow
- `scripts/quality-gate.mjs`
  - プロジェクト側設定の `quality.commands` を実行
- `scripts/risk-gate.mjs`
  - 差分サイズ、高リスクファイル、Autofix回数、Devin blocker相当コメントを判定
- `scripts/init.mjs`
  - 対象プロジェクトへ最小ファイルを生成するCLI

## Required Checks

Branch Protection / Ruleset では、少なくとも次のチェックを必須にしてください。

- `PR Quality Gate`
- `Risk Gate`

Devin Reviewが独自のcheck runを提供している場合は、そのDevin Reviewチェックも必須化してください。

中央リポジトリをprivateにする場合は、対象プロジェクトに `AUTOMATION_TOKEN` secretを追加し、中央リポジトリをcheckoutできるようにしてください。

## 初期閾値

| 項目 | 初期値 |
| --- | ---: |
| 最大変更ファイル数 | 10 |
| 最大差分行数 | 300 |
| Autofix最大回数 | 1 |
| 高リスクファイル変更 | 1つでも停止 |
| CI状態 | successのみ許可 |

## 運用方針

```text
PR Quality Gate success
+ Risk Gate pass
+ Devin Review blockerなし
+ Required Checks success
= Auto-merge

それ以外
= Human in the loop
```

詳細は `docs/devin-review-automation.md` を参照してください。

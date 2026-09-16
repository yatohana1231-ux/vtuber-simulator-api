# packages

世界観とキャラクターの組み合わせ（パッケージ）。フロントはここにある `id` の中から1つを選び、各エンドポイントに `packageId` として渡す。`packageId` を省略した場合は `yui-modern-tokyo` を使う。

## ファイル一覧

| ファイル | 世界観 | キャラクター |
|---|---|---|
| `yui-modern-tokyo.json` | `modern-tokyo` | `yui` |

## フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | パッケージID。ファイル名（拡張子なし）と同じ値 |
| `displayName` | string | 表示名（フロントの選択画面向け） |
| `world` | string | `worlds/` の `key` |
| `character` | string | `characters/` の `key` |

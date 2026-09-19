# packages

世界観・キャラクター・生活様式の組み合わせ（パッケージ）。フロントはここにある `id` の中から1つを選び、各エンドポイントに `packageId` として渡す。`packageId` を省略した場合は `yui-modern-tokyo` を使う。`GET /packages` がこのフォルダのパッケージを一覧で返す。

## ファイル一覧

| ファイル | 世界観 | キャラクター | 生活様式 |
|---|---|---|---|
| `yui-modern-tokyo.json` | `modern-tokyo` | `yui` | `tokyo-highschool-vtuber` |

## フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | パッケージID。ファイル名（拡張子なし）と同じ値 |
| `displayName` | string | 表示名（フロントの選択画面向け） |
| `description` | string | 選択画面に出す紹介文 |
| `fixedGreeting` | string | 不在が短いログインでフロントが表示する固定の挨拶 |
| `world` | string | `worlds/` の `key` |
| `character` | string | `characters/` の `key` |
| `lifestyle` | string | `lifestyles/` の `key` |

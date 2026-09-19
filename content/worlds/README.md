# worlds

世界観のデータファイル。5つのプロンプトすべてに、共有パーシャル `src/promptPartials/world.mustache` を通して差し込まれる。

## ファイル一覧

| ファイル | 世界観 |
|---|---|
| `modern-tokyo.json` | 2026年の現代日本・東京。魔法や超能力のない現実世界 |
| `modern-fantasy-tokyo.json` | 2026年の現代日本・東京をベースに、異種族（エルフ・獣人・妖精など）と魔法が日常の一部として存在する世界。勇者・ダンジョンなどの冒険ものの要素は禁止 |

## フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `key` | string | 識別子。ファイル名（拡張子なし）と同じ値 |
| `name` | string | 世界観の名前 |
| `description` | string | 舞台の説明文 |
| `rules` | string[] | 世界のルール（生成内容が守るべき制約） |
| `forbiddenElements` | string[] | 生成してはいけない要素。ファンタジーの世界観では魔法などを外し、代わりに現代的な要素を入れる、といった使い方を想定 |
| `timezone` | string | IANA タイムゾーン名（例: `"Asia/Tokyo"`）。`packages/` から参照する `lifestyles/` の時刻は、この世界観の時刻として扱う |

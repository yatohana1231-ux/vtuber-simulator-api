# promptPartials

5つの機能（`eventResolver` / `actionPlanner` / `emotionUpdater` / `memoryRetriever` / `dialogueGenerator`）のプロンプトテンプレートで共有する Mustache パーシャル。特定の世界観やキャラクターの文面をテンプレートに直書きしないために、`api/content/` のデータを描画する部分をここに集約している。

| ファイル | 内容 | 使っているテンプレート |
|---|---|---|
| `world.mustache` | 世界観（説明・ルール・存在しない要素） | 5つすべて（`{{> world}}`） |
| `speechExamples.mustache` | 口調の例文（few-shot）。例文が0件ならブロックごと出力しない | `dialogueGenerator/prompts/conversation.mustache`（`{{> speechExamples}}`） |
| `index.ts` | `PROMPT_PARTIALS`（`Mustache.render` の第3引数に渡すパーシャル一覧）と `buildPromptContext(world, character)`（テンプレートの view に展開する値） | 5つの機能の `index.ts` |

## 使い方

```ts
Mustache.render(
  PROMPT_TEMPLATE,
  { ...buildPromptContext(world, character), /* 機能ごとの値 */ },
  PROMPT_PARTIALS
);
```

テンプレートからは `{{character.name}}` のように `world` / `character` の各フィールドを参照できる。

## 注意

- パーシャル内の値は `{{{ }}}`（HTML エスケープなし）で出力している。Mustache の `{{ }}` は `/` などを `&#x2F;` に変換してしまい、プロンプトの文面が崩れるため。
- パーシャルを追加したら `PROMPT_PARTIALS` に登録すること。

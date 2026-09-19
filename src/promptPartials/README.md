# promptPartials

各機能（`absenceSimulator` / `emotionUpdater` / `memoryRetriever` / `dialogueGenerator`）のプロンプトテンプレートで共有する Mustache パーシャル。特定の世界観やキャラクターの文面をテンプレートに直書きしないために、`api/content/` のデータを描画する部分をここに集約している。

| ファイル | 内容 | 使っているテンプレート |
|---|---|---|
| `world.mustache` | 世界観（説明・ルール・存在しない要素） | 各機能の固定部のテンプレートすべて（`{{> world}}`） |
| `speechExamples.mustache` | 口調の例文（few-shot）。view の `characterName`・`speechExamples`（例文の配列）・`hasSpeechExamples` を使う。例文が0件ならブロックごと出力しない | `dialogueGenerator/prompts/conversation.session.mustache`（`{{> speechExamples}}`。今の関係の段階の例文、無ければキャラクター共通の例文。D-033） |
| `index.ts` | `PROMPT_PARTIALS`（`Mustache.render` の第3引数に渡すパーシャル一覧）、`buildPromptContext(world, character)`（テンプレートの view に展開する値）、`buildSpeechExamplesContext(characterName, examples)`（`speechExamples` パーシャルの view） | 各機能の `prompt.ts`（プロンプトの層を組み立てる処理） |

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

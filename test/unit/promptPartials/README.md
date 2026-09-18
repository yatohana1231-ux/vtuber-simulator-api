# api/test/unit/promptPartials

`src/promptPartials/` の単体テスト。対象の概要は [`../../../src/promptPartials/README.md`](../../../src/promptPartials/README.md) を参照。

| テストファイル | 対象 | 内容 |
|---|---|---|
| `index.test.ts` | `src/promptPartials/index.ts` | `PROMPT_PARTIALS.world` / `.speechExamples` が空でない文字列であること（`.mustache` 変換プラグインの動作確認を兼ねる）、`buildPromptContext` の `hasForbiddenElements` / `forbiddenElementsText` / `hasSpeechExamples` |

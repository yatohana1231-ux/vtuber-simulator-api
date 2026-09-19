/**
 * モデル ID ごとの、Bedrock Converse API の呼び出し方の違いを持つ。
 *
 * 実測（2026-09-19、Bedrock Converse API、`.notes/model-selection-roadmap.md` フェーズ2）:
 * - Amazon Nova（`apac.amazon.nova-lite-v1:0`、`jp.`/`global.amazon.nova-2-lite-v1:0`、
 *   `apac.amazon.nova-pro-v1:0`）は `temperature` と `topP` の併用を受け付ける。
 * - Anthropic Claude（`jp.anthropic.claude-haiku-4-5-20251001-v1:0`、`jp.anthropic.claude-sonnet-4-6`）は
 *   併用すると `ValidationException: temperature and top_p cannot both be specified for this model` になる。
 *   `temperature` だけなら通る。
 *
 * 判定規則:
 * - モデル ID（推論プロファイルの接頭辞 `apac.`/`jp.`/`global.`/`us.` などが付いていてもよい）に
 *   `amazon.nova` を含むものは `supportsTopP: true`。
 * - それ以外（Anthropic Claude を含む、未知のモデル）は `supportsTopP: false`
 *   （`temperature` だけなら多くのモデルが受け付けるため、未知のモデルでは安全側に倒す）。
 */

export interface ModelProfile {
  supportsTopP: boolean;
}

export function getModelProfile(modelId: string): ModelProfile {
  return {
    supportsTopP: modelId.includes("amazon.nova"),
  };
}

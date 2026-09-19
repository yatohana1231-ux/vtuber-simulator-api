# characters

キャラクターのデータファイル。

## ファイル一覧

| ファイル | キャラクター |
|---|---|
| `yui.json` | ゆい。都内の高校2年生で、デビューしたての VTuber |
| `kohaku.json` | コハク。ミミズクの獣人（夜型）で、魔法史を研究する大学院生（博士課程）。プレイヤーを「少年」と呼ぶ、飄々とした年上（`modern-fantasy-tokyo` の世界観が前提） |

## フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `key` | string | 識別子。ファイル名（拡張子なし）と同じ値 |
| `name` | string | キャラクター名 |
| `personality` | string | 性格 |
| `speechStyle` | string | 段階によらない話し方（口ぐせ・テンションなど）。丁寧語かくだけた口調かなど、関係によって変わる部分は `relationshipStages` に書く |
| `relationship` | string | 段階によらない、プレイヤーとの関係の前提（例: 「配信者とリスナー」）。ゆいの値は後で見直す（`.notes` の F-030） |
| `background` | string | キャラクター固有の設定（年齢・所属・境遇など）。5つのプロンプトすべてに渡る |
| `speechExamples` | `{ player, reply }[]` | 口調の例文（few-shot）。`dialogueGenerator` のプロンプトにだけ渡る。読み込み時に先頭5件までに切り詰める。今の段階に例文が無いときだけ使う |
| `initialPerception` | `Perception`（6軸、1〜100の整数） | 状態レコードが無い（初めての）ときの関係値（`perception`）の初期値。最初の段階に合う低めの値にする（D-033） |
| `relationshipStages` | 段階の配列（1つ以上） | 関係の段階（D-033）。先頭が最初の段階。段階はサーバーが決め、今の段階の内容を `dialogueGenerator` のプロンプトに入れる。各要素は下の表 |
| `bigFive` | `{ openness, conscientiousness, extraversion, agreeableness, neuroticism }`（各 −100〜+100。省略可） | 性格の5因子（0 が平均的。`neuroticism` は高いほど情緒が不安定）。気分の平常値（Mehrabian 1996 の式）と、感じやすさ（外向性が高いと正の情動、神経症傾向が高いと負の情動が強く出る）を決める（[D-040](../../../.notes/decision-history.md#d-040)、`src/lib/affect/personality.ts`）。省略時はすべて 0 |
| `goals` | `{ key, description, importance }[]`（省略可） | 目標・大事にしていること。出来事の評価の基準で、`emotionUpdater` のプロンプトの固定部に入る。`key` は重複不可、`importance` は 1〜100（関係する出来事の情動の強さにかかる）。設定（`background`）に無い事実を足さない |
| `attachmentStyle` | `"secure"` / `"anxious"` / `"avoidant"`（省略可。既定は `secure`） | 愛着のスタイル。会えない間の孤独感の増え方と、久しぶりに会ったときのふるまいの説明（`src/lib/affect/affectText.ts` の定型文）に使う。`anxious` はさみしさが強く出て少し拗ねる、`avoidant` は平気なふりをする |
| `affectTuning` | object（省略可） | 設定値（`src/lib/affect/affectConfig.ts`）のキャラクターごとの上書き。`moodHomeBase`（気分の平常値を直接指定）、`positiveEmotionGain`・`negativeEmotionGain`（感じやすさ）、`emotionHalfLifeScale`・`moodHalfLifeScale`（引きずりやすさ）、`lonelinessGrowthScale`、`perceptionGainScale`（関係の深まりやすさ）、`perceptionDampingSigma`（上限の手前での上がりづらさ）。倍率は 1 が既定と同じ。知らないキーは読み込み時にエラー |

### `relationshipStages` の要素

| フィールド | 型 | 説明 |
|---|---|---|
| `key` | string | 段階の識別子（重複不可） |
| `label` | string | 段階の名前（例: 「仲良し」）。節目の記録（重要記憶・ログ）に使い、プロンプトには入れない |
| `description` | string | この段階の関係と距離感 |
| `speechStyle` | string | この段階の話し方（丁寧語かくだけた口調か、話題の広さなど） |
| `speechExamples` | `{ player, reply }[]` | この段階の口調の例文。省略・空ならキャラクター共通の例文を使う。先頭5件までに切り詰める |
| `promoteWhen` | object または null | この段階に上がる条件。先頭の段階は `null`。`minConversationDays`（発言した日数）・`minConversationCount`（発言の回数）・`minPerception`（関係値の下限。書いた軸だけを見る）をすべて満たすと上がる |
| `maxPerception` | `Partial<Perception>`（省略可） | この段階での関係値の上限（書いた軸だけを見る。書かない軸は 100。小数可）。関係値は上限に近づくほど上がりづらくなり、上限で止まる（D-040、`src/lib/affect/perceptionDynamics.ts`）。**次の段階の `promoteWhen.minPerception` の同じ軸以上にすること**（低いと永久に上がれないので、読み込み時にエラーにする）。`initialPerception` は最初の段階の上限以下にする。`fear` は低いほど関係が深い項目なので、基本は書かない |

- 段階が下がる・戻る決まり（60日話さないと1段階下がり、そのあと5回の発言で戻る）は、キャラクターによらないサーバーの定数（`src/lib/relationship.ts`）。
- 段階ごとの例文には、段階が変わったことを告げるセリフ（「仲良くなったね」など）を入れない（節目はプレイヤーに伝えない方針）。設定に無い具体的な事実（趣味など）や、決めていない呼び方も入れない（例文の内容が設定として定着しやすいため）。

## 例文を書くときの注意

- 例文は口調と語彙の手本として使われ、プロンプトでは「内容や言い回しをそのまま使わない」よう指示している。それでも同じ質問が来ると似た返答になりやすいので、動作確認に使う質問と同じ `player` を例文に入れないこと。

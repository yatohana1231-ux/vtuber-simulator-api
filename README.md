# VTuber Simulator API

VTuber キャラクターとのチャットインタラクションを提供するサーバーレス API。プレイヤーの不在時間に基づいてキャラクターの世界をシミュレートし、感情・関係値を持つキャラクターとの自然な対話を実現する。

`docs/spec/api/` 配下にあった仕様ドキュメント（overview / architecture / data-model / flow / api-spec）を、このフォルダの README に統合したもの。

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js 20.x (AWS Lambda) |
| 言語 | TypeScript (ESM) |
| ビルドツール | esbuild |
| LLM | Amazon Bedrock (Converse API) / `apac.amazon.nova-lite-v1:0` |
| データベース | Amazon DynamoDB |
| API ゲートウェイ | Amazon API Gateway (REST API) |
| IaC | AWS CDK (TypeScript) |
| CI/CD | GitHub Actions (OIDC 認証) |
| テンプレートエンジン | Mustache |
| リージョン | ap-northeast-1 (東京) |

## ディレクトリ構成

```
api/
├── .github/workflows/deploy-stg.yml   # CI/CD パイプライン（STG）
├── dist/                               # ビルド成果物（機能ごとに <name>.mjs）
├── infra/                              # CDK インフラ定義
│   ├── bin/                            # CDK エントリーポイント
│   ├── lib/
│   │   ├── vtuber-simulator-stack.ts   # メインスタック（Lambda x5, API GW, DynamoDB）
│   │   └── github-oidc-stack.ts        # GitHub OIDC 認証スタック
│   ├── cdk.json / package.json / tsconfig.json
├── scripts/
│   ├── clear-tables.mjs                # テーブルクリアスクリプト
│   └── test-runner.ts                  # テスト実行スクリプト
├── src/
│   ├── handlers/                       # Lambda エントリーポイント（機能ごとに1ファイル）
│   │   ├── eventResolver.ts
│   │   ├── actionPlanner.ts
│   │   ├── emotionUpdater.ts
│   │   ├── memoryRetriever.ts
│   │   └── dialogueGenerator.ts
│   ├── types.ts                        # 型定義
│   ├── eventResolver/{index.ts, prompts/eventResolver.mustache}      # イベント生成
│   ├── actionPlanner/{index.ts, prompts/actionPlanner.mustache}      # 行動履歴生成
│   ├── emotionUpdater/{index.ts, prompts/emotionUpdater.mustache}    # 感情値更新
│   ├── memoryRetriever/{index.ts, prompts/memoryRetriever.mustache}  # 重要記憶管理
│   ├── dialogueGenerator/{index.ts, prompts/conversation.mustache}   # セリフ生成
│   └── lib/{bedrock.ts, dynamo.ts, utils.ts}
└── package.json
```

## アーキテクチャ

機能（`eventResolver`/`actionPlanner`/`emotionUpdater`/`memoryRetriever`/`dialogueGenerator`）ごとに独立した Lambda + API エンドポイントを公開する構成。**「どの処理をどの順で呼ぶか」を決めるオーケストレーションはバックエンドではなくフロントエンド（Unity、未実装）の責務**であり、バックエンド側にはもうプロセス分岐ロジックは存在しない（旧 `processChat.ts`/単一 `POST /chat` は廃止済み）。各 Lambda は「リクエストを受け取り、対応する機能を実行し、結果を返す」だけの薄いエンドポイントになっている。

### 主要コンポーネント

| モジュール | 役割 |
|-----------|------|
| `handlers/*.ts` | Lambda エントリーポイント（機能ごとに1ファイル）。リクエスト解析・正規化・レスポンス生成のみを行う薄いアダプタ |
| `eventResolver` | 不在期間中にキャラクターが経験したイベントを LLM で生成 |
| `actionPlanner` | イベントに基づくキャラクターの行動履歴を LLM で生成 |
| `emotionUpdater` | イベント/プレイヤー発言を元に感情・関係値を LLM で更新 |
| `memoryRetriever` | 重要な出来事・会話を LLM で判定し長期記憶として保存 |
| `dialogueGenerator` | 全情報を統合しキャラクターのセリフを LLM で生成 |

### フロントが組み立てる呼び出しパターン

以下はフロントが「どの状況でどのエンドポイントをどの順で呼ぶべきか」を判断する際の推奨パターン（詳細は後述の「API仕様」を参照）。

| 状況 | 条件 | 呼び出し順 |
|---------|------|---------|
| ログイン時・通常不在 | `message=""` かつ 3h <= 経過 < 2週間 | `/event-resolver` → `/action-planner` → `/emotion-updater`(process=1) → `/memory-retriever`(process=1) → `/dialogue-generator` |
| ログイン時・長期不在 | `message=""` かつ 経過 >= 2週間 | 同上 + `longTimeFlag=1` を `/dialogue-generator` に渡す（孤独感・喜び表現を追加） |
| ログイン時・短時間不在 | `message=""` かつ 経過 < 3h | どのAPIも呼ばない。固定挨拶をローカル表示 |
| 会話メッセージ送信 | `message` に内容あり | `/dialogue-generator` → `/emotion-updater`(process=2) → `/memory-retriever`(process=2)（重要記憶判定は内部で5往復ごとにスキップ判定） |

### システム構成図（AWS インフラ）

```mermaid
graph TB
    subgraph Client["クライアント (Unity・未実装)"]
        UNITY[Unity アプリケーション<br/>オーケストレーションを担当]
    end

    subgraph AWS["AWS (ap-northeast-1)"]
        subgraph APILayer["API Layer"]
            APIGW[API Gateway<br/>REST API<br/>機能ごとに5リソース]
        end
        subgraph ComputeLayer["Compute Layer（機能ごとに独立したLambda）"]
            L1[event-resolver]
            L2[action-planner]
            L3[emotion-updater]
            L4[memory-retriever]
            L5[dialogue-generator]
        end
        subgraph DataLayer["Data Layer (DynamoDB)"]
            CONV_LOG[vtuber-simu-conversation-log<br/>会話ログテーブル]
            CHAR_MEM[v-simu-characters-memory<br/>キャラクター記憶テーブル]
            EVENTS[v-simu-events<br/>イベントテーブル]
        end
        subgraph AILayer["AI Layer"]
            BEDROCK[Amazon Bedrock<br/>Converse API<br/>apac.amazon.nova-lite-v1:0]
        end
    end

    UNITY -->|HTTPS POST 順次呼び出し| APIGW
    APIGW --> L1 & L2 & L3 & L4 & L5
    L1 --> CHAR_MEM
    L1 --> EVENTS
    L2 --> CHAR_MEM
    L3 --> CHAR_MEM
    L4 --> CHAR_MEM
    L4 --> CONV_LOG
    L5 --> CHAR_MEM
    L5 --> CONV_LOG
    L1 & L2 & L3 & L4 & L5 -->|InvokeModel| BEDROCK
```

### アプリケーション内部コンポーネント構成図

```mermaid
graph TB
    subgraph EntryPoints["Entry Points（機能ごとの薄いアダプタ）"]
        H1[handlers/eventResolver.ts]
        H2[handlers/actionPlanner.ts]
        H3[handlers/emotionUpdater.ts]
        H4[handlers/memoryRetriever.ts]
        H5[handlers/dialogueGenerator.ts]
    end
    subgraph DomainModules["Domain Modules"]
        ER[eventResolver]
        AP[actionPlanner]
        EU[emotionUpdater]
        MR[memoryRetriever]
        DG[dialogueGenerator]
    end
    subgraph SharedLib["Shared Libraries"]
        BK[bedrock.ts]
        DB[dynamo.ts]
        UT[utils.ts]
    end
    subgraph Templates["Prompt Templates (.mustache)"]
        T1[eventResolver.mustache]
        T2[actionPlanner.mustache]
        T3[emotionUpdater.mustache]
        T4[memoryRetriever.mustache]
        T5[conversation.mustache]
    end

    H1 --> ER
    H2 --> AP
    H3 --> EU
    H4 --> MR
    H5 --> DG
    H1 & H2 & H3 & H4 & H5 --> UT
    ER --> BK & DB & T1
    AP --> BK & DB & T2
    EU --> BK & DB & T3
    MR --> BK & DB & T4
    DG --> BK & DB & T5
```

### CI/CD パイプライン構成図

```mermaid
graph LR
    subgraph GitHub
        REPO[リポジトリ<br/>develop ブランチ]
        GHA[GitHub Actions]
    end
    subgraph BuildSteps["ビルドステップ"]
        CHECKOUT[Checkout] --> SETUP[Node.js 20 Setup] --> OIDC[AWS OIDC 認証] --> INSTALL[npm ci] --> TYPECHECK[tsc --noEmit] --> BUILD[esbuild バンドル<br/>機能ごとに dist/*.mjs] --> CDK[CDK Deploy]
    end
    subgraph AWS_Deploy["AWS (STG)"]
        CFN[CloudFormation] --> LAMBDA_D[Lambda 更新]
        CFN --> APIGW_D[API Gateway 更新]
        CFN --> DYNAMO_D[DynamoDB 更新]
    end

    REPO -->|push to develop| GHA
    GHA --> CHECKOUT
    CDK --> CFN
```

## リクエスト処理フロー

以下はいずれも**フロント側が実行する**呼び出し順序（=旧 `processChat.ts` が担っていた判断）。バックエンドは個々のエンドポイントを提供するのみで、この順序決定には関与しない。

### 全体フロー

```mermaid
flowchart TD
    START([フロント: トリガー検知]) --> CALC[elapsedHours 算出<br/>now - lastLoginAt]
    CALC --> CHECK_MSG{message は空?}

    CHECK_MSG -->|message = ""| P1{elapsedHours 判定}
    CHECK_MSG -->|message 有| P2[会話メッセージ送信の<br/>呼び出し列]

    P1 -->|< 3時間| P1_3[どのAPIも呼ばず<br/>ローカルで固定挨拶を表示]
    P1 -->|3h ~ 2週間| P1_1[ログイン時（通常不在）の<br/>呼び出し列]
    P1 -->|>= 2週間| P1_2[ログイン時（長期不在）の<br/>呼び出し列<br/>longTimeFlag=1]

    P1_1 --> RES([フロントで画面表示用に組み立て])
    P1_2 --> RES
    P2 --> RES
    P1_3 --> RES
```

### ログイン時（不在3時間以上）の呼び出しシーケンス

```mermaid
sequenceDiagram
    participant Front as フロント（Unity・未実装）
    participant ER as /event-resolver
    participant AP as /action-planner
    participant EU as /emotion-updater
    participant MR as /memory-retriever
    participant DG as /dialogue-generator
    participant BK as Bedrock
    participant DB as DynamoDB

    Note over Front: elapsedHours >= 3h（フロントが算出済み）

    Front->>ER: POST { characterId, characterProfile, lastLoginAt, now }
    ER->>DB: getMemories(characterName)
    ER->>BK: invokeModelJson(prompt, "不在期間中の出来事を生成")
    ER->>DB: saveEvent(eventItem)
    ER-->>Front: { events }

    Front->>AP: POST { characterId, characterProfile, lastLoginAt, now, events }
    AP->>DB: getMemories(characterName)
    AP->>BK: invokeModelJson(prompt, "行動履歴を生成")
    AP-->>Front: { actions }

    Front->>EU: POST { characterId, characterProfile, process:1, events, actions }
    EU->>DB: getCharacterState(characterId)
    EU->>BK: invokeModelJson(prompt, "感情値の差分を算出")
    EU->>DB: saveCharacterState(updated)
    EU-->>Front: { mood, perception }

    Front->>MR: POST { characterId, characterProfile, process:1, events, actions }
    MR->>DB: getMemories(characterName)
    MR->>BK: invokeModelJson(prompt, "重要度を判定")
    MR->>DB: saveMemory(重要記憶) [shouldRemember=true のみ]
    MR-->>Front: { ok: true }

    Front->>DG: POST { characterId, characterProfile, now, message:"", mood, perception, events, actions, longTimeFlag }
    DG->>DB: getMemories(characterName)
    DG->>DB: saveConversationLog(user, "（プレイヤーが来た）")
    DG->>DB: getRecentLogs(characterId, 10)
    DG->>BK: invokeModel(systemPrompt, "（プレイヤーが来た）")
    DG->>DB: saveConversationLog(assistant, reply)
    DG-->>Front: { reply }

    Note over Front: { reply, mood, perception, actions } を画面表示用に組み立てる
```

### 会話メッセージ送信時の呼び出しシーケンス

```mermaid
sequenceDiagram
    participant Front as フロント（Unity・未実装）
    participant DG as /dialogue-generator
    participant EU as /emotion-updater
    participant MR as /memory-retriever
    participant BK as Bedrock
    participant DB as DynamoDB

    Front->>DG: POST { characterId, characterProfile, now, message }
    Note over DG: mood/perception 省略時は DynamoDB から取得
    DG->>DB: getCharacterState / getMemories
    DG->>DB: saveConversationLog(user, message)
    DG->>DB: getRecentLogs(characterId, 10)
    DG->>BK: invokeModel(systemPrompt, message)
    DG->>DB: saveConversationLog(assistant, reply)
    DG-->>Front: { reply }

    Front->>EU: POST { characterId, characterProfile, process:2, playerMessage: message }
    EU->>DB: getCharacterState(characterId)
    EU->>BK: invokeModelJson(prompt, "感情値の差分を算出")
    EU->>DB: saveCharacterState(updated)
    EU-->>Front: { mood, perception }

    Front->>MR: POST { characterId, characterProfile, process:2 }
    MR->>DB: getLogsForMemoryJudge(characterId, 5)
    alt 10件未満 or 判定済み
        MR-->>Front: { ok: true }（スキップ）
    else 未判定かつ10件以上
        MR->>DB: getMemories(characterName)
        MR->>BK: invokeModelJson(prompt, "重要度を判定")
        MR->>DB: saveMemory(重要記憶)
        MR->>DB: markLogsAsJudged(indexes)
        MR-->>Front: { ok: true }
    end

    Note over Front: { reply, mood, perception } を画面表示用に組み立てる
```

### emotionUpdater 内部処理フロー

```mermaid
flowchart TD
    START([開始]) --> GET_STATE[DynamoDB から現在の<br/>mood / perception 取得]
    GET_STATE --> BUILD_INPUT{process 判定}
    BUILD_INPUT -->|process=1| INPUT1[インプット:<br/>不在中の出来事 + 行動]
    BUILD_INPUT -->|process=2| INPUT2[インプット:<br/>プレイヤーの発言]
    INPUT1 --> RULE1[制約: perception ±0~3]
    INPUT2 --> RULE2[制約: perception ±1~5]
    RULE1 --> PROMPT[Mustache テンプレートで<br/>システムプロンプト構築]
    RULE2 --> PROMPT
    PROMPT --> BEDROCK[Bedrock 呼び出し<br/>moodDelta + perceptionDelta 取得]
    BEDROCK --> APPLY[差分を適用<br/>clamp 1~100]
    APPLY --> SAVE[DynamoDB に保存]
    SAVE --> END_([完了: updated mood/perception 返却])
```

### memoryRetriever 判定フロー

```mermaid
flowchart TD
    START([開始]) --> CHECK_PROCESS{process 判定}
    CHECK_PROCESS -->|process=1| P1_CHECK{events/actions<br/>あり?}
    CHECK_PROCESS -->|process=2| P2_LOGS[直近5往復のログ取得]

    P1_CHECK -->|なし| SKIP1([スキップ])
    P1_CHECK -->|あり| P1_INPUT[イベント+アクションを<br/>テキスト化]

    P2_LOGS --> P2_COUNT{10件以上?}
    P2_COUNT -->|いいえ| SKIP2([スキップ: 往復数不足])
    P2_COUNT -->|はい| P2_JUDGED{判定済みフラグ<br/>あり?}
    P2_JUDGED -->|あり| SKIP3([スキップ: 判定済み])
    P2_JUDGED -->|なし| P2_INPUT[会話ログをテキスト化]

    P1_INPUT --> JUDGE[Bedrock で重要度判定]
    P2_INPUT --> JUDGE
    JUDGE --> FILTER{shouldRemember<br/>= true?}
    FILTER -->|はい| SAVE[DynamoDB に記憶保存]
    FILTER -->|いいえ| DISCARD[破棄]
    SAVE --> MARK[ログに判定済みフラグ付与<br/>※process=2のみ]
    DISCARD --> END_([完了])
    MARK --> END_
```

## データモデル（DynamoDB）

| テーブル名 | 用途 | 作成方法 |
|-----------|------|---------|
| `vtuber-simu-conversation-log-{stage}` | 会話ログ | 既存（CDK でインポート） |
| `v-simu-characters-memory-{stage}` | キャラクター記憶・状態 | 既存（CDK でインポート） |
| `v-simu-events-{stage}` | イベント履歴 | CDK で新規作成 |

```mermaid
erDiagram
    CONVERSATION_LOG {
        string conversation_id PK "キャラクターID"
        string index SK "ISO8601 タイムスタンプ"
        string role "user | assistant"
        string content "発言内容"
        number memoryRetrieverJudgedFlag "判定済み: 0 or 1"
    }
    CHARACTER_MEMORY {
        string memory_id PK "キャラクター名 or ID"
        string index SK "state | タイムスタンプ_UUID"
        object mood "感情値 (state レコードのみ)"
        object perception "関係値 (state レコードのみ)"
        string eventSummary "記憶: 出来事の要約"
        string characterInterpretation "記憶: キャラクターの解釈"
        string[] tags "記憶: タグ"
        number importance "記憶: 重要度"
        string memoryType "記憶: 記憶タイプ"
        object relationshipChanges "記憶: 関係値変化"
        string emotion "記憶: 感情"
        string reason "記憶: 記憶理由"
        string updatedAt "更新日時"
    }
    EVENTS {
        string event_id PK "UUID"
        string characterId "キャラクターID (GSI PK)"
        string startDatetime "不在開始日時"
        string endDatetime "不在終了日時"
        string elapsed "経過時間テキスト"
        string[] events "生成されたイベント一覧"
        string createdAt "作成日時 (GSI SK)"
    }
    CHARACTER_MEMORY ||--o{ CONVERSATION_LOG : "characterId で関連"
    CHARACTER_MEMORY ||--o{ EVENTS : "characterId で関連"
```

### 会話ログテーブル

- キー: PK `conversation_id`（キャラクターID）/ SK `index`（ISO8601タイムスタンプ）
- 属性: `role`（`user`|`assistant`）, `content`, `memoryRetrieverJudgedFlag`（0/1）
- アクセスパターン: `saveConversationLog()` / `getRecentLogs(limit=10)`（降順クエリ→昇順反転）/ `getLogsForMemoryJudge(turns=5)`（直近10件）/ `markLogsAsJudged(indexes)`

### キャラクター記憶テーブル

感情状態と重要記憶の2種類を1テーブルで管理するマルチパーパステーブル。PK `memory_id`（キャラクター名 or ID）/ SK `index`。

| レコード種別 | `index` の値 | `memory_id` の値 | 用途 |
|-------------|-------------|-----------------|------|
| 状態レコード | `"state"` | characterId (UUID) | 感情値・関係値の現在値（`mood`, `perception`, `updatedAt`） |
| 記憶レコード | `{ISO8601}_{UUID8桁}` | characterName (名前) | 重要記憶（`eventSummary`, `characterInterpretation`, `tags`, `importance`, `memoryType`, `relationshipChanges`, `emotion`, `reason`, `updatedAt`） |

アクセスパターン: `getCharacterState(characterId)` / `saveCharacterState(characterId, mood, perception)` / `getMemories(characterName)` / `saveMemory(item)`

### イベントテーブル

- キー: PK `event_id`（UUID）。GSI `characterId-index`: PK `characterId` / SK `createdAt`
- 属性: `startDatetime`, `endDatetime`, `elapsed`, `events`（3〜7件のテキスト配列）, `createdAt`
- アクセスパターン: `saveEvent(item)`
- 容量: PAY_PER_REQUEST、削除ポリシーは stg=DESTROY / prod=RETAIN

### Mood（内面感情・6次元、1〜100）

| パラメータ | 日本語名 | デフォルト値 |
|-----------|---------|-------------|
| `joy` | 喜び | 35 |
| `anxiety` | 不安 | 62 |
| `angry` | 怒り | 20 |
| `fatigue` | 疲労 | 48 |
| `confidence` | 自信 | 30 |
| `loneliness` | 孤独感 | 10 |

### Perception（対プレイヤー関係値・6次元、1〜100）

| パラメータ | 日本語名 | デフォルト値 |
|-----------|---------|-------------|
| `trust` | 信頼 | 72 |
| `affection` | 好感 | 55 |
| `respect` | 尊敬 | 80 |
| `fear` | 恐れ | 12 |
| `dependence` | 依存 | 30 |
| `familiarity` | 親しみ | 65 |

値の解釈: 1〜20 ほとんど感じない / 21〜40 低い / 41〜60 標準 / 61〜80 自覚している / 81〜100 強く感じる。

更新ルール: Process 1（不在中）は mood 変化幅の制限なし・perception は ±0〜3。Process 2（会話中）は mood 制限なし・perception は ±1〜5。

## API 仕様

| 項目 | 値 |
|------|------|
| ベース URL | `https://{api-id}.execute-api.ap-northeast-1.amazonaws.com/{stage}` |
| 認証 | なし（CORS で制御、`Access-Control-Allow-Origin: *`） |
| タイムアウト | API Gateway: 29秒 / Lambda: 120秒 |

5つの独立したエンドポイントを提供する。すべて `POST`、リクエスト/レスポンスは JSON。**`characterId` は全エンドポイントで必須**（自動生成は行わない。新規キャラクターの UUID 発行はフロント側の責務）。呼び出し順序は「リクエスト処理フロー」を参照。

### `POST /event-resolver`

不在期間中のイベントを生成する。

**リクエスト**

```json
{
  "characterId": "550e8400-e29b-41d4-a716-446655440000",
  "characterProfile": { "name": "桜庭あおい", "personality": "明るく前向きだが、少し臆病な一面もある" },
  "lastLoginAt": "2026-08-10T10:00:00",
  "now": "2026-08-11T14:30:00"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `characterId` | string | Yes | キャラクター識別子 |
| `characterProfile.{name,personality,...}` | object | No | 省略項目はデフォルト値で補完 |
| `lastLoginAt` | string (ISO8601) | No | 前回ログイン日時。省略時は `now` と同値 |
| `now` | string (ISO8601) | No | 現在日時。省略時はサーバー現在時刻 |

**レスポンス**（`EventResolverResult`）

```json
{
  "UUID": "b3f1...",
  "startDatetime": "2026-08-10T10:00:00.000Z",
  "endDatetime": "2026-08-11T14:30:00.000Z",
  "elapsed": "28時間30分",
  "events": ["テストで赤点を取って補修が大変だった"]
}
```

### `POST /action-planner`

`event-resolver` の出力（`events`）を受け取り、不在期間分（上限12時間）の行動履歴を生成する。

**リクエスト**: `event-resolver` と同じ4フィールド + `events: string[]`（`event-resolver` のレスポンスの `events` をそのまま渡す）

**レスポンス**（`ActionPlannerResult`）

```json
{
  "actions": [
    { "startDatetime": "2026-08-11T08:00:00", "endDatetime": "2026-08-11T09:30:00", "action": "歌の練習", "memo": "新曲のサビを重点的に練習した" }
  ]
}
```

### `POST /emotion-updater`

`process` フィールドで process1（不在中のイベント/行動が入力）と process2（プレイヤー発言が入力）を切り替える判別ユニオン。

```json
// process = 1
{ "characterId": "...", "characterProfile": {...}, "process": 1, "events": [...], "actions": [...] }

// process = 2
{ "characterId": "...", "characterProfile": {...}, "process": 2, "playerMessage": "今日の配信、すごく良かったよ！" }
```

**レスポンス**

```json
{
  "mood": { "joy": 52, "anxiety": 45, "angry": 15, "fatigue": 38, "confidence": 35, "loneliness": 8 },
  "perception": { "trust": 74, "affection": 58, "respect": 80, "fear": 10, "dependence": 32, "familiarity": 68 }
}
```

process1 では perception の変化幅は ±0〜3、process2 では ±1〜5 に抑えるようプロンプトで指示している（詳細は「データモデル」の更新ルール参照）。

### `POST /memory-retriever`

会話・出来事を重要度判定し、該当すれば DynamoDB に記憶として保存する（副作用のみのエンドポイント）。

```json
// process = 1
{ "characterId": "...", "characterProfile": { "name": "..." }, "process": 1, "events": [...], "actions": [...] }

// process = 2（内部で直近5往復のログを見て、10件未満または判定済みならスキップする）
{ "characterId": "...", "characterProfile": { "name": "..." }, "process": 2 }
```

**レスポンス**: `{ "ok": true }`（判定結果は返さない。保存有無は DynamoDB の状態としてのみ反映される）

### `POST /dialogue-generator`

会話履歴・記憶・感情/関係値を踏まえてキャラクターのセリフを生成する。

**リクエスト**

```json
{
  "characterId": "550e8400-e29b-41d4-a716-446655440000",
  "characterProfile": {
    "name": "桜庭あおい",
    "personality": "明るく前向きだが、少し臆病な一面もある",
    "speechStyle": "丁寧語まじりのカジュアルな話し方",
    "relationship": "デビューしたての新人VTuber。プレイヤーはプロデューサー候補"
  },
  "now": "2026-08-11T14:30:00",
  "message": "今日の配信、すごく良かったよ！",
  "mood": { "...": "..." },
  "perception": { "...": "..." },
  "events": [],
  "actions": [],
  "longTimeFlag": 0
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `message` | string | No | `""` の場合は「プレイヤーが来た」という代替テキストで生成（ログイン時のセリフ生成に使う） |
| `mood` / `perception` | object | No | 省略時は DynamoDB の現在値を使用（会話メッセージ送信時、`emotion-updater` 呼び出し前に使うのが典型パターン） |
| `events` / `actions` | array | No | ログイン時のみ渡す。省略時は空配列扱い |
| `longTimeFlag` | 0 or 1 | No | 省略時 0 |

**レスポンス**: `{ "reply": "え、本当ですか！？ありがとうございます！実は結構緊張してたんですけど..." }`

### エラーレスポンス（全エンドポイント共通）

- **400** — `characterId` 未指定 / `process` が 1,2 以外 / 日時フォーマット不正: `{ "error": "..." }`
- **500** — サーバー内部エラー（Bedrock呼び出し失敗、DynamoDBエラー等）: `{ "error": "Failed to generate a response", "errorName": "...", "errorMessage": "..." }`

### フロント実装ガイド

呼び出し順序の詳細は「リクエスト処理フロー」を参照。実装上の注意点:

1. `event-resolver` の `events` は `action-planner`・`emotion-updater`(process1)・`memory-retriever`(process1)・`dialogue-generator` に、`action-planner` の `actions` は後続の3エンドポイントに、それぞれそのまま渡す（バックエンドはステップ間の状態を保持しない）
2. `characterId` はフロントが最初のセッションで生成し、以降すべてのリクエストで使い回す
3. アプリ終了時の時刻を `lastLoginAt` としてローカル保存し、次回起動時に送信する
4. ログイン時（不在3時間以上）は最大5回のAPI呼び出しが直列に発生するため、体感の待ち時間は旧単一エンドポイント構成より伸びる可能性がある（トレードオフとして受け入れる前提。詳細は `.notes/api-endpoint-split-roadmap.md` の設計経緯を参照）
5. 不在3時間未満の場合はどのエンドポイントも呼ばず、直前に表示していた mood/perception をそのまま維持する（固定デフォルト値を返す挙動は廃止）

## ビルド・デプロイ

```bash
npm run build
# esbuild src/handlers/eventResolver.ts src/handlers/actionPlanner.ts src/handlers/emotionUpdater.ts \
#   src/handlers/memoryRetriever.ts src/handlers/dialogueGenerator.ts \
#   --bundle --platform=node --target=node20 --format=esm \
#   --outdir=dist --out-extension:.js=.mjs --external:@aws-sdk/* --loader:.mustache=text
```

- `.mustache` テンプレートはテキストとしてバンドルに含まれる
- `@aws-sdk/*` は Lambda ランタイムに含まれるため外部化

`develop` ブランチへの push で stg へ自動デプロイ: `npm ci` → `npx tsc --noEmit` → `npm run build` → `npx cdk deploy`（詳細は [CLAUDE.md](../CLAUDE.md) のコマンド節を参照）。

## 依存パッケージ

| パッケージ | 用途 |
|-----------|------|
| `@aws-sdk/client-bedrock-runtime` | Bedrock Converse API クライアント |
| `@aws-sdk/client-dynamodb` | DynamoDB 低レベルクライアント |
| `@aws-sdk/lib-dynamodb` | DynamoDB ドキュメントクライアント |
| `mustache` | プロンプトテンプレートエンジン |
| `@types/mustache`, `@types/node`, `esbuild`, `typescript`（開発依存） | 型定義・ビルドツール |

## 設計意図と現状のギャップ（未実装）

企画当初のドキュメントには書かれていたが、現在のコードには反映されていない設計意図。詳細と優先度は [`.notes/_followup.md`](../.notes/_followup.md) を参照。

- **AI障害時のフォールバック**: 「Bedrock 呼び出し失敗時はデフォルトのテキストを返す」という設計意図があったが、実装は各 `handlers/*.ts` が例外を捕捉して 500 エラーを返すのみで、固定文言へのフォールバックは無い。
- **記憶の重要度減衰**: 「最近の出来事ほど強く、時系列が遠くなるほど影響度を弱め、閾値を超えたら参照しない」という設計意図があったが、`lib/dynamo.ts` の `getMemories()` は減衰計算や件数・重要度による足切りをせず、該当キャラクターの記憶を全件返すのみ。

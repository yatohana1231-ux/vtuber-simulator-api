import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";
import { ApiEntrance } from "./api-entrance";

// -------------------------------------------------------
// スタックプロパティ
// -------------------------------------------------------

export interface VtuberSimulatorStackProps extends cdk.StackProps {
  /** デプロイステージ名（例: stg, prod）*/
  stageName: string;
}

// -------------------------------------------------------
// エンドポイント定義
//
// 機能（absenceSimulator/emotionUpdater/memoryRetriever/
// dialogueGenerator）ごとに独立した Lambda + API Gateway リソースを持つ。
// オーケストレーション（どの順で呼ぶか）はフロント側の責務になったため、
// バックエンドは各機能を単独で呼び出せる薄いエンドポイント群になる。
// 4関数とも esbuild が dist/ に出力する同一アセットを共有し、
// handler プロパティだけを関数ごとに変える。
// -------------------------------------------------------

// "read"/"write"/"readwrite" は grantReadData/grantWriteData/grantReadWriteData の
// ショートハンド（DeleteItem・UpdateItem・BatchWriteItem・Scan なども含まれる）。
// 実際に使う操作だけに絞りたい場合は { actions: [...] } で dynamodb:* のアクション名を
// 直接指定する（table.grant(fn, ...actions) を使う。GSI を持つテーブルでは自動的に
// `${tableArn}/index/*` もリソースに含まれる）。
type TableAccess = "read" | "write" | "readwrite" | { actions: string[] };

interface EndpointDef {
  id: string; // CDK construct id の接頭辞
  fileBaseName: string; // dist/<fileBaseName>.mjs（esbuild のエントリポイント名と一致）
  resourcePath: string; // API Gateway のパス（kebab-case）
  bedrockModelId: string; // Lambda の環境変数 BEDROCK_MODEL_ID に設定するモデルID（D-024: 機能ごとにモデルを使い分ける）
  tables: {
    characterMemory?: TableAccess;
    conversationLogs?: TableAccess;
    events?: TableAccess;
  };
}

const ENDPOINTS: EndpointDef[] = [
  {
    id: "AbsenceSimulator",
    fileBaseName: "absenceSimulator",
    resourcePath: "absence-simulator",
    // D-024: 不在期間シミュレーションは Claude Haiku 4.5 を使用
    bedrockModelId: "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    tables: {
      // キャラクター記憶テーブル: 重要記憶の読み出し（getRelevantMemories、Query）、
      // 最新の不在期間の記録の読み出し（getLatestAbsenceRecord、GetItem）と
      // 書き込み（saveAbsenceRecord の TransactWriteItems 内の Put、PutItem）。
      characterMemory: { actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"] },
      // イベントテーブル: 記録の保存（saveAbsenceRecord の TransactWriteItems 内の Put、
      // PutItem）と、GSI characterId-index での直近の記録の読み出し
      // （getRecentAbsenceRecords、Query。D-019）。
      events: { actions: ["dynamodb:PutItem", "dynamodb:Query"] },
    },
  },
  {
    id: "EmotionUpdater",
    fileBaseName: "emotionUpdater",
    resourcePath: "emotion-updater",
    // D-024: 感情更新は Amazon Nova Lite を使用
    bedrockModelId: "apac.amazon.nova-lite-v1:0",
    tables: { characterMemory: "readwrite" },
  },
  {
    id: "MemoryRetriever",
    fileBaseName: "memoryRetriever",
    resourcePath: "memory-retriever",
    // D-024: 記憶の重要度判定は Amazon Nova 2 Lite を使用
    bedrockModelId: "jp.amazon.nova-2-lite-v1:0",
    tables: { characterMemory: "readwrite", conversationLogs: "readwrite" },
  },
  {
    id: "DialogueGenerator",
    fileBaseName: "dialogueGenerator",
    resourcePath: "dialogue-generator",
    // D-024: 対話生成は Claude Haiku 4.5 を使用
    bedrockModelId: "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    tables: {
      // キャラクター記憶テーブル: 感情状態・最新の不在期間の記録・関係の記録の読み出し
      // （getCharacterState / getLatestAbsenceRecord / getRelationshipRecord、GetItem）、
      // 重要記憶の読み出し（getRelevantMemories、Query）、関係の記録と節目の記憶の保存
      // （saveRelationshipRecord / saveMemory、PutItem。D-033）。
      characterMemory: { actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"] },
      conversationLogs: "readwrite",
    },
  },
];

function grantTableAccess(
  table: dynamodb.ITable,
  access: TableAccess | undefined,
  fn: lambda.Function
): void {
  if (access === undefined) return;
  if (access === "read") table.grantReadData(fn);
  else if (access === "write") table.grantWriteData(fn);
  else if (access === "readwrite") table.grantReadWriteData(fn);
  else table.grant(fn, ...access.actions);
}

// -------------------------------------------------------
// スタック
// -------------------------------------------------------

export class VtuberSimulatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VtuberSimulatorStackProps) {
    super(scope, id, props);

    const { stageName } = props;

    // api-access-control-roadmap.md フェーズ3: CORS はフロントのオリジンだけを許可する。
    // ステージがコンテキストに無ければ、黙って全許可に戻さずデプロイを止める。
    const corsAllowedOriginsByStage = this.node.tryGetContext("corsAllowedOrigins") as
      | Record<string, string[]>
      | undefined;
    const allowedOrigins = corsAllowedOriginsByStage?.[stageName];
    if (!allowedOrigins || allowedOrigins.length === 0) {
      throw new Error(
        `cdk.json の context.corsAllowedOrigins にステージ "${stageName}" の許可オリジンが設定されていません。`
      );
    }

    // API キー（とシークレット）の版。未定義のステージは 1（導入前と同じ ID・名前）
    // とみなす（tester-character-ownership-roadmap.md 検討事項7）。
    const apiKeyVersionByStage = this.node.tryGetContext("apiKeyVersion") as
      | Record<string, number>
      | undefined;
    const apiKeyVersion = apiKeyVersionByStage?.[stageName] ?? 1;

    // キャラクターの持ち主の確認（tester-character-ownership-roadmap.md フェーズ3・4）。
    // cdk.json の context.enforceCharacterOwnership[stageName] が true のときだけ
    // 有効にする。未定義のステージ・false は文字列 "false"（段階的に有効にするため、
    // 黙って無効のままデプロイできる。フェーズ5の方針）。
    const enforceCharacterOwnershipByStage = this.node.tryGetContext(
      "enforceCharacterOwnership"
    ) as Record<string, boolean> | undefined;
    const enforceCharacterOwnership =
      enforceCharacterOwnershipByStage?.[stageName] === true ? "true" : "false";

    // -------------------------------------------------------
    // 既存リソースをインポート
    // -------------------------------------------------------

    // 既存: 会話ログテーブル
    const conversationLogsTable = dynamodb.Table.fromTableArn(
      this,
      "ConversationLogsTable",
      `arn:aws:dynamodb:ap-northeast-1:${this.account}:table/vtuber-simu-conversation-log-${stageName}`
    );

    // 既存: キャラクター記憶テーブル
    const characterMemoryTable = dynamodb.Table.fromTableArn(
      this,
      "CharacterMemoryTable",
      `arn:aws:dynamodb:ap-northeast-1:${this.account}:table/v-simu-characters-memory-${stageName}`
    );

    // -------------------------------------------------------
    // 新規: events テーブル
    // -------------------------------------------------------

    const eventsTable = new dynamodb.Table(this, "EventsTable", {
      tableName: `v-simu-events-${stageName}`,
      partitionKey: {
        name: "event_id",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        stageName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // characterId でクエリできるよう GSI を追加
    eventsTable.addGlobalSecondaryIndex({
      indexName: "characterId-index",
      partitionKey: {
        name: "characterId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: dynamodb.AttributeType.STRING,
      },
    });

    // -------------------------------------------------------
    // 新規: テスターのキャラクターテーブル
    // （tester-character-ownership-roadmap.md フェーズ4。パーティションキー
    // tester_id・ソートキー character_id で1テスターの1キャラクターを表す。
    // GSI は持たない）
    // -------------------------------------------------------

    const testerCharactersTable = new dynamodb.Table(this, "TesterCharactersTable", {
      tableName: `v-simu-tester-characters-${stageName}`,
      partitionKey: {
        name: "tester_id",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "character_id",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        stageName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------
    // 共有アセット（esbuild が dist/ に機能ごとの .mjs を出力する）
    // -------------------------------------------------------

    const lambdaCode = lambda.Code.fromAsset(
      path.join(__dirname, "..", "..", "dist")
    );

    // -------------------------------------------------------
    // API Gateway（機能ごとのリソースをまとめる REST API）
    // -------------------------------------------------------

    const api = new apigateway.RestApi(this, "VtuberSimulatorApi", {
      restApiName: `vtuber-simu-api-${stageName}`,
      description: "VTuber Simulator API（機能別エンドポイント）",
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName,
      },
    });

    // -------------------------------------------------------
    // Lambda 関数 + API リソース（機能ごと）
    // -------------------------------------------------------

    for (const endpoint of ENDPOINTS) {
      const fn = new lambda.Function(this, `${endpoint.id}Lambda`, {
        functionName: `vtuber-simu-${endpoint.resourcePath}-${stageName}`,
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: `${endpoint.fileBaseName}.handler`,
        code: lambdaCode,
        timeout: cdk.Duration.seconds(120),
        memorySize: 512,
        // ロググループの保持期間を30日に設定する（デフォルトは無期限。
        // tester-character-ownership-roadmap.md 検討事項7）。ロググループは
        // 既存のものがあるため、新規作成する logGroup プロパティではなく、
        // 既存のロググループに保持期間を設定する logRetention を使う。
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          BEDROCK_MODEL_ID: endpoint.bedrockModelId,
          CHARACTER_MEMORY_TABLE: characterMemoryTable.tableArn,
          CONVERSATION_LOGS_TABLE: conversationLogsTable.tableArn,
          EVENTS_TABLE: eventsTable.tableName,
          // キャラクターの持ち主の確認（tester-character-ownership-roadmap.md フェーズ3・4）
          TESTER_CHARACTERS_TABLE: testerCharactersTable.tableName,
          ENFORCE_CHARACTER_OWNERSHIP: enforceCharacterOwnership,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
        },
      });

      // DynamoDB アクセス権限（実際に使うテーブルのみ最小権限で付与）
      grantTableAccess(characterMemoryTable, endpoint.tables.characterMemory, fn);
      grantTableAccess(conversationLogsTable, endpoint.tables.conversationLogs, fn);
      grantTableAccess(eventsTable, endpoint.tables.events, fn);
      // テスターのキャラクターテーブル: 持ち主の確認（getTesterCharacter、GetItem）のみ
      testerCharactersTable.grant(fn, "dynamodb:GetItem");

      // Bedrock 呼び出し権限（全関数共通）
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          resources: ["*"],
        })
      );

      const integration = new apigateway.LambdaIntegration(fn, {
        timeout: cdk.Duration.seconds(29),
      });
      const resource = api.root.addResource(endpoint.resourcePath);
      resource.addMethod("POST", integration, { apiKeyRequired: true });

      new cdk.CfnOutput(this, `${endpoint.id}Endpoint`, {
        value: `${api.url}${endpoint.resourcePath}`,
        description: `${endpoint.id} API Endpoint`,
      });
    }

    // -------------------------------------------------------
    // 新規: テスターのキャラクター一覧・作成 Lambda（GET/POST /characters）
    //
    // 既存の4つの Lambda（ENDPOINTS のループ）とは形が異なる（Bedrock を呼ばない、
    // GET/POST の2メソッドを1つの Lambda で扱う、アクセスするテーブルも
    // テスターのキャラクターテーブルだけ）ため、ループには含めず個別に定義する
    // （ループに条件分岐を足すより差分が小さいため。tester-character-ownership-
    // roadmap.md フェーズ4）。
    // -------------------------------------------------------

    const testerCharactersFn = new lambda.Function(this, "TesterCharactersLambda", {
      functionName: `vtuber-simu-tester-characters-${stageName}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "testerCharacters.handler",
      code: lambdaCode,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      // 他の4つの Lambda と同じ理由で logRetention を使う（上記コメント参照）
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        TESTER_CHARACTERS_TABLE: testerCharactersTable.tableName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
      },
    });

    // 一覧（listTesterCharacters、Query）と作成（createTesterCharacter、PutItem）
    // のみ使う。GetItem は使っていないので付けない（最小権限）。
    testerCharactersTable.grant(testerCharactersFn, "dynamodb:Query", "dynamodb:PutItem");

    const testerCharactersIntegration = new apigateway.LambdaIntegration(testerCharactersFn, {
      timeout: cdk.Duration.seconds(29),
    });
    const charactersResource = api.root.addResource("characters");
    charactersResource.addMethod("GET", testerCharactersIntegration, { apiKeyRequired: true });
    charactersResource.addMethod("POST", testerCharactersIntegration, { apiKeyRequired: true });

    new cdk.CfnOutput(this, "TesterCharactersEndpoint", {
      value: `${api.url}characters`,
      description: "テスターのキャラクター一覧・作成 API Endpoint",
    });

    // -------------------------------------------------------
    // 新規: デバッグ専用 Lambda（POST /debug-character-state）
    //
    // mood/perception の値を直接指定して状態レコードを書き換える、デバッグ用の
    // エンドポイント（.notes/done/debug-character-state-roadmap.md）。ステージごとに
    // 有効・無効を切り替える（context.enableDebugEndpoints[stageName] === true の
    // ときだけ作る。prod では作らない想定）。Bedrock の権限は持たせないため、
    // 全関数に Bedrock 権限を付与する ENDPOINTS のループには含めない
    // （TesterCharactersLambda と同じ理由）。
    // -------------------------------------------------------

    const enableDebugEndpointsByStage = this.node.tryGetContext("enableDebugEndpoints") as
      | Record<string, boolean>
      | undefined;
    const enableDebugEndpoints = enableDebugEndpointsByStage?.[stageName] === true;

    if (enableDebugEndpoints) {
      const debugCharacterStateFn = new lambda.Function(this, "DebugCharacterStateLambda", {
        functionName: `vtuber-simu-debug-character-state-${stageName}`,
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: "debugCharacterState.handler",
        code: lambdaCode,
        // TesterCharactersLambda と同じ timeout/memory（Bedrock を呼ばない軽量な処理）
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        // 他の Lambda と同じ理由で logRetention を使う（TesterCharactersLambda のコメント参照）
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          CHARACTER_MEMORY_TABLE: characterMemoryTable.tableArn,
          TESTER_CHARACTERS_TABLE: testerCharactersTable.tableName,
          ENFORCE_CHARACTER_OWNERSHIP: enforceCharacterOwnership,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
        },
      });

      // 状態レコードの読み書きのみ（最小権限。Bedrock の権限は付けない）
      characterMemoryTable.grant(debugCharacterStateFn, "dynamodb:GetItem", "dynamodb:PutItem");
      // 持ち主の確認のみ（GetItem のみ。Query・PutItem は無い）
      testerCharactersTable.grant(debugCharacterStateFn, "dynamodb:GetItem");

      const debugCharacterStateIntegration = new apigateway.LambdaIntegration(
        debugCharacterStateFn,
        { timeout: cdk.Duration.seconds(29) }
      );
      const debugCharacterStateResource = api.root.addResource("debug-character-state");
      debugCharacterStateResource.addMethod("POST", debugCharacterStateIntegration, {
        apiKeyRequired: true,
      });

      new cdk.CfnOutput(this, "DebugCharacterStateEndpoint", {
        value: `${api.url}debug-character-state`,
        description: "デバッグ専用: mood/perception を書き換える API Endpoint（有効なステージのみ）",
      });
    }

    // -------------------------------------------------------
    // API 専用の CloudFront（Basic 認証・API キー付与・CORS の絞り込み）
    // api-access-control-roadmap.md フェーズ3
    // -------------------------------------------------------

    const apiEntrance = new ApiEntrance(this, "ApiEntrance", {
      api,
      stageName,
      allowedOrigins,
      apiKeyVersion,
    });

    // -------------------------------------------------------
    // Outputs
    // -------------------------------------------------------

    new cdk.CfnOutput(this, "EventsTableName", {
      value: eventsTable.tableName,
      description: "Events DynamoDB Table Name",
    });

    new cdk.CfnOutput(this, "TesterCharactersTableName", {
      value: testerCharactersTable.tableName,
      description: "Tester Characters DynamoDB Table Name",
    });

    new cdk.CfnOutput(this, "ApiEntranceUrl", {
      value: `https://${apiEntrance.distribution.distributionDomainName}`,
      description: "API 専用 CloudFront の URL（フロントが呼び出す唯一の入口）",
    });

    new cdk.CfnOutput(this, "TesterKeyValueStoreArn", {
      value: apiEntrance.keyValueStore.keyValueStoreArn,
      description: "テスターの資格情報を保持する KeyValueStore の ARN",
    });
  }
}

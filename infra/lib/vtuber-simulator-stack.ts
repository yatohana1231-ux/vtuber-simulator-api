import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
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
    tables: { characterMemory: "read", conversationLogs: "readwrite" },
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
        environment: {
          BEDROCK_MODEL_ID: endpoint.bedrockModelId,
          CHARACTER_MEMORY_TABLE: characterMemoryTable.tableArn,
          CONVERSATION_LOGS_TABLE: conversationLogsTable.tableArn,
          EVENTS_TABLE: eventsTable.tableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
        },
      });

      // DynamoDB アクセス権限（実際に使うテーブルのみ最小権限で付与）
      grantTableAccess(characterMemoryTable, endpoint.tables.characterMemory, fn);
      grantTableAccess(conversationLogsTable, endpoint.tables.conversationLogs, fn);
      grantTableAccess(eventsTable, endpoint.tables.events, fn);

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
    // API 専用の CloudFront（Basic 認証・API キー付与・CORS の絞り込み）
    // api-access-control-roadmap.md フェーズ3
    // -------------------------------------------------------

    const apiEntrance = new ApiEntrance(this, "ApiEntrance", {
      api,
      stageName,
      allowedOrigins,
    });

    // -------------------------------------------------------
    // Outputs
    // -------------------------------------------------------

    new cdk.CfnOutput(this, "EventsTableName", {
      value: eventsTable.tableName,
      description: "Events DynamoDB Table Name",
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

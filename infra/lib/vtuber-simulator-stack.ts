import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

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
// 機能（eventResolver/actionPlanner/emotionUpdater/memoryRetriever/
// dialogueGenerator）ごとに独立した Lambda + API Gateway リソースを持つ。
// オーケストレーション（どの順で呼ぶか）はフロント側の責務になったため、
// バックエンドは各機能を単独で呼び出せる薄いエンドポイント群になる。
// 5関数とも esbuild が dist/ に出力する同一アセットを共有し、
// handler プロパティだけを関数ごとに変える。
// -------------------------------------------------------

type TableAccess = "read" | "write" | "readwrite";

interface EndpointDef {
  id: string; // CDK construct id の接頭辞
  fileBaseName: string; // dist/<fileBaseName>.mjs（esbuild のエントリポイント名と一致）
  resourcePath: string; // API Gateway のパス（kebab-case）
  tables: {
    characterMemory?: TableAccess;
    conversationLogs?: TableAccess;
    events?: TableAccess;
  };
}

const ENDPOINTS: EndpointDef[] = [
  {
    id: "EventResolver",
    fileBaseName: "eventResolver",
    resourcePath: "event-resolver",
    tables: { characterMemory: "read", events: "write" },
  },
  {
    id: "ActionPlanner",
    fileBaseName: "actionPlanner",
    resourcePath: "action-planner",
    tables: { characterMemory: "read" },
  },
  {
    id: "EmotionUpdater",
    fileBaseName: "emotionUpdater",
    resourcePath: "emotion-updater",
    tables: { characterMemory: "readwrite" },
  },
  {
    id: "MemoryRetriever",
    fileBaseName: "memoryRetriever",
    resourcePath: "memory-retriever",
    tables: { characterMemory: "readwrite", conversationLogs: "readwrite" },
  },
  {
    id: "DialogueGenerator",
    fileBaseName: "dialogueGenerator",
    resourcePath: "dialogue-generator",
    tables: { characterMemory: "read", conversationLogs: "readwrite" },
  },
];

function grantTableAccess(
  table: dynamodb.ITable,
  access: TableAccess | undefined,
  fn: lambda.Function
): void {
  if (access === "read") table.grantReadData(fn);
  else if (access === "write") table.grantWriteData(fn);
  else if (access === "readwrite") table.grantReadWriteData(fn);
}

// -------------------------------------------------------
// スタック
// -------------------------------------------------------

export class VtuberSimulatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VtuberSimulatorStackProps) {
    super(scope, id, props);

    const { stageName } = props;

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
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
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
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: `${endpoint.fileBaseName}.handler`,
        code: lambdaCode,
        timeout: cdk.Duration.seconds(120),
        memorySize: 512,
        environment: {
          BEDROCK_MODEL_ID: "apac.amazon.nova-lite-v1:0",
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
      resource.addMethod("POST", integration);

      new cdk.CfnOutput(this, `${endpoint.id}Endpoint`, {
        value: `${api.url}${endpoint.resourcePath}`,
        description: `${endpoint.id} API Endpoint`,
      });
    }

    // -------------------------------------------------------
    // Outputs
    // -------------------------------------------------------

    new cdk.CfnOutput(this, "EventsTableName", {
      value: eventsTable.tableName,
      description: "Events DynamoDB Table Name",
    });
  }
}

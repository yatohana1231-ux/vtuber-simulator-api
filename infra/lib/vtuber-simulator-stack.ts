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
    // Lambda 関数
    // -------------------------------------------------------

    const chatLambda = new lambda.Function(this, "ChatLambda", {
      functionName: `vtuber-simu-chat-${stageName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      // esbuild でバンドルしたファイルを dist/ に出力してからデプロイする
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "..", "dist")
      ),
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

    // -------------------------------------------------------
    // IAM ポリシー
    // -------------------------------------------------------

    // DynamoDB アクセス権限
    conversationLogsTable.grantReadWriteData(chatLambda);
    characterMemoryTable.grantReadWriteData(chatLambda);
    eventsTable.grantReadWriteData(chatLambda);

    // Bedrock 呼び出し権限
    chatLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["*"],
      })
    );

    // -------------------------------------------------------
    // API Gateway（既存をインポートして Lambda 統合を追加）
    // -------------------------------------------------------

    // 既存の REST API を参照する場合は fromRestApiId を使う。
    // ここでは新規作成として定義する（既存 API への統合はコンソールまたは別途設定）。
    const api = new apigateway.RestApi(this, "ChatApi", {
      restApiName: `vtuber-simu-api-${stageName}`,
      description: "VTuber Simulator Chat API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName,
      },
    });

    const chatIntegration = new apigateway.LambdaIntegration(chatLambda, {
      timeout: cdk.Duration.seconds(29),
    });

    // POST /chat
    const chatResource = api.root.addResource("chat");
    chatResource.addMethod("POST", chatIntegration);

    // -------------------------------------------------------
    // Outputs
    // -------------------------------------------------------

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: `${api.url}chat`,
      description: "Chat API Endpoint",
    });

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: chatLambda.functionName,
      description: "Chat Lambda Function Name",
    });

    new cdk.CfnOutput(this, "EventsTableName", {
      value: eventsTable.tableName,
      description: "Events DynamoDB Table Name",
    });
  }
}

import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { VtuberSimulatorStack } from "../lib/vtuber-simulator-stack";

// tester-character-ownership-roadmap.md フェーズ4。
// テスターのキャラクターテーブル・新しい Lambda（GET/POST /characters）・
// 既存4つの Lambda への環境変数と最小権限の追加・CORS の許可メソッドへの GET 追加・
// 出力2つを CloudFormation テンプレートのアサーションで確認する。
//
// api/dist（Lambda コードのアセット）が無いと lambda.Code.fromAsset が synth
// できないため、このテストの前に `api/` で `npm run build` を実行しておく必要がある
// （../test/api-entrance.test.ts と同じ注意点）。

const STG_ALLOWED_ORIGINS = [
  "https://d35a8wyhb727oo.cloudfront.net",
  "http://localhost:5173",
];

const EXISTING_LAMBDA_LOGICAL_ID_PREFIXES = [
  "AbsenceSimulatorLambda",
  "EmotionUpdaterLambda",
  "MemoryRetrieverLambda",
  "DialogueGeneratorLambda",
];

function synthStgTemplate(enforceCharacterOwnership?: boolean): Template {
  const app = new cdk.App({
    context: {
      corsAllowedOrigins: { stg: STG_ALLOWED_ORIGINS },
      ...(enforceCharacterOwnership !== undefined
        ? { enforceCharacterOwnership: { stg: enforceCharacterOwnership } }
        : {}),
    },
  });
  const stack = new VtuberSimulatorStack(app, "TestStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    stageName: "stg",
  });
  return Template.fromStack(stack);
}

/** 論理IDが与えられたプレフィックスのいずれかで始まるリソースだけを残す */
function filterByLogicalIdPrefix<T>(
  resources: Record<string, T>,
  prefixes: string[]
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(resources).filter(([id]) => prefixes.some((p) => id.startsWith(p)))
  );
}

/**
 * Lambda を作った Construct ID（例: "TesterCharactersLambda"。CDK の synth 時の
 * ハッシュ付き論理ID、例: "TesterCharactersLambdaA550CBD1" とは異なる）から、
 * その実行ロールに紐づく IAM ポリシーを探す。IAM ポリシーの論理ID は CDK の慣習で
 * `${Construct ID}ServiceRoleDefaultPolicy...` になる（Roles プロパティは Ref で
 * ロールの論理IDを指すため、関数の論理IDと直接には結び付かない。命名の慣習に頼る）。
 */
function findPolicyForLambda(template: Template, constructId: string): any {
  const policies = template.findResources("AWS::IAM::Policy");
  const entry = Object.entries(policies).find(([id]) =>
    id.startsWith(`${constructId}ServiceRoleDefaultPolicy`)
  );
  return entry ? entry[1] : undefined;
}

describe("テスターのキャラクターテーブル", () => {
  const template = synthStgTemplate();

  it("パーティションキー tester_id・ソートキー character_id（いずれも string）、オンデマンド課金", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "v-simu-tester-characters-stg",
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "tester_id", KeyType: "HASH" },
        { AttributeName: "character_id", KeyType: "RANGE" },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: "tester_id", AttributeType: "S" },
        { AttributeName: "character_id", AttributeType: "S" },
      ]),
    });
  });

  it("削除時の扱いが既存の events テーブルと同じ規則（stg は DESTROY）", () => {
    const tables = template.findResources("AWS::DynamoDB::Table", {
      Properties: { TableName: "v-simu-tester-characters-stg" },
    });
    const table = Object.values(tables)[0] as any;
    // DESTROY は DeletionPolicy: Delete（RETAIN なら Retain になる）
    expect(table.DeletionPolicy).toBe("Delete");
    expect(table.UpdateReplacePolicy).toBe("Delete");
  });
});

describe("/characters の GET・POST", () => {
  const template = synthStgTemplate();

  it("GET・POST がどちらも ApiKeyRequired: true、Lambda 統合", () => {
    const resources = template.findResources("AWS::ApiGateway::Resource", {
      Properties: { PathPart: "characters" },
    });
    const resourceIds = Object.keys(resources);
    expect(resourceIds).toHaveLength(1);
    const resourceLogicalId = resourceIds[0];

    const methods = template.findResources("AWS::ApiGateway::Method");
    const charactersMethods = Object.values(methods).filter(
      (m: any) => m.Properties.ResourceId?.Ref === resourceLogicalId
    ) as any[];

    const get = charactersMethods.find((m) => m.Properties.HttpMethod === "GET");
    const post = charactersMethods.find((m) => m.Properties.HttpMethod === "POST");
    const options = charactersMethods.find((m) => m.Properties.HttpMethod === "OPTIONS");

    expect(get).toBeDefined();
    expect(get.Properties.ApiKeyRequired).toBe(true);
    expect(get.Properties.Integration.Type).toBe("AWS_PROXY");

    expect(post).toBeDefined();
    expect(post.Properties.ApiKeyRequired).toBe(true);
    expect(post.Properties.Integration.Type).toBe("AWS_PROXY");

    // プリフライトは既存の defaultCorsPreflightOptions のまま（API キー不要）
    expect(options).toBeDefined();
    expect(options.Properties.ApiKeyRequired).toBe(false);
  });
});

describe("新しい Lambda（testerCharacters）", () => {
  const template = synthStgTemplate();

  it("関数名・ハンドラー・ランタイム・メモリ・タイムアウト", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "vtuber-simu-tester-characters-stg",
      Handler: "testerCharacters.handler",
      Runtime: "nodejs24.x",
      MemorySize: 256,
      Timeout: 10,
    });
  });

  it("環境変数は TESTER_CHARACTERS_TABLE のみ（BEDROCK_MODEL_ID は無い）", () => {
    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "testerCharacters.handler" },
    });
    const fn = Object.values(fns)[0] as any;
    const env = fn.Properties.Environment.Variables;
    expect(env.TESTER_CHARACTERS_TABLE).toBeDefined();
    expect(env.BEDROCK_MODEL_ID).toBeUndefined();
    expect(env.ENFORCE_CHARACTER_OWNERSHIP).toBeUndefined();
  });

  it("ロググループの保持期間30日（既存の4つと同じ logRetention）", () => {
    const retentions = template.findResources("Custom::LogRetention", {
      Properties: { RetentionInDays: 30 },
    });
    // 既存4つ + 新しい Lambda で5つ
    expect(Object.keys(retentions)).toHaveLength(5);
  });

  it("Bedrock の権限が無い（bedrock:InvokeModel を含むポリシーが存在しない）", () => {
    const policy = findPolicyForLambda(template, "TesterCharactersLambda");

    if (policy) {
      const statements = policy.Properties.PolicyDocument.Statement as any[];
      for (const s of statements) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        expect(actions.some((a: string) => a.startsWith("bedrock:"))).toBe(false);
      }
    }
  });

  it("テスターのキャラクターテーブルへの権限は Query・PutItem のみ（GetItem は無い）", () => {
    const rolePolicy = findPolicyForLambda(template, "TesterCharactersLambda");

    expect(rolePolicy).toBeDefined();
    const statements = rolePolicy.Properties.PolicyDocument.Statement as any[];
    // dynamodb アクションを含む文が1つだけあり、Query・PutItem のみを含む
    const dynamoStatements = statements.filter((s) => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.some((a: string) => a.startsWith("dynamodb:"));
    });
    expect(dynamoStatements).toHaveLength(1);
    const actions = dynamoStatements[0].Action as string[];
    expect(new Set(actions)).toEqual(new Set(["dynamodb:Query", "dynamodb:PutItem"]));
  });
});

describe("既存4つの Lambda への追加（GetItem・環境変数）", () => {
  const template = synthStgTemplate();

  it("4つとも TESTER_CHARACTERS_TABLE・ENFORCE_CHARACTER_OWNERSHIP を持つ", () => {
    const allFns = template.findResources("AWS::Lambda::Function");
    const fns = filterByLogicalIdPrefix(allFns, EXISTING_LAMBDA_LOGICAL_ID_PREFIXES);
    expect(Object.keys(fns)).toHaveLength(4);

    for (const fn of Object.values(fns) as any[]) {
      const env = fn.Properties.Environment.Variables;
      expect(env.TESTER_CHARACTERS_TABLE).toBeDefined();
      expect(env.ENFORCE_CHARACTER_OWNERSHIP).toBe("false"); // stg のデフォルトは false
    }
  });

  it("テスターのキャラクターテーブルへの権限は GetItem のみ（Query・PutItem は無い）", () => {
    const testerCharactersTables = template.findResources("AWS::DynamoDB::Table", {
      Properties: { TableName: "v-simu-tester-characters-stg" },
    });
    const tableLogicalId = Object.keys(testerCharactersTables)[0];

    for (const constructId of EXISTING_LAMBDA_LOGICAL_ID_PREFIXES) {
      const rolePolicy = findPolicyForLambda(template, constructId);
      expect(rolePolicy).toBeDefined();

      const statements = rolePolicy.Properties.PolicyDocument.Statement as any[];
      const testerCharacterStatements = statements.filter((s) => {
        const resource = JSON.stringify(s.Resource);
        return resource.includes(tableLogicalId);
      });
      expect(testerCharacterStatements).toHaveLength(1);
      const actions = testerCharacterStatements[0].Action;
      const actionList = Array.isArray(actions) ? actions : [actions];
      expect(actionList).toEqual(["dynamodb:GetItem"]);
    }
  });
});

describe("enforceCharacterOwnership（context.enforceCharacterOwnership）", () => {
  it("未定義のステージ → \"false\"", () => {
    const template = synthStgTemplate(undefined);
    const allFns = template.findResources("AWS::Lambda::Function");
    const fns = filterByLogicalIdPrefix(allFns, EXISTING_LAMBDA_LOGICAL_ID_PREFIXES);
    for (const fn of Object.values(fns) as any[]) {
      expect(fn.Properties.Environment.Variables.ENFORCE_CHARACTER_OWNERSHIP).toBe("false");
    }
  });

  it("false → \"false\"", () => {
    const template = synthStgTemplate(false);
    const allFns = template.findResources("AWS::Lambda::Function");
    const fns = filterByLogicalIdPrefix(allFns, EXISTING_LAMBDA_LOGICAL_ID_PREFIXES);
    for (const fn of Object.values(fns) as any[]) {
      expect(fn.Properties.Environment.Variables.ENFORCE_CHARACTER_OWNERSHIP).toBe("false");
    }
  });

  it("true → \"true\"", () => {
    const template = synthStgTemplate(true);
    const allFns = template.findResources("AWS::Lambda::Function");
    const fns = filterByLogicalIdPrefix(allFns, EXISTING_LAMBDA_LOGICAL_ID_PREFIXES);
    for (const fn of Object.values(fns) as any[]) {
      expect(fn.Properties.Environment.Variables.ENFORCE_CHARACTER_OWNERSHIP).toBe("true");
    }
  });
});

describe("CORS の許可メソッドに GET が加わっている", () => {
  it("レスポンスヘッダーポリシーの AccessControlAllowMethods に GET・POST・OPTIONS", () => {
    const template = synthStgTemplate();
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: Match.objectLike({
          AccessControlAllowMethods: {
            Items: ["GET", "POST", "OPTIONS"],
          },
        }),
      }),
    });
  });
});

describe("出力", () => {
  const template = synthStgTemplate();

  it("TesterCharactersTableName・TesterCharactersEndpoint が出力される", () => {
    const outputs = template.findOutputs("TesterCharactersTableName");
    expect(Object.keys(outputs)).toHaveLength(1);

    const endpointOutputs = template.findOutputs("TesterCharactersEndpoint");
    expect(Object.keys(endpointOutputs)).toHaveLength(1);
    const value = JSON.stringify(Object.values(endpointOutputs)[0].Value);
    expect(value).toContain("characters");
  });
});

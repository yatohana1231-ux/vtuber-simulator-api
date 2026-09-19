import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { VtuberSimulatorStack } from "../lib/vtuber-simulator-stack";

// .notes/done/debug-character-state-roadmap.md フェーズ1。
// context.enableDebugEndpoints[stageName] === true のときだけ、デバッグ専用の
// Lambda（POST /debug-character-state）が作られること、Bedrock の権限を持たず
// テーブルへの権限が最小限（characterMemoryTable は GetItem・PutItem、
// testerCharactersTable は GetItem のみ）であることを確認する。
//
// api/dist（Lambda コードのアセット）が無いと lambda.Code.fromAsset が synth
// できないため、このテストの前に `api/` で `npm run build` を実行しておく必要がある
// （../test/tester-characters.test.ts と同じ注意点）。

const STG_ALLOWED_ORIGINS = [
  "https://d35a8wyhb727oo.cloudfront.net",
  "http://localhost:5173",
];

function synthStgTemplate(enableDebugEndpoints?: boolean): Template {
  const app = new cdk.App({
    context: {
      corsAllowedOrigins: { stg: STG_ALLOWED_ORIGINS },
      ...(enableDebugEndpoints !== undefined
        ? { enableDebugEndpoints: { stg: enableDebugEndpoints } }
        : {}),
    },
  });
  const stack = new VtuberSimulatorStack(app, "TestStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    stageName: "stg",
  });
  return Template.fromStack(stack);
}

/**
 * Lambda を作った Construct ID から、その実行ロールに紐づく IAM ポリシーを探す
 * （../test/tester-characters.test.ts の findPolicyForLambda と同じ考え方）。
 */
function findPolicyForLambda(template: Template, constructId: string): any {
  const policies = template.findResources("AWS::IAM::Policy");
  const entry = Object.entries(policies).find(([id]) =>
    id.startsWith(`${constructId}ServiceRoleDefaultPolicy`)
  );
  return entry ? entry[1] : undefined;
}

describe("enableDebugEndpointsが未指定・false → 何も作られない", () => {
  it("未指定 → Lambda・リソース・出力が無い", () => {
    const template = synthStgTemplate(undefined);

    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "debugCharacterState.handler" },
    });
    expect(Object.keys(fns)).toHaveLength(0);

    const resources = template.findResources("AWS::ApiGateway::Resource", {
      Properties: { PathPart: "debug-character-state" },
    });
    expect(Object.keys(resources)).toHaveLength(0);

    const outputs = template.findOutputs("DebugCharacterStateEndpoint");
    expect(Object.keys(outputs)).toHaveLength(0);
  });

  it("false → Lambda・リソース・出力が無い", () => {
    const template = synthStgTemplate(false);

    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "debugCharacterState.handler" },
    });
    expect(Object.keys(fns)).toHaveLength(0);
  });
});

describe("enableDebugEndpoints=true → デバッグ専用の Lambda と API リソースが作られる", () => {
  const template = synthStgTemplate(true);

  it("関数名・ハンドラー・ランタイム・メモリ・タイムアウト（TesterCharactersLambdaと同じ）", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "vtuber-simu-debug-character-state-stg",
      Handler: "debugCharacterState.handler",
      Runtime: "nodejs24.x",
      MemorySize: 256,
      Timeout: 10,
    });
  });

  it("環境変数はCHARACTER_MEMORY_TABLE・TESTER_CHARACTERS_TABLE・ENFORCE_CHARACTER_OWNERSHIP・AWS_NODEJS_CONNECTION_REUSE_ENABLEDのみ（BEDROCK_MODEL_IDは無い）", () => {
    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "debugCharacterState.handler" },
    });
    const fn = Object.values(fns)[0] as any;
    const env = fn.Properties.Environment.Variables;
    expect(env.CHARACTER_MEMORY_TABLE).toBeDefined();
    expect(env.TESTER_CHARACTERS_TABLE).toBeDefined();
    // このテストでは context.enforceCharacterOwnership を渡していないため、
    // 既存4つのLambdaと同じ既定値（未定義 → "false"）になる
    expect(env.ENFORCE_CHARACTER_OWNERSHIP).toBe("false");
    expect(env.AWS_NODEJS_CONNECTION_REUSE_ENABLED).toBe("1");
    expect(env.BEDROCK_MODEL_ID).toBeUndefined();
    expect(env.CONVERSATION_LOGS_TABLE).toBeUndefined();
    expect(env.EVENTS_TABLE).toBeUndefined();
  });

  it("ロググループの保持期間30日（既存5つ + デバッグ用で6つ）", () => {
    const retentions = template.findResources("Custom::LogRetention", {
      Properties: { RetentionInDays: 30 },
    });
    expect(Object.keys(retentions)).toHaveLength(6);
  });

  it("Bedrock の権限が無い", () => {
    const policy = findPolicyForLambda(template, "DebugCharacterStateLambda");

    if (policy) {
      const statements = policy.Properties.PolicyDocument.Statement as any[];
      for (const s of statements) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        expect(actions.some((a: string) => a.startsWith("bedrock:"))).toBe(false);
      }
    }
  });

  it("characterMemoryTableへの権限はGetItem・PutItemのみ", () => {
    const rolePolicy = findPolicyForLambda(template, "DebugCharacterStateLambda");
    expect(rolePolicy).toBeDefined();

    const statements = rolePolicy.Properties.PolicyDocument.Statement as any[];
    const characterMemoryStatements = statements.filter((s) => {
      const resource = JSON.stringify(s.Resource);
      // characterMemoryTable は fromTableArn でインポートしているため、
      // リテラルの ARN 文字列がそのままリソースに入る
      return resource.includes("v-simu-characters-memory-stg");
    });
    expect(characterMemoryStatements).toHaveLength(1);
    const actions = characterMemoryStatements[0].Action as string[];
    expect(new Set(actions)).toEqual(new Set(["dynamodb:GetItem", "dynamodb:PutItem"]));
  });

  it("testerCharactersTableへの権限はGetItemのみ", () => {
    const testerCharactersTables = template.findResources("AWS::DynamoDB::Table", {
      Properties: { TableName: "v-simu-tester-characters-stg" },
    });
    const tableLogicalId = Object.keys(testerCharactersTables)[0];

    const rolePolicy = findPolicyForLambda(template, "DebugCharacterStateLambda");
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
  });

  it("POST /debug-character-state がApiKeyRequired: true、Lambda統合", () => {
    const resources = template.findResources("AWS::ApiGateway::Resource", {
      Properties: { PathPart: "debug-character-state" },
    });
    const resourceIds = Object.keys(resources);
    expect(resourceIds).toHaveLength(1);
    const resourceLogicalId = resourceIds[0];

    const methods = template.findResources("AWS::ApiGateway::Method");
    const matchingMethods = Object.values(methods).filter(
      (m: any) => m.Properties.ResourceId?.Ref === resourceLogicalId
    ) as any[];

    const post = matchingMethods.find((m) => m.Properties.HttpMethod === "POST");
    expect(post).toBeDefined();
    expect(post.Properties.ApiKeyRequired).toBe(true);
    expect(post.Properties.Integration.Type).toBe("AWS_PROXY");
  });

  it("ENDPOINTSの4つには含まれない（debugCharacterState.handlerというLambdaは1つだけ）", () => {
    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "debugCharacterState.handler" },
    });
    expect(Object.keys(fns)).toHaveLength(1);
  });

  it("DebugCharacterStateEndpointが出力される", () => {
    const outputs = template.findOutputs("DebugCharacterStateEndpoint");
    expect(Object.keys(outputs)).toHaveLength(1);
    const value = JSON.stringify(Object.values(outputs)[0].Value);
    expect(value).toContain("debug-character-state");
  });
});

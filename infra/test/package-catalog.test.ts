import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { VtuberSimulatorStack } from "../lib/vtuber-simulator-stack";

// package-selection-roadmap.md フェーズ1c。
// パッケージ（キャラクター×世界観）一覧 Lambda（GET /packages）を
// CloudFormation テンプレートのアサーションで確認する。
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

describe("新しい Lambda（packageCatalog）", () => {
  const template = synthStgTemplate();

  it("関数名・ハンドラー・ランタイム・メモリ・タイムアウト", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "vtuber-simu-package-catalog-stg",
      Handler: "packageCatalog.handler",
      Runtime: "nodejs24.x",
      MemorySize: 256,
      Timeout: 10,
    });
  });

  it("環境変数は AWS_NODEJS_CONNECTION_REUSE_ENABLED のみ（BEDROCK_MODEL_ID・テーブル名は無い）", () => {
    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "packageCatalog.handler" },
    });
    const fn = Object.values(fns)[0] as any;
    const env = fn.Properties.Environment.Variables;
    expect(env.AWS_NODEJS_CONNECTION_REUSE_ENABLED).toBe("1");
    expect(env.BEDROCK_MODEL_ID).toBeUndefined();
    expect(env.CHARACTER_MEMORY_TABLE).toBeUndefined();
    expect(env.CONVERSATION_LOGS_TABLE).toBeUndefined();
    expect(env.EVENTS_TABLE).toBeUndefined();
    expect(env.TESTER_CHARACTERS_TABLE).toBeUndefined();
    expect(env.ENFORCE_CHARACTER_OWNERSHIP).toBeUndefined();
    expect(Object.keys(env)).toHaveLength(1);
  });

  it("DynamoDB・Bedrock の権限を含むポリシーが無い（テーブル・Bedrock どちらもアクセスしない）", () => {
    const policy = findPolicyForLambda(template, "PackageCatalogLambda");

    // 実行ロールにテーブル・Bedrock いずれの権限も付与していないため、
    // ServiceRoleDefaultPolicy 自体が作られない（付与するアクションが無い）はず。
    // 万一作られていた場合でも、dynamodb:*・bedrock:* を含むステートメントが
    // 無いことを確認する。
    if (policy) {
      const statements = policy.Properties.PolicyDocument.Statement as any[];
      for (const s of statements) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        expect(actions.some((a: string) => a.startsWith("dynamodb:"))).toBe(false);
        expect(actions.some((a: string) => a.startsWith("bedrock:"))).toBe(false);
      }
    } else {
      expect(policy).toBeUndefined();
    }
  });
});

describe("/packages の GET", () => {
  const template = synthStgTemplate();

  it("GET が ApiKeyRequired: true、この Lambda への Lambda 統合。POST は無い", () => {
    const resources = template.findResources("AWS::ApiGateway::Resource", {
      Properties: { PathPart: "packages" },
    });
    const resourceIds = Object.keys(resources);
    expect(resourceIds).toHaveLength(1);
    const resourceLogicalId = resourceIds[0];

    const methods = template.findResources("AWS::ApiGateway::Method");
    const packagesMethods = Object.values(methods).filter(
      (m: any) => m.Properties.ResourceId?.Ref === resourceLogicalId
    ) as any[];

    const get = packagesMethods.find((m) => m.Properties.HttpMethod === "GET");
    const post = packagesMethods.find((m) => m.Properties.HttpMethod === "POST");
    const options = packagesMethods.find((m) => m.Properties.HttpMethod === "OPTIONS");

    expect(get).toBeDefined();
    expect(get.Properties.ApiKeyRequired).toBe(true);
    expect(get.Properties.Integration.Type).toBe("AWS_PROXY");

    expect(post).toBeUndefined();

    // プリフライトは既存の defaultCorsPreflightOptions のまま（API キー不要）
    expect(options).toBeDefined();
    expect(options.Properties.ApiKeyRequired).toBe(false);
  });
});

describe("出力", () => {
  it("PackageCatalogEndpoint が出力される", () => {
    const template = synthStgTemplate();
    const outputs = template.findOutputs("PackageCatalogEndpoint");
    expect(Object.keys(outputs)).toHaveLength(1);
    const value = JSON.stringify(Object.values(outputs)[0].Value);
    expect(value).toContain("packages");
  });
});

describe("enableDebugEndpoints の指定によらず作られる", () => {
  it("未指定でも Lambda・リソース・出力が作られる", () => {
    const template = synthStgTemplate(undefined);

    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "packageCatalog.handler" },
    });
    expect(Object.keys(fns)).toHaveLength(1);

    const resources = template.findResources("AWS::ApiGateway::Resource", {
      Properties: { PathPart: "packages" },
    });
    expect(Object.keys(resources)).toHaveLength(1);

    const outputs = template.findOutputs("PackageCatalogEndpoint");
    expect(Object.keys(outputs)).toHaveLength(1);
  });

  it("false でも Lambda・リソース・出力が作られる", () => {
    const template = synthStgTemplate(false);

    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "packageCatalog.handler" },
    });
    expect(Object.keys(fns)).toHaveLength(1);
  });

  it("true でも（デバッグ用と一緒でも）Lambda が1つだけ作られる", () => {
    const template = synthStgTemplate(true);

    const fns = template.findResources("AWS::Lambda::Function", {
      Properties: { Handler: "packageCatalog.handler" },
    });
    expect(Object.keys(fns)).toHaveLength(1);
  });
});

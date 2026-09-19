import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { VtuberSimulatorStack } from "../lib/vtuber-simulator-stack";

// api-access-control-roadmap.md フェーズ3。
// ApiEntrance（CloudFront・CloudFront Function・KeyValueStore・
// レスポンスヘッダーポリシー・Secrets Manager・API キー/使用量プラン）と、
// VtuberSimulatorStack 側の変更（apiKeyRequired・CORS の絞り込み）を
// CloudFormation テンプレートのアサーションで確認する。
//
// api/dist（Lambda コードのアセット）が無いと lambda.Code.fromAsset が
// synth できないため、このテストの前に `api/` で `npm run build` を実行しておく必要がある。

const STG_ALLOWED_ORIGINS = [
  "https://d35a8wyhb727oo.cloudfront.net",
  "http://localhost:5173",
];

function synthStgTemplate(apiKeyVersion?: number): Template {
  const app = new cdk.App({
    context: {
      corsAllowedOrigins: { stg: STG_ALLOWED_ORIGINS },
      ...(apiKeyVersion !== undefined ? { apiKeyVersion: { stg: apiKeyVersion } } : {}),
    },
  });
  const stack = new VtuberSimulatorStack(app, "TestStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    stageName: "stg",
  });
  return Template.fromStack(stack);
}

describe("ApiEntrance / VtuberSimulatorStack のアクセス制限", () => {
  const template = synthStgTemplate();

  it("5つの POST（既存4つ + /characters）が ApiKeyRequired: true、OPTIONS は API キー不要", () => {
    const methods = template.findResources("AWS::ApiGateway::Method");
    const postMethods = Object.values(methods).filter(
      (m: any) => m.Properties.HttpMethod === "POST"
    );
    const optionsMethods = Object.values(methods).filter(
      (m: any) => m.Properties.HttpMethod === "OPTIONS"
    );

    // 既存4つ（absence-simulator・emotion-updater・memory-retriever・
    // dialogue-generator）+ /characters（tester-character-ownership-roadmap.md フェーズ4）
    expect(postMethods).toHaveLength(5);
    for (const m of postMethods as any[]) {
      expect(m.Properties.ApiKeyRequired).toBe(true);
    }

    expect(optionsMethods.length).toBeGreaterThan(0);
    for (const m of optionsMethods as any[]) {
      expect(m.Properties.ApiKeyRequired).toBe(false);
    }
  });

  it("使用量プランのスロットル・クォータと API キーの紐付け", () => {
    template.hasResourceProperties("AWS::ApiGateway::UsagePlan", {
      Throttle: { RateLimit: 5, BurstLimit: 10 },
      Quota: { Limit: 5000, Period: "DAY" },
    });

    // UsagePlanKey が API キーを使用量プランに関連付けている
    template.hasResourceProperties("AWS::ApiGateway::UsagePlanKey", {
      KeyType: "API_KEY",
    });
  });

  it("Secrets Manager のシークレットが 32文字・記号なしで生成される", () => {
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "vtuber-simu-api-key-stg",
      GenerateSecretString: {
        PasswordLength: 32,
        ExcludePunctuation: true,
        IncludeSpace: false,
      },
    });
  });

  it("API キーの値とディストリビューションのカスタムヘッダーがどちらも Secrets Manager の動的参照", () => {
    template.hasResourceProperties("AWS::ApiGateway::ApiKey", {
      Value: Match.objectLike({
        "Fn::Join": Match.arrayWith([
          Match.arrayWith([
            Match.stringLikeRegexp("^\\{\\{resolve:secretsmanager:"),
          ]),
        ]),
      }),
    });

    const distributions = template.findResources("AWS::CloudFront::Distribution");
    const distProps = Object.values(distributions)[0] as any;
    const origin = distProps.Properties.DistributionConfig.Origins[0];
    const headerValue = origin.OriginCustomHeaders[0].HeaderValue;
    // Fn::Join でつなげた文字列に動的参照の断片が含まれる（平文の値は含まれない）
    const templateJson = JSON.stringify(headerValue);
    expect(templateJson).toContain("{{resolve:secretsmanager:");

    // テンプレート全体に平文の32文字シークレット値が literal に出てこないこと
    // （動的参照は Fn::Join の断片としてのみ現れる）
    const fullTemplate = JSON.stringify(template.toJSON());
    const plainSecretPattern = /"Value":"[A-Za-z0-9]{32}"/;
    expect(fullTemplate).not.toMatch(plainSecretPattern);
  });

  it("CloudFront Function が JS 2.0 で KVS に関連付き、プレースホルダーが残っておらず許可オリジンが入っている", () => {
    const fns = template.findResources("AWS::CloudFront::Function");
    const fnEntries = Object.values(fns) as any[];
    expect(fnEntries).toHaveLength(1);

    const fn = fnEntries[0];
    expect(fn.Properties.FunctionConfig.Runtime).toBe("cloudfront-js-2.0");
    expect(fn.Properties.FunctionConfig.KeyValueStoreAssociations).toBeDefined();
    expect(fn.Properties.FunctionConfig.KeyValueStoreAssociations.length).toBe(1);

    const code: string = fn.Properties.FunctionCode;
    expect(code).not.toContain("__ALLOWED_ORIGINS__");
    for (const origin of STG_ALLOWED_ORIGINS) {
      expect(code).toContain(origin);
    }
  });

  it("KeyValueStore が作られている", () => {
    template.hasResourceProperties("AWS::CloudFront::KeyValueStore", {
      Name: "vtuber-simu-testers-stg",
    });
  });

  it("レスポンスヘッダーポリシーの CORS（許可先・originOverride）", () => {
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: Match.objectLike({
          AccessControlAllowOrigins: {
            Items: STG_ALLOWED_ORIGINS,
          },
          AccessControlAllowHeaders: {
            Items: ["Authorization", "Content-Type"],
          },
          AccessControlAllowMethods: {
            // GET: /characters（一覧）。tester-character-ownership-roadmap.md フェーズ4
            Items: ["GET", "POST", "OPTIONS"],
          },
          AccessControlAllowCredentials: false,
          OriginOverride: true,
        }),
      }),
    });
  });

  it("ビヘイビア: HTTPS のみ・ALLOW_ALL・キャッシュ無効・viewer request の関数が紐付いている", () => {
    const distributions = template.findResources("AWS::CloudFront::Distribution");
    const distProps = Object.values(distributions)[0] as any;
    const behavior = distProps.Properties.DistributionConfig.DefaultCacheBehavior;

    expect(behavior.ViewerProtocolPolicy).toBe("https-only");
    expect(behavior.AllowedMethods.sort()).toEqual(
      ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"].sort()
    );
    // CACHING_DISABLED の管理ポリシー ID
    expect(behavior.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
    // ALL_VIEWER_EXCEPT_HOST_HEADER の管理ポリシー ID
    expect(behavior.OriginRequestPolicyId).toBe("b689b0a8-53d0-40ab-baf2-68738e2966ac");

    expect(behavior.FunctionAssociations).toHaveLength(1);
    expect(behavior.FunctionAssociations[0].EventType).toBe("viewer-request");
  });

  it("CORS のプリフライトの許可先がコンテキストの配列になっている（* ではない）", () => {
    const methods = template.findResources("AWS::ApiGateway::Method");
    const optionsMethods = Object.values(methods).filter(
      (m: any) => m.Properties.HttpMethod === "OPTIONS"
    ) as any[];
    expect(optionsMethods.length).toBeGreaterThan(0);

    for (const m of optionsMethods) {
      const headerValue =
        m.Properties.Integration.IntegrationResponses[0].ResponseParameters[
          "method.response.header.Access-Control-Allow-Origin"
        ];
      expect(headerValue).toBe(`'${STG_ALLOWED_ORIGINS[0]}'`);
      expect(headerValue).not.toBe("'*'");
    }
  });
});

describe("apiKeyVersion（tester-character-ownership-roadmap.md 検討事項7）", () => {
  it("context未設定（版1扱い） → 導入前と同じID・名前のシークレット・APIキーになる", () => {
    const template = synthStgTemplate();

    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "vtuber-simu-api-key-stg",
    });
    template.hasResourceProperties("AWS::ApiGateway::ApiKey", {
      Name: "vtuber-simu-api-key-stg",
    });

    const secretIds = Object.keys(
      template.findResources("AWS::SecretsManager::Secret")
    );
    // 版1は ID に "V<版>" が付かない（ApiEntranceApiKeySecret<hash> の形）
    expect(secretIds.some((id) => /^ApiEntranceApiKeySecret[0-9A-F]+$/.test(id))).toBe(
      true
    );
    expect(secretIds.some((id) => /ApiKeySecretV\d/.test(id))).toBe(false);
  });

  it("版2 → IDに V2、名前に -v2 が付いたシークレット・APIキーになる", () => {
    const template = synthStgTemplate(2);

    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "vtuber-simu-api-key-stg-v2",
    });
    template.hasResourceProperties("AWS::ApiGateway::ApiKey", {
      Name: "vtuber-simu-api-key-stg-v2",
    });

    const secretIds = Object.keys(
      template.findResources("AWS::SecretsManager::Secret")
    );
    expect(secretIds.some((id) => /^ApiEntranceApiKeySecretV2[0-9A-F]+$/.test(id))).toBe(
      true
    );
  });

  it("版2でも、APIキーの値とディストリビューションのカスタムヘッダーが同じ版のシークレットの動的参照になる", () => {
    const template = synthStgTemplate(2);

    const secrets = template.findResources("AWS::SecretsManager::Secret");
    const secretLogicalId = Object.keys(secrets).find((id) =>
      id.startsWith("ApiEntranceApiKeySecretV2")
    );
    expect(secretLogicalId).toBeDefined();

    const apiKeys = template.findResources("AWS::ApiGateway::ApiKey");
    const apiKeyProps = Object.values(apiKeys)[0] as any;
    expect(apiKeyProps.Properties.Value).toEqual({
      "Fn::Join": [
        "",
        [
          "{{resolve:secretsmanager:",
          { Ref: secretLogicalId },
          ":SecretString:::}}",
        ],
      ],
    });

    const distributions = template.findResources("AWS::CloudFront::Distribution");
    const distProps = Object.values(distributions)[0] as any;
    const headerValue =
      distProps.Properties.DistributionConfig.Origins[0].OriginCustomHeaders[0]
        .HeaderValue;
    expect(headerValue).toEqual({
      "Fn::Join": [
        "",
        [
          "{{resolve:secretsmanager:",
          { Ref: secretLogicalId },
          ":SecretString:::}}",
        ],
      ],
    });
  });
});

describe("Lambda ロググループの保持期間（tester-character-ownership-roadmap.md 検討事項7）", () => {
  it("5つの Lambda（既存4つ + テスターのキャラクター）に RetentionInDays: 30 の Custom::LogRetention が設定されている", () => {
    const template = synthStgTemplate();

    const retentions = template.findResources("Custom::LogRetention", {
      Properties: { RetentionInDays: 30 },
    });

    expect(Object.keys(retentions)).toHaveLength(5);
  });
});

describe("corsAllowedOrigins に無いステージ", () => {
  it("エラーになる（黙って全許可に戻さない）", () => {
    const app = new cdk.App({
      context: {
        corsAllowedOrigins: { stg: STG_ALLOWED_ORIGINS },
      },
    });

    expect(
      () =>
        new VtuberSimulatorStack(app, "ProdStack", {
          env: { account: "123456789012", region: "ap-northeast-1" },
          stageName: "prod",
        })
    ).toThrow(/corsAllowedOrigins/);
  });
});

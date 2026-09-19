import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";

// -------------------------------------------------------
// api-access-control-roadmap.md フェーズ3。
//
// API 専用の CloudFront を API Gateway の唯一の入口にする Construct。
// - Secrets Manager のシークレットを、API Gateway の API キー（使用量プラン）と
//   CloudFront のオリジンへのカスタムヘッダー x-api-key の両方から
//   動的参照する（値はテンプレート・CI のログを通らない。D-025）。
// - CloudFront Function（infra/functions/api-auth.js）で Basic 認証を検証し、
//   通ったリクエストのみオリジン（API Gateway）へ通す。
// - レスポンスヘッダーポリシーで CORS をフロントのオリジンだけに絞る
//   （Lambda 側が返す `*` を originOverride で上書きする）。
// -------------------------------------------------------

export interface ApiEntranceProps {
  /** API キー必須にした4つの POST を持つ REST API */
  readonly api: apigateway.RestApi;
  /** デプロイステージ名（例: stg, prod） */
  readonly stageName: string;
  /** CORS で許可するオリジン（フロントのドメイン・ローカル開発用など） */
  readonly allowedOrigins: string[];
  /**
   * API キー（と、その値を持つシークレット）の版。1 以上の整数。
   *
   * CloudFormation の動的参照（`{{resolve:secretsmanager:...}}`）は、
   * テンプレートの文字列が変わらないと再解決されない。そのため、
   * シークレットの値を変えるだけ（ローテーション）では API キーと
   * CloudFront のカスタムヘッダーに反映されない。この版を上げることで
   * Construct の ID・リソース名を変え、新しいシークレット・API キーを
   * 作り直す（tester-character-ownership-roadmap.md 検討事項7）。
   *
   * 版 1 は、この仕組みを導入する前と同じ ID・名前（`ApiKeySecret`・
   * `vtuber-simu-api-key-${stageName}`、`ApiKey`・同名）を保つ。
   */
  readonly apiKeyVersion: number;
}

export class ApiEntrance extends Construct {
  /** API 専用の CloudFront Distribution */
  public readonly distribution: cloudfront.Distribution;
  /** テスターの資格情報（id -> "<salt>:<hash>"）を保持する KeyValueStore */
  public readonly keyValueStore: cloudfront.KeyValueStore;

  constructor(scope: Construct, id: string, props: ApiEntranceProps) {
    super(scope, id);

    const { api, stageName, allowedOrigins, apiKeyVersion } = props;

    // 版 1 は導入前と同じ ID・名前を保つ。版 2 以降は ID に `V<版>`、
    // 名前に `-v<版>` を付けて、別のシークレット・API キーとして作り直す。
    const versionIdSuffix = apiKeyVersion === 1 ? "" : `V${apiKeyVersion}`;
    const versionNameSuffix = apiKeyVersion === 1 ? "" : `-v${apiKeyVersion}`;

    // -------------------------------------------------------
    // Secrets Manager: API キーの値（英数字のみ・20〜128文字の制約を満たす）
    // -------------------------------------------------------

    const apiKeySecret = new secretsmanager.Secret(this, `ApiKeySecret${versionIdSuffix}`, {
      secretName: `vtuber-simu-api-key-${stageName}${versionNameSuffix}`,
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    // -------------------------------------------------------
    // API Gateway: API キー + 使用量プラン
    // -------------------------------------------------------

    const apiKey = api.addApiKey(`ApiKey${versionIdSuffix}`, {
      apiKeyName: `vtuber-simu-api-key-${stageName}${versionNameSuffix}`,
      value: apiKeySecret.secretValue.unsafeUnwrap(),
    });

    const usagePlan = api.addUsagePlan("UsagePlan", {
      name: `vtuber-simu-usage-plan-${stageName}`,
      throttle: {
        rateLimit: 5,
        burstLimit: 10,
      },
      quota: {
        limit: 5000,
        period: apigateway.Period.DAY,
      },
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    // -------------------------------------------------------
    // KeyValueStore: テスターの資格情報（id -> "<salt>:<hash>"）
    // -------------------------------------------------------

    this.keyValueStore = new cloudfront.KeyValueStore(this, "TestersKeyValueStore", {
      keyValueStoreName: `vtuber-simu-testers-${stageName}`,
      comment: `VTuber Simulator API テスターの資格情報（${stageName}）`,
    });

    // -------------------------------------------------------
    // CloudFront Function: viewer request で Basic 認証を検証する
    // （infra/functions/api-auth.js のプレースホルダー __ALLOWED_ORIGINS__ を、
    //  許可オリジンの JSON 配列で全置換する。先頭のコメント内の記述も含む）
    // -------------------------------------------------------

    const apiAuthSource = fs.readFileSync(
      path.join(__dirname, "..", "functions", "api-auth.js"),
      "utf8"
    );
    const apiAuthCode = apiAuthSource.split("__ALLOWED_ORIGINS__").join(JSON.stringify(allowedOrigins));

    const apiAuthFunction = new cloudfront.Function(this, "ApiAuthFunction", {
      functionName: `vtuber-simu-api-auth-${stageName}`,
      comment: `Basic 認証の検証・Authorization ヘッダーの削除（${stageName}）`,
      code: cloudfront.FunctionCode.fromInline(apiAuthCode),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      keyValueStore: this.keyValueStore,
    });

    // -------------------------------------------------------
    // レスポンスヘッダーポリシー: CORS をフロントのオリジンだけに絞る
    // （Lambda が返す Access-Control-Allow-Origin: * を originOverride で上書き）
    // -------------------------------------------------------

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "ResponseHeadersPolicy",
      {
        responseHeadersPolicyName: `vtuber-simu-api-cors-${stageName}`,
        comment: `API 用 CORS（許可オリジンに限定、${stageName}）`,
        corsBehavior: {
          accessControlAllowOrigins: allowedOrigins,
          accessControlAllowHeaders: ["Authorization", "Content-Type"],
          accessControlAllowMethods: ["POST", "OPTIONS"],
          accessControlAllowCredentials: false,
          originOverride: true,
          accessControlMaxAge: cdk.Duration.minutes(10),
        },
      }
    );

    // -------------------------------------------------------
    // Distribution: API Gateway をオリジンとする、API 専用の CloudFront
    // （originPath にステージ名が入る。viewer request の関数を通ったリクエストのみ
    //  x-api-key 付きでオリジンへ転送される）
    // -------------------------------------------------------

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `vtuber-simulator API entrance (${stageName})`,
      defaultBehavior: {
        origin: new origins.RestApiOrigin(api, {
          customHeaders: {
            "x-api-key": apiKeySecret.secretValue.unsafeUnwrap(),
          },
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        functionAssociations: [
          {
            function: apiAuthFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        responseHeadersPolicy,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });
  }
}

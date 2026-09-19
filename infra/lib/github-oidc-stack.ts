import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

// ==============================================================================
// GitHub Actions OIDC + IAM Role Stack (STG のみ)
// ==============================================================================
// GitHub Actions から AWS へ安全にアクセスするための
// OIDC プロバイダと IAM ロールを作成します。
// vtuber-simulator-api・vtuber-simulator-front-web の2リポジトリ分の
// stg デプロイ用ロールをここにまとめて持つ（D-036・D-039、front-web-deploy-automation-roadmap.md）。
//
// デプロイ方法 (初回のみローカルから手動実行):
//   cd infra
//   npx cdk deploy GithubOidcStack
//
// デプロイ後の手順:
//   1. 出力される GitHubActionsRoleArnStg をコピー
//   2. vtuber-simulator-api リポジトリ > Settings > Secrets and variables > Actions に登録:
//      - AWS_ROLE_ARN_STG = (出力されたロール ARN)
//   3. 出力される GitHubActionsRoleArnFrontWebStg をコピー
//   4. vtuber-simulator-front-web リポジトリ > Settings > Secrets and variables > Actions に登録:
//      - AWS_ROLE_ARN_STG = (出力されたロール ARN)
// ==============================================================================

/**
 * CDK のブートストラップの修飾子。`cdk bootstrap` の既定値（`hnb659fds`）で
 * ブートストラップしている。修飾子を変えてブートストラップし直したら合わせること。
 */
const CDK_BOOTSTRAP_QUALIFIER = "hnb659fds";

/** CDK のブートストラップのロールの ARN（例: cdk-hnb659fds-deploy-role-<account>-<region>） */
function cdkBootstrapRoleArn(kind: string, account: string, region: string): string {
  return `arn:aws:iam::${account}:role/cdk-${CDK_BOOTSTRAP_QUALIFIER}-${kind}-role-${account}-${region}`;
}

export interface GithubOidcStackProps extends cdk.StackProps {
  /** GitHub リポジトリ (形式: "owner/repo") ※表示・参照用 */
  githubRepo: string;
  /**
   * OIDC トークンの sub クレームで実際に使われるプレフィックス (形式: "owner@ownerId/repo@repoId")。
   *
   * このリポジトリは GitHub 側で "Use immutable subject" (OIDC subject claim customization)
   * が有効になっており、sub クレームが通常の `repo:owner/repo:ref:...` ではなく
   * `repo:owner@ownerId/repo@repoId:ref:...` という不変ID付き形式になる。
   * 実際の値は `gh api repos/{owner}/{repo}/actions/oidc/customization/sub` で確認できる
   * （2026-09-16 時点: `use_immutable_subject: true`,
   *   `sub_claim_prefix: "repo:yatohana1231-ux@250690137/vtuber-simulator-api@1306115303"`）。
   * 通常形式のままだと IAM 信頼ポリシーの StringLike 条件が一致せず
   * `AssumeRoleWithWebIdentity` が常に AccessDenied になる（実際に発生した障害）。
   */
  githubOidcSubjectPrefix: string;
  /** front-web の GitHub リポジトリ (形式: "owner/repo") ※表示・参照用 */
  frontWebGithubRepo: string;
  /**
   * front-web の OIDC トークンの sub クレームで実際に使われるプレフィックス
   * (形式: "owner@ownerId/repo@repoId")。
   *
   * このリポジトリも GitHub 側で "Use immutable subject" (OIDC subject claim customization)
   * が有効になっており、sub クレームが通常の `repo:owner/repo:ref:...` ではなく
   * `repo:owner@ownerId/repo@repoId:ref:...` という不変ID付き形式になる。
   * 実際の値は `gh api repos/{owner}/{repo}/actions/oidc/customization/sub` で確認できる
   * （2026-09-19 時点: `use_immutable_subject: true`,
   *   `sub_claim_prefix: "repo:yatohana1231-ux@250690137/vtuber-simulator-front-web@1376745123"`）。
   * 通常形式のままだと IAM 信頼ポリシーの StringLike 条件が一致せず
   * `AssumeRoleWithWebIdentity` が常に AccessDenied になる（実際に発生した障害）。
   */
  frontWebGithubOidcSubjectPrefix: string;
}

export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const { githubOidcSubjectPrefix, frontWebGithubOidcSubjectPrefix } = props;

    // --------------------------------------------------
    // OIDC プロバイダ
    // --------------------------------------------------
    // 注意: AWS アカウントにつき1つしか作成できません。
    // 既に存在する場合はこのリソースを削除し、
    // iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn() で参照してください。
    const oidcProvider = new iam.OpenIdConnectProvider(this, "GithubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
      thumbprints: ["6938fd4d98bab03faadb97b34396831e3780aea1"],
    });

    // --------------------------------------------------
    // IAM ロール - stg 環境用 (develop ブランチからのみ引き受け可)
    // --------------------------------------------------
    // vtuber-simulator-api リポジトリ用
    const stgRole = this.createGithubActionsRole(
      "GitHubActionsRoleStg",
      "github-actions-vtuber-simu-stg",
      githubOidcSubjectPrefix,
      oidcProvider
    );

    // front-web（vtuber-simulator-front-web リポジトリ）用。CloudTrail で
    // どちらのリポジトリの操作か区別でき、片方だけ止める・変えることができるよう、
    // 既存の api 用ロールとは別ロールにしている（front-web-deploy-automation-roadmap.md 検討事項1）。
    const frontWebRole = this.createGithubActionsRole(
      "GitHubActionsRoleFrontWebStg",
      "github-actions-vtuber-simu-front-web-stg",
      frontWebGithubOidcSubjectPrefix,
      oidcProvider
    );

    // --------------------------------------------------
    // Outputs
    // --------------------------------------------------
    new cdk.CfnOutput(this, "GitHubActionsRoleArnStg", {
      value: stgRole.roleArn,
      description: "GitHub Secrets に AWS_ROLE_ARN_STG として登録してください",
    });

    new cdk.CfnOutput(this, "GitHubActionsRoleArnFrontWebStg", {
      value: frontWebRole.roleArn,
      description:
        "vtuber-simulator-front-web リポジトリの GitHub Secrets に AWS_ROLE_ARN_STG として登録してください",
    });

    new cdk.CfnOutput(this, "OidcProviderArn", {
      value: oidcProvider.openIdConnectProviderArn,
      description: "GitHub OIDC Provider ARN",
    });
  }

  /**
   * GitHub Actions が OIDC で引き受ける、stg デプロイ用の IAM ロールを1つ作成する。
   * `develop` ブランチのみを信頼し、権限は最小限（D-036 / F-029）：
   * CI がするのは `cdk deploy` だけで、実際の操作は CDK のブートストラップのロールが行う
   * （CloudFormation の操作は deploy ロール、アセットの S3 への公開は file-publishing ロール、
   * リソースの作成は CloudFormation が cfn-exec ロールで行う）。ブートストラップのロールは
   * アカウントを信頼しているので、CI のロールにはそれらを引き受ける権限だけを付ける。
   * image-publishing（Docker イメージのアセット）・lookup（fromLookup などの
   * コンテキストの参照）は使っていないので含めない。使うようになったら足すこと。
   */
  private createGithubActionsRole(
    constructId: string,
    roleName: string,
    githubOidcSubjectPrefix: string,
    oidcProvider: iam.OpenIdConnectProvider
  ): iam.Role {
    const role = new iam.Role(this, constructId, {
      roleName,
      assumedBy: new iam.FederatedPrincipal(
        oidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": `repo:${githubOidcSubjectPrefix}:ref:refs/heads/develop`,
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole", "sts:TagSession"],
        resources: ["deploy", "file-publishing"].map((kind) =>
          cdkBootstrapRoleArn(kind, this.account, this.region)
        ),
      })
    );

    return role;
  }
}

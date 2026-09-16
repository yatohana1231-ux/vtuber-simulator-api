import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

// ==============================================================================
// GitHub Actions OIDC + IAM Role Stack (STG のみ)
// ==============================================================================
// GitHub Actions から AWS へ安全にアクセスするための
// OIDC プロバイダと IAM ロールを作成します。
//
// デプロイ方法 (初回のみローカルから手動実行):
//   cd infra
//   npx cdk deploy GithubOidcStack
//
// デプロイ後の手順:
//   1. 出力される GitHubActionsRoleArnStg をコピー
//   2. GitHub リポジトリ > Settings > Secrets and variables > Actions に登録:
//      - AWS_ROLE_ARN_STG = (出力されたロール ARN)
// ==============================================================================

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
}

export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const { githubOidcSubjectPrefix } = props;

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
    const stgRole = new iam.Role(this, "GitHubActionsRoleStg", {
      roleName: "github-actions-vtuber-simu-stg",
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

    // --------------------------------------------------
    // 権限付与
    // --------------------------------------------------
    // CDK デプロイには CloudFormation, S3, Lambda, IAM 等の広範な権限が必要。
    // 本番運用時は最小権限に絞ることを推奨。
    stgRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")
    );

    // --------------------------------------------------
    // Outputs
    // --------------------------------------------------
    new cdk.CfnOutput(this, "GitHubActionsRoleArnStg", {
      value: stgRole.roleArn,
      description: "GitHub Secrets に AWS_ROLE_ARN_STG として登録してください",
    });

    new cdk.CfnOutput(this, "OidcProviderArn", {
      value: oidcProvider.openIdConnectProviderArn,
      description: "GitHub OIDC Provider ARN",
    });
  }
}

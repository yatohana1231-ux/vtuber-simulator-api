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
  /** GitHub リポジトリ (形式: "owner/repo") */
  githubRepo: string;
}

export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const { githubRepo } = props;

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
            "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:ref:refs/heads/develop`,
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

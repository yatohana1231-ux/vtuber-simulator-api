import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { GithubOidcStack } from "../lib/github-oidc-stack";

// ci-role-least-privilege-roadmap.md（F-029、D-036）。
// GitHub Actions の stg デプロイのロールが、AdministratorAccess ではなく、
// CDK のブートストラップのロール（deploy・file-publishing）を引き受ける権限だけを
// 持つことを、CloudFormation テンプレートのアサーションで確認する。
// GithubOidcStack は Lambda のアセットを持たないので、api/dist が無くても synth できる。

const ACCOUNT = "123456789012";
const REGION = "ap-northeast-1";
const SUBJECT_PREFIX = "owner@1/repo@2";

function synthTemplate(): Template {
  const app = new cdk.App();
  const stack = new GithubOidcStack(app, "TestGithubOidcStack", {
    env: { account: ACCOUNT, region: REGION },
    githubRepo: "owner/repo",
    githubOidcSubjectPrefix: SUBJECT_PREFIX,
  });
  return Template.fromStack(stack);
}

describe("GithubOidcStack の CI のロール", () => {
  const template = synthTemplate();

  it("AdministratorAccess などの管理ポリシーを付けていない", () => {
    const roles = template.findResources("AWS::IAM::Role", {
      Properties: { RoleName: "github-actions-vtuber-simu-stg" },
    });
    expect(Object.keys(roles)).toHaveLength(1);
    const role = Object.values(roles)[0] as { Properties: Record<string, unknown> };
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    expect(JSON.stringify(template.toJSON())).not.toContain("AdministratorAccess");
  });

  it("許可は、deploy・file-publishing のブートストラップのロールへの sts:AssumeRole・sts:TagSession だけ", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toEqual({
      Sid: "AssumeCdkBootstrapRoles",
      Effect: "Allow",
      Action: ["sts:AssumeRole", "sts:TagSession"],
      Resource: [
        `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-deploy-role-${ACCOUNT}-${REGION}`,
        `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-file-publishing-role-${ACCOUNT}-${REGION}`,
      ],
    });
  });

  it("信頼ポリシーは develop ブランチからの GitHub OIDC だけ（変更なし）", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "github-actions-vtuber-simu-stg",
      MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Effect: "Allow",
            Condition: {
              StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
              StringLike: {
                "token.actions.githubusercontent.com:sub": `repo:${SUBJECT_PREFIX}:ref:refs/heads/develop`,
              },
            },
          }),
        ],
      },
    });
  });
});

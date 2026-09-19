import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { GithubOidcStack } from "../lib/github-oidc-stack";

// ci-role-least-privilege-roadmap.md（F-029、D-036）。
// front-web-deploy-automation-roadmap.md（F-026、D-039）で front-web 用のロールを追加。
// GitHub Actions の stg デプロイのロール（vtuber-simulator-api・vtuber-simulator-front-web の
// 2リポジトリ分）が、AdministratorAccess ではなく、CDK のブートストラップのロール
// （deploy・file-publishing）を引き受ける権限だけを持つことを、
// CloudFormation テンプレートのアサーションで確認する。
// GithubOidcStack は Lambda のアセットを持たないので、api/dist が無くても synth できる。

const ACCOUNT = "123456789012";
const REGION = "ap-northeast-1";
const SUBJECT_PREFIX = "owner@1/repo@2";
const FRONT_WEB_SUBJECT_PREFIX = "owner@1/front-web@3";

function synthTemplate(): Template {
  const app = new cdk.App();
  const stack = new GithubOidcStack(app, "TestGithubOidcStack", {
    env: { account: ACCOUNT, region: REGION },
    githubRepo: "owner/repo",
    githubOidcSubjectPrefix: SUBJECT_PREFIX,
    frontWebGithubRepo: "owner/front-web",
    frontWebGithubOidcSubjectPrefix: FRONT_WEB_SUBJECT_PREFIX,
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

  it("許可は、deploy・file-publishing のブートストラップのロールへの sts:AssumeRole・sts:TagSession だけ（ロールごとに1つずつ、同じ内容）", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    const statementsPerPolicy = Object.values(policies).map(
      (p: any) => p.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>
    );
    // api 用・front-web 用の2ロール分、ポリシーが1つずつ作られる
    expect(statementsPerPolicy).toHaveLength(2);
    const expectedStatement = {
      Sid: "AssumeCdkBootstrapRoles",
      Effect: "Allow",
      Action: ["sts:AssumeRole", "sts:TagSession"],
      Resource: [
        `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-deploy-role-${ACCOUNT}-${REGION}`,
        `arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-file-publishing-role-${ACCOUNT}-${REGION}`,
      ],
    };
    for (const statements of statementsPerPolicy) {
      expect(statements).toHaveLength(1);
      expect(statements[0]).toEqual(expectedStatement);
    }
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

  it("既存ロールの信頼ポリシーは api 側の prefix のみで、front-web の prefix を含まない（取り違え防止）", () => {
    const roles = template.findResources("AWS::IAM::Role", {
      Properties: { RoleName: "github-actions-vtuber-simu-stg" },
    });
    const role = Object.values(roles)[0] as { Properties: Record<string, unknown> };
    expect(JSON.stringify(role.Properties.AssumeRolePolicyDocument)).not.toContain(
      FRONT_WEB_SUBJECT_PREFIX
    );
  });
});

describe("GithubOidcStack の front-web 用 CI のロール", () => {
  const template = synthTemplate();

  it("AdministratorAccess などの管理ポリシーを付けていない", () => {
    const roles = template.findResources("AWS::IAM::Role", {
      Properties: { RoleName: "github-actions-vtuber-simu-front-web-stg" },
    });
    expect(Object.keys(roles)).toHaveLength(1);
    const role = Object.values(roles)[0] as { Properties: Record<string, unknown> };
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
  });

  it("許可は、deploy・file-publishing のブートストラップのロールへの sts:AssumeRole・sts:TagSession だけ", () => {
    const roles = template.findResources("AWS::IAM::Role", {
      Properties: { RoleName: "github-actions-vtuber-simu-front-web-stg" },
    });
    const roleLogicalId = Object.keys(roles)[0];
    const policies = template.findResources("AWS::IAM::Policy", {
      Properties: {
        Roles: Match.arrayWith([{ Ref: roleLogicalId }]),
      },
    });
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

  it("信頼ポリシーは front-web の prefix の develop ブランチだけ", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "github-actions-vtuber-simu-front-web-stg",
      MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Effect: "Allow",
            Condition: {
              StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
              StringLike: {
                "token.actions.githubusercontent.com:sub": `repo:${FRONT_WEB_SUBJECT_PREFIX}:ref:refs/heads/develop`,
              },
            },
          }),
        ],
      },
    });
  });
});

describe("GithubOidcStack の Outputs", () => {
  const template = synthTemplate();

  it("GitHubActionsRoleArnFrontWebStg が出力される", () => {
    template.hasOutput("GitHubActionsRoleArnFrontWebStg", {});
  });
});

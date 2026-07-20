#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VtuberSimulatorStack } from "../lib/vtuber-simulator-stack";
import { GithubOidcStack } from "../lib/github-oidc-stack";

const app = new cdk.App();

// --------------------------------------------------
// アプリケーションスタック (Lambda, API Gateway, DynamoDB)
// --------------------------------------------------
new VtuberSimulatorStack(app, "VtuberSimulatorStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",
  },
  stageName: app.node.tryGetContext("stage") ?? "stg",
});

// --------------------------------------------------
// CI/CD 基盤スタック (GitHub OIDC + IAM ロール)
// --------------------------------------------------
// 初回のみ手動でデプロイ: npx cdk deploy GithubOidcStack
new GithubOidcStack(app, "GithubOidcStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",
  },
  githubRepo: "yatohana1231-ux/vtuber-simulator-api",
});

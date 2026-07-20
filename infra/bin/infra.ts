#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VtuberSimulatorStack } from "../lib/vtuber-simulator-stack";

const app = new cdk.App();

new VtuberSimulatorStack(app, "VtuberSimulatorStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",
  },
  stageName: app.node.tryGetContext("stage") ?? "stg",
});

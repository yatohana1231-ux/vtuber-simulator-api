/**
 * DynamoDB テーブルのデータを全削除するスクリプト
 * Usage: node scripts/clear-tables.mjs
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "ap-northeast-1" })
);

async function clearTable(tableName, keySchema) {
  console.log(`\n[clearTable] Scanning ${tableName}...`);
  let lastKey = undefined;
  let totalDeleted = 0;

  // ExpressionAttributeNames で予約語を回避
  const exprNames = {};
  const projParts = [];
  keySchema.forEach((k, i) => {
    const alias = `#k${i}`;
    exprNames[alias] = k.name;
    projParts.push(alias);
  });

  do {
    const scan = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        ProjectionExpression: projParts.join(", "),
        ExpressionAttributeNames: exprNames,
      })
    );

    const items = scan.Items ?? [];
    lastKey = scan.LastEvaluatedKey;

    if (items.length === 0) break;

    // BatchWrite は最大25件ずつ
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      const deleteRequests = batch.map((item) => ({
        DeleteRequest: {
          Key: Object.fromEntries(keySchema.map((k) => [k.name, item[k.name]])),
        },
      }));

      await client.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: deleteRequests },
        })
      );
      totalDeleted += batch.length;
    }
  } while (lastKey);

  console.log(`[clearTable] Deleted ${totalDeleted} items from ${tableName}`);
}

// CHARACTER_MEMORY_TABLE: PK=memory_id, SK=index
await clearTable("v-simu-characters-memory-stg", [
  { name: "memory_id" },
  { name: "index" },
]);

// EVENTS_TABLE: PK=event_id
await clearTable("v-simu-events-stg", [{ name: "event_id" }]);

console.log("\nDone.");

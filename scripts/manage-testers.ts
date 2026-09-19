/**
 * テスターの資格情報を CloudFront KeyValueStore（API 専用 CloudFront が
 * viewer request の CloudFront Function（`infra/functions/api-auth.js`）で
 * 照合する ID/パスワード）に登録・削除・一覧するローカル用スクリプト。
 *
 * `.notes/api-access-control-roadmap.md` フェーズ4。
 *
 * 使い方（`api/` 配下で npm scripts 経由。`--` の後がこのスクリプトへの引数）:
 *   npm run testers:add -- <id> [options]
 *   npm run testers:add -- <id> --generate [options]
 *   npm run testers:remove -- <id> [options]
 *   npm run testers:list -- [options]
 *   npm run testers:list -- --help
 *
 *   直接 tsx を呼ぶ場合:
 *   npx tsx scripts/manage-testers.ts add <id> [options]
 *   npx tsx scripts/manage-testers.ts remove <id> [options]
 *   npx tsx scripts/manage-testers.ts list [options]
 *   npx tsx scripts/manage-testers.ts --help
 *
 * オプション:
 *   --generate         （add のみ）パスワードを対話入力させず、自動生成する。
 *                       登録に成功した場合のみ、生成したパスワードを標準出力に
 *                       1回だけ表示する（ファイル・ログには書かない）。
 *   --stage <name>     ステージ名（既定: stg）。現時点ではスタック名は固定
 *                       （`VtuberSimulatorStack`）のため、--kvs-arn 省略時の
 *                       解決には使っていない（将来ステージごとにスタックを
 *                       分けたときのための予約）
 *   --kvs-arn <arn>    KeyValueStore の ARN。省略時は
 *                       `aws cloudformation describe-stacks --stack-name VtuberSimulatorStack`
 *                       の出力 `TesterKeyValueStoreArn` から取得する（読み取りのみ）
 *
 * 前提:
 *   - AWS CLI v2 がインストール済みで、有効な資格情報（環境変数 / プロファイル）が
 *     設定されていること。
 *   - このスクリプトは AWS への変更操作（put-key / delete-key）を実行しうる。
 *     実行前に、KeyValueStore を持つスタックがデプロイ済みであることを確認すること。
 *
 * パスワードの扱い:
 *   - コマンドライン引数では受け取らない（シェルの履歴に残るため）。
 *   - --generate を付けない場合、TTY のときはエコーを切って2回入力させ、一致を
 *     確認する。パイプ経由の標準入力（TTY でない）のときは1行読み取る（確認なし）。
 *   - --generate を付けた場合、`crypto.randomBytes` から作った強いパスワード
 *     （base64url で20文字）を自動生成する。登録に成功したときだけ、標準出力に
 *     1回だけ表示するので、その場でテスターに安全な方法（対面・別経路のチャット等）
 *     で伝えること。チャットの共有ログなどに貼らないこと。
 *   - パスワード・salt・hash・put-key のコマンドライン全体は、ログにも画面にも
 *     出力しない（AWS CLI のエラーメッセージも、値を含みうる部分は組み立て直す）。
 *
 * 反映:
 *   - 登録・削除は CloudFront Functions の KeyValueStore に反映されるまで
 *     1分ほどかかることがある（実行後にその旨を表示する）。
 */

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// -------------------------------------------------------
// 純粋な関数（テスト対象）
// -------------------------------------------------------

export const MAX_TESTER_ID_BYTES = 512;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * テスターの ID が妥当かを確かめる。
 * 妥当なら null、妥当でなければ理由を表す文字列を返す。
 *
 * - 空文字は不可
 * - ":" を含んではならない（Basic 認証は最初の ":" で ID とパスワードを分けるため）
 * - UTF-8 で 512 バイト以下
 */
export function validateTesterId(id: string): string | null {
  if (id.length === 0) {
    return "ID を空にすることはできません。";
  }
  if (id.indexOf(":") !== -1) {
    return "ID に ':' を含めることはできません（Basic 認証は最初の ':' で ID とパスワードを分けるため）。";
  }
  if (Buffer.byteLength(id, "utf8") > MAX_TESTER_ID_BYTES) {
    return `ID は UTF-8 で ${MAX_TESTER_ID_BYTES} バイト以下にしてください。`;
  }
  return null;
}

/**
 * パスワードが妥当かを確かめる（8文字以上）。妥当なら null。
 * サロゲートペアを含む文字列でも文字数を正しく数える。
 */
export function validatePassword(password: string): string | null {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return `パスワードは ${MIN_PASSWORD_LENGTH} 文字以上にしてください。`;
  }
  return null;
}

/** `crypto.randomBytes(16)` の16進数文字列（":" を含まない）。 */
export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * `add --generate` 用のパスワードを自動生成する。
 * `crypto.randomBytes(15)`（15バイト = 120ビット）を base64url 化すると、
 * 15 が3の倍数のためパディングなしでちょうど20文字になる。
 * base64url の文字（英数字・"-"・"_"）のみで、伝達時に紛らわしい記号
 * （"+"/"/"/"="）を含まない。呼ぶたびに乱数から異なる値になる。
 * 生成した値は常に `validatePassword` を満たす（20 >= MIN_PASSWORD_LENGTH）。
 */
export function generatePassword(): string {
  return crypto.randomBytes(15).toString("base64url");
}

/**
 * KeyValueStore に保存する値 "<salt>:<hash>" を作る。
 * `hash` は `sha256(salt + ":" + password)` の16進数文字列
 * （`infra/functions/api-auth.js` の照合ロジックと同じ規則）。
 * 同じ salt・password の組なら決定的に同じ値を返す。
 */
export function createStoredValue(password: string, saltHex: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${saltHex}:${password}`)
    .digest("hex");
  return `${saltHex}:${hash}`;
}

export type Command = "add" | "remove" | "list";

export interface ParsedArgs {
  help: boolean;
  command?: Command;
  id?: string;
  stage: string;
  kvsArn?: string;
  generate: boolean;
}

const VALID_COMMANDS: readonly Command[] = ["add", "remove", "list"];

/**
 * `process.argv.slice(2)` 相当の引数配列をパースする。
 * 不正な引数（未知のコマンド・未知のオプション・値の欠落・add/remove での ID 欠落）は例外を投げる。
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { help: false, stage: "stg", generate: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--generate") {
      result.generate = true;
    } else if (arg === "--stage") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--stage には値が必要です。");
      }
      result.stage = value;
      i++;
    } else if (arg === "--kvs-arn") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--kvs-arn には値が必要です。");
      }
      result.kvsArn = value;
      i++;
    } else if (arg.startsWith("--")) {
      throw new Error(`未知のオプション: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (result.help) {
    return result;
  }

  const [command, id] = positionals;
  if (command !== undefined) {
    if ((VALID_COMMANDS as string[]).indexOf(command) === -1) {
      throw new Error(`未知のコマンド: ${command}（add / remove / list のいずれか）`);
    }
    result.command = command as Command;
  }
  if (id !== undefined) {
    result.id = id;
  }

  if ((result.command === "add" || result.command === "remove") && result.id === undefined) {
    throw new Error(`${result.command} には ID を指定してください。`);
  }

  if (result.generate && result.command !== "add") {
    throw new Error("--generate は add コマンドでのみ指定できます。");
  }

  return result;
}

// -------------------------------------------------------
// パスワードの入力（画面に表示しない）
// -------------------------------------------------------

/** TTY 上でエコーを切って1行読み取る。 */
function readPasswordFromTty(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(promptText);

    let input = "";
    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf8");
      if (char === "\n" || char === "\r" || char === "\u0004") {
        cleanup();
        process.stdout.write("\n");
        resolve(input);
        return;
      }
      if (char === "\u0003") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("入力が中断されました。"));
        return;
      }
      if (char === "\u007f" || char === "\b") {
        input = input.slice(0, -1);
        return;
      }
      input += char;
    };

    const cleanup = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

/**
 * パイプ等（TTY でない）の標準入力から1行読み取る。
 * `input` は既定で `process.stdin`（テストでは任意の Readable を渡せる）。
 *
 * `rl.close()` は同期的に `close` イベントを発生させるため、`line` ハンドラ内で
 * `resolve(line)` を `rl.close()` より先に呼ぶ（`close` 側の `resolve("")` は
 * 一度解決した Promise には効かないが、`line` が一度も来ないまま入力が終わった
 * 場合はそちらが空文字で解決する）。
 */
export function readLineFromStdin(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, terminal: false });
    rl.once("line", (line) => {
      resolve(line);
      rl.close();
    });
    rl.once("close", () => {
      resolve("");
    });
    rl.once("error", reject);
  });
}

/**
 * `add` 用のパスワード入力。TTY のときはエコーを切って2回入力させ、一致を確かめる。
 * TTY でない（パイプ）ときは1行読み取る（確認なし）。
 */
async function promptPasswordForAdd(): Promise<string> {
  if (process.stdin.isTTY) {
    const first = await readPasswordFromTty("パスワード: ");
    const second = await readPasswordFromTty("パスワード（確認）: ");
    if (first !== second) {
      throw new Error("入力したパスワードが一致しません。");
    }
    return first;
  }
  return readLineFromStdin();
}

// -------------------------------------------------------
// AWS CLI 呼び出し（child_process.execFile。シェルを通さない）
// -------------------------------------------------------

interface ExecFileFailure extends Error {
  stderr?: string;
}

/**
 * `aws <args>` を実行し、stdout を返す。
 * 失敗時は、渡した引数（値を含みうる）をエラーメッセージに含めない。
 * `redactStderr` を true にすると、stderr も一切表示しない
 * （put-key のように値をコマンドラインに含む呼び出し向け）。
 */
async function runAwsCli(args: string[], redactStderr = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync("aws", args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const subcommand = `aws ${args[0] ?? ""} ${args[1] ?? ""}`.trim();
    const failure = err as ExecFileFailure;
    if (redactStderr || !failure.stderr) {
      throw new Error(`${subcommand} の実行に失敗しました。`);
    }
    throw new Error(`${subcommand} の実行に失敗しました: ${failure.stderr.trim()}`);
  }
}

async function resolveKvsArnFromStack(stackName = "VtuberSimulatorStack"): Promise<string> {
  const stdout = await runAwsCli([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--output",
    "json",
  ]);
  const parsed = JSON.parse(stdout) as {
    Stacks?: Array<{ Outputs?: Array<{ OutputKey?: string; OutputValue?: string }> }>;
  };
  const outputs = parsed.Stacks?.[0]?.Outputs ?? [];
  const found = outputs.find((o) => o.OutputKey === "TesterKeyValueStoreArn");
  if (!found || typeof found.OutputValue !== "string") {
    throw new Error(
      `スタック ${stackName} の出力に TesterKeyValueStoreArn が見つかりません。--kvs-arn を指定してください。`
    );
  }
  return found.OutputValue;
}

async function getEtag(kvsArn: string): Promise<string> {
  const stdout = await runAwsCli([
    "cloudfront-keyvaluestore",
    "describe-key-value-store",
    "--kvs-arn",
    kvsArn,
    "--output",
    "json",
  ]);
  const parsed = JSON.parse(stdout) as { ETag?: string };
  if (typeof parsed.ETag !== "string") {
    throw new Error("describe-key-value-store の応答から ETag を取得できませんでした。");
  }
  return parsed.ETag;
}

async function putKey(kvsArn: string, id: string, value: string, etag: string): Promise<void> {
  await runAwsCli(
    [
      "cloudfront-keyvaluestore",
      "put-key",
      "--kvs-arn",
      kvsArn,
      "--key",
      id,
      "--value",
      value,
      "--if-match",
      etag,
    ],
    true // 値をコマンドラインに含むため、エラーメッセージから stderr を必ず除く
  );
}

async function deleteKey(kvsArn: string, id: string, etag: string): Promise<void> {
  await runAwsCli([
    "cloudfront-keyvaluestore",
    "delete-key",
    "--kvs-arn",
    kvsArn,
    "--key",
    id,
    "--if-match",
    etag,
  ]);
}

async function listKeys(kvsArn: string): Promise<string[]> {
  const ids: string[] = [];
  let marker: string | undefined;

  do {
    const args = [
      "cloudfront-keyvaluestore",
      "list-keys",
      "--kvs-arn",
      kvsArn,
      "--output",
      "json",
    ];
    if (marker) {
      args.push("--marker", marker);
    }
    const stdout = await runAwsCli(args);
    const parsed = JSON.parse(stdout) as {
      Items?: Array<{ Key?: string }>;
      NextMarker?: string;
    };
    for (const item of parsed.Items ?? []) {
      if (typeof item.Key === "string") {
        ids.push(item.Key);
      }
    }
    marker = parsed.NextMarker;
  } while (marker);

  return ids;
}

// -------------------------------------------------------
// コマンド
// -------------------------------------------------------

async function cmdAdd(kvsArn: string, id: string, generate: boolean): Promise<void> {
  const idError = validateTesterId(id);
  if (idError) {
    throw new Error(idError);
  }

  const password = generate ? generatePassword() : await promptPasswordForAdd();
  const passwordError = validatePassword(password);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const salt = generateSalt();
  const value = createStoredValue(password, salt);

  const etag = await getEtag(kvsArn);
  await putKey(kvsArn, id, value, etag);

  console.log(`登録しました: ${id}`);
  if (generate) {
    // 登録に成功したときだけ、ここで1回だけ表示する（ファイル・ログには書かない）。
    console.log(
      `パスワード（この画面にだけ表示します。テスターに安全な方法で伝えてください）: ${password}`
    );
  }
  console.log("反映まで1分ほどかかることがあります（2026-09-19 の確認では約45秒）。");
}

async function cmdRemove(kvsArn: string, id: string): Promise<void> {
  const idError = validateTesterId(id);
  if (idError) {
    throw new Error(idError);
  }

  const etag = await getEtag(kvsArn);
  await deleteKey(kvsArn, id, etag);

  console.log(`削除しました: ${id}`);
  console.log("反映まで1分ほどかかることがあります（2026-09-19 の確認では約45秒）。");
}

async function cmdList(kvsArn: string): Promise<void> {
  const ids = await listKeys(kvsArn);
  if (ids.length === 0) {
    console.log("登録されているテスターはいません。");
    return;
  }
  console.log("登録済みのテスター ID:");
  for (const id of ids) {
    console.log(`  - ${id}`);
  }
}

function printHelp(): void {
  console.log(`使い方: npm run testers:<add|remove|list> -- <command向け引数> [options]
      （直接呼ぶ場合: npx tsx scripts/manage-testers.ts <command> [options]）

API 専用 CloudFront が照合するテスターの資格情報を KeyValueStore に登録・削除・一覧する。

コマンド:
  add <id>      テスターを登録する（既存の ID があれば上書き）。パスワードは画面に表示せず入力させる
                （--generate を付けると自動生成し、登録成功時のみ1回だけ表示する）
  remove <id>   テスターを削除する
  list          登録済みのテスター ID を一覧する（値は表示しない）

オプション:
  --generate         （add のみ）パスワードを対話入力せず自動生成する（base64url 20文字）
  --stage <name>     ステージ名（既定: stg）
  --kvs-arn <arn>    KeyValueStore の ARN。省略時は
                     aws cloudformation describe-stacks --stack-name VtuberSimulatorStack
                     の出力 TesterKeyValueStoreArn から取得する（読み取りのみ）
  -h, --help         このヘルプを表示する

例:
  npm run testers:add -- tester1
  npm run testers:add -- tester1 --generate
  npm run testers:remove -- tester1
  npm run testers:list
  npm run testers:list -- --kvs-arn arn:aws:cloudfront::123456789012:key-value-store/xxxxxxxx

前提: AWS CLI v2、有効な AWS 資格情報（一時的な資格情報の場合はリージョンの STS エンドポイントが必要）。
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help || !parsed.command) {
    printHelp();
    return;
  }

  const kvsArn = parsed.kvsArn ?? (await resolveKvsArnFromStack());

  switch (parsed.command) {
    case "add":
      await cmdAdd(kvsArn, parsed.id!, parsed.generate);
      break;
    case "remove":
      await cmdRemove(kvsArn, parsed.id!);
      break;
    case "list":
      await cmdList(kvsArn);
      break;
  }
}

// -------------------------------------------------------
// 直接実行されたときだけ動かす（テストからの import では動かさない）
// -------------------------------------------------------

const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

// esbuild の --loader:.mustache=text により、
// .mustache ファイルを import すると文字列として取得できる
declare module "*.mustache" {
  const content: string;
  export default content;
}

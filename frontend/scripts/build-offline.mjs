// 进程内离线构建：rollup + TypeScript 编译器，全程不创建子进程。
// 标准流程仍是 Vite（npm run build）；本脚本用于无法启动子进程的受限环境。
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { rollup } from "rollup";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const assets = path.join(dist, "assets");

// 样式由 index.html 直接引用，打包时把 CSS 导入替换为空模块。
const cssStub = {
  name: "css-stub",
  load(id) {
    if (id.endsWith(".css")) return "export default undefined;";
    return null;
  }
};

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const bundle = await rollup({
  input: path.join(root, "src", "main.tsx"),
  onwarn(warning, warn) {
    if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
    warn(warning);
  },
  plugins: [
    cssStub,
    replace({
      preventAssignment: true,
      "process.env.NODE_ENV": JSON.stringify("production")
    }),
    nodeResolve({ extensions: [".ts", ".tsx", ".js", ".jsx", ".json"] }),
    commonjs(),
    typescript({
      tsconfig: path.join(root, "tsconfig.json"),
      noEmitOnError: false,
      declaration: false,
      sourceMap: false,
      compilerOptions: {
        target: "ES2017",
        allowImportingTsExtensions: false,
        noEmit: false,
        declaration: false,
        jsx: "react-jsx",
        module: "esnext",
        moduleResolution: "bundler"
      }
    })
  ]
});

await bundle.write({
  file: path.join(assets, "app.js"),
  format: "iife",
  sourcemap: false
});
await bundle.close();

await copyFile(path.join(root, "src", "styles.css"), path.join(assets, "app.css"));

const html = [
  "<!doctype html>",
  '<html lang="zh-CN" data-theme="light">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  "    <title>CampusClaw · 登录</title>",
  '    <link rel="stylesheet" href="/assets/app.css" />',
  "  </head>",
  "  <body>",
  '    <div id="root"></div>',
  '    <script src="/assets/app.js"></script>',
  "  </body>",
  "</html>",
  ""
].join("\n");

await writeFile(path.join(dist, "index.html"), html, "utf8");
console.log("离线构建完成：" + dist);

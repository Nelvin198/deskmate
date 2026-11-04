import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { copyFile, mkdir, readFile } from "node:fs/promises";

const prod = process.argv[2] === "production";
// Set DESKMATE_PLUGIN_DIR to a vault's .obsidian/plugins/deskmate folder to copy each build there.
const pluginDir = process.env.DESKMATE_PLUGIN_DIR;

const copyToVault = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length || !pluginDir) return;
      await mkdir(pluginDir, { recursive: true });
      for (const file of ["main.js", "manifest.json", "styles.css"]) await copyFile(file, `${pluginDir}/${file}`);
      console.log(`Copied build to ${pluginDir}`);
    });
  },
};

// Obsidian runs on Electron, which exposes Node.js. WebLLM's WebAssembly loader then takes its
// Node.js path (reading files with require), which doesn't work inside a plugin. Force the browser path.
const NODE_CHECK = 'ENVIRONMENT_IS_NODE=typeof process=="object"&&typeof process.versions=="object"&&typeof process.versions.node=="string"';
const webllmBrowserOnly = {
  name: "webllm-browser-only",
  setup(build) {
    build.onLoad({ filter: /@mlc-ai[\\/]web-llm[\\/]lib[\\/]index\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const count = source.split(NODE_CHECK).length - 1;
      if (!count) throw new Error("WebLLM changed: the Node.js check to patch wasn't found. Update esbuild.config.mjs.");
      return { contents: source.split(NODE_CHECK).join("ENVIRONMENT_IS_NODE=false"), loader: "js" };
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  legalComments: "inline",
  outfile: "main.js",
  plugins: [webllmBrowserOnly, copyToVault],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}

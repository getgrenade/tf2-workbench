// Runs the tests: every tests/**/*.test.ts is bundled with esbuild (the sources import each other without extensions and the viewer code
// reaches for Vite's `import.meta.env`) and then run with node's own test runner.
//   npm test                 all of them
//   npm test -- sceneParts   the files whose name contains that
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = join(root, "target", "test-bundles");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const found = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".test.ts")) found.push(p);
  }
};
walk(join(root, "tests"));
const filter = process.argv.slice(2);
const files = found.filter((f) => !filter.length || filter.some((x) => f.includes(x)));

const bundles = [];
const broken = [];
for (const file of files) {
  const target = join(out, `${bundles.length}-${basename(file, ".ts")}.mjs`);
  try {
    await build({
      entryPoints: [file], outfile: target, bundle: true, platform: "node", format: "esm", logLevel: "silent", sourcemap: "inline",
      define: { "import.meta.env.DEV": "false", "import.meta.env.BASE_URL": '"/"', "import.meta.env": "{}", __WEB__: "false" },
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url); globalThis.requestAnimationFrame ??= (f) => setTimeout(() => f(performance.now()), 16); globalThis.cancelAnimationFrame ??= clearTimeout;" },
      nodePaths: [join(root, "node_modules")],
    });
    bundles.push(target);
  } catch (error) {
    broken.push(file);
    console.error(`not built: ${file}\n  ${String(error.errors?.[0]?.text ?? error)}`);
  }
}
const run = bundles.length ? spawnSync(process.execPath, ["--test", "--enable-source-maps", ...bundles], { stdio: "inherit", cwd: root }) : { status: 0 };
if (broken.length) console.error(`\n${broken.length} test file(s) did not build:\n  ${broken.join("\n  ")}`);
process.exit(run.status || broken.length ? 1 : 0);

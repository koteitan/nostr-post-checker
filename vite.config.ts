import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

// The build bundles third-party code (rx-nostr, rxjs, ...). Their licenses
// require shipping the license text with every copy, so collect the license
// (and NOTICE) files of the bundled packages and emit them as
// THIRD_PARTY_LICENSES.txt next to the built files.
//
// A bundled package may have inlined its own dependencies into its dist file
// (rx-nostr inlines rxjs and tslib), which module ids cannot reveal. So the
// list is the bundled packages plus their dependency closure; @types/* packages
// are skipped because they contain type declarations only, never runtime code.
function thirdPartyLicenses(): Plugin {
  const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
  const readIf = (dir: string, re: RegExp) => {
    const f = fs.readdirSync(dir).find((n) => re.test(n));
    return f ? fs.readFileSync(path.join(dir, f), "utf8").trim() : null;
  };
  // Node-style lookup of `dep` starting from the directory `from`.
  const findRoot = (from: string, dep: string): string | null => {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const cand = path.join(dir, "node_modules", dep);
      if (fs.existsSync(path.join(cand, "package.json"))) return cand;
      if (path.dirname(dir) === dir) return null;
    }
  };
  return {
    name: "third-party-licenses",
    apply: "build",
    generateBundle() {
      const roots = new Map<string, string>(); // package name -> package root
      const add = (root: string) => {
        const pkg = readJson(path.join(root, "package.json"));
        if (pkg.name.startsWith("@types/") || roots.has(pkg.name)) return;
        roots.set(pkg.name, root);
        for (const dep of Object.keys(pkg.dependencies || {})) {
          const r = findRoot(root, dep);
          if (r) add(r);
        }
      };
      for (const id of this.getModuleIds()) {
        const m = id.replace(/\\/g, "/").match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
        if (m) add(m[1]);
      }
      const parts: string[] = [];
      for (const [name, root] of [...roots].sort()) {
        const pkg = readJson(path.join(root, "package.json"));
        const license = readIf(root, /^(license|licence|copying)(\..*)?$/i) ?? "(license file not found)";
        const notice = readIf(root, /^notice(\..*)?$/i);
        parts.push(
          `${name}@${pkg.version} (${pkg.license})\n${"-".repeat(72)}\n${license}` +
            (notice ? `\n\nNOTICE:\n${notice}` : "")
        );
      }
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_LICENSES.txt",
        source:
          "Third-party software bundled into nostr-post-checker.\n\n" + parts.join("\n\n\n") + "\n",
      });
    },
  };
}

// Served from https://koteitan.github.io/nostr-post-checker/ (a project
// subpath), so use relative asset URLs. This keeps the public URL unchanged.
export default defineConfig({
  base: "./",
  plugins: [thirdPartyLicenses()],
  build: {
    rolldownOptions: {
      output: {
        // postBanner is added after minification, which strips /*! */ comments.
        postBanner: "/*! Licenses of bundled third-party code: THIRD_PARTY_LICENSES.txt */",
      },
    },
  },
});

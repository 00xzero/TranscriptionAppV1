// Builds preview.html: the template with the app's Hairline kernel and figures
// (frontend/lib/hairline) inlined, so the page opens straight from disk with no
// server. Run: node .docs/empty-state-illustrations/build-preview.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "../../frontend/lib/hairline");
const read = (p) => readFileSync(p, "utf8");

// The app's files are ES modules. Here they become plain scripts: the kernel
// defines the HL global, and each figure registers itself through hairline().
const kernel = read(join(lib, "kernel.js")).replace(/\nexport default HL;\s*$/, "\n");
const figures = ["drawer", "typewriter", "rolodex"]
  .map((name) => {
    const src = read(join(lib, "figures", `${name}.js`))
      .replace(/^import HL from "\.\.\/kernel\.js";\n/m, "")
      .replace(/\nexport default figure;\s*$/, "\nhairline(figure);\n");
    return `<script>(() => {\n${src}\n})();</script>`;
  })
  .join("\n");

const html = read(join(here, "preview.template.html"))
  .replace("/*KERNEL*/", () => kernel)
  .replace("/*FIGURES*/", () => figures);

writeFileSync(join(here, "preview.html"), html);
console.log("wrote preview.html");

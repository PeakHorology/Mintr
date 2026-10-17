import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
require(join(dirname(fileURLToPath(import.meta.url)), "../electron/mcpStdio.cjs"));

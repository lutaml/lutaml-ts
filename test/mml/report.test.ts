import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Keep the dependency-free reporting suite in the existing npm test / CI run.
it("passes the saved-result reporting regressions", () => {
  const result = spawnSync(process.execPath, ["--test", fileURLToPath(new URL("./report.node.mjs", import.meta.url))], {
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error, result.error?.message).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

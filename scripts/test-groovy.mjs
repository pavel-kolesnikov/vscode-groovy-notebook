import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const groovyDir = join(rootDir, "src", "groovy");

const TEST_FILES = readdirSync(groovyDir)
  .filter((f) => f.endsWith("Test.groovy"))
  .sort();

function findGroovy() {
  try {
    const result = execFileSync("which", ["groovy"], {
      encoding: "utf8",
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function runGroovyTests() {
  const groovyBin = findGroovy();
  if (!groovyBin) {
    console.log("[groovy] SKIP: 'groovy' not found on PATH");
    console.log("[groovy] Install via SDKMAN: sdk install groovy");
    return "skip";
  }

  console.log(`[groovy] Using: ${groovyBin}\n`);

  let failed = 0;
  for (const file of TEST_FILES) {
    const label = file.replace(".groovy", "");
    process.stdout.write(`[groovy] ${label} ... `);
    try {
      execFileSync(groovyBin, [file], {
        cwd: groovyDir,
        encoding: "utf8",
        timeout: 120_000,
      });
      console.log("OK");
    } catch (error) {
      failed++;
      console.log("FAILED");
      const parts = [error.stdout, error.stderr, error.message].filter(Boolean);
      const output = parts.join("\n");
      if (output) {
        for (const line of output.split("\n")) {
          console.log(`  ${line}`);
        }
      }
    }
  }

  const total = TEST_FILES.length;
  console.log(
    `\n[groovy] ${total - failed}/${total} test suites passed${
      failed ? `, ${failed} failed` : ""
    }`
  );
  return failed === 0 ? "pass" : "fail";
}

const outcome = runGroovyTests();
if (outcome === "fail") {
  process.exit(1);
}

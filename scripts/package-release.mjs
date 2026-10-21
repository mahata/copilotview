import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const releaseTag = process.env.RELEASE_TAG;
if (releaseTag && !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
  fail(`Release tag ${releaseTag} is not a version tag such as v1.2.3.`);
}
const version = releaseTag ? releaseTag.slice(1) : JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const requiredBuildOutputs = [path.join("dist", "cli.js"), path.join("dist", "web", "index.html")];
const missingBuildOutputs = requiredBuildOutputs.filter((file) => !fs.existsSync(file));
if (missingBuildOutputs.length > 0) {
  fail(`Missing ${missingBuildOutputs.join(", ")}. Run \`pnpm build\` first.`);
}

const releaseDir = "release";
const releaseName = `copilotview-${version}`;
const tarballName = `${releaseName}.tar.gz`;
const stagingDir = path.join(releaseDir, releaseName);

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.cpSync("dist", stagingDir, { recursive: true });
for (const file of ["LICENSE", "README.md"]) {
  fs.copyFileSync(file, path.join(stagingDir, file));
}

const withoutMacOSResourceForks = { ...process.env, COPYFILE_DISABLE: "1" };
execFileSync("tar", ["-czf", tarballName, releaseName], { cwd: releaseDir, env: withoutMacOSResourceForks });
fs.rmSync(stagingDir, { recursive: true });

const tarballPath = path.join(releaseDir, tarballName);
const sha256 = createHash("sha256").update(fs.readFileSync(tarballPath)).digest("hex");
fs.writeFileSync(`${tarballPath}.sha256`, `${sha256}  ${tarballName}\n`);
process.stdout.write(`${tarballPath}\nsha256: ${sha256}\n`);

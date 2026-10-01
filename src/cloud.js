const LIMIT = 300_000;

function packageScripts(pkg) {
  const scripts = pkg && typeof pkg.scripts === "object" ? pkg.scripts : {};
  return {
    build: typeof scripts.build === "string" ? scripts.build : null,
    test: typeof scripts.test === "string" ? scripts.test : null,
    start: typeof scripts.start === "string" ? scripts.start : null,
    dev: typeof scripts.dev === "string" ? scripts.dev : null
  };
}

function detectFromFiles(files) {
  const paths = new Set(files.map(item => item.path));
  if (paths.has("package.json")) return "node";
  if (paths.has("requirements.txt") || paths.has("pyproject.toml")) return "python";
  if (paths.has("go.mod")) return "go";
  if (paths.has("Cargo.toml")) return "rust";
  if (paths.has("Dockerfile")) return "docker";
  return "unknown";
}

export function createBuildPlan({ repository, branch, repo, files }) {
  const packageFile = files.find(item => item.path === "package.json");
  let pkg = null;
  if (packageFile) {
    try { pkg = JSON.parse(packageFile.content); } catch { throw new Error("package.json is invalid JSON"); }
  }
  const runtime = detectFromFiles(files);
  const scripts = packageScripts(pkg);
  let buildCommand = null, testCommand = null, startCommand = null;
  if (runtime === "node") {
    buildCommand = scripts.build || null;
    testCommand = scripts.test || null;
    startCommand = scripts.start || (scripts.dev ? scripts.dev : null);
  } else if (runtime === "python") {
    testCommand = "python -m pytest";
    startCommand = "python main.py";
  } else if (runtime === "go") {
    buildCommand = "go build ./...";
    testCommand = "go test ./...";
    startCommand = null;
  } else if (runtime === "rust") {
    buildCommand = "cargo build --release";
    testCommand = "cargo test";
    startCommand = null;
  } else if (runtime === "docker") {
    buildCommand = "docker build -t bhai-cloud-app .";
    startCommand = null;
  }
  return {
    repository,
    branch: branch || repo?.defaultBranch || "main",
    runtime,
    framework: runtime === "node" ? (pkg?.dependencies?.next ? "next" : pkg?.dependencies?.vite ? "vite" : pkg?.dependencies?.express ? "express" : "node") : runtime,
    commands: { install: runtime === "node" ? "npm ci" : runtime === "python" ? "python -m pip install -r requirements.txt" : null, build: buildCommand, test: testCommand, start: startCommand },
    deployable: Boolean(runtime !== "unknown" && (startCommand || buildCommand)),
    sourceFiles: files.map(item => item.path)
  };
}

export async function runBuildPlan(plan, { cwd } = {}) {
  if (!plan || !plan.runtime) throw new Error("build plan is required");
  const { buildRunnerInfo, runBuildCommand } = await import("./buildRunner.js");
  if (!buildRunnerInfo().enabled) {
    const error = new Error("Build runner is disabled"); error.code = "BUILD_RUNNER_DISABLED"; error.status = 503; throw error;
  }
  const steps = [];
  for (const [name, command] of Object.entries(plan.commands || {})) {
    if (!command || name === "start") continue;
    const result = await runBuildCommand(command, { cwd });
    steps.push({ name, ...result });
    if (!result.ok) return { ok: false, repository: plan.repository, runtime: plan.runtime, steps };
  }
  return { ok: true, repository: plan.repository, runtime: plan.runtime, steps };
}

export function buildPlanInfo() {
  return { maxPackageChars: LIMIT, supportedRuntimes: ["node","python","go","rust","docker"] };
}

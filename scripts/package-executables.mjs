import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { copyFile, cp } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")
const releaseDir = path.join(rootDir, "release")
const stagingDir = path.join(releaseDir, ".staging")
const serverDir = path.join(rootDir, "packages", "server")
const uiDistDir = path.join(rootDir, "packages", "ui", "dist")
const pkgCacheDir = path.join(rootDir, "node_modules", ".cache", "pkg")
const pkgBinPath = path.join(rootDir, "node_modules", "@yao-pkg", "pkg", "lib-es5", "bin.js")

const rootPackage = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"))
const serverPackage = JSON.parse(readFileSync(path.join(serverDir, "package.json"), "utf8"))
const versionLabel = String(rootPackage.version).startsWith("v")
  ? rootPackage.version
  : `v${rootPackage.version}`

const allTargets = {
  linux: {
    pkgTarget: "node22-linux-x64",
    output: `tspanelio-linux-x64-${versionLabel}`,
  },
  macos: {
    pkgTarget: "node22-macos-x64",
    output: `tspanelio-macos-x64-${versionLabel}`,
  },
  windows: {
    pkgTarget: "node22-win-x64",
    output: `tspanelio-win-x64-${versionLabel}.exe`,
  },
}

const requestedTarget = readRequestedTarget()
const targets = requestedTarget ? { [requestedTarget]: allTargets[requestedTarget] } : allTargets

run("npm", ["run", "build:release"])

if (!existsSync(path.join(uiDistDir, "index.html"))) {
  throw new Error("packages/ui/dist/index.html was not found after build:release.")
}

rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(stagingDir, { recursive: true })

await copyServerRuntime(serverDir, stagingDir)
await cp(uiDistDir, path.join(stagingDir, "public"), { recursive: true })

writeFileSync(
  path.join(stagingDir, "package.json"),
  `${JSON.stringify(
    {
      name: "tspanelio-runtime",
      version: rootPackage.version,
      private: true,
      description: rootPackage.description,
      main: "app.js",
      bin: "app.js",
      dependencies: serverPackage.dependencies,
      pkg: {
        scripts: ["**/*.js"],
        assets: ["public/**/*"],
      },
    },
    null,
    2,
  )}\n`,
)

for (const target of Object.values(targets)) {
  run(process.execPath, [
    pkgBinPath,
    path.join(stagingDir, "package.json"),
    "--targets",
    target.pkgTarget,
    "--no-bytecode",
    "--public",
    "--output",
    path.join(releaseDir, target.output),
  ])
}

rmSync(stagingDir, { recursive: true, force: true })

console.log("Created release executables:")
for (const target of Object.values(targets)) {
  console.log(`- ${path.relative(rootDir, path.join(releaseDir, target.output))}`)
}

function readRequestedTarget() {
  const targetArg = process.argv.find((arg) => arg.startsWith("--target="))
  const targetIndex = process.argv.indexOf("--target")
  const target = targetArg?.slice("--target=".length) ?? (targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined)

  if (!target) {
    return undefined
  }

  if (!Object.hasOwn(allTargets, target)) {
    throw new Error(`Unknown package target "${target}". Use linux, macos, or windows.`)
  }

  return target
}

async function copyServerRuntime(sourceDir, destinationDir) {
  for (const entry of readdirSync(sourceDir)) {
    if (shouldSkipServerEntry(entry)) {
      continue
    }

    const source = path.join(sourceDir, entry)
    const destination = path.join(destinationDir, entry)

    if (statSync(source).isDirectory()) {
      await cp(source, destination, {
        recursive: true,
        filter: (item) => !shouldSkipServerEntry(path.basename(item)),
      })
    } else {
      await copyFile(source, destination)
    }
  }
}

function shouldSkipServerEntry(entry) {
  return (
    entry === "node_modules" ||
    entry === ".env" ||
    entry === "server" ||
    entry === "server.exe" ||
    entry === "tspanelio" ||
    entry === "tspanelio.exe" ||
    entry.endsWith(".log")
  )
}

function run(command, args) {
  const executable = process.platform === "win32" && ["npm", "npx"].includes(command)
    ? `${command}.cmd`
    : command
  const usesCommandShim = process.platform === "win32" && ["npm", "npx"].includes(command)

  const result = spawnSync(executable, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      PKG_CACHE_PATH: pkgCacheDir,
    },
    stdio: "inherit",
    shell: usesCommandShim,
  })

  if (result.status !== 0) {
    if (result.error) {
      throw result.error
    }

    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`)
  }
}

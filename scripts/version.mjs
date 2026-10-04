import { appendFile, mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootIndex = process.argv.indexOf('--root')
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : sourceRoot)
const outputIndex = process.argv.indexOf('--output-dir')
const outputDir = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.resolve(root, '..', '..', 'outputs')
const dryRun = process.argv.includes('--dry-run')
const syncOnly = process.argv.includes('--sync')
const allocateDev = process.argv.includes('--allocate-dev') || process.argv.includes('--advance')
const finalize = process.argv.includes('--finalize')
const modes = [dryRun, syncOnly, allocateDev, finalize].filter(Boolean).length
if (modes !== 1) throw new Error('Choose one version action: --dry-run, --sync, --allocate-dev, or --finalize.')
if (rootIndex >= 0 && !process.argv[rootIndex + 1]) throw new Error('--root requires a project directory.')
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('--output-dir requires a directory.')

const versionFile = path.join(root, 'version.json')
const lockFile = path.join(root, 'work', 'package-build.lock')
const readState = async () => JSON.parse(await readFile(versionFile, 'utf8'))
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function scanHighestArtifactSequence(baseVersion) {
  const dirs = [
    outputDir,
    path.resolve(root, '..', '..', 'outputs'),
    path.resolve(root, '..', '..', 'work', 'native-renderer', 'artifacts'),
    path.join(root, 'work'),
  ]
  const pattern = new RegExp(`(?:^|-)${escaped(baseVersion)}-dev\\.(\\d+)(?=$|[.-])`)
  let highest = 0
  for (const directory of new Set(dirs)) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const entry of entries) {
      const match = entry.name.match(pattern)
      if (match) highest = Math.max(highest, Number(match[1]))
    }
  }
  return highest
}

async function acquireLock() {
  await mkdir(path.dirname(lockFile), { recursive: true })
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    try {
      const handle = await open(lockFile, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
      return async () => {
        await handle.close()
        try { await unlink(lockFile) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const info = await stat(lockFile)
        if (Date.now() - info.mtimeMs > 60_000) {
          let lock
          try { lock = JSON.parse(await readFile(lockFile, 'utf8')) } catch { lock = null }
          let alive = false
          if (Number.isInteger(lock?.pid)) {
            try { process.kill(lock.pid, 0); alive = true } catch (probeError) { alive = probeError.code === 'EPERM' }
          }
          let exclusivelyAvailable = false
          try {
            const probe = await open(lockFile, 'r+')
            await probe.close()
            exclusivelyAvailable = true
          } catch { }
          if (!alive && exclusivelyAvailable) { await unlink(lockFile); continue }
        }
      } catch (probeError) { if (probeError.code !== 'ENOENT') throw probeError }
      await delay(100)
    }
  }
  throw new Error(`Timed out waiting for version metadata lock: ${lockFile}`)
}

function replaceOne(content, expression, replacement, label) {
  if (!expression.test(content)) throw new Error(`Cannot synchronize ${label}; expected version field was not found.`)
  return content.replace(expression, replacement)
}

async function synchronize(state, { saveState, changelogEntry } = {}) {
  const version = state.version
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/)
  if (!match) throw new Error(`Unsupported version: ${version}`)
  const [, major, minor, patch, prerelease] = match
  const numericVersion = `${major}.${minor}.${patch}.${prerelease ?? 65535}`
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  packageJson.version = version
  packageLock.version = version
  if (packageLock.packages?.['']) packageLock.packages[''].version = version

  let desktop = await readFile(path.join(root, 'DesktopProgram.cs'), 'utf8')
  desktop = replaceOne(desktop, /\[assembly: AssemblyVersion\("[^"]+"\)\]/,
    `[assembly: AssemblyVersion("${numericVersion}")]`, 'DesktopProgram AssemblyVersion')
  desktop = replaceOne(desktop, /\[assembly: AssemblyFileVersion\("[^"]+"\)\]/,
    `[assembly: AssemblyFileVersion("${numericVersion}")]`, 'DesktopProgram AssemblyFileVersion')
  desktop = replaceOne(desktop, /\[assembly: AssemblyInformationalVersion\("[^"]+"\)\]/,
    `[assembly: AssemblyInformationalVersion("${version}")]`, 'DesktopProgram AssemblyInformationalVersion')
  desktop = replaceOne(desktop, /private const string AppVersion = "[^"]+";/,
    `private const string AppVersion = "${version}";`, 'DesktopProgram AppVersion')

  const manifestPath = path.join(root, 'app.manifest')
  const manifest = replaceOne(await readFile(manifestPath, 'utf8'),
    /(<assemblyIdentity version=")[^"]+(" name="RhineMusic\.Desktop"\s*\/?>)/,
    `$1${numericVersion}$2`, 'Windows assembly manifest')
  const buildVersion = `// Generated from version.json by scripts/version.mjs.\nexport const BUILD_VERSION = ${JSON.stringify(version)};\n`

  let readme = await readFile(path.join(root, 'README.md'), 'utf8')
  if (/^Windows build: .*$/m.test(readme)) {
    readme = replaceOne(readme, /^Windows build: .*$/m,
      `Windows build: ${version}`, 'README build version')
  } else {
    readme = replaceOne(readme,
      /^\*\*当前版本：[^*]+\*\* · \*\*维护者：\*\* \[Bong712\]\(https:\/\/github\.com\/Bong712\)$/m,
      `**当前版本：${version}** · **维护者：** [Bong712](https://github.com/Bong712)`, 'README build version')
    readme = readme.replace(/当前发行使用 `\d+\.\d+\.\d+(?:-dev\.\d+)?` 版本号/g,
      `当前发行使用 \`${version}\` 版本号`)
    readme = readme.replace(/RELEASE_NOTES_\d+\.\d+\.\d+(?:-dev\.\d+)?\.md/g,
      `RELEASE_NOTES_${version}.md`)
  }
  readme = readme.replace(/^\d+\.\d+\.\d+(?:-dev\.\d+)? 是本机开发候选包/m,
    `${version} 是本机开发候选包`)
  readme = readme.replace(/Rhine-Music-Desktop-\d+\.\d+\.\d+(?:-dev\.\d+)?\.exe/g,
    `Rhine-Music-Desktop-${version}.exe`)
  readme = readme.replace(/app-v\d+\.\d+\.\d+(?:-dev\.\d+)?/g, `app-v${version}`)

  const writes = [
    [path.join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`],
    [path.join(root, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`],
    [path.join(root, 'src', 'build-version.ts'), buildVersion],
    [path.join(root, 'DesktopProgram.cs'), desktop],
    [manifestPath, manifest],
    [path.join(root, 'README.md'), readme],
  ]
  if (saveState) writes.unshift([versionFile, `${JSON.stringify(state, null, 2)}\n`])
  for (const [file, content] of writes) await writeFile(file, content, 'utf8')

  if (changelogEntry) {
    const changelogPath = path.join(root, 'CHANGELOG.md')
    const current = await readFile(changelogPath, 'utf8')
    if (!current.includes(`## ${version} (`)) {
      const day = new Date().toISOString().slice(0, 10)
      await appendFile(changelogPath,
        `\n## ${version} (${day})\n\n- ${changelogEntry}\n`, 'utf8')
    }
  }
  return { version, numericVersion }
}

let state = await readState()
if (dryRun) {
  if (state.channel !== 'dev') throw new Error('Only a development candidate can be previewed.')
  const versionMatch = state.version.match(/-dev\.(\d+)$/)
  const highest = Math.max(Number(state.sequence) || 0, Number(versionMatch?.[1]) || 0,
    await scanHighestArtifactSequence(state.baseVersion))
  const sequence = highest + 1
  process.stdout.write(JSON.stringify({ version: `${state.baseVersion}-dev.${sequence}`, sequence, state: 'dry-run; files unchanged' }, null, 2) + '\n')
  process.exit(0)
}

const releaseAcceptance = async () => {
  if (state.channel !== 'dev') throw new Error('Only a development candidate can be finalized.')
  const acceptancePath = path.join(root, 'performance-acceptance.json')
  let acceptance
  try { acceptance = JSON.parse(await readFile(acceptancePath, 'utf8')) }
  catch { throw new Error('A final release requires a verified performance-acceptance.json report.') }
  const requiredScenarios = ['cold-switch', 'warm-switch', 'rapid-switch', 'album-detail', 'theme-switch', 'large-library']
  const scenarios = new Map((Array.isArray(acceptance.scenarios) ? acceptance.scenarios : []).map(item => [item?.name, item]))
  const allScenariosPass = requiredScenarios.every(name => {
    const item = scenarios.get(name)
    return item?.renderResolution === '3840x2160'
      && item?.displayedFps >= 60
      && item?.p95DisplayIntervalMs <= 16.67
  })
  if (acceptance.status !== 'passed' || acceptance.captureTool !== 'PresentMon'
    || acceptance.displayMetric !== 'MsBetweenDisplayChange'
    || acceptance.renderQuality !== 'original' || acceptance.upscaled !== false
    || !allScenariosPass) {
    throw new Error('A final release requires PresentMon display-interval evidence at native 3840x2160/original quality, passing all six scenarios at 60 displayed FPS or higher.')
  }
}

const releaseLock = process.env.RHINE_BUILD_LOCK_HELD === '1'
  ? async () => {}
  : await acquireLock()
try {
  state = await readState()
  if (finalize) await releaseAcceptance()
  let action
  if (syncOnly) {
    action = 'synced; version unchanged'
  } else if (allocateDev) {
    if (state.channel !== 'dev') throw new Error('A final release must be created from a passed acceptance report.')
    const current = state.version.match(/-dev\.(\d+)$/)
    const highest = Math.max(Number(state.sequence) || 0, Number(current?.[1]) || 0,
      await scanHighestArtifactSequence(state.baseVersion))
    state.sequence = highest + 1
    state.version = `${state.baseVersion}-dev.${state.sequence}`
    action = `allocated unique development package ${state.version}`
  } else {
    state.channel = 'release'
    state.version = state.baseVersion
    action = 'finalized after performance acceptance'
  }
  const result = await synchronize(state, {
    saveState: !syncOnly,
    changelogEntry: syncOnly ? undefined : finalize
      ? 'Windows desktop release build after verified real-present performance acceptance.'
      : 'Windows desktop development package; 3840×2160 real-present 60 FPS acceptance is pending.',
  })
  process.stdout.write(JSON.stringify({ ...result, sequence: state.sequence, action }, null, 2) + '\n')
} finally {
  await releaseLock()
}

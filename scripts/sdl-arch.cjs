// electron-builder beforePack/afterPack hook for macOS: @kmamal/sdl installs the native binding for the machine that
// ran `npm install`, so an Intel package built on Apple Silicon (or the reverse) would ship the wrong one. Before each
// macOS package, fetch the binding for the package's architecture; afterward, put back the one for this machine.
const { execFileSync } = require('child_process')
const { existsSync } = require('fs')
const { join } = require('path')
const { Arch } = require('builder-util')

const SCRIPTS = join(__dirname, '..', 'node_modules', '@kmamal', 'sdl', 'scripts')

function fetchBinding(arch) {
  if (!existsSync(SCRIPTS)) return // optional dependency not installed: the app falls back to the Gamepad API
  console.log(`  • @kmamal/sdl binding for darwin-${arch}`)
  execFileSync(process.execPath, ['download-release.mjs'], { cwd: SCRIPTS, stdio: 'inherit', env: { ...process.env, CROSS_COMPILE_ARCH: arch } })
}

/** beforePack: the binding for the package being built. */
exports.beforePack = async (context) => {
  if (context.electronPlatformName !== 'darwin') return
  const arch = Arch[context.arch]
  if (arch !== process.arch) fetchBinding(arch)
}

/** afterPack: this machine's binding again, so `npm run dev` keeps working. */
exports.afterPack = async (context) => {
  if (context.electronPlatformName !== 'darwin') return
  if (Arch[context.arch] !== process.arch) fetchBinding(process.arch)
}

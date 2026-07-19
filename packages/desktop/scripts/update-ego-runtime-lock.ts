import { captureEgoRuntime, egoRuntimeLockPath, readEgoRuntimeLock, vendoredEgoLitePath, verifyEgoRuntime } from "./ego-runtime-lock"

const approval = "--accept-reviewed-local-vendor"
if (process.argv.length !== 3 || process.argv[2] !== approval) {
  throw new Error(`This owner-only command only records the already-vendored local app. Review that app, then rerun with ${approval}.`)
}

const current = await readEgoRuntimeLock()
const next = await captureEgoRuntime(vendoredEgoLitePath, current)
await Bun.write(egoRuntimeLockPath, `${JSON.stringify(next, null, 2)}\n`)
await verifyEgoRuntime(vendoredEgoLitePath, next)

console.log("Ego runtime lock updated from the reviewed local vendor app; no network update was attempted.")
console.log(`Lock: ${egoRuntimeLockPath}`)

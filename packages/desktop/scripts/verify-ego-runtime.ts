import { egoRuntimeLockPath, vendoredEgoLitePath, verifyEgoRuntime } from "./ego-runtime-lock"

await verifyEgoRuntime()

console.log("Vendored Ego runtime lock verification passed.")
console.log(`Lock: ${egoRuntimeLockPath}`)
console.log(`App: ${vendoredEgoLitePath}`)

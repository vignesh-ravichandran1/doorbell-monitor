// Runs after `npm install`. Fixes two bugs in @eneris/push-receiver (used by ring-client-api
// for ding/motion events):
//  1. It reads the sender key with value.slice(3), assuming the crypto-key header is only
//     "dh=<key>". Headers like "dh=<key>;p256ecdsa=<key>" then fail with
//     ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY. Parse the dh= / salt= parameters properly instead.
//  2. Any other decrypt error crashes the whole app. Drop just that message instead.
// Idempotent: does nothing if already patched or if the library changed shape.
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'node_modules', '@eneris', 'push-receiver', 'dist', 'utils', 'decrypt.js')
const clientFile = path.join(path.dirname(file), '..', 'client.js')
const MARK = '/* doorbell-monitor patch */'

function patch(target, edits) {
  if (!fs.existsSync(target)) return console.log(`patch: ${path.basename(target)} not found, skipping`)
  let src = fs.readFileSync(target, 'utf8')
  if (src.includes(MARK)) return
  for (const [from, to] of edits) {
    if (!src.includes(from)) return console.log(`patch: ${path.basename(target)} changed upstream, skipping`)
    src = src.replace(from, to)
  }
  fs.writeFileSync(target, `${MARK}\n${src}`)
  console.log(`patch: fixed ${path.relative(path.join(__dirname, '..'), target)}`)
}

patch(file, [
  ['function decrypt(object, keys) {',
   "function param(value, name) {\n    const part = value.split(/[;,]/).map(s => s.trim()).find(s => s.startsWith(name + '='));\n    return part ? part.slice(name.length + 1) : value.slice(name.length + 1);\n}\nfunction decrypt(object, keys) {"],
  ['dh: cryptoKey.value.slice(3),', "dh: param(cryptoKey.value, 'dh'),"],
  ['salt: salt.value.slice(5),', "salt: param(salt.value, 'salt'),"],
])

patch(clientFile, [
  ["                default:\n                    throw error;\n            }\n        }\n        // Maintain persistentIds",
   "                default:\n                    logger_1.default.warn('Message dropped as it could not be decrypted: ' + error.message);\n                    return;\n            }\n        }\n        // Maintain persistentIds"],
])

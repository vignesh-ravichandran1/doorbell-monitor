// Run by windows\start-doorbell.bat before every start of the recorder: undoes an update
// from the Settings page that keeps failing to start. Keep this file tiny and dependency-free.
// Its messages go to logs\recorder-*.log too: as SYSTEM nobody sees this console.
import path from 'node:path'
import { startFileLog } from './lifecycle.js'
import { APP_DIR, guard } from './updater.js'

startFileLog(path.join(APP_DIR, 'logs'))
const log = (m) => console.log(new Date().toLocaleString(), m)
try {
  const result = await guard(log)
  if (result === 'rolled back') log('update guard: rolled back to the previous version (the update did not start properly)')
  else if (result === 'waiting') log('update guard: starting the updated version; it is kept once it runs for a minute')
} catch (e) {
  log(`update guard failed: ${e.message}`)
}

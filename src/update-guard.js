// Run by windows\start-doorbell.bat before every start of the recorder: undoes an update
// from the Settings page that keeps failing to start. Keep this file tiny and dependency-free.
import { guard } from './updater.js'

try {
  const result = await guard((m) => console.log(new Date().toLocaleString(), m))
  if (result === 'rolled back') console.log('Rolled back to the previous version.')
} catch (e) {
  console.log('update guard:', e.message)
}

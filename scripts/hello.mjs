import { app } from 'electron'
app.whenReady().then(() => {
  process.stdout.write('electron-ok ' + process.versions.electron + '\n')
  app.exit(0)
})

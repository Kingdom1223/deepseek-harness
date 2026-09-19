import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const profileUrl = new URL('../resources/desktop-profile/cordis.patch.yml', import.meta.url)
const workflowUrl = new URL('../.github/workflows/release.yml', import.meta.url)

test('release checks keep the Windows ACL sandbox while selecting the inbox PowerShell host', async () => {
  const [profile, workflow] = await Promise.all([
    readFile(profileUrl, 'utf8'),
    readFile(workflowUrl, 'utf8'),
  ])

  assert.match(profile, /pwshPath:\s*!!js process\.env\.DSH_PWSH_PATH/u)
  assert.equal(
    workflow.match(/\$env:DSH_PWSH_PATH\s*=\s*'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe'/gu)?.length,
    2,
  )
  assert.equal(workflow.match(/\$env:DSH_PERMISSION_MODE\s*=\s*'danger-full-access'/gu)?.length, 2)
  assert.equal(workflow.match(/\$env:DSH_SKIP_PWSH_SMOKE\s*=\s*'1'/gu)?.length, 2)
  assert.equal(workflow.match(/DSH_CI_PWSH_OK/gu)?.length, 2)
})

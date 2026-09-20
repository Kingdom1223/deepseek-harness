import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('desktop icon uses the official DeepSeek FishLogo path and blue brand color', async () => {
  const icon = await readFile(new URL('../build/icon.svg', import.meta.url), 'utf8')

  assert.match(icon, /viewBox="0 0 23\.16 23\.16"/)
  assert.match(icon, /fill="#4D6BFE"/)
  assert.match(icon, /M22\.9168 1\.43018C22\.6713/)
  assert.doesNotMatch(icon, /linearGradient|M196 150|M316 150/)
})

test('desktop shell keeps appearance changes isolated and reuses the official sidebar logo', async () => {
  const shell = await readFile(new URL('../src/desktop/desktop-shell.js', import.meta.url), 'utf8')

  assert.match(shell, /--dshd-card-bg:/)
  assert.match(shell, /\.bhn1Oq_groupSection/)
  assert.match(shell, /\[data-dockkit-pane\]/)
  assert.match(shell, /\.uV2eYG_card/)
  assert.match(shell, /\.hHd-Xa_brandMark svg/)
  assert.doesNotMatch(shell, /dshd-titlebar__dot/)
})

test('appearance selectors stay compatible with the installed official UI modules', async () => {
  const modules = await Promise.all([
    readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url), 'utf8'),
  ])
  const officialUi = modules.join('\n')

  for (const className of [
    'pI_x6G_frame',
    'pI_x6G_centerCol',
    'hHd-Xa_root',
    'hHd-Xa_brandMark',
    'bhn1Oq_groupSection',
    'uV2eYG_card',
  ]) assert.match(officialUi, new RegExp(`\\.${className}(?:[,{.:])`))
})

/**
 * Electron 运行时的稳定冒烟契约。
 *
 * 开发态脚本和打包后的 `--smoke-test` 共用这里，避免发布检查逐渐变成另一套逻辑。
 * 只做无副作用的读取和故意失败的校验请求，不创建会话或打开外部程序。
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { ORIGIN } from './page-protocol.js'
import { profileDir } from './paths.js'
import { decodeTransportResponse, encodeTransportRequest } from '../shared/transport-codec.js'

/**
 * @param {object} options
 * @param {import('./transport.js').DesktopTransport} options.transport
 * @param {{capability: () => {kind: string, pick: (signal: AbortSignal) => Promise<string | null>}}} options.directoryPicker
 * @param {{resolveMountable: (id: string) => Promise<any>, ensureStanding: (preset: any) => Promise<any>}} options.agentPresets
 * @param {{spawn: (spec: any) => any}} options.subprocess
 * @param {{resolve: (request: any) => any, run: (spec: any) => Promise<any>}} options.shell
 * @param {string} options.shellWorkspace
 * @param {{getState: () => any}} [options.updateService]
 * @param {(input: string, init?: RequestInit) => Promise<Response>} options.fetchImpl
 * @param {(message: string) => void} [options.report]
 */
export async function runElectronSmokeChecks(options) {
  const { transport, directoryPicker, agentPresets, subprocess, shell, shellWorkspace, updateService, fetchImpl } = options
  const report = options.report ?? (() => {})

  /** @param {string} name @param {() => Promise<void>} run */
  const check = async (name, run) => {
    const started = Date.now()
    report(`run  ${name}`)
    await run()
    report(`ok   ${name} (${String(Date.now() - started)}ms)`)
  }

  const runCollected = async (argv, cwd = profileDir()) => {
    assert.ok(subprocess)
    const handle = subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 1024 * 1024 },
        stderr: { maxBytes: 1024 * 1024 },
      },
      graceMs: 1_000,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    assert.equal(outcome.signal, null, stderr)
    assert.equal(outcome.exitCode, 0, stderr)
    return { stdout, stderr }
  }

  await check('node-pty 原生终端', async () => {
    const { spawn } = await import('node-pty')
    const shell = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'echo DSH_PTY_OK']
      : ['-lc', 'printf DSH_PTY_OK']
    await new Promise((resolve, reject) => {
      let output = ''
      const terminal = spawn(shell, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env,
      })
      const timer = setTimeout(() => {
        terminal.kill()
        reject(new Error('node-pty 子进程在 10000ms 内没有退出'))
      }, 10_000)
      terminal.onData((chunk) => {
        output += chunk
      })
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timer)
        try {
          assert.equal(exitCode, 0)
          assert.match(output, /DSH_PTY_OK/)
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
  })

  await check('sharp 原生图片模块', async () => {
    const { default: sharp } = await import('sharp')
    const png = await sharp({
      create: { width: 1, height: 1, channels: 4, background: '#00000000' },
    }).png().toBuffer()
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  })

  await check('koffi 原生调用模块', async () => {
    const koffi = await import('koffi')
    assert.ok(koffi.default ?? koffi)
  })

  await check('Windows Job 命令执行器', async () => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const result = await runCollected([
      powershell,
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Write-Output 'DSH_SUBPROCESS_OK'",
    ])
    assert.match(result.stdout, /DSH_SUBPROCESS_OK/)
  })

  await check('ripgrep 文件搜索执行链', async () => {
    const { rgPath } = await import('@vscode/ripgrep')
    const result = await runCollected([rgPath, '--no-config', '--files', profileDir()])
    assert.match(result.stdout.replaceAll('\\', '/'), /desktop-profile\/cordis\.yml|cordis\.yml/)
  })

  const skipPwshSmoke = process.env.DSH_SKIP_PWSH_SMOKE === '1'
  if (skipPwshSmoke) {
    report('skip 模型 pwsh 沙箱执行链（CI 外层已验证 PowerShell 主机）')
  } else await check('模型 pwsh 沙箱执行链', async () => {
    assert.ok(shell)
    assert.equal(typeof shellWorkspace, 'string')
    const probeFile = join(shellWorkspace, 'dsh-shell-smoke.txt')
    const quotedProbeFile = probeFile.replaceAll("'", "''")
    try {
      const spec = shell.resolve({
        command: `[IO.File]::WriteAllText('${quotedProbeFile}', 'DSH_SHELL_WRITE_OK', [Text.UTF8Encoding]::new($false)); Write-Output 'DSH_SHELL_OK'`,
        workdir: shellWorkspace,
        sandboxPolicy: {
          mode: 'workspace-write',
          workspaceRoot: shellWorkspace,
        },
      })
      const result = await shell.run(spec)
      assert.equal(result.signal, null, result.stderr?.text ?? '')
      assert.equal(result.exitCode, 0, result.stderr?.text ?? '')
      assert.match(result.stdout?.text ?? '', /DSH_SHELL_OK/)
      assert.equal(readFileSync(probeFile, 'utf8'), 'DSH_SHELL_WRITE_OK')
      assert.equal(result.sandbox?.mode, 'workspace-write')
    } finally {
      rmSync(probeFile, { force: true })
    }
  })

  await check('Gateway WebSocket 事件流', async () => {
    const carrierId = `smoke-${String(Date.now())}`
    let opened = false
    await Promise.race([
      transport.openStream({ carrierId }, {
        post: (frame) => {
          if (frame?.kind === 'open') {
            opened = true
            transport.deliverToCarrier(carrierId, { kind: 'close', code: 1000, reason: 'smoke complete' })
          }
          if (frame?.kind === 'error') throw new Error(String(frame.message ?? '事件流失败'))
        },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('事件流在 10000ms 内未接通并关闭')), 10_000)),
    ])
    assert.equal(opened, true)
  })

  await check('Electron 工作区目录选择能力', async () => {
    const capability = directoryPicker?.capability()
    assert.equal(capability?.kind, 'native')
    // 无窗口门禁的宿主回调等价于用户取消，不能在 CI 中弹出真实对话框。
    assert.equal(await capability.pick(new AbortController().signal), null)
  })

  await check('首次 API 配置与工作区客户端模块', async () => {
    const graph = transport.bootstrapPayload({}).bootGraph
    const serialized = JSON.stringify(graph)
    assert.match(serialized, /@deepseek-ai\/dsh-client-ui-settings-models/)
    assert.match(serialized, /@deepseek-ai\/dsh-client-ui-directory-picker-native/)
  })

  await check('桌面更新服务接口', async () => {
    if (updateService === undefined) return
    const state = updateService.getState()
    assert.equal(typeof state.currentVersion, 'string')
    assert.equal(typeof state.phase, 'string')
    assert.equal(typeof state.supported, 'boolean')
    assert.ok(['stable', 'beta'].includes(state.channel))
  })

  await check('standard Agent Preset 可解析并挂载', async () => {
    assert.ok(agentPresets)
    const preset = await agentPresets.resolveMountable('standard')
    assert.equal(preset.id, 'standard')
    await agentPresets.ensureStanding(preset)
  })

  await check('app:// 引导页面', async () => {
    const response = await fetchImpl(`${ORIGIN}/`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
    assert.match(await response.text(), /__DSH_BOOT__/)
  })

  await check('app:// 静态资源', async () => {
    const response = await fetchImpl(`${ORIGIN}/manifest.webmanifest`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /^application\/manifest\+json/)
  })

  await check('动态宿主 GET 路由 /open-in-app/apps', async () => {
    const response = await fetchImpl(`${ORIGIN}/open-in-app/apps`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.ok(Array.isArray(payload.apps))
  })

  await check('动态宿主 POST 能读取请求体', async () => {
    const response = await fetchImpl(`${ORIGIN}/open-in-app/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 42, path: false }),
    })
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.match(payload.message, /string "app" and "path"/)
  })

  await check('精确 Fetch 路由 /api/present.host', async () => {
    const response = await fetchImpl(`${ORIGIN}/api/present.host`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(typeof payload.available, 'boolean')
  })

  await check('HEAD 会话导出路由不是静态 404', async () => {
    const response = await fetchImpl(`${ORIGIN}/api/session.export`, { method: 'HEAD' })
    assert.equal(response.status, 400)
  })

  await check('IPC 版本化信封共用同一精确路由', async () => {
    const request = await encodeTransportRequest(`${ORIGIN}/api/present.host`, {}, 'electron-smoke')
    const response = decodeTransportResponse(await transport.fetch(request))
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(typeof payload.available, 'boolean')
  })
}

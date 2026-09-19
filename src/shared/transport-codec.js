/**
 * 桌面载具 IPC 协议。
 *
 * 这个文件只依赖 Web 标准对象与 node:buffer，主进程、preload 和 Node 测试都能
 * 共用。协议显式带版本号：后续升级 DSH 或扩展流式传输时，可以新增版本而不必
 * 猜测旧字段的含义。
 */
import { Buffer } from 'node:buffer'

export const TRANSPORT_PROTOCOL_VERSION = 1

/** @param {Headers} source */
function headersToRecord(source) {
  /** @type {Record<string, string>} */
  const headers = {}
  source.forEach((value, name) => {
    headers[name] = value
  })
  return headers
}

/**
 * 把 fetch 的完整输入编码成可通过 Electron structured clone 的信封。
 * Request、Blob、ArrayBuffer、TypedArray、FormData 与 ReadableStream 最终都由
 * Request.arrayBuffer() 归一成原始字节，不再发生 `[object Blob]` 之类的损坏。
 *
 * @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 * @param {string} [id]
 */
export async function encodeTransportRequest(input, init = {}, id = crypto.randomUUID()) {
  const request = new Request(input, init)
  const envelope = {
    version: TRANSPORT_PROTOCOL_VERSION,
    id,
    url: request.url,
    method: request.method,
    headers: headersToRecord(request.headers),
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bytes = Buffer.from(await request.arrayBuffer())
    if (bytes.byteLength > 0) envelope.bodyBase64 = bytes.toString('base64')
  }
  return envelope
}

/**
 * 解码主进程收到的请求信封。兼容旧版 `body` 字符串，便于已发布的 preload 与
 * 新主进程在滚动升级期间短暂共存。
 *
 * @param {any} envelope
 */
export function decodeTransportRequest(envelope) {
  if (envelope === null || typeof envelope !== 'object') throw new TypeError('dsh-desktop: 请求信封必须是对象')
  const version = envelope.version ?? 0
  if (version !== 0 && version !== TRANSPORT_PROTOCOL_VERSION) {
    throw new Error(`dsh-desktop: 不支持的载具协议版本 ${String(version)}`)
  }
  if (typeof envelope.url !== 'string' || envelope.url === '') throw new TypeError('dsh-desktop: 请求 URL 缺失')
  if (typeof envelope.method !== 'string' || envelope.method === '') throw new TypeError('dsh-desktop: 请求方法缺失')

  let body
  if (typeof envelope.bodyBase64 === 'string') body = Buffer.from(envelope.bodyBase64, 'base64')
  else if (typeof envelope.body === 'string') body = Buffer.from(envelope.body, 'utf8')

  return {
    version,
    id: typeof envelope.id === 'string' ? envelope.id : '',
    url: envelope.url,
    method: envelope.method.toUpperCase(),
    headers: new Headers(envelope.headers ?? {}),
    body,
  }
}

/** @param {Response} response */
export async function encodeTransportResponse(response) {
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    version: TRANSPORT_PROTOCOL_VERSION,
    status: response.status,
    statusText: response.statusText,
    headers: headersToRecord(response.headers),
    bodyBase64: bytes.toString('base64'),
  }
}

/** @param {any} envelope */
export function decodeTransportResponse(envelope) {
  if (envelope === null || typeof envelope !== 'object') throw new TypeError('dsh-desktop: 响应信封必须是对象')
  const version = envelope.version ?? 0
  if (version !== 0 && version !== TRANSPORT_PROTOCOL_VERSION) {
    throw new Error(`dsh-desktop: 不支持的响应协议版本 ${String(version)}`)
  }
  const bytes = Buffer.from(envelope.bodyBase64 ?? '', 'base64')
  const status = Number(envelope.status)
  const noBody = status === 101 || status === 103 || status === 204 || status === 205 || status === 304
  return new Response(noBody || bytes.byteLength === 0 ? null : bytes, {
    status,
    statusText: typeof envelope.statusText === 'string' ? envelope.statusText : undefined,
    headers: envelope.headers ?? {},
  })
}


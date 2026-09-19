import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeTransportRequest,
  decodeTransportResponse,
  encodeTransportRequest,
  encodeTransportResponse,
  TRANSPORT_PROTOCOL_VERSION,
} from '../src/shared/transport-codec.js'
import { invokeRouteHandler } from '../src/main/transport.js'

test('request codec preserves Request method, headers and binary body', async () => {
  const original = new Request('app://shell/api/upload?name=test', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-test': 'yes' },
    body: new Uint8Array([0, 1, 2, 127, 255]),
  })
  const encoded = await encodeTransportRequest(original, {}, 'request-1')
  const decoded = decodeTransportRequest(encoded)

  assert.equal(encoded.version, TRANSPORT_PROTOCOL_VERSION)
  assert.equal(decoded.id, 'request-1')
  assert.equal(decoded.method, 'POST')
  assert.equal(decoded.headers.get('x-test'), 'yes')
  assert.deepEqual([...decoded.body], [0, 1, 2, 127, 255])
})

test('request codec preserves Blob bodies instead of stringifying them', async () => {
  const encoded = await encodeTransportRequest('app://shell/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Blob([new Uint8Array([9, 8, 7])]),
  }, 'blob-1')

  assert.deepEqual([...decodeTransportRequest(encoded).body], [9, 8, 7])
})

test('response codec round-trips binary bytes and metadata', async () => {
  const encoded = await encodeTransportResponse(new Response(new Uint8Array([255, 0, 4]), {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'application/octet-stream', 'x-result': 'ok' },
  }))
  const decoded = decodeTransportResponse(encoded)

  assert.equal(decoded.status, 201)
  assert.equal(decoded.statusText, 'Created')
  assert.equal(decoded.headers.get('x-result'), 'ok')
  assert.deepEqual([...new Uint8Array(await decoded.arrayBuffer())], [255, 0, 4])
})

test('node-style route receives the request body and produces a Response', async () => {
  const response = await invokeRouteHandler((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      res.statusCode = 202
      res.setHeader('content-type', 'application/octet-stream')
      res.end(Buffer.concat(chunks))
    })
  }, '/open-in-app/open', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array([3, 1, 4, 1, 5]),
  })

  assert.equal(response.status, 202)
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [3, 1, 4, 1, 5])
})

test('future protocol versions fail loudly', () => {
  assert.throws(() => decodeTransportRequest({ version: 99, url: 'app://shell/api', method: 'GET' }), /协议版本/)
})

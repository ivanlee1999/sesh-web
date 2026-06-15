#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { smokeRuntime } from './smoke-runtime.mjs'

const image = process.env.SMOKE_IMAGE || 'sesh-web:smoke'
const port = process.env.SMOKE_PORT || '3034'
const name = process.env.SMOKE_CONTAINER_NAME || `sesh-web-smoke-${Date.now()}`

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: options.stdio ?? 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

async function waitForRuntime(baseUrl) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL('/api/sessions', baseUrl))
      if (res.ok) return
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw lastError instanceof Error ? lastError : new Error('Runtime did not become healthy')
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'sesh-web-smoke-'))
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    if (process.env.SMOKE_SKIP_BUILD !== '1') {
      await run('docker', ['build', '-t', image, '.'])
    }

    await run('docker', [
      'run',
      '-d',
      '--rm',
      '--name', name,
      '-p', `127.0.0.1:${port}:3000`,
      '-e', 'DISABLE_APP_AUTH=true',
      '-e', 'NEXTAUTH_SECRET=smoke-secret',
      '-e', 'APP_AUTH_USERNAME=smoke',
      '-e', 'APP_AUTH_PASSWORD=smoke',
      '-v', `${dataDir}:/app/data`,
      image,
    ])

    await waitForRuntime(baseUrl)
    await smokeRuntime({ baseUrl })
  } finally {
    await run('docker', ['rm', '-f', name], { stdio: 'ignore' }).catch(() => {})
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

import 'server-only'
import crypto from 'crypto'

/**
 * Encryption at rest for the Things Cloud password.
 *
 * sesh has to replay the password on every request — Things authenticates with
 * `Authorization: Password <password>` and issues no token — so it cannot be
 * hashed. Encrypting it at least means a stolen sesh.db is not a stolen Things
 * account on its own; the key lives in the environment, not the database.
 */

const ALGORITHM = 'aes-256-gcm'

export class ThingsSecretError extends Error {}

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new ThingsSecretError('NEXTAUTH_SECRET must be set to store a Things password.')
  }
  // A KDF over the app secret: the secret is a passphrase, not a 32-byte key.
  return crypto.createHash('sha256').update(`things:${secret}`).digest()
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.')
}

/**
 * Returns null rather than throwing when the stored value can't be read — a
 * rotated NEXTAUTH_SECRET should surface as "reconnect Things", not a crash.
 */
export function decryptSecret(stored: string): string | null {
  if (!stored) return null
  const [ivB64, tagB64, dataB64] = stored.split('.')
  if (!ivB64 || !tagB64 || !dataB64) return null
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

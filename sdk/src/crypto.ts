import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32   // AES-256
const IV_BYTES = 12    // GCM standard nonce
const TAG_BYTES = 16   // GCM auth tag

let _key: Buffer | null = null
function getKey(): Buffer {
  if (!_key) {
    const hex = process.env.PATCHWAY_ENCRYPTION_KEY
    if (!hex) throw new Error('PATCHWAY_ENCRYPTION_KEY env var is required for encrypt/decrypt operations')
    let buf: Buffer
    try {
      buf = Buffer.from(hex, 'hex')
    } catch {
      throw new Error('PATCHWAY_ENCRYPTION_KEY must be hex')
    }
    // Fail loudly on a misconfigured key — a too-short/long key silently weakens
    // (or breaks) every secret at rest. Must be exactly 32 bytes (64 hex chars).
    if (buf.length !== KEY_BYTES) {
      throw new Error(`PATCHWAY_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars); got ${buf.length}`)
    }
    _key = buf
  }
  return _key
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)   // fresh random nonce per encryption — never reused
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(ciphertext: string): string {
  const key = getKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    throw new Error('Malformed ciphertext — expected iv:tag:data')
  }
  const [ivHex, tagHex, encryptedHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed ciphertext — bad iv/tag length')
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)   // GCM verifies integrity on final() — tampered data throws
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

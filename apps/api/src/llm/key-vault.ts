import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
}

export interface KeyVault {
  encrypt(plain: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret): string;
}

/** AES-256-GCM vault for BYOK provider keys. `masterKeyBase64` must decode to
 * exactly 32 bytes (architecture §8: `LLM_KEY_MASTER_KEY`). */
export function createKeyVault(masterKeyBase64: string): KeyVault {
  const masterKey = Buffer.from(masterKeyBase64, 'base64');
  if (masterKey.length !== 32) {
    throw new Error('LLM_KEY_MASTER_KEY must decode to 32 bytes');
  }

  return {
    encrypt(plain: string): EncryptedSecret {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, masterKey, iv);
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return { ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]), iv };
    },
    decrypt({ ciphertext, iv }: EncryptedSecret): string {
      const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_LENGTH);
      const encrypted = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }
  };
}

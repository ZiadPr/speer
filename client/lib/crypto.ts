// Unambiguous Crockford-like alphabet (excludes 0, O, 1, I, L)
const ROOM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toHex(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, '');
}

export function generateRoomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return out;
}

export function generateRoomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Derive blind roomId = SHA-256(CODE) hex string.
 * Only this hash is transmitted to the signaling server.
 */
export async function deriveRoomId(code: string): Promise<string> {
  const normalized = normalizeRoomCode(code);
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

/**
 * Derive an AES-256-GCM CryptoKey from URL fragment #SECRET via HKDF-SHA-256.
 * Used client-side to encrypt all SDP and ICE payloads before WebSocket relay.
 */
export async function deriveSignalingKey(secret: string, roomId: string): Promise<CryptoKey> {
  const secretBytes = new TextEncoder().encode(secret);
  const baseKey = await crypto.subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey']);
  const salt = new TextEncoder().encode(roomId);
  const info = new TextEncoder().encode('speer-signaling-v1');

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSignal(key: CryptoKey, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSignal<T>(key: CryptoKey, blob: string): Promise<T> {
  const parts = blob.split('.');
  if (parts.length !== 2) {
    throw new Error('Malformed encrypted payload');
  }
  const iv = fromBase64Url(parts[0]);
  const ciphertext = fromBase64Url(parts[1]);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function generateEcdhKeyPair(): Promise<{
  keyPair: CryptoKeyPair;
  publicKeyB64: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
  const rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return {
    keyPair,
    publicKeyB64: toBase64Url(new Uint8Array(rawPub)),
  };
}

/**
 * Derive 128-bit AES-GCM media encryption key + 6-digit SAS verification code from ECDH.
 */
export async function deriveMediaE2eeKeyAndSas(
  localPrivateKey: CryptoKey,
  localPublicKeyB64: string,
  remotePublicKeyB64: string
): Promise<{
  mediaKeyBytes: ArrayBuffer;
  sasCode: string;
}> {
  const remoteRaw = fromBase64Url(remotePublicKeyB64);
  const remotePubKey = await crypto.subtle.importKey(
    'raw',
    remoteRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: remotePubKey },
    localPrivateKey,
    256
  );

  const hkdfBase = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);

  const sortedPubs = [localPublicKeyB64, remotePublicKeyB64].sort().join(':');
  const salt = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sortedPubs));

  const mediaKeyBytes = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode('speer-media-e2ee-v1'),
    },
    hkdfBase,
    128
  );

  const sasBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode('speer-sas-v1'),
    },
    hkdfBase,
    32
  );

  const view = new DataView(sasBits);
  const num = view.getUint32(0, false) % 1_000_000;
  const padded = num.toString().padStart(6, '0');
  const sasCode = `${padded.slice(0, 3)} ${padded.slice(3, 6)}`;

  return { mediaKeyBytes, sasCode };
}

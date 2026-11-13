interface EncodedFrame {
  data: ArrayBuffer;
  type?: 'key' | 'delta' | 'empty';
}

interface TransformEvent extends Event {
  transformer: {
    readable: ReadableStream<EncodedFrame>;
    writable: WritableStream<EncodedFrame>;
    options: {
      operation: 'encrypt' | 'decrypt';
      kind: 'audio' | 'video';
    };
  };
}

const MAGIC = new Uint8Array([0x53, 0x50, 0x45, 0x52]); // "SPER"
const IV_BYTES = 12;
const TRAILER_BYTES = IV_BYTES + MAGIC.length;

let activeKey: CryptoKey | null = null;
let frameCounter = 0;

self.onmessage = async (event: MessageEvent<{ type: string; keyBytes?: ArrayBuffer }>) => {
  if (event.data?.type === 'setKey' && event.data.keyBytes) {
    activeKey = await crypto.subtle.importKey(
      'raw',
      event.data.keyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  } else if (event.data?.type === 'clearKey') {
    activeKey = null;
  }
};

function getUnencryptedHeaderLength(frame: EncodedFrame, kind: 'audio' | 'video'): number {
  if (kind === 'audio') return 1;
  return frame.type === 'key' ? 10 : 3;
}

async function encryptFrame(
  frame: EncodedFrame,
  kind: 'audio' | 'video',
  controller: TransformStreamDefaultController<EncodedFrame>
) {
  if (!activeKey || frame.data.byteLength === 0) {
    controller.enqueue(frame);
    return;
  }

  const src = new Uint8Array(frame.data);
  const headerLen = Math.min(getUnencryptedHeaderLength(frame, kind), src.byteLength);
  const header = src.subarray(0, headerLen);
  const payload = src.subarray(headerLen);

  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv.subarray(0, 8));
  const view = new DataView(iv.buffer);
  frameCounter = (frameCounter + 1) >>> 0;
  view.setUint32(8, frameCounter, false);

  try {
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: header,
        },
        activeKey,
        payload
      )
    );

    const out = new Uint8Array(headerLen + encrypted.byteLength + TRAILER_BYTES);
    out.set(header, 0);
    out.set(encrypted, headerLen);
    out.set(iv, headerLen + encrypted.byteLength);
    out.set(MAGIC, headerLen + encrypted.byteLength + IV_BYTES);

    frame.data = out.buffer;
    controller.enqueue(frame);
  } catch {
    // Drop corrupted frame
  }
}

async function decryptFrame(
  frame: EncodedFrame,
  kind: 'audio' | 'video',
  controller: TransformStreamDefaultController<EncodedFrame>
) {
  const src = new Uint8Array(frame.data);
  if (!activeKey || src.byteLength <= TRAILER_BYTES) {
    controller.enqueue(frame);
    return;
  }

  const magicStart = src.byteLength - MAGIC.length;
  let hasMagic = true;
  for (let i = 0; i < MAGIC.length; i++) {
    if (src[magicStart + i] !== MAGIC[i]) {
      hasMagic = false;
      break;
    }
  }

  if (!hasMagic) {
    controller.enqueue(frame);
    return;
  }

  const headerLen = Math.min(getUnencryptedHeaderLength(frame, kind), magicStart - IV_BYTES);
  if (headerLen < 0) {
    return;
  }

  const ivStart = magicStart - IV_BYTES;
  const header = src.subarray(0, headerLen);
  const ciphertext = src.subarray(headerLen, ivStart);
  const iv = src.subarray(ivStart, magicStart);

  try {
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: header,
        },
        activeKey,
        ciphertext
      )
    );

    const out = new Uint8Array(headerLen + decrypted.byteLength);
    out.set(header, 0);
    out.set(decrypted, headerLen);
    frame.data = out.buffer;
    controller.enqueue(frame);
  } catch {
    // Drop frames that fail authentication (stale key or tampered frame)
  }
}

(self as unknown as { onrtctransform: ((event: TransformEvent) => void) | null }).onrtctransform = (
  event: TransformEvent
) => {
  const { readable, writable, options } = event.transformer;
  const transformStream = new TransformStream<EncodedFrame, EncodedFrame>({
    transform: (frame, controller) => {
      if (options.operation === 'encrypt') {
        return encryptFrame(frame, options.kind, controller);
      }
      return decryptFrame(frame, options.kind, controller);
    },
  });
  void readable.pipeThrough(transformStream).pipeTo(writable).catch(() => {});
};

type RtpScriptTransformCtor = new (
  worker: Worker,
  options?: Record<string, unknown>
) => RTCRtpScriptTransform;

export function isScriptTransformSupported(): boolean {
  return typeof (window as unknown as { RTCRtpScriptTransform?: RtpScriptTransformCtor })
    .RTCRtpScriptTransform === 'function';
}

export class E2eeMediaController {
  private worker: Worker | null = null;
  private attachedSenders = new WeakSet<RTCRtpSender>();
  private attachedReceivers = new WeakSet<RTCRtpReceiver>();

  constructor() {
    if (isScriptTransformSupported()) {
      this.worker = new Worker(new URL('../workers/e2eeWorker.ts', import.meta.url), {
        type: 'module',
      });
    }
  }

  public get supported(): boolean {
    return this.worker !== null;
  }

  public setMediaKey(keyBytes: ArrayBuffer) {
    if (!this.worker) return;
    const copy = keyBytes.slice(0);
    this.worker.postMessage({ type: 'setKey', keyBytes: copy }, [copy]);
  }

  public clearKey() {
    this.worker?.postMessage({ type: 'clearKey' });
  }

  public attachSender(sender: RTCRtpSender, kind: 'audio' | 'video') {
    if (!this.worker || this.attachedSenders.has(sender)) return;
    const TransformCtor = (window as unknown as { RTCRtpScriptTransform?: RtpScriptTransformCtor })
      .RTCRtpScriptTransform;
    if (!TransformCtor) return;

    if ('transform' in sender) {
      sender.transform = new TransformCtor(this.worker, {
        operation: 'encrypt',
        kind,
      });
      this.attachedSenders.add(sender);
    }
  }

  public attachReceiver(receiver: RTCRtpReceiver, kind: 'audio' | 'video') {
    if (!this.worker || this.attachedReceivers.has(receiver)) return;
    const TransformCtor = (window as unknown as { RTCRtpScriptTransform?: RtpScriptTransformCtor })
      .RTCRtpScriptTransform;
    if (!TransformCtor) return;

    if ('transform' in receiver) {
      receiver.transform = new TransformCtor(this.worker, {
        operation: 'decrypt',
        kind,
      });
      this.attachedReceivers.add(receiver);
    }
  }

  public destroy() {
    this.clearKey();
    this.worker?.terminate();
    this.worker = null;
  }
}

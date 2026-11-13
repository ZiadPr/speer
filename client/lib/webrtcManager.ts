import { useCallStore } from '../stores/useCallStore.ts';
import { useSettingsStore } from '../stores/useSettingsStore.ts';
import type { CallStats, ErrorKey } from '../types/index.ts';
import {
  decryptSignal,
  deriveMediaE2eeKeyAndSas,
  deriveSignalingKey,
  encryptSignal,
  generateEcdhKeyPair,
} from './crypto.ts';
import { E2eeMediaController } from './e2eeTransform.ts';
import { buildRtcConfiguration } from './iceProbe.ts';
import { getResolutionDimensions } from './mediaDevices.ts';

interface EncryptedSignalPayload {
  kind: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface DataChannelControlMessage {
  type: 'e2ee-key' | 'media-state';
  publicKey?: string;
  micMuted?: boolean;
  cameraOff?: boolean;
}

function preferOpusFecDtx(sdp: string): string {
  const lines = sdp.split('\r\n');
  const opusLine = lines.find((l) => l.startsWith('a=rtpmap:') && l.toLowerCase().includes('opus/48000'));
  if (!opusLine) return sdp;

  const payloadType = opusLine.slice('a=rtpmap:'.length).split(' ')[0];
  if (!payloadType) return sdp;

  const fmtpPrefix = `a=fmtp:${payloadType} `;
  let foundFmtp = false;

  const updated = lines.map((line) => {
    if (!line.startsWith(fmtpPrefix)) return line;
    foundFmtp = true;
    let next = line;
    if (!next.includes('useinbandfec=')) next += ';useinbandfec=1';
    if (!next.includes('usedtx=')) next += ';usedtx=1';
    return next;
  });

  if (!foundFmtp) {
    const idx = updated.findIndex((l) => l === opusLine);
    if (idx !== -1) {
      updated.splice(idx + 1, 0, `${fmtpPrefix}minptime=10;useinbandfec=1;usedtx=1`);
    }
  }

  return updated.join('\r\n');
}

function applyVideoCodecPreferences(transceiver: RTCRtpTransceiver) {
  if (typeof transceiver.setCodecPreferences !== 'function') return;
  const capabilities = RTCRtpReceiver.getCapabilities?.('video');
  if (!capabilities?.codecs?.length) return;

  const priority = ['video/AV1', 'video/VP9', 'video/H264', 'video/VP8'];
  const preferred: RTCRtpCodec[] = [];
  const rest: RTCRtpCodec[] = [];

  for (const mime of priority) {
    for (const codec of capabilities.codecs) {
      if (codec.mimeType.toLowerCase() === mime.toLowerCase()) {
        preferred.push(codec);
      }
    }
  }

  for (const codec of capabilities.codecs) {
    const lower = codec.mimeType.toLowerCase();
    if (!priority.some((p) => p.toLowerCase() === lower)) {
      rest.push(codec);
    }
  }

  try {
    transceiver.setCodecPreferences([...preferred, ...rest]);
  } catch {
    // Ignore unsupported codec preference sets
  }
}

export class WebRtcCallManager {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signalingKey: CryptoKey | null = null;
  private e2eeController: E2eeMediaController | null = null;

  private localPeerId = '';
  private remotePeerId: string | null = null;
  private isPolite = true;
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;

  private localEcdh: { keyPair: CryptoKeyPair; publicKeyB64: string } | null = null;
  private pendingRemotePubKey: string | null = null;

  private statsTimer: number | null = null;
  private prevStats = {
    timestamp: 0,
    bytesSent: 0,
    bytesRecv: 0,
    packetsSent: 0,
    packetsLost: 0,
  };
  private lastQualityTier: 'high' | 'medium' | 'low' | null = null;
  private destroyed = false;

  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;
  private screenStream: MediaStream | null = null;
  private cameraTrackRestore: MediaStreamTrack | null = null;

  public async connect(params: {
    roomId: string;
    roomSecret: string;
    isCreator: boolean;
    localStream: MediaStream;
  }) {
    const callStore = useCallStore.getState();
    const settings = useSettingsStore.getState();

    this.signalingKey = await deriveSignalingKey(params.roomSecret, params.roomId);

    if (settings.e2eeEnabled) {
      this.e2eeController = new E2eeMediaController();
      if (!this.e2eeController.supported) {
        callStore.setError('E2EE_UNSUPPORTED');
      } else {
        this.localEcdh = await generateEcdhKeyPair();
      }
    }

    const { rtcConfig, selectedRegion, hasTurn } = await buildRtcConfiguration({
      preferredRegion: settings.preferredRegion,
      hideMyIp: settings.hideMyIp,
    });
    callStore.setActiveRegion(selectedRegion);

    if (settings.hideMyIp && !hasTurn) {
      callStore.setError('TURN_MISSING');
    }

    this.createPeerConnection(rtcConfig, params.localStream);
    this.openWebSocket(params.roomId, params.isCreator);
  }

  private createPeerConnection(rtcConfig: RTCConfiguration, localStream: MediaStream) {
    const callStore = useCallStore.getState();
    const pc = new RTCPeerConnection(rtcConfig);
    this.pc = pc;

    // Add local tracks
    for (const track of localStream.getTracks()) {
      const sender = pc.addTrack(track, localStream);
      if (track.kind === 'audio') {
        this.audioSender = sender;
        this.e2eeController?.attachSender(sender, 'audio');
      } else if (track.kind === 'video') {
        this.videoSender = sender;
        this.cameraTrackRestore = track;
        this.e2eeController?.attachSender(sender, 'video');
      }
    }

    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender.track?.kind === 'video') {
        applyVideoCodecPreferences(transceiver);
      }
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (event.track.kind === 'audio') {
        this.e2eeController?.attachReceiver(event.receiver, 'audio');
      } else if (event.track.kind === 'video') {
        this.e2eeController?.attachReceiver(event.receiver, 'video');
      }
      useCallStore.getState().setRemoteStream(stream);
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.sendEncryptedSignal({
          kind: 'ice',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      useCallStore.getState().setConnectionState(state);
      if (state === 'connected') {
        useCallStore.getState().setPeerConnected(true);
        useCallStore.getState().setPeerLeft(false);
        this.startStatsLoop();
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        useCallStore.getState().setPeerConnected(false);
      }
    };

    pc.oniceconnectionstatechange = () => {
      useCallStore.getState().setIceConnectionState(pc.iceConnectionState);
    };

    pc.onnegotiationneeded = async () => {
      if (!this.remotePeerId || !this.pc) return;
      try {
        this.makingOffer = true;
        const offer = await this.pc.createOffer();
        const tunedOffer: RTCSessionDescriptionInit = {
          type: offer.type,
          sdp: offer.sdp ? preferOpusFecDtx(offer.sdp) : offer.sdp,
        };
        await this.pc.setLocalDescription(tunedOffer);
        if (this.pc.localDescription) {
          await this.sendEncryptedSignal({
            kind: 'offer',
            sdp: this.pc.localDescription.toJSON(),
          });
        }
      } catch {
        // Ignore transient negotiation race
      } finally {
        this.makingOffer = false;
      }
    };

    callStore.setConnectionState('connecting');
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;

    const trySendKey = () => {
      if (channel.readyState === 'open' && this.localEcdh) {
        const msg: DataChannelControlMessage = {
          type: 'e2ee-key',
          publicKey: this.localEcdh.publicKeyB64,
        };
        channel.send(JSON.stringify(msg));
      }
    };

    channel.onopen = () => {
      trySendKey();
      if (this.pendingRemotePubKey) {
        const key = this.pendingRemotePubKey;
        this.pendingRemotePubKey = null;
        void this.finalizeE2ee(key);
      }
    };

    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as DataChannelControlMessage;
        if (msg.type === 'e2ee-key' && msg.publicKey) {
          if (this.localEcdh) {
            void this.finalizeE2ee(msg.publicKey);
          } else {
            this.pendingRemotePubKey = msg.publicKey;
          }
        }
      } catch {
        // Ignore malformed control frame
      }
    };

    if (channel.readyState === 'open') {
      trySendKey();
    }
  }

  private async finalizeE2ee(remotePublicKeyB64: string) {
    if (!this.localEcdh || !this.e2eeController) return;
    try {
      const { mediaKeyBytes, sasCode } = await deriveMediaE2eeKeyAndSas(
        this.localEcdh.keyPair.privateKey,
        this.localEcdh.publicKeyB64,
        remotePublicKeyB64
      );
      this.e2eeController.setMediaKey(mediaKeyBytes);
      useCallStore.getState().setE2eeActive(true);
      useCallStore.getState().setSasCode(sasCode);
    } catch {
      // Leave E2EE inactive on error
    }
  }

  private openWebSocket(roomId: string, isCreator: boolean) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          roomId,
          action: isCreator ? 'create' : 'join',
        })
      );
    };

    ws.onmessage = (event) => {
      let msg: {
        type: string;
        code?: ErrorKey;
        peerId?: string;
        peers?: string[];
        fromPeerId?: string;
        payload?: string;
      };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (msg.type === 'error' && msg.code) {
        useCallStore.getState().setError(msg.code);
        return;
      }

      if (msg.type === 'joined' && msg.peerId) {
        this.localPeerId = msg.peerId;
        if (msg.peers && msg.peers.length > 0) {
          this.onPeerDiscovered(msg.peers[0]);
        }
        return;
      }

      if (msg.type === 'peer-joined' && msg.peerId) {
        this.onPeerDiscovered(msg.peerId);
        return;
      }

      if (msg.type === 'peer-left') {
        this.remotePeerId = null;
        useCallStore.getState().setPeerConnected(false);
        useCallStore.getState().setPeerLeft(true);
        useCallStore.getState().setRemoteStream(null);
        useCallStore.getState().setSasCode(null);
        useCallStore.getState().setE2eeActive(false);
        return;
      }

      if (msg.type === 'signal' && msg.payload) {
        void this.handleEncryptedSignal(msg.payload);
      }
    };

    ws.onclose = (event) => {
      if (this.destroyed) return;
      if (event.code === 4003) {
        useCallStore.getState().setError('ROOM_FULL');
      } else {
        useCallStore.getState().setError('WS_DISCONNECTED');
      }
    };
  }

  private onPeerDiscovered(peerId: string) {
    this.remotePeerId = peerId;
    this.isPolite = this.localPeerId < peerId;
    useCallStore.getState().setPeerLeft(false);

    if (!this.pc) return;

    // Impolite peer creates the control DataChannel and triggers initial offer
    if (!this.isPolite) {
      if (!this.dataChannel) {
        const dc = this.pc.createDataChannel('speer-control', { ordered: true });
        this.setupDataChannel(dc);
      }
      void this.triggerOffer();
    }
  }

  private async triggerOffer() {
    if (!this.pc || !this.remotePeerId) return;
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      const tunedOffer: RTCSessionDescriptionInit = {
        type: offer.type,
        sdp: offer.sdp ? preferOpusFecDtx(offer.sdp) : offer.sdp,
      };
      await this.pc.setLocalDescription(tunedOffer);
      if (this.pc.localDescription) {
        await this.sendEncryptedSignal({
          kind: 'offer',
          sdp: this.pc.localDescription.toJSON(),
        });
      }
    } catch {
      // Ignore
    } finally {
      this.makingOffer = false;
    }
  }

  private async sendEncryptedSignal(payload: EncryptedSignalPayload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.signalingKey) return;
    try {
      const encrypted = await encryptSignal(this.signalingKey, payload);
      this.ws.send(JSON.stringify({ type: 'signal', payload: encrypted }));
    } catch {
      // Ignore serialization failure
    }
  }

  private async handleEncryptedSignal(blob: string) {
    if (!this.signalingKey || !this.pc) return;
    let payload: EncryptedSignalPayload;
    try {
      payload = await decryptSignal<EncryptedSignalPayload>(this.signalingKey, blob);
    } catch {
      useCallStore.getState().setError('DECRYPT_FAILED');
      return;
    }

    try {
      if ((payload.kind === 'offer' || payload.kind === 'answer') && payload.sdp) {
        const description = payload.sdp;
        const readyForOffer =
          !this.makingOffer &&
          (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
        const offerCollision = description.type === 'offer' && !readyForOffer;

        this.ignoreOffer = !this.isPolite && offerCollision;
        if (this.ignoreOffer) return;

        this.isSettingRemoteAnswerPending = description.type === 'answer';
        await this.pc.setRemoteDescription(description);
        this.isSettingRemoteAnswerPending = false;

        if (description.type === 'offer') {
          const answer = await this.pc.createAnswer();
          const tunedAnswer: RTCSessionDescriptionInit = {
            type: answer.type,
            sdp: answer.sdp ? preferOpusFecDtx(answer.sdp) : answer.sdp,
          };
          await this.pc.setLocalDescription(tunedAnswer);
          if (this.pc.localDescription) {
            await this.sendEncryptedSignal({
              kind: 'answer',
              sdp: this.pc.localDescription.toJSON(),
            });
          }
        }
      } else if (payload.kind === 'ice' && payload.candidate) {
        try {
          await this.pc.addIceCandidate(payload.candidate);
        } catch {
          if (!this.ignoreOffer) {
            // Ignore stale candidates during rollback
          }
        }
      }
    } catch {
      // Ignore transient signaling race
    }
  }

  private startStatsLoop() {
    if (this.statsTimer !== null) return;
    this.statsTimer = window.setInterval(() => {
      void this.pollStatsAndAdapt();
    }, 1000);
  }

  private async pollStatsAndAdapt() {
    if (!this.pc || this.destroyed) return;
    try {
      const report = await this.pc.getStats();
      const codecs = new Map<string, { mimeType: string }>();

      let rttMs: number | null = null;
      let jitterMs: number | null = null;
      let bytesSent = 0;
      let bytesRecv = 0;
      let packetsSent = 0;
      let packetsLost = 0;
      let videoCodec: string | null = null;
      let audioCodec: string | null = null;
      let resolution: string | null = null;
      let fps: number | null = null;
      let candidateType: string | null = null;
      let selectedPairId: string | null = null;

      let audioJitterMs: number | null = null;
      let videoJitterMs: number | null = null;
      let audioPlayoutTs: number | null = null;
      let videoPlayoutTs: number | null = null;

      report.forEach((stat) => {
        if (stat.type === 'codec') {
          codecs.set(stat.id, { mimeType: String(stat.mimeType ?? '') });
        }
        if (stat.type === 'transport' && stat.selectedCandidatePairId) {
          selectedPairId = String(stat.selectedCandidatePairId);
        }
      });

      const localCandidates = new Map<string, string>();
      report.forEach((stat) => {
        if (stat.type === 'local-candidate' && stat.candidateType) {
          localCandidates.set(stat.id, String(stat.candidateType));
        }
      });

      report.forEach((stat) => {
        if (stat.type === 'candidate-pair' && (stat.id === selectedPairId || stat.nominated)) {
          if (typeof stat.currentRoundTripTime === 'number') {
            rttMs = Math.round(stat.currentRoundTripTime * 1000);
          }
          if (stat.localCandidateId && localCandidates.has(String(stat.localCandidateId))) {
            candidateType = localCandidates.get(String(stat.localCandidateId)) ?? null;
          }
        }

        if (stat.type === 'outbound-rtp') {
          if (typeof stat.bytesSent === 'number') bytesSent += stat.bytesSent;
          if (typeof stat.packetsSent === 'number') packetsSent += stat.packetsSent;
          if (stat.kind === 'video') {
            if (stat.frameWidth && stat.frameHeight) {
              resolution = `${stat.frameWidth}x${stat.frameHeight}`;
            }
            if (typeof stat.framesPerSecond === 'number') {
              fps = Math.round(stat.framesPerSecond);
            }
            if (stat.codecId && codecs.has(String(stat.codecId))) {
              const mime = codecs.get(String(stat.codecId))?.mimeType ?? '';
              videoCodec = mime.replace('video/', '');
            }
          }
          if (stat.kind === 'audio' && stat.codecId && codecs.has(String(stat.codecId))) {
            const mime = codecs.get(String(stat.codecId))?.mimeType ?? '';
            audioCodec = mime.replace('audio/', '');
          }
        }

        if (stat.type === 'remote-inbound-rtp') {
          if (typeof stat.roundTripTime === 'number' && rttMs === null) {
            rttMs = Math.round(stat.roundTripTime * 1000);
          }
          if (typeof stat.packetsLost === 'number') {
            packetsLost += Math.max(0, stat.packetsLost);
          }
          if (typeof stat.jitter === 'number') {
            jitterMs = Math.round(stat.jitter * 1000);
          }
        }

        if (stat.type === 'inbound-rtp') {
          if (typeof stat.bytesReceived === 'number') bytesRecv += stat.bytesReceived;
          const emitted = Number(stat.jitterBufferEmittedCount ?? 0);
          const jbDelay = Number(stat.jitterBufferDelay ?? 0);
          const avgJbMs = emitted > 0 ? (jbDelay / emitted) * 1000 : null;

          if (stat.kind === 'audio') {
            audioJitterMs = avgJbMs;
            if (typeof stat.estimatedPlayoutTimestamp === 'number') {
              audioPlayoutTs = stat.estimatedPlayoutTimestamp;
            }
          } else if (stat.kind === 'video') {
            videoJitterMs = avgJbMs;
            if (typeof stat.estimatedPlayoutTimestamp === 'number') {
              videoPlayoutTs = stat.estimatedPlayoutTimestamp;
            }
          }
        }
      });

      const now = performance.now();
      let sendBitrateKbps: number | null = null;
      let recvBitrateKbps: number | null = null;
      let packetLossPct: number | null = null;

      if (this.prevStats.timestamp > 0) {
        const dtSec = (now - this.prevStats.timestamp) / 1000;
        if (dtSec > 0.2) {
          sendBitrateKbps = Math.max(
            0,
            Math.round(((bytesSent - this.prevStats.bytesSent) * 8) / dtSec / 1000)
          );
          recvBitrateKbps = Math.max(
            0,
            Math.round(((bytesRecv - this.prevStats.bytesRecv) * 8) / dtSec / 1000)
          );
          const dSent = packetsSent - this.prevStats.packetsSent;
          const dLost = packetsLost - this.prevStats.packetsLost;
          const total = dSent + dLost;
          if (total > 0) {
            packetLossPct = Math.round((Math.max(0, dLost) / total) * 1000) / 10;
          }
        }
      }

      this.prevStats = { timestamp: now, bytesSent, bytesRecv, packetsSent, packetsLost };

      let avDriftMs: number | null = null;
      if (audioPlayoutTs !== null && videoPlayoutTs !== null) {
        avDriftMs = Math.round(Math.abs(audioPlayoutTs - videoPlayoutTs));
      } else if (audioJitterMs !== null && videoJitterMs !== null) {
        avDriftMs = Math.round(Math.abs(audioJitterMs - videoJitterMs));
      }

      // Tune A/V jitterBufferTarget / playoutDelayHint when drift exceeds 35ms
      if (avDriftMs !== null && avDriftMs > 35) {
        const targetSec = Math.min(0.2, Math.max(0.02, avDriftMs / 1000));
        for (const receiver of this.pc.getReceivers()) {
          if ('jitterBufferTarget' in receiver) {
            receiver.jitterBufferTarget = Math.round(targetSec * 1000);
          } else {
            const legacyRx = receiver as RTCRtpReceiver & { playoutDelayHint?: number | null };
            if ('playoutDelayHint' in legacyRx) {
              legacyRx.playoutDelayHint = targetSec;
            }
          }
        }
      }

      // Adaptive video quality via RTCRtpSender.setParameters
      const adapted = await this.adaptVideoQuality(rttMs, packetLossPct);

      const callStore = useCallStore.getState();
      callStore.setRelayActive(candidateType === 'relay');

      const snapshot: CallStats = {
        rttMs,
        jitterMs,
        packetLossPct,
        sendBitrateKbps,
        recvBitrateKbps,
        videoCodec,
        audioCodec,
        resolution,
        fps,
        avDriftMs,
        candidateType,
        region: callStore.activeRegion,
        targetBitrateKbps: adapted.targetBitrateKbps,
        adaptiveScale: adapted.scale,
      };
      callStore.setStats(snapshot);
    } catch {
      // Ignore stats failure during teardown
    }
  }

  private async adaptVideoQuality(
    rttMs: number | null,
    packetLossPct: number | null
  ): Promise<{ targetBitrateKbps: number | null; scale: number | null }> {
    if (!this.videoSender) return { targetBitrateKbps: null, scale: null };

    const settings = useSettingsStore.getState();
    const { width } = getResolutionDimensions(settings.resolution);
    const baseMaxBitrate =
      width >= 1920 ? 3_000_000 : width >= 1280 ? 1_800_000 : 900_000;

    let tier: 'high' | 'medium' | 'low' = 'high';
    if ((packetLossPct !== null && packetLossPct > 6) || (rttMs !== null && rttMs > 300)) {
      tier = 'low';
    } else if ((packetLossPct !== null && packetLossPct > 2) || (rttMs !== null && rttMs > 160)) {
      tier = 'medium';
    }

    const targetBitrate =
      tier === 'high' ? baseMaxBitrate : tier === 'medium' ? 750_000 : 350_000;
    const scale = tier === 'high' ? 1 : tier === 'medium' ? 1.5 : 2;
    const maxFramerate =
      tier === 'high'
        ? settings.frameRate
        : tier === 'medium'
          ? Math.min(settings.frameRate, 24)
          : Math.min(settings.frameRate, 15);

    if (this.lastQualityTier !== tier) {
      this.lastQualityTier = tier;
      try {
        const params = this.videoSender.getParameters();
        if (params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxBitrate = targetBitrate;
          params.encodings[0].scaleResolutionDownBy = scale;
          params.encodings[0].maxFramerate = maxFramerate;
          await this.videoSender.setParameters(params);
        }
      } catch {
        // Ignore browsers that reject dynamic parameter updates
      }
    }

    return {
      targetBitrateKbps: Math.round(targetBitrate / 1000),
      scale,
    };
  }

  public async replaceAudioTrack(track: MediaStreamTrack | null) {
    if (!this.audioSender) return;
    await this.audioSender.replaceTrack(track);
  }

  public async replaceVideoTrack(track: MediaStreamTrack | null, isCamera = true) {
    if (isCamera) {
      this.cameraTrackRestore = track;
    }
    if (!this.videoSender) return;
    await this.videoSender.replaceTrack(track);
  }

  public async toggleScreenShare(): Promise<boolean> {
    const callStore = useCallStore.getState();

    if (callStore.isScreenSharing) {
      this.screenStream?.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      await this.replaceVideoTrack(this.cameraTrackRestore, false);
      callStore.setIsScreenSharing(false);
      return false;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return false;

      this.screenStream = displayStream;
      await this.replaceVideoTrack(screenTrack, false);
      callStore.setIsScreenSharing(true);

      screenTrack.onended = () => {
        this.screenStream = null;
        void this.replaceVideoTrack(this.cameraTrackRestore, false);
        useCallStore.getState().setIsScreenSharing(false);
      };
      return true;
    } catch {
      callStore.setError('SCREEN_SHARE_FAILED');
      return false;
    }
  }

  public destroy() {
    this.destroyed = true;
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'leave' }));
      } catch {
        // ignore
      }
    }
    this.ws?.close();
    this.ws = null;

    this.dataChannel?.close();
    this.dataChannel = null;

    this.pc?.close();
    this.pc = null;

    this.e2eeController?.destroy();
    this.e2eeController = null;
  }
}

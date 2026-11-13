import { create } from 'zustand';
import type { AppView, CallStats, ErrorKey } from '../types/index.ts';

interface CallState {
  view: AppView;
  roomCode: string;
  roomSecret: string;
  roomId: string;
  isCreator: boolean;

  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  cameraOff: boolean;
  isScreenSharing: boolean;

  peerConnected: boolean;
  peerLeft: boolean;
  connectionState: RTCPeerConnectionState | 'idle';
  iceConnectionState: RTCIceConnectionState | 'new';
  activeRegion: string | null;
  relayActive: boolean;

  e2eeActive: boolean;
  sasCode: string | null;

  stats: CallStats;
  statsPanelOpen: boolean;
  settingsOpen: boolean;
  error: ErrorKey | null;

  setView: (view: AppView) => void;
  setRoom: (params: {
    roomCode: string;
    roomSecret: string;
    roomId: string;
    isCreator: boolean;
  }) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  setMicMuted: (muted: boolean) => void;
  setCameraOff: (off: boolean) => void;
  setIsScreenSharing: (sharing: boolean) => void;
  setPeerConnected: (connected: boolean) => void;
  setPeerLeft: (left: boolean) => void;
  setConnectionState: (state: RTCPeerConnectionState | 'idle') => void;
  setIceConnectionState: (state: RTCIceConnectionState | 'new') => void;
  setActiveRegion: (region: string | null) => void;
  setRelayActive: (active: boolean) => void;
  setE2eeActive: (active: boolean) => void;
  setSasCode: (code: string | null) => void;
  setStats: (stats: CallStats) => void;
  setStatsPanelOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setError: (error: ErrorKey | null) => void;
  resetCall: () => void;
}

const EMPTY_STATS: CallStats = {
  rttMs: null,
  jitterMs: null,
  packetLossPct: null,
  sendBitrateKbps: null,
  recvBitrateKbps: null,
  videoCodec: null,
  audioCodec: null,
  resolution: null,
  fps: null,
  avDriftMs: null,
  candidateType: null,
  region: null,
  targetBitrateKbps: null,
  adaptiveScale: null,
};

export const useCallStore = create<CallState>((set) => ({
  view: 'home',
  roomCode: '',
  roomSecret: '',
  roomId: '',
  isCreator: false,

  localStream: null,
  remoteStream: null,
  micMuted: false,
  cameraOff: false,
  isScreenSharing: false,

  peerConnected: false,
  peerLeft: false,
  connectionState: 'idle',
  iceConnectionState: 'new',
  activeRegion: null,
  relayActive: false,

  e2eeActive: false,
  sasCode: null,

  stats: EMPTY_STATS,
  statsPanelOpen: false,
  settingsOpen: false,
  error: null,

  setView: (view) => set({ view }),
  setRoom: ({ roomCode, roomSecret, roomId, isCreator }) =>
    set({ roomCode, roomSecret, roomId, isCreator, peerLeft: false, error: null }),
  setLocalStream: (localStream) => set({ localStream }),
  setRemoteStream: (remoteStream) => set({ remoteStream }),
  setMicMuted: (micMuted) => set({ micMuted }),
  setCameraOff: (cameraOff) => set({ cameraOff }),
  setIsScreenSharing: (isScreenSharing) => set({ isScreenSharing }),
  setPeerConnected: (peerConnected) => set({ peerConnected }),
  setPeerLeft: (peerLeft) => set({ peerLeft }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setIceConnectionState: (iceConnectionState) => set({ iceConnectionState }),
  setActiveRegion: (activeRegion) => set({ activeRegion }),
  setRelayActive: (relayActive) => set({ relayActive }),
  setE2eeActive: (e2eeActive) => set({ e2eeActive }),
  setSasCode: (sasCode) => set({ sasCode }),
  setStats: (stats) => set({ stats }),
  setStatsPanelOpen: (statsPanelOpen) => set({ statsPanelOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setError: (error) => set({ error }),
  resetCall: () =>
    set({
      view: 'home',
      roomCode: '',
      roomSecret: '',
      roomId: '',
      isCreator: false,
      localStream: null,
      remoteStream: null,
      micMuted: false,
      cameraOff: false,
      isScreenSharing: false,
      peerConnected: false,
      peerLeft: false,
      connectionState: 'idle',
      iceConnectionState: 'new',
      relayActive: false,
      e2eeActive: false,
      sasCode: null,
      stats: EMPTY_STATS,
      statsPanelOpen: false,
      error: null,
    }),
}));

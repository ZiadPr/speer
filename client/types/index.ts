export type LanguageCode = 'en' | 'ar' | 'fr';
export type ThemeMode = 'light' | 'dark' | 'system';
export type VideoResolution = '480p' | '720p' | '1080p';
export type VideoFrameRate = 15 | 24 | 30 | 60;
export type RegionCode = 'auto' | 'us' | 'eu' | 'ap' | 'sa';

export interface SettingsState {
  // General
  language: LanguageCode;
  theme: ThemeMode;

  // Audio
  audioInputId: string;
  audioOutputId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  muteOnJoin: boolean;

  // Video
  videoInputId: string;
  resolution: VideoResolution;
  frameRate: VideoFrameRate;
  mirrorSelfView: boolean;
  backgroundBlur: boolean;

  // Connection
  preferredRegion: RegionCode;
  hideMyIp: boolean;
  showLiveStats: boolean;
  e2eeEnabled: boolean;

  setSetting: <K extends keyof Omit<SettingsState, 'setSetting' | 'resetDefaults'>>(
    key: K,
    value: SettingsState[K]
  ) => void;
  resetDefaults: () => void;
}

export type AppView = 'home' | 'prejoin' | 'call';

export interface CallStats {
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPct: number | null;
  sendBitrateKbps: number | null;
  recvBitrateKbps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  resolution: string | null;
  fps: number | null;
  avDriftMs: number | null;
  candidateType: string | null;
  region: string | null;
  targetBitrateKbps: number | null;
  adaptiveScale: number | null;
}

export interface RegionalIceServer {
  region: Exclude<RegionCode, 'auto'>;
  urls: string | string[];
  rttMs?: number | null;
}

export interface IceConfigResponse {
  stunRegions: RegionalIceServer[];
  turnServers: RTCIceServer[];
  fallbackStunUrls: string[];
}

export type ErrorKey =
  | 'ROOM_FULL'
  | 'RATE_LIMITED'
  | 'INVALID_ROOM'
  | 'INVALID_LINK'
  | 'WS_DISCONNECTED'
  | 'MEDIA_DENIED'
  | 'MEDIA_UNAVAILABLE'
  | 'SCREEN_SHARE_FAILED'
  | 'BLUR_FAILED'
  | 'E2EE_UNSUPPORTED'
  | 'TURN_MISSING'
  | 'DECRYPT_FAILED'
  | 'UNKNOWN';

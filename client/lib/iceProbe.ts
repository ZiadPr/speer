import type { IceConfigResponse, RegionCode, RegionalIceServer } from '../types/index.ts';

const FALLBACK_REGIONS: RegionalIceServer[] = [
  { region: 'us', urls: 'stun:stun.l.google.com:19302' },
  { region: 'eu', urls: 'stun:stun1.l.google.com:19302' },
  { region: 'ap', urls: 'stun:stun2.l.google.com:19302' },
  { region: 'sa', urls: 'stun:stun3.l.google.com:19302' },
];

let cachedConfig: IceConfigResponse | null = null;
let cachedProbeResults: RegionalIceServer[] | null = null;

export async function fetchIceConfig(): Promise<IceConfigResponse> {
  if (cachedConfig) return cachedConfig;

  try {
    const res = await fetch('/api/ice-config', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as IceConfigResponse;
      cachedConfig = data;
      return data;
    }
  } catch {
    // Fall back to compile-time env / defaults
  }

  let envRegions = FALLBACK_REGIONS;
  const rawEnv = import.meta.env.VITE_STUN_REGIONS as string | undefined;
  if (rawEnv) {
    try {
      envRegions = JSON.parse(rawEnv) as RegionalIceServer[];
    } catch {
      envRegions = FALLBACK_REGIONS;
    }
  }

  cachedConfig = {
    stunRegions: envRegions,
    turnServers: [],
    fallbackStunUrls: ['stun:stun.l.google.com:19302'],
  };
  return cachedConfig;
}

/**
 * Measure ICE STUN srflx gathering RTT per regional endpoint using ephemeral RTCPeerConnections.
 */
async function measureRegionRtt(entry: RegionalIceServer): Promise<RegionalIceServer> {
  if (typeof RTCPeerConnection === 'undefined') {
    return { ...entry, rttMs: null };
  }

  const start = performance.now();
  let pc: RTCPeerConnection | null = null;

  try {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: entry.urls }],
      iceCandidatePoolSize: 0,
    });
    pc.createDataChannel('probe');

    const rttMs = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 2200);
      if (!pc) {
        clearTimeout(timer);
        resolve(null);
        return;
      }

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          clearTimeout(timer);
          resolve(null);
          return;
        }
        if (ev.candidate.type === 'srflx') {
          clearTimeout(timer);
          resolve(Math.max(1, Math.round(performance.now() - start)));
        }
      };

      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
    });

    return { ...entry, rttMs };
  } catch {
    return { ...entry, rttMs: null };
  } finally {
    pc?.close();
  }
}

export async function probeRegionalIceServers(): Promise<RegionalIceServer[]> {
  if (cachedProbeResults) return cachedProbeResults;

  const config = await fetchIceConfig();
  const results = await Promise.all(config.stunRegions.map(measureRegionRtt));
  results.sort((a, b) => {
    if (a.rttMs == null && b.rttMs == null) return 0;
    if (a.rttMs == null) return 1;
    if (b.rttMs == null) return -1;
    return a.rttMs - b.rttMs;
  });

  cachedProbeResults = results;
  return results;
}

export async function buildRtcConfiguration(options: {
  preferredRegion: RegionCode;
  hideMyIp: boolean;
}): Promise<{
  rtcConfig: RTCConfiguration;
  selectedRegion: string;
  hasTurn: boolean;
}> {
  const [config, probed] = await Promise.all([fetchIceConfig(), probeRegionalIceServers()]);

  let chosen = probed[0];
  if (options.preferredRegion !== 'auto') {
    const exact = probed.find((r) => r.region === options.preferredRegion);
    if (exact) chosen = exact;
  }

  const orderedStuns = chosen
    ? [chosen, ...probed.filter((r) => r.region !== chosen.region)]
    : probed;

  const iceServers: RTCIceServer[] = [];

  if (!options.hideMyIp) {
    for (const s of orderedStuns) {
      iceServers.push({ urls: s.urls });
    }
    if (iceServers.length === 0 && config.fallbackStunUrls.length > 0) {
      iceServers.push({ urls: config.fallbackStunUrls });
    }
  }

  const turnServers = config.turnServers ?? [];
  for (const turn of turnServers) {
    iceServers.push(turn);
  }

  const rtcConfig: RTCConfiguration = {
    iceServers,
    iceCandidatePoolSize: 4,
    iceTransportPolicy: options.hideMyIp ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };

  return {
    rtcConfig,
    selectedRegion: chosen?.region ?? 'us',
    hasTurn: turnServers.length > 0,
  };
}

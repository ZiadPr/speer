import { useTranslation } from 'react-i18next';
import { useCallStore } from '../stores/useCallStore.ts';

export function StatsOverlay() {
  const { t } = useTranslation();
  const stats = useCallStore((s) => s.stats);
  const none = t('stats.none');

  const rows: { label: string; value: string }[] = [
    { label: t('stats.rtt'), value: stats.rttMs !== null ? `${stats.rttMs} ms` : none },
    { label: t('stats.jitter'), value: stats.jitterMs !== null ? `${stats.jitterMs} ms` : none },
    {
      label: t('stats.loss'),
      value: stats.packetLossPct !== null ? `${stats.packetLossPct}%` : none,
    },
    {
      label: t('stats.bitrateUp'),
      value: stats.sendBitrateKbps !== null ? `${stats.sendBitrateKbps} kbps` : none,
    },
    {
      label: t('stats.bitrateDown'),
      value: stats.recvBitrateKbps !== null ? `${stats.recvBitrateKbps} kbps` : none,
    },
    {
      label: t('stats.video'),
      value:
        stats.videoCodec || stats.resolution
          ? `${stats.videoCodec ?? ''} ${stats.resolution ?? ''}${stats.fps !== null ? ` @ ${stats.fps}fps` : ''}`.trim()
          : none,
    },
    { label: t('stats.audio'), value: stats.audioCodec ?? none },
    {
      label: t('stats.drift'),
      value: stats.avDriftMs !== null ? `${stats.avDriftMs} ms` : none,
    },
    { label: t('stats.ice'), value: stats.candidateType ?? none },
    { label: t('stats.region'), value: stats.region ? stats.region.toUpperCase() : none },
  ];

  return (
    <aside
      aria-label={t('stats.title')}
      className="w-64 sm:w-72 border border-neutral-300 dark:border-neutral-700 bg-white/95 dark:bg-black/95 backdrop-blur-sm rounded-lg p-3.5 text-black dark:text-white shadow-sm"
    >
      <div className="text-xs font-semibold pb-2 mb-2 border-b border-neutral-200 dark:border-neutral-800">
        {t('stats.title')}
      </div>
      <dl className="space-y-1.5 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="text-neutral-500 dark:text-neutral-400 truncate">{row.label}</dt>
            <dd className="font-mono tabular-nums text-end whitespace-nowrap">{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

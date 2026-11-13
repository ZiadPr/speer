import { Check, Copy, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface QrCodeModalProps {
  open: boolean;
  url: string;
  roomCode: string;
  onClose: () => void;
}

export function QrCodeModal({ open, url, roomCode, onClose }: QrCodeModalProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, url, {
      width: 224,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('prejoin.qrCode')}
        className="w-full max-w-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white p-5 space-y-4 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">{t('prejoin.qrCode')}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('settings.close')}
            className="min-h-[40px] min-w-[40px] -me-2 inline-flex items-center justify-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex justify-center">
          <div className="p-2 rounded-md bg-white border border-neutral-200">
            <canvas ref={canvasRef} className="block" />
          </div>
        </div>

        <div className="text-center font-mono tabular-nums text-sm font-semibold tracking-wider">
          {roomCode}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="w-full min-h-[44px] px-4 rounded-md border border-neutral-300 dark:border-neutral-700 text-xs font-medium inline-flex items-center justify-center gap-2 hover:border-black dark:hover:border-white transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? t('prejoin.copied') : t('prejoin.copyLink')}</span>
        </button>
      </div>
    </div>
  );
}

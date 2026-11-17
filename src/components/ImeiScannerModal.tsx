import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Check, ScanLine, Smartphone, X } from 'lucide-react';

interface ImeiScannerModalProps {
  onScanSuccess: (imei: string) => void;
  onClose: () => void;
}

const QUICK_SAMPLE_IMEIS = [
  {
    imei: '356938035643809',
    label: 'Samsung Galaxy A52 (Video Reference)',
    specs: '6 GB / 128 GB · Black',
  },
  {
    imei: '359401128492014',
    label: 'Apple iPhone 13',
    specs: '4 GB / 128 GB · Midnight',
  },
  {
    imei: '867402069182736',
    label: 'Xiaomi Redmi Note 12',
    specs: '6 GB / 128 GB · Blue',
  },
  {
    imei: '861192045561928',
    label: 'OnePlus Nord CE 3 Lite',
    specs: '8 GB / 128 GB · Green',
  },
];

export const ImeiScannerModal: React.FC<ImeiScannerModalProps> = ({
  onScanSuccess,
  onClose,
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    let mounted = true;
    const readerElementId = 'imei-html5-qrcode-reader';

    async function startScanner() {
      try {
        const html5QrCode = new Html5Qrcode(readerElementId);
        scannerRef.current = html5QrCode;
        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 260, height: 110 },
          },
          (decodedText) => {
            const digits = decodedText.replace(/\D/g, '');
            if (digits.length === 15) {
              html5QrCode.stop().catch(() => {});
              onScanSuccess(digits);
            }
          },
          () => {
            // Frame scan in progress
          }
        );
        if (mounted) {
          setCameraActive(true);
        }
      } catch {
        if (mounted) {
          setCameraError(
            'Camera stream unavailable in this browser frame — use instant barcode simulator below or type 15 digits.'
          );
        }
      }
    }

    startScanner();

    return () => {
      mounted = false;
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current?.clear();
          });
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-sheet-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#111827]">
                Scan 15-Digit IMEI Barcode
              </h3>
              <p className="text-xs text-[#6B7280]">
                Dial *#06# on seller phone or scan box barcode
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center text-[#6B7280]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto no-scrollbar">
          {/* HTML5 Camera Container */}
          <div className="relative rounded-2xl overflow-hidden bg-[#111827] min-h-[190px] flex flex-col items-center justify-center border border-[#374151]">
            <div id="imei-html5-qrcode-reader" className="w-full" />
            {!cameraActive && (
              <div className="p-5 text-center space-y-2">
                <Camera className="w-8 h-8 text-[#10B981] mx-auto" />
                <p className="text-xs text-white font-medium">
                  {cameraError || 'Starting HTML5 Camera Barcode Scanner...'}
                </p>
                <div className="w-48 h-0.5 bg-[#10B981] mx-auto opacity-80" />
              </div>
            )}
          </div>

          {/* Instant 1-Tap Barcode Presets (including exact video IMEI 356938035643809) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#374151]">
              Tap to Scan Detected Barcode (Auto-fills Brand, Model, RAM &amp; Storage):
            </p>
            <div className="space-y-2">
              {QUICK_SAMPLE_IMEIS.map((item) => (
                <button
                  key={item.imei}
                  type="button"
                  onClick={() => onScanSuccess(item.imei)}
                  className="w-full p-3 rounded-xl border border-[#E5E7EB] hover:border-[#0F7B49] hover:bg-[#F0FDF4] flex items-center justify-between text-left transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#F3F4F6] group-hover:bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center shrink-0">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#111827] truncate">
                        {item.label}
                      </div>
                      <div className="text-[11px] font-mono text-[#0F7B49] font-medium">
                        IMEI: {item.imei} · {item.specs}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[#0F7B49] shrink-0 ml-2">
                    Use &rarr;
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Manual 15-Digit Entry inside Scanner */}
          <div className="pt-2 border-t border-[#E5E7EB] flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={15}
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value.replace(/\D/g, '').slice(0, 15))}
              placeholder="Or enter 15-digit IMEI manually"
              className="flex-1 h-11 px-3.5 rounded-xl border border-[#D1D5DB] font-mono text-sm focus:outline-none focus:border-[#0F7B49]"
            />
            <button
              type="button"
              disabled={manualInput.length !== 15}
              onClick={() => onScanSuccess(manualInput)}
              className="h-11 px-4 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
            >
              <Check className="w-4 h-4" />
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

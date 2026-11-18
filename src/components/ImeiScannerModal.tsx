import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  AiExtractedScanResult,
  extract15DigitImei,
  scanCapturedPhotoForImeiAndSpecs,
} from '../utils/apkMediaEngine';
import { lookupImeiSpecs } from '../utils/imeiDatabase';
import {
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  Sparkles,
  X,
} from 'lucide-react';

interface ImeiScannerModalProps {
  onScanSuccess: (
    imei: string,
    aiExtractedSpecs?: AiExtractedScanResult
  ) => void;
  onClose: () => void;
}

const SUPPORTED_IMEI_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];

export const ImeiScannerModal: React.FC<ImeiScannerModalProps> = ({
  onScanSuccess,
  onClose,
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Point camera at 15-digit IMEI barcode, or tap "Capture & AI Read" / "Take Photo"'
  );
  const [manualInput, setManualInput] = useState('');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isScanningRef = useRef(false);
  const hasCompletedRef = useRef(false);
  const onScanSuccessRef = useRef(onScanSuccess);
  onScanSuccessRef.current = onScanSuccess;

  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const readerContainerRef = useRef<HTMLDivElement | null>(null);

  const safelyStopScanner = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    if (isScanningRef.current) {
      isScanningRef.current = false;
      try {
        await scanner.stop();
      } catch {
        // ignore if already stopped
      }
    }
    try {
      scanner.clear();
    } catch {
      // ignore
    }
  };

  const completeWithResult = (
    imei: string,
    specs?: AiExtractedScanResult
  ) => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    void safelyStopScanner();
    onScanSuccessRef.current(imei, specs);
  };

  useEffect(() => {
    let mounted = true;
    const readerElementId = 'imei-html5-qrcode-reader';

    // Safety timeout: if live getUserMedia hangs >4s in an Android WebView without resolving,
    // cleanly switch UI to Native Camera + AI Vision without blocking user interaction
    const webViewHangTimer = window.setTimeout(() => {
      if (mounted && !isScanningRef.current) {
        setCameraUnavailable(true);
        setStatusMessage(
          'Tap "Take Photo (AI Scan)" below to scan Barcode, *#06# Screen, or Box Label'
        );
      }
    }, 4000);

    async function startScanner() {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        if (mounted) {
          window.clearTimeout(webViewHangTimer);
          setCameraUnavailable(true);
          setStatusMessage(
            'Tap "Take Photo (AI Scan)" below to scan Barcode, *#06# Screen, or Box Label'
          );
        }
        return;
      }

      try {
        const html5QrCode = new Html5Qrcode(readerElementId, {
          formatsToSupport: SUPPORTED_IMEI_FORMATS,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
          verbose: false,
        });
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => ({
              width: Math.max(220, Math.min(340, Math.floor(viewfinderWidth * 0.9))),
              height: Math.max(110, Math.min(180, Math.floor(viewfinderHeight * 0.52))),
            }),
            disableFlip: false,
          },
          (decodedText) => {
            if (!mounted || hasCompletedRef.current) return;
            const imei15 = extract15DigitImei(decodedText);
            if (imei15) {
              const tacSpec = lookupImeiSpecs(imei15);
              completeWithResult(imei15, {
                imei: imei15,
                barcode: decodedText,
                brand: tacSpec?.brand || '',
                model: tacSpec?.model || '',
                ram: tacSpec?.ram || '',
                storage: tacSpec?.storage || '',
                colour: tacSpec?.colour || '',
                sourceMethod: 'local_barcode',
              });
            } else {
              // Nearby EAN-13 / Serial barcode detected on the box — keep camera running for the 15-digit IMEI
              const shortPreview = decodedText.trim().slice(0, 20);
              setStatusMessage(
                `Barcode seen (${shortPreview}) — aim slightly closer to the 15-digit IMEI or tap "Capture & AI Read"`
              );
            }
          },
          () => {
            // Frame scan in progress
          }
        );

        if (mounted) {
          window.clearTimeout(webViewHangTimer);
          isScanningRef.current = true;
          setCameraActive(true);
          setCameraUnavailable(false);
        } else {
          isScanningRef.current = true;
          void safelyStopScanner();
        }
      } catch {
        if (mounted) {
          window.clearTimeout(webViewHangTimer);
          setCameraActive(false);
          setCameraUnavailable(true);
          setStatusMessage(
            'Tap "Take Photo (AI Scan)" below to scan Barcode, *#06# Screen, or Box Label'
          );
        }
      }
    }

    void startScanner();

    return () => {
      mounted = false;
      window.clearTimeout(webViewHangTimer);
      void safelyStopScanner();
    };
  }, []);

  const processImageFile = async (file: File) => {
    setProcessingPhoto(true);
    setStatusMessage(
      'Reading Barcode & 15-Digit IMEI via Local Scanner + AI Vision OCR...'
    );

    try {
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });
    } catch {
      // ignore preview error
    }

    try {
      const scanResult = await scanCapturedPhotoForImeiAndSpecs(file);
      const foundImei =
        scanResult.imei || extract15DigitImei(scanResult.barcode || '');

      if (foundImei && foundImei.length === 15) {
        completeWithResult(foundImei, scanResult);
        return;
      }

      if (scanResult.brand || scanResult.model) {
        // Model/specs found even if IMEI was partially cropped — fill specs or prompt user
        completeWithResult(foundImei || '', scanResult);
        return;
      }

      setStatusMessage(
        'No 15-digit IMEI detected clearly. Hold phone closer with good light, or enter 15 digits manually below.'
      );
    } catch {
      setStatusMessage(
        'Could not process that photo — please retake clearly or type 15-digit IMEI below.'
      );
    } finally {
      setProcessingPhoto(false);
    }
  };

  const handleCapturedImageFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await processImageFile(file);
  };

  /**
   * Captures a high-resolution frame directly from the live `<video>` stream
   * and runs BarcodeDetector + Html5Qrcode.scanFile + Gemini 2.5 Flash Vision OCR.
   */
  const handleCaptureLiveFrameForAi = async () => {
    const videoEl = readerContainerRef.current?.querySelector('video');
    if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      nativeCameraInputRef.current?.click();
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    const frameFile = await new Promise<File | null>((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          resolve(new File([blob], 'live-imei-frame.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.92
      );
    });

    if (frameFile) {
      await processImageFile(frameFile);
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* 1. Direct Native Hardware Camera Input (100% Works in All Android Web-APKs) */}
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapturedImageFile}
        className="hidden"
      />
      {/* 2. Optional Upload from Gallery Input */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleCapturedImageFile}
        className="hidden"
      />

      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-sheet-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#111827]">
                IMEI, Barcode &amp; AI Bill Scanner
              </h3>
              <p className="text-xs text-[#6B7280]">
                Scan *#06# screen, Box Barcode, or Paper Bill
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void safelyStopScanner();
              onClose();
            }}
            className="w-10 h-10 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center text-[#6B7280]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82dvh] overflow-y-auto touch-pan-y no-scrollbar">
          {/* Primary Dual-Mode Native APK Camera & Gallery Triggers */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={processingPhoto}
              onClick={() => nativeCameraInputRef.current?.click()}
              className="h-12 px-3 rounded-2xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-display font-bold text-xs flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition-all disabled:opacity-60"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Take Photo (AI Scan)</span>
            </button>

            <button
              type="button"
              disabled={processingPhoto}
              onClick={() => galleryInputRef.current?.click()}
              className="h-12 px-3 rounded-2xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] text-[#111827] font-display font-bold text-xs flex items-center justify-center gap-2 active:scale-[0.99] transition-all disabled:opacity-60"
            >
              <ImageIcon className="w-4 h-4 text-[#0F7B49] shrink-0" />
              <span>Upload from Gallery</span>
            </button>
          </div>

          {/* Processing AI Vision Indicator */}
          {processingPhoto && (
            <div className="bg-[#E8F5EE] border border-[#A7F3D0] rounded-2xl p-3.5 flex items-center gap-3">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Captured scan"
                  className="w-12 h-12 rounded-xl object-cover border border-[#A7F3D0] shrink-0"
                />
              )}
              <Loader2 className="w-5 h-5 text-[#0F7B49] animate-spin shrink-0" />
              <div>
                <div className="font-display font-bold text-xs text-[#064E3B] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#0F7B49]" />
                  Scanning Barcode &amp; AI Vision OCR...
                </div>
                <p className="text-[11px] text-[#0F7B49] mt-0.5">
                  Reading 15-digit IMEI, Brand, Model &amp; Specs
                </p>
              </div>
            </div>
          )}

          {/* Live Camera Stream Container */}
          <div
            ref={readerContainerRef}
            className="relative rounded-2xl overflow-hidden bg-[#111827] min-h-[200px] flex flex-col items-center justify-center border border-[#374151]"
          >
            <div
              id="imei-html5-qrcode-reader"
              className={`w-full ${cameraUnavailable && !cameraActive ? 'hidden' : 'block'}`}
            />

            {/* Capture & AI Read button directly on Live Camera View */}
            {cameraActive && (
              <div className="w-full p-2.5 bg-[#0B111E] border-t border-[#1F2937] flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#D1FAE5] leading-tight flex-1">
                  Auto-scanning barcodes... or tap button for *#06# text
                </span>
                <button
                  type="button"
                  disabled={processingPhoto}
                  onClick={() => void handleCaptureLiveFrameForAi()}
                  className="h-9 px-3 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-60"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Capture &amp; AI Read
                </button>
              </div>
            )}

            {!cameraActive && (
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="p-5 text-center space-y-2.5 w-full flex flex-col items-center justify-center"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#0F7B49]/20 border border-[#10B981]/40 flex items-center justify-center mx-auto">
                  {cameraUnavailable ? (
                    <Camera className="w-6 h-6 text-[#10B981]" />
                  ) : (
                    <Loader2 className="w-6 h-6 text-[#10B981] animate-spin" />
                  )}
                </div>
                <p className="text-xs text-white font-semibold max-w-xs">
                  {cameraUnavailable
                    ? 'Tap here to open Camera & scan Barcode / IMEI / Bill via AI Vision'
                    : 'Starting live camera... or tap here for Native Camera'}
                </p>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0F7B49] text-white text-[11px] font-bold">
                  <Sparkles className="w-3 h-3" />
                  Works on Barcodes, *#06# Screen &amp; Bills
                </span>
              </button>
            )}
          </div>

          {/* Live Status Feedback */}
          {!processingPhoto && (
            <p className="text-xs text-center text-[#4B5563] font-medium px-1">
              {statusMessage}
            </p>
          )}

          {/* Manual 15-Digit Entry inside Scanner */}
          <div className="pt-2 border-t border-[#E5E7EB] flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={15}
              value={manualInput}
              onChange={(e) =>
                setManualInput(e.target.value.replace(/\D/g, '').slice(0, 15))
              }
              placeholder="Or type 15-digit IMEI manually"
              className="flex-1 h-11 px-3.5 rounded-xl border border-[#D1D5DB] font-mono text-sm focus:outline-none focus:border-[#0F7B49]"
            />
            <button
              type="button"
              disabled={manualInput.length !== 15}
              onClick={() => completeWithResult(manualInput)}
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

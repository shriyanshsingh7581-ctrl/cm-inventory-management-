import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AiExtractedScanResult,
  createContrastEnhancedStripCanvas,
  detectBarcodesFast,
  extract15DigitImei,
  extractPhoneOrBillViaAiVision,
  isValidImeiLuhn,
  scanCapturedPhotoForImeiAndSpecs,
  warmupBarcodeDetector,
} from '../utils/apkMediaEngine';
import { lookupImeiSpecs } from '../utils/imeiDatabase';
import {
  Camera,
  Check,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  Sparkles,
  X,
  ZoomIn,
} from 'lucide-react';

interface ImeiScannerModalProps {
  onScanSuccess: (
    imei: string,
    aiExtractedSpecs?: AiExtractedScanResult
  ) => void;
  onClose: () => void;
}

/**
 * Plays a crisp, instant scanner lock beep via Web Audio API + subtle haptic vibration.
 */
function playScannerBeep() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(70);
    }
  } catch {
    // ignore
  }
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1480, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1960, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
    window.setTimeout(() => {
      void ctx.close();
    }, 220);
  } catch {
    // ignore audio block
  }
}

export const ImeiScannerModal: React.FC<ImeiScannerModalProps> = ({
  onScanSuccess,
  onClose,
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [autoAiScanning, setAutoAiScanning] = useState(false);
  const [lockedImeiBanner, setLockedImeiBanner] = useState<{
    imei: string;
    imei2?: string;
    via: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Point camera at IMEI Barcode, *#06# screen, or Box sticker — scans automatically'
  );
  const [manualInput, setManualInput] = useState('');

  // Hardware camera capabilities
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<1 | 2>(1);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const autoAiIntervalRef = useRef<number | null>(null);
  const autoAiBusyRef = useRef(false);
  const autoAiAttemptsRef = useRef(0);
  const hasCompletedRef = useRef(false);

  const onScanSuccessRef = useRef(onScanSuccess);
  onScanSuccessRef.current = onScanSuccess;

  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraResources = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (autoAiIntervalRef.current !== null) {
      window.clearInterval(autoAiIntervalRef.current);
      autoAiIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
      videoTrackRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const completeWithResult = useCallback(
    (imei: string, specs?: AiExtractedScanResult, viaLabel = 'Instant Scan') => {
      if (hasCompletedRef.current) return;
      hasCompletedRef.current = true;
      stopCameraResources();
      playScannerBeep();

      if (imei) {
        setLockedImeiBanner({
          imei,
          imei2: specs?.imei2,
          via: viaLabel,
        });
        window.setTimeout(() => {
          onScanSuccessRef.current(imei, specs);
        }, 200);
      } else {
        onScanSuccessRef.current(imei, specs);
      }
    },
    [stopCameraResources]
  );

  /**
   * Captures a sharp center-weighted JPEG frame from the live `<video>` stream
   * for instant server-side Gemini Flash Lite Vision OCR (*#06# screen, printed box text, blurry barcodes).
   */
  const captureLiveVideoDataUrl = useCallback((maxDim = 1024): string | null => {
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      return null;
    }
    const srcW = videoEl.videoWidth;
    const srcH = videoEl.videoHeight;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, dstW, dstH);
    return canvas.toDataURL('image/jpeg', 0.86);
  }, []);

  /**
   * Background AI Vision OCR assist for live camera frames (*#06# screens & printed IMEI stickers).
   */
  const runLiveFrameAiRead = useCallback(
    async (isManualTap: boolean) => {
      if (hasCompletedRef.current || autoAiBusyRef.current) return;
      const frameDataUrl = captureLiveVideoDataUrl(isManualTap ? 1200 : 960);
      if (!frameDataUrl) {
        if (isManualTap) {
          nativeCameraInputRef.current?.click();
        }
        return;
      }

      autoAiBusyRef.current = true;
      if (isManualTap) {
        setProcessingPhoto(true);
        setStatusMessage('AI Vision reading IMEI from live camera frame...');
      } else {
        setAutoAiScanning(true);
      }

      try {
        const aiResult = await extractPhoneOrBillViaAiVision(frameDataUrl, {
          fastImeiOnly: !isManualTap,
        });

        if (hasCompletedRef.current) return;

        if (aiResult && aiResult.imei && aiResult.imei.length === 15) {
          completeWithResult(aiResult.imei, aiResult, 'AI Vision OCR');
          return;
        }

        if (isManualTap) {
          if (aiResult && (aiResult.brand || aiResult.model)) {
            completeWithResult(aiResult.imei || '', aiResult, 'AI Vision');
            return;
          }
          setStatusMessage(
            'Hold camera slightly closer & steady on the 15-digit IMEI, turn on Flash, or tap "Camera Photo"'
          );
        }
      } catch {
        if (isManualTap) {
          setStatusMessage(
            'Could not read IMEI clearly — try turning on Flash or use "Camera Photo"'
          );
        }
      } finally {
        autoAiBusyRef.current = false;
        setAutoAiScanning(false);
        if (isManualTap) {
          setProcessingPhoto(false);
        }
      }
    },
    [captureLiveVideoDataUrl, completeWithResult]
  );

  // Main Ultra-Fast Camera + Dual-Engine (Hardware/WASM Barcode + Auto AI Vision) Lifecycle
  useEffect(() => {
    let mounted = true;
    warmupBarcodeDetector();

    // Fast 1.8s WebView guard: if Android APK blocks/hangs getUserMedia, show Native Camera immediately
    const webViewHangTimer = window.setTimeout(() => {
      if (mounted && !streamRef.current) {
        setCameraUnavailable(true);
        setStatusMessage(
          'Tap "Camera Scan" below to snap IMEI barcode, *#06# screen, or mobile box'
        );
      }
    }, 1800);

    async function startLiveCamera() {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        if (mounted) {
          window.clearTimeout(webViewHangTimer);
          setCameraUnavailable(true);
        }
        return;
      }

      let stream: MediaStream | null = null;
      // Request crisp Full-HD rear camera first (essential for tiny 1D Code-128 IMEI barcodes!)
      const constraintProfiles: MediaStreamConstraints[] = [
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 1024 },
            height: { ideal: 1080, min: 576 },
          },
        },
        {
          audio: false,
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        { audio: false, video: true },
      ];

      for (const constraints of constraintProfiles) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch {
          // Try next relaxed constraint profile
        }
      }

      if (!mounted) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      if (!stream) {
        window.clearTimeout(webViewHangTimer);
        setCameraActive(false);
        setCameraUnavailable(true);
        setStatusMessage(
          'Tap "Camera Scan" below to scan IMEI barcode, *#06# screen, or box label'
        );
        return;
      }

      window.clearTimeout(webViewHangTimer);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] || null;
      videoTrackRef.current = track;

      // Enable continuous autofocus & detect hardware torch/zoom capabilities
      if (track) {
        try {
          const caps =
            typeof track.getCapabilities === 'function'
              ? (track.getCapabilities() as MediaTrackCapabilities & {
                  torch?: boolean;
                  zoom?: { min: number; max: number };
                  focusMode?: string[];
                })
              : null;

          if (caps?.torch) {
            setTorchSupported(true);
          }
          if (caps?.zoom && caps.zoom.max >= 2) {
            setZoomSupported(true);
          }
          if (caps?.focusMode?.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            });
          }
        } catch {
          // Hardware constraint optional
        }
      }

      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.srcObject = stream;
        try {
          await videoEl.play();
        } catch {
          // Autoplay handled by playsInline + muted
        }
      }

      setCameraActive(true);
      setCameraUnavailable(false);

      // Start blazing-fast continuous dual-pass barcode detection loop (~15-18 scans/sec)
      let frameIndex = 0;
      let lastScanTs = 0;
      let busy = false;
      const workCanvas = document.createElement('canvas');
      workCanvasRef.current = workCanvas;

      const tick = (now: number) => {
        if (!mounted || hasCompletedRef.current) return;
        rafRef.current = requestAnimationFrame(tick);

        if (busy || now - lastScanTs < 55) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2 || v.videoWidth === 0) return;

        busy = true;
        lastScanTs = now;
        frameIndex += 1;

        void (async () => {
          try {
            // Alternate between full raw live video frame (fast, catches any orientation/QR/DataMatrix)
            // and contrast-boosted monochrome center band (catches faint/tiny 1D Code-128 IMEI bars!)
            let source: HTMLVideoElement | HTMLCanvasElement = v;
            if (frameIndex % 2 === 0) {
              const strip = createContrastEnhancedStripCanvas(v, workCanvas, true);
              if (strip) source = strip;
            }

            const { imeis, rawValues } = await detectBarcodesFast(source);
            if (!mounted || hasCompletedRef.current) return;

            if (imeis.length > 0) {
              const imei1 = imeis[0];
              const imei2 = imeis[1] || '';
              const tacSpec = lookupImeiSpecs(imei1);
              completeWithResult(
                imei1,
                {
                  imei: imei1,
                  imei2,
                  allImeis: imeis,
                  barcode: rawValues[0] || imei1,
                  brand: tacSpec?.brand || '',
                  model: tacSpec?.model || '',
                  ram: tacSpec?.ram || '',
                  storage: tacSpec?.storage || '',
                  colour: tacSpec?.colour || '',
                  sourceMethod: 'local_barcode',
                },
                imei2 ? 'Dual-IMEI Barcode' : 'Instant Barcode'
              );
              return;
            }

            if (rawValues.length > 0 && frameIndex % 6 === 0) {
              const shortPreview = rawValues[0].slice(0, 18);
              setStatusMessage(
                `Barcode detected (${shortPreview}) — aim at 15-digit IMEI or hold steady for AI Read`
              );
            }
          } catch {
            // Continue scanning next frame
          } finally {
            busy = false;
          }
        })();
      };

      rafRef.current = requestAnimationFrame(tick);

      // Hands-free Smart AI Vision Assist:
      // Automatically reads *#06# screens & printed IMEI numbers after 1.5s if no barcode locked yet
      autoAiAttemptsRef.current = 0;
      autoAiIntervalRef.current = window.setInterval(() => {
        if (!mounted || hasCompletedRef.current) return;
        if (autoAiAttemptsRef.current >= 4) return;
        autoAiAttemptsRef.current += 1;
        void runLiveFrameAiRead(false);
      }, 1700);
    }

    void startLiveCamera();

    return () => {
      mounted = false;
      window.clearTimeout(webViewHangTimer);
      stopCameraResources();
    };
  }, [completeWithResult, runLiveFrameAiRead, stopCameraResources]);

  const toggleTorch = async () => {
    const track = videoTrackRef.current;
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // ignore if unsupported by hardware
    }
  };

  const toggleZoom = async () => {
    const track = videoTrackRef.current;
    if (!track || !zoomSupported) return;
    const next: 1 | 2 = zoomLevel === 1 ? 2 : 1;
    try {
      await track.applyConstraints({
        advanced: [{ zoom: next } as MediaTrackConstraintSet],
      });
      setZoomLevel(next);
    } catch {
      // ignore
    }
  };

  const processImageFile = async (file: File) => {
    setProcessingPhoto(true);
    setStatusMessage('Scanning Barcode & reading 15-digit IMEI...');

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
      // fastImeiOnly: returns in ~50ms if local WASM barcode finds IMEI, otherwise runs fast server AI Vision OCR!
      const scanResult = await scanCapturedPhotoForImeiAndSpecs(file, {
        fastImeiOnly: true,
      });
      const foundImei =
        scanResult.imei || extract15DigitImei(scanResult.barcode || '');

      if (foundImei && foundImei.length === 15) {
        completeWithResult(
          foundImei,
          scanResult,
          scanResult.sourceMethod === 'local_barcode'
            ? 'Instant Barcode'
            : 'AI Vision OCR'
        );
        return;
      }

      if (scanResult.brand || scanResult.model) {
        completeWithResult(foundImei || '', scanResult, 'AI Vision');
        return;
      }

      setStatusMessage(
        'IMEI not clear in photo — hold closer with good light, or type 15 digits below.'
      );
    } catch {
      setStatusMessage(
        'Could not process photo — retake clearly or type 15-digit IMEI below.'
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

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const manualIsLuhnValid =
    manualInput.length === 15 && isValidImeiLuhn(manualInput);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* 1. Direct Native Hardware Camera Input (100% Works in All Android Web-APKs) */}
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapturedImageFile}
        className="hidden"
      />
      {/* 2. Upload from Gallery Input */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleCapturedImageFile}
        className="hidden"
      />

      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-sheet-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#111827] leading-tight">
                Fast IMEI Scanner
              </h3>
              <p className="text-[11px] text-[#6B7280]">
                Barcode, *#06# Screen &amp; Dual-SIM Box Label
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCameraResources();
              onClose();
            }}
            className="w-9 h-9 rounded-full hover:bg-[#F3F4F6] flex items-center justify-center text-[#6B7280]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 max-h-[85dvh] overflow-y-auto touch-pan-y no-scrollbar">
          {/* Live High-Res Viewfinder */}
          <div className="relative rounded-2xl overflow-hidden bg-[#0B111E] aspect-[4/3] w-full flex flex-col items-center justify-center border border-[#1F2937]">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover ${
                cameraActive ? 'block' : 'hidden'
              }`}
            />

            {/* Wide 1D/2D IMEI Target Reticle Overlay */}
            {cameraActive && !lockedImeiBanner && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                {/* Wide horizontal targeting box so long 15-digit Code-128 barcodes never clip */}
                <div className="relative w-[90%] h-[42%] rounded-xl border-2 border-[#10B981]/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]">
                  {/* Animated Laser Line */}
                  <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-0.5 bg-[#10B981] shadow-[0_0_10px_#10B981] animate-pulse" />
                  {/* Corner Accents */}
                  <div className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-4 border-l-4 border-[#34D399] rounded-tl-lg" />
                  <div className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-4 border-r-4 border-[#34D399] rounded-tr-lg" />
                  <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-4 border-l-4 border-[#34D399] rounded-bl-lg" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-4 border-r-4 border-[#34D399] rounded-br-lg" />
                </div>

                {/* Live AI Vision Auto-Assist Indicator */}
                <div className="mt-2.5 px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-xs text-[11px] font-medium text-white flex items-center gap-1.5">
                  {autoAiScanning ? (
                    <>
                      <Sparkles className="w-3 h-3 text-[#34D399] animate-pulse" />
                      <span>AI reading *#06# / printed IMEI...</span>
                    </>
                  ) : (
                    <span>Align IMEI barcode or *#06# inside box</span>
                  )}
                </div>
              </div>
            )}

            {/* Hardware Controls: Torch + 2x Zoom (Top Right) */}
            {cameraActive && !lockedImeiBanner && (
              <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
                {zoomSupported && (
                  <button
                    type="button"
                    onClick={() => void toggleZoom()}
                    className={`h-8 px-2.5 rounded-full backdrop-blur-md text-xs font-bold flex items-center gap-1 border transition-colors ${
                      zoomLevel === 2
                        ? 'bg-[#0F7B49] text-white border-[#34D399]'
                        : 'bg-black/55 text-white border-white/20'
                    }`}
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    {zoomLevel}x
                  </button>
                )}
                {torchSupported && (
                  <button
                    type="button"
                    onClick={() => void toggleTorch()}
                    aria-label="Toggle Flashlight"
                    className={`w-8 h-8 rounded-full backdrop-blur-md flex items-center justify-center border transition-colors ${
                      torchOn
                        ? 'bg-amber-400 text-[#111827] border-amber-300'
                        : 'bg-black/55 text-white border-white/20'
                    }`}
                  >
                    {torchOn ? (
                      <FlashlightOff className="w-4 h-4" />
                    ) : (
                      <Flashlight className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Instant Lock Confirmation Overlay */}
            {lockedImeiBanner && (
              <div className="absolute inset-0 bg-[#064E3B]/95 flex flex-col items-center justify-center p-4 text-center z-20">
                <CheckCircle2 className="w-12 h-12 text-[#34D399] mb-2" />
                <p className="text-xs font-bold uppercase tracking-wider text-[#A7F3D0]">
                  {lockedImeiBanner.via} Locked
                </p>
                <p className="font-mono font-bold text-xl text-white tracking-wider mt-1">
                  {lockedImeiBanner.imei}
                </p>
                {lockedImeiBanner.imei2 && (
                  <p className="font-mono text-xs text-[#D1FAE5] mt-1">
                    IMEI 2: {lockedImeiBanner.imei2}
                  </p>
                )}
              </div>
            )}

            {/* Instant AI Read Bar at Bottom of Viewfinder */}
            {cameraActive && !lockedImeiBanner && (
              <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-center z-10">
                <button
                  type="button"
                  disabled={processingPhoto}
                  onClick={() => void runLiveFrameAiRead(true)}
                  className="h-9 px-4 rounded-full bg-[#0F7B49] hover:bg-[#0C633A] text-white text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 transition-all disabled:opacity-60"
                >
                  {processingPhoto ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>Instant AI Read (*#06# / Box)</span>
                </button>
              </div>
            )}

            {/* Android WebView / Fallback Camera Trigger */}
            {!cameraActive && !lockedImeiBanner && (
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="p-5 text-center space-y-2.5 w-full h-full flex flex-col items-center justify-center"
              >
                <div className="w-13 h-13 rounded-2xl bg-[#0F7B49]/25 border border-[#10B981]/50 flex items-center justify-center mx-auto">
                  {cameraUnavailable ? (
                    <Camera className="w-6 h-6 text-[#34D399]" />
                  ) : (
                    <Loader2 className="w-6 h-6 text-[#34D399] animate-spin" />
                  )}
                </div>
                <p className="text-xs text-white font-semibold max-w-xs">
                  {cameraUnavailable
                    ? 'Tap here to open Camera & scan IMEI instantly'
                    : 'Starting HD camera... or tap for Native Camera'}
                </p>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0F7B49] text-white text-[11px] font-bold">
                  <Sparkles className="w-3 h-3" />
                  Barcodes · *#06# Screen · Dual-SIM Box
                </span>
              </button>
            )}
          </div>

          {/* Native APK Camera & Gallery Triggers (100% Reliable on Every Android Web-APK) */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={processingPhoto}
              onClick={() => nativeCameraInputRef.current?.click()}
              className="h-11 px-3 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-display font-bold text-xs flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition-all disabled:opacity-60"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Camera Photo Scan</span>
            </button>

            <button
              type="button"
              disabled={processingPhoto}
              onClick={() => galleryInputRef.current?.click()}
              className="h-11 px-3 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] text-[#111827] font-display font-bold text-xs flex items-center justify-center gap-2 active:scale-[0.99] transition-all disabled:opacity-60"
            >
              <ImageIcon className="w-4 h-4 text-[#0F7B49] shrink-0" />
              <span>Upload Photo</span>
            </button>
          </div>

          {/* Processing Indicator */}
          {processingPhoto && (
            <div className="bg-[#E8F5EE] border border-[#A7F3D0] rounded-xl p-3 flex items-center gap-3">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Captured scan"
                  className="w-11 h-11 rounded-lg object-cover border border-[#A7F3D0] shrink-0"
                />
              )}
              <Loader2 className="w-5 h-5 text-[#0F7B49] animate-spin shrink-0" />
              <div>
                <div className="font-display font-bold text-xs text-[#064E3B] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#0F7B49]" />
                  Reading 15-Digit IMEI...
                </div>
                <p className="text-[11px] text-[#0F7B49]">
                  Barcode + AI Vision OCR active
                </p>
              </div>
            </div>
          )}

          {/* Status Feedback */}
          {!processingPhoto && !lockedImeiBanner && (
            <p className="text-[11px] text-center text-[#4B5563] font-medium px-1">
              {statusMessage}
            </p>
          )}

          {/* Manual 15-Digit Entry */}
          <div className="pt-2 border-t border-[#E5E7EB] space-y-1.5">
            <div className="flex gap-2">
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
                onClick={() => completeWithResult(manualInput, undefined, 'Manual Entry')}
                className="h-11 px-4 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
              >
                <Check className="w-4 h-4" />
                Apply
              </button>
            </div>
            {manualInput.length === 15 && (
              <p
                className={`text-[11px] font-medium px-1 ${
                  manualIsLuhnValid ? 'text-[#0F7B49]' : 'text-amber-600'
                }`}
              >
                {manualIsLuhnValid
                  ? 'Valid 15-digit IMEI checksum verified'
                  : '15 digits entered (checksum warning — verify digits)'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

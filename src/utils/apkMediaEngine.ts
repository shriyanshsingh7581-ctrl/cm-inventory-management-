import {
  BarcodeDetector as WasmBarcodeDetector,
  prepareZXingModule,
  type BarcodeFormat,
} from 'barcode-detector/ponyfill';
import { Html5Qrcode } from 'html5-qrcode';
import {
  compressImageFileToDataUrl,
  ImeiDeviceSpec,
  lookupImeiSpecs,
} from './imeiDatabase';

// Optional Groq key for Whisper audio transcription (server handles Gemini Vision & Voice Parse automatically)
const GROQ_API_KEY = (import.meta.env.VITE_GROQ_API_KEY || '').trim();

export interface AiExtractedScanResult {
  imei: string;
  imei2?: string;
  allImeis?: string[];
  barcode?: string;
  brand?: string;
  model?: string;
  ram?: string;
  storage?: string;
  colour?: string;
  buyingPrice?: number;
  expectedSellingPrice?: number;
  sellerName?: string;
  sellerMobile?: string;
  sellerAddress?: string;
  idType?: string;
  idNumber?: string;
  notes?: string;
  sourceMethod: 'local_barcode' | 'ai_vision_ocr';
}

export interface AiExtractedVoiceResult {
  intent?: 'buy' | 'sell' | 'search' | 'due';
  imei?: string;
  brand?: string;
  model?: string;
  ram?: string;
  storage?: string;
  colour?: string;
  buyingPrice?: number;
  expectedSellingPrice?: number;
  sellingPrice?: number;
  sellerName?: string;
  sellerMobile?: string;
  sellerAddress?: string;
  buyerName?: string;
  buyerMobile?: string;
  buyerAddress?: string;
  idType?: string;
  idNumber?: string;
  paymentMethod?: 'Cash' | 'UPI' | 'Bank Transfer' | 'Part Due';
  dueAmount?: number;
  notes?: string;
  searchQuery?: string;
}

const IMEI_BARCODE_FORMATS: BarcodeFormat[] = [
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'codabar',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'qr_code',
  'data_matrix',
  'pdf417',
];

const KNOWN_IMEI_TAC_PREFIXES = new Set([
  '35',
  '86',
  '01',
  '99',
  '49',
  '50',
  '30',
  '33',
  '44',
  '45',
  '51',
  '52',
  '53',
  '54',
  '91',
  '98',
]);

// Configure ZXing WASM to load from our same-origin /public/zxing_reader.wasm (instant & works in offline/APK WebViews)
let zxingPrepared = false;
let wasmDetectorInstance: WasmBarcodeDetector | null = null;
let nativeDetectorInstance: {
  detect: (
    source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap
  ) => Promise<Array<{ rawValue?: string }>>;
} | null = null;
let nativeChecked = false;

function ensureZxingPrepared() {
  if (zxingPrepared) return;
  zxingPrepared = true;
  try {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => {
          if (path.endsWith('.wasm')) {
            return '/zxing_reader.wasm';
          }
          return prefix + path;
        },
      },
    });
  } catch {
    // Fallback to default loader if already initialized
  }
}

export function warmupBarcodeDetector(): void {
  ensureZxingPrepared();
  try {
    if (!wasmDetectorInstance) {
      wasmDetectorInstance = new WasmBarcodeDetector({
        formats: IMEI_BARCODE_FORMATS,
      });
    }
  } catch {
    // ignore warmup failure
  }
  void getNativeBarcodeDetector();
}

async function getNativeBarcodeDetector() {
  if (nativeChecked) return nativeDetectorInstance;
  nativeChecked = true;
  try {
    const WinBD = (
      window as unknown as {
        BarcodeDetector?: {
          getSupportedFormats?: () => Promise<string[]>;
          new (options?: { formats?: string[] }): {
            detect: (
              source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap
            ) => Promise<Array<{ rawValue?: string }>>;
          };
        };
      }
    ).BarcodeDetector;

    if (!WinBD) return null;

    let formatsToUse: string[] = IMEI_BARCODE_FORMATS;
    if (typeof WinBD.getSupportedFormats === 'function') {
      const supported = await WinBD.getSupportedFormats();
      if (!supported.includes('code_128')) {
        return null;
      }
      formatsToUse = IMEI_BARCODE_FORMATS.filter((f) => supported.includes(f));
    }

    nativeDetectorInstance = new WinBD({ formats: formatsToUse });
    return nativeDetectorInstance;
  } catch {
    return null;
  }
}

function getWasmBarcodeDetector(): WasmBarcodeDetector | null {
  ensureZxingPrepared();
  if (!wasmDetectorInstance) {
    try {
      wasmDetectorInstance = new WasmBarcodeDetector({
        formats: IMEI_BARCODE_FORMATS,
      });
    } catch {
      return null;
    }
  }
  return wasmDetectorInstance;
}

/**
 * Computes the 15th GSMA Luhn check digit for a 14-digit IMEI base.
 */
export function computeImeiLuhnCheckDigit(first14: string): string {
  if (!/^\d{14}$/.test(first14)) return '';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(first14[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Standard GSMA Luhn checksum validation for 15-digit IMEI numbers.
 */
export function isValidImeiLuhn(imei15: string): boolean {
  if (!/^\d{15}$/.test(imei15)) return false;
  return computeImeiLuhnCheckDigit(imei15.slice(0, 14)) === imei15[14];
}

function hasKnownTacPrefix(digits: string): boolean {
  return digits.length >= 2 && KNOWN_IMEI_TAC_PREFIXES.has(digits.slice(0, 2));
}

function isLikelyFakeRepeat(digits: string): boolean {
  return /^(\d)\1{14}$/.test(digits);
}

/**
 * Extracts ALL unique 15-digit IMEI numbers from any barcode string, *#06# text,
 * GS1-128 prefixed barcode, 16-digit IMEISV, 14-digit IMEI, or multi-IMEI box label.
 * Returns candidates sorted with GSMA Luhn-valid + known TAC prefix first.
 */
export function extractAllImeis(rawText: string): string[] {
  if (!rawText) return [];

  const found = new Map<string, number>(); // imei15 -> priority score (higher = stronger)

  const addCandidate = (imei15: string, baseScore: number) => {
    if (!/^\d{15}$/.test(imei15) || isLikelyFakeRepeat(imei15)) return;
    let score = baseScore;
    if (isValidImeiLuhn(imei15)) score += 100;
    if (hasKnownTacPrefix(imei15)) score += 25;
    const prev = found.get(imei15) ?? -1;
    if (score > prev) found.set(imei15, score);
  };

  // 1. Exact contiguous 15-digit numbers
  const exact15 = rawText.match(/(?<!\d)\d{15}(?!\d)/g);
  if (exact15) {
    for (const m of exact15) {
      addCandidate(m, 50);
    }
  }

  // 2. Spaced / slashed / hyphenated / dotted 15-digit or 16-digit IMEISV groups
  // e.g. "356938/03/564380/9", "35 693803 564380 9", "356938-03-564380-9 / 01"
  const formattedMatches = rawText.match(/(?<!\d)(?:\d[\s/.-]?){14,16}\d(?!\d)/g);
  if (formattedMatches) {
    for (const m of formattedMatches) {
      const digits = m.replace(/\D/g, '');
      if (digits.length === 15) {
        addCandidate(digits, 48);
      } else if (digits.length === 16) {
        // Could be 16-digit IMEISV (14-digit TAC+SNR + 2-digit SVN) OR 15-digit IMEI + 1 extra digit
        const first15 = digits.slice(0, 15);
        if (isValidImeiLuhn(first15)) {
          addCandidate(first15, 45);
        } else {
          const derived = digits.slice(0, 14) + computeImeiLuhnCheckDigit(digits.slice(0, 14));
          addCandidate(derived, 35);
        }
      } else if (digits.length === 17) {
        // Common "*#06#" format: 15-digit IMEI + "/01" SVN suffix
        const first15 = digits.slice(0, 15);
        if (isValidImeiLuhn(first15) || hasKnownTacPrefix(first15)) {
          addCandidate(first15, 46);
        }
      }
    }
  }

  // 3. Explicit IMEI-labeled strings (handles IMEI1, IMEI2, MEID, IMEISV, etc.)
  const labeledMatches = rawText.match(
    /(?:IMEI\s*[12]?\s*(?:SV)?\s*[:#=-]?\s*)((?:\d[\s/.-]*){14,17})/gi
  );
  if (labeledMatches) {
    for (const m of labeledMatches) {
      const digits = m.replace(/\D/g, '');
      if (digits.length === 15) {
        addCandidate(digits, 60);
      } else if (digits.length === 14) {
        addCandidate(digits + computeImeiLuhnCheckDigit(digits), 40);
      } else if (digits.length >= 16) {
        const first15 = digits.slice(0, 15);
        if (isValidImeiLuhn(first15)) {
          addCandidate(first15, 58);
        } else {
          addCandidate(digits.slice(0, 14) + computeImeiLuhnCheckDigit(digits.slice(0, 14)), 42);
        }
      }
    }
  }

  // 4. Long digit runs (16 to 24 digits): GS1-128 / prefixed / suffixed barcodes
  // Slide a 15-digit window to catch Luhn-valid IMEIs embedded inside barcode payloads
  const longDigitRuns = rawText.match(/\d{16,24}/g);
  if (longDigitRuns) {
    for (const run of longDigitRuns) {
      let matchedLuhnWindow = false;
      for (let start = 0; start <= run.length - 15; start++) {
        const slice15 = run.slice(start, start + 15);
        if (isValidImeiLuhn(slice15) && hasKnownTacPrefix(slice15)) {
          addCandidate(slice15, 44);
          matchedLuhnWindow = true;
          break;
        }
      }
      if (!matchedLuhnWindow && run.length === 16) {
        // Standard 16-digit IMEISV barcode on Samsung/Xiaomi/Vivo boxes
        const first15 = run.slice(0, 15);
        if (isValidImeiLuhn(first15)) {
          addCandidate(first15, 42);
        } else if (hasKnownTacPrefix(run)) {
          const imei15FromSv =
            run.slice(0, 14) + computeImeiLuhnCheckDigit(run.slice(0, 14));
          addCandidate(imei15FromSv, 32);
        }
      }
    }
  }

  // 5. Standalone 14-digit IMEI barcode (missing check digit) with valid GSMA TAC prefix
  const exact14 = rawText.match(/(?<!\d)\d{14}(?!\d)/g);
  if (exact14 && found.size === 0) {
    for (const m of exact14) {
      if (hasKnownTacPrefix(m)) {
        addCandidate(m + computeImeiLuhnCheckDigit(m), 25);
      }
    }
  }

  // 6. Entire string stripped of non-digits (e.g. "I356938035643809" or "S356938035643809")
  const allDigits = rawText.replace(/\D/g, '');
  if (allDigits.length === 15) {
    addCandidate(allDigits, 50);
  } else if (allDigits.length === 16 && hasKnownTacPrefix(allDigits)) {
    const first15 = allDigits.slice(0, 15);
    if (isValidImeiLuhn(first15)) {
      addCandidate(first15, 45);
    } else {
      addCandidate(
        allDigits.slice(0, 14) + computeImeiLuhnCheckDigit(allDigits.slice(0, 14)),
        30
      );
    }
  }

  return Array.from(found.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([imei]) => imei);
}

/**
 * Extracts the best valid 15-digit IMEI from any raw string if present.
 */
export function extract15DigitImei(rawText: string): string {
  return extractAllImeis(rawText)[0] || '';
}

/**
 * Runs ultra-fast native BarcodeDetector (if available) + ZXing-C++ WASM BarcodeDetector
 * directly on a live HTMLVideoElement or HTMLCanvasElement.
 */
export async function detectBarcodesFast(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap
): Promise<{ imeis: string[]; rawValues: string[] }> {
  const rawValues: string[] = [];
  const imeisSet = new Set<string>();

  const collectResults = (results: Array<{ rawValue?: string }>) => {
    for (const item of results) {
      const val = (item.rawValue || '').trim();
      if (!val) continue;
      if (!rawValues.includes(val)) rawValues.push(val);
      for (const imei of extractAllImeis(val)) {
        imeisSet.add(imei);
      }
    }
  };

  // 1. Try native hardware BarcodeDetector first (zero overhead on Android Chrome/WebView ML Kit)
  const nativeDetector = await getNativeBarcodeDetector();
  if (nativeDetector) {
    try {
      const nativeRes = await nativeDetector.detect(source);
      collectResults(nativeRes);
      if (imeisSet.size > 0) {
        return { imeis: Array.from(imeisSet), rawValues };
      }
    } catch {
      // Fall through to ZXing WASM
    }
  }

  // 2. Try ZXing-C++ WASM BarcodeDetector (blazing fast 1D Code-128/Code-39/ITF + 2D on ALL devices)
  const wasmDetector = getWasmBarcodeDetector();
  if (wasmDetector) {
    try {
      const wasmRes = await wasmDetector.detect(source);
      collectResults(wasmRes);
    } catch {
      // ignore frame decode error
    }
  }

  return { imeis: Array.from(imeisSet), rawValues };
}

/**
 * Creates a contrast-boosted monochrome crop canvas from a video/canvas source.
 * Dramatically improves 1D Code-128 IMEI barcode locking on glossy stickers & *#06# screens.
 */
export function createContrastEnhancedStripCanvas(
  source: HTMLVideoElement | HTMLCanvasElement,
  targetCanvas?: HTMLCanvasElement,
  cropBand = true
): HTMLCanvasElement | null {
  const srcW =
    source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcH =
    source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!srcW || !srcH) return null;

  const sx = cropBand ? Math.round(srcW * 0.03) : 0;
  const sy = cropBand ? Math.round(srcH * 0.24) : 0;
  const sw = cropBand ? Math.round(srcW * 0.94) : srcW;
  const sh = cropBand ? Math.round(srcH * 0.52) : srcH;

  // Keep sharp resolution for thin 1D IMEI bars (up to 1400px wide)
  const maxW = 1400;
  const scale = sw > maxW ? maxW / sw : 1;
  const dstW = Math.max(1, Math.round(sw * scale));
  const dstH = Math.max(1, Math.round(sh * scale));

  const canvas = targetCanvas || document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // Boost grayscale contrast so faint black-on-white IMEI bars snap sharply
  ctx.filter = 'grayscale(100%) contrast(165%) brightness(106%)';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dstW, dstH);
  ctx.filter = 'none';
  return canvas;
}

function createRotatedCanvas90(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = source.height;
  canvas.height = source.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  fileName: string,
  quality = 0.92
): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], fileName, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      quality
    );
  });
}

async function createNormalizedCanvasFromFile(
  imageFile: File,
  maxDim = 1600
): Promise<HTMLCanvasElement | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(imageFile);
      let { width, height } = bitmap;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      return canvas;
    }
  } catch {
    // Fallback to Image element
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
      }
      URL.revokeObjectURL(url);
      resolve(ctx ? canvas : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Multi-pass local barcode decoder (WASM ZXing-C++ + Native Hardware BarcodeDetector + Html5Qrcode fallback).
 * Decodes full image -> contrast-enhanced monochrome -> 90° rotated -> Html5Qrcode.
 * Returns ALL IMEIs found on the photo (IMEI 1 + IMEI 2 on Dual-SIM box stickers!).
 */
export async function decodeAllImeisLocallyFromFile(
  imageFile: File
): Promise<{ imei: string; imei2: string; allImeis: string[]; rawBarcode: string } | null> {
  const normalizedCanvas = await createNormalizedCanvasFromFile(imageFile, 1600);
  const collectedImeis = new Set<string>();
  let firstRawBarcode = '';

  const absorb = (res: { imeis: string[]; rawValues: string[] }) => {
    if (!firstRawBarcode && res.rawValues[0]) {
      firstRawBarcode = res.rawValues[0];
    }
    for (const imei of res.imeis) {
      collectedImeis.add(imei);
    }
  };

  if (normalizedCanvas) {
    // Pass 1: Full normalized canvas (fastest ~20ms)
    absorb(await detectBarcodesFast(normalizedCanvas));

    // Pass 2: Contrast-enhanced monochrome full canvas (catches glossy/low-contrast 1D Code-128 IMEI bars)
    if (collectedImeis.size === 0) {
      const enhancedFull = createContrastEnhancedStripCanvas(
        normalizedCanvas,
        undefined,
        false
      );
      if (enhancedFull) {
        absorb(await detectBarcodesFast(enhancedFull));
      }
    }

    // Pass 3: 90° rotated canvas (catches sideways/vertical barcodes on mobile boxes)
    if (collectedImeis.size === 0) {
      const rotated = createRotatedCanvas90(normalizedCanvas);
      if (rotated) {
        absorb(await detectBarcodesFast(rotated));
      }
    }
  }

  if (collectedImeis.size > 0) {
    const list = Array.from(collectedImeis);
    return {
      imei: list[0] || '',
      imei2: list[1] || '',
      allImeis: list,
      rawBarcode: firstRawBarcode || list[0] || '',
    };
  }

  // Pass 4: Html5Qrcode.scanFile final local backup
  const tempId = `apk-hidden-qr-reader-${Date.now()}`;
  let tempDiv: HTMLDivElement | null = null;
  try {
    tempDiv = document.createElement('div');
    tempDiv.id = tempId;
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '-9999px';
    tempDiv.style.width = '10px';
    tempDiv.style.height = '10px';
    document.body.appendChild(tempDiv);

    const html5Qr = new Html5Qrcode(tempId);
    const candidateFile = normalizedCanvas
      ? (await canvasToJpegFile(normalizedCanvas, 'scan-resized.jpg', 0.92)) || imageFile
      : imageFile;

    try {
      const decodedText = await html5Qr.scanFile(candidateFile, false);
      if (decodedText) {
        const list = extractAllImeis(decodedText);
        if (list.length > 0) {
          html5Qr.clear();
          return {
            imei: list[0],
            imei2: list[1] || '',
            allImeis: list,
            rawBarcode: decodedText.trim(),
          };
        }
      }
    } catch {
      // No crisp barcode found locally; Server AI Vision OCR will read it
    }
    html5Qr.clear();
  } catch {
    // ignore
  } finally {
    if (tempDiv && tempDiv.parentNode) {
      tempDiv.parentNode.removeChild(tempDiv);
    }
  }

  return null;
}

/**
 * Backward-compatible single-IMEI helper.
 */
export async function decodeBarcodeLocallyFromFile(
  imageFile: File
): Promise<string | null> {
  const res = await decodeAllImeisLocallyFromFile(imageFile);
  return res?.imei || null;
}

function normalizeRam(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/(\d+)\s*GB/i);
  if (m) return `${m[1]} GB`;
  return raw.trim().slice(0, 20);
}

function normalizeStorage(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/(\d+)\s*(GB|TB)/i);
  if (m) return `${m[1]} ${m[2].toUpperCase()}`;
  return raw.trim().slice(0, 20);
}

function normalizeScanResult(
  parsed: Partial<AiExtractedScanResult> | null,
  rawTextFallback: string
): AiExtractedScanResult | null {
  if (!parsed && !rawTextFallback) return null;

  const combinedImeiSource = [
    parsed?.imei || '',
    parsed?.imei2 || '',
    ...(Array.isArray(parsed?.allImeis) ? parsed.allImeis : []),
    parsed?.barcode || '',
    rawTextFallback,
  ]
    .filter(Boolean)
    .join(' ');

  const allImeis = extractAllImeis(combinedImeiSource);
  const cleanImei = extract15DigitImei(parsed?.imei || '') || allImeis[0] || '';
  const cleanImei2Candidate =
    extract15DigitImei(parsed?.imei2 || '') ||
    allImeis.find((x) => x !== cleanImei) ||
    '';
  const cleanImei2 = cleanImei2Candidate !== cleanImei ? cleanImei2Candidate : '';

  const tacSpec: ImeiDeviceSpec | null = cleanImei
    ? lookupImeiSpecs(cleanImei)
    : null;

  const cleanBrand = (parsed?.brand || tacSpec?.brand || '').trim().slice(0, 60);
  const cleanModel = (parsed?.model || tacSpec?.model || '').trim().slice(0, 100);
  const cleanRam = normalizeRam(parsed?.ram || tacSpec?.ram || '');
  const cleanStorage = normalizeStorage(
    parsed?.storage || tacSpec?.storage || ''
  );

  if (
    !cleanImei &&
    !cleanImei2 &&
    !cleanBrand &&
    !cleanModel &&
    !parsed?.idNumber &&
    !parsed?.sellerName
  ) {
    return null;
  }

  return {
    imei: cleanImei,
    imei2: cleanImei2,
    allImeis,
    barcode: (parsed?.barcode || cleanImei || '').slice(0, 32),
    brand: cleanBrand,
    model: cleanModel,
    ram: cleanRam,
    storage: cleanStorage,
    colour: (parsed?.colour || tacSpec?.colour || '').trim().slice(0, 40),
    buyingPrice: Number(parsed?.buyingPrice) || 0,
    expectedSellingPrice: Number(parsed?.expectedSellingPrice) || 0,
    sellerName: (parsed?.sellerName || '').trim().slice(0, 120),
    sellerMobile: (parsed?.sellerMobile || '').replace(/\D/g, '').slice(-10),
    sellerAddress: (parsed?.sellerAddress || '').trim().slice(0, 300),
    idType: (parsed?.idType || '').trim().slice(0, 40),
    idNumber: (parsed?.idNumber || '').trim().slice(0, 30),
    notes: (parsed?.notes || '').trim().slice(0, 500),
    sourceMethod: 'ai_vision_ocr',
  };
}

/**
 * STEP B: Server-Side AI Vision OCR via `/api/scan-imei` (Gemini Flash Lite / Hydrogen).
 * Reads ALL 15-digit IMEIs from *#06# screens, blurry box stickers, phone backs,
 * SIM trays, paper bills, and Government ID cards in ~0.7–1.2s.
 */
export async function extractPhoneOrBillViaAiVision(
  imageFileOrDataUrl: File | string,
  options?: { fastImeiOnly?: boolean }
): Promise<AiExtractedScanResult | null> {
  const maxDim = options?.fastImeiOnly ? 1024 : 1280;
  const quality = options?.fastImeiOnly ? 0.84 : 0.88;

  const dataUrl =
    typeof imageFileOrDataUrl === 'string'
      ? imageFileOrDataUrl
      : await compressImageFileToDataUrl(imageFileOrDataUrl, maxDim, quality);

  const base64Raw = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  try {
    const resp = await fetch('/api/scan-imei', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64Raw,
        mimeType,
        fastImeiOnly: Boolean(options?.fastImeiOnly),
      }),
    });

    if (resp.ok) {
      const parsed = (await resp.json()) as Partial<AiExtractedScanResult>;
      const normalized = normalizeScanResult(parsed, JSON.stringify(parsed));
      if (normalized) {
        return normalized;
      }
    }
  } catch {
    // Network or server unavailable
  }

  return null;
}

/**
 * Combined Universal Dual-Step Scanner from a captured Camera / Gallery File or Live Video Frame:
 * - Step A: Ultra-Fast Local WASM + Hardware Barcode Decode (~30–60ms)
 *   If `fastImeiOnly` is true and a valid 15-digit IMEI is decoded locally, returns IMMEDIATELY!
 * - Step B: Server-Side Gemini Vision OCR (`/api/scan-imei`) for *#06# screens, blurry stickers,
 *   Dual-SIM IMEI 1 + IMEI 2, and full box/bill/ID details.
 */
export async function scanCapturedPhotoForImeiAndSpecs(
  imageFile: File,
  options?: { fastImeiOnly?: boolean }
): Promise<AiExtractedScanResult> {
  // Run blazing-fast local WASM + native barcode decoder first (~30-60ms)
  const localDecoded = await decodeAllImeisLocallyFromFile(imageFile);

  if (options?.fastImeiOnly && localDecoded?.imei) {
    const tacSpec = lookupImeiSpecs(localDecoded.imei);
    return {
      imei: localDecoded.imei,
      imei2: localDecoded.imei2 || '',
      allImeis: localDecoded.allImeis,
      barcode: localDecoded.rawBarcode || localDecoded.imei,
      brand: tacSpec?.brand || '',
      model: tacSpec?.model || '',
      ram: tacSpec?.ram || '',
      storage: tacSpec?.storage || '',
      colour: tacSpec?.colour || '',
      sourceMethod: 'local_barcode',
    };
  }

  // Run Server-Side Gemini Vision OCR (for *#06# screen, blurry stickers, paper bills, or full box specs)
  const aiResult = await extractPhoneOrBillViaAiVision(imageFile, {
    fastImeiOnly: Boolean(options?.fastImeiOnly),
  });

  const mergedImeis = Array.from(
    new Set([
      ...(localDecoded?.allImeis || []),
      ...(aiResult?.allImeis || []),
      ...(localDecoded?.imei ? [localDecoded.imei] : []),
      ...(aiResult?.imei ? [aiResult.imei] : []),
      ...(localDecoded?.imei2 ? [localDecoded.imei2] : []),
      ...(aiResult?.imei2 ? [aiResult.imei2] : []),
    ])
  );

  const finalImei = localDecoded?.imei || aiResult?.imei || mergedImeis[0] || '';
  const finalImei2 =
    localDecoded?.imei2 ||
    aiResult?.imei2 ||
    mergedImeis.find((x) => x !== finalImei) ||
    '';
  const tacSpec = finalImei ? lookupImeiSpecs(finalImei) : null;

  return {
    imei: finalImei,
    imei2: finalImei2 !== finalImei ? finalImei2 : '',
    allImeis: mergedImeis,
    barcode: localDecoded?.rawBarcode || aiResult?.barcode || finalImei,
    brand: aiResult?.brand || tacSpec?.brand || '',
    model: aiResult?.model || tacSpec?.model || '',
    ram: aiResult?.ram || tacSpec?.ram || '',
    storage: aiResult?.storage || tacSpec?.storage || '',
    colour: aiResult?.colour || tacSpec?.colour || '',
    buyingPrice: aiResult?.buyingPrice || 0,
    expectedSellingPrice: aiResult?.expectedSellingPrice || 0,
    sellerName: aiResult?.sellerName || '',
    sellerMobile: aiResult?.sellerMobile || '',
    sellerAddress: aiResult?.sellerAddress || '',
    idType: aiResult?.idType || '',
    idNumber: aiResult?.idNumber || '',
    notes: aiResult?.notes || '',
    sourceMethod: localDecoded?.imei ? 'local_barcode' : 'ai_vision_ocr',
  };
}

/**
 * LAYER 1 & 2 AUDIO TRANSCRIPTION:
 * Sends recorded audio Blob or native audio File via FormData to Groq's Whisper API (`whisper-large-v3-turbo`).
 */
export async function transcribeAudioWithGroqWhisper(
  audioBlobOrFile: Blob | File
): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('Voice transcription key not configured');
  }
  const formData = new FormData();
  const fileName =
    audioBlobOrFile instanceof File && audioBlobOrFile.name
      ? audioBlobOrFile.name
      : 'voice_recording.webm';

  formData.append('file', audioBlobOrFile, fileName);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'hi');
  formData.append('response_format', 'json');

  const response = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error('Transcription failed');
  }

  const data = await response.json();
  return (data?.text || '').trim();
}

/**
 * Parses Hindi / Hinglish / English voice or typed text via Server-Side Gemini (`/api/parse-voice`)
 * with Groq fallback to auto-fill Buy Phone, Sell Phone, Stock Search, or Dues fields.
 */
export async function parseVoiceTranscriptWithGroqAi(
  transcript: string,
  context: 'buy_phone' | 'sell_phone' | 'search_stock' | 'dues' | 'general' = 'general'
): Promise<AiExtractedVoiceResult> {
  const cleanText = transcript.trim();
  if (!cleanText) return {};

  // 1. Primary: Server-side Gemini endpoint (`/api/parse-voice`)
  try {
    const serverResp = await fetch('/api/parse-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: cleanText, context }),
    });
    if (serverResp.ok) {
      const parsed = (await serverResp.json()) as AiExtractedVoiceResult;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // Fall through to optional Groq or heuristic fallback
  }

  // 2. Optional Groq fallback if configured
  if (GROQ_API_KEY) {
    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: `Parse Hindi/Hinglish/English mobile shop input (context: "${context}") into JSON with optional keys: intent, imei, brand, model, ram, storage, colour, buyingPrice, expectedSellingPrice, sellingPrice, sellerName, sellerMobile, sellerAddress, buyerName, buyerMobile, buyerAddress, idType, idNumber, paymentMethod, dueAmount, notes, searchQuery.`,
              },
              { role: 'user', content: cleanText },
            ],
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const parsed = JSON.parse(content) as AiExtractedVoiceResult;
        if (parsed) return parsed;
      }
    } catch {
      // Fall through to offline heuristic
    }
  }

  // Offline basic heuristic extraction
  const imeiMatch = extract15DigitImei(cleanText);
  return {
    ...(imeiMatch ? { imei: imeiMatch } : {}),
    searchQuery: cleanText,
    notes: cleanText,
  };
}

import { jsPDF } from 'jspdf';

export interface ApkPdfPayload {
  fileName: string;
  title: string;
  mode: 'download' | 'print';
  dataUri: string;
  base64Raw: string;
  pdfBlob: Blob;
  pdfFile: File;
  summaryText: string;
  whatsappPhone?: string;
  htmlPreviewLines?: { label: string; value: string }[];
}

type PdfPreviewListener = (payload: ApkPdfPayload) => void;
const pdfPreviewListeners = new Set<PdfPreviewListener>();

export function subscribeToApkPdfPreview(
  listener: PdfPreviewListener
): () => void {
  pdfPreviewListeners.add(listener);
  return () => {
    pdfPreviewListeners.delete(listener);
  };
}

function notifyApkPdfPreview(payload: ApkPdfPayload): void {
  pdfPreviewListeners.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      // Ignore listener error
    }
  });
}

/**
 * Detects whether the app is running on Android or inside an Android System WebView (Web-APK)
 */
export function isAndroidOrWebApk(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /Android/i.test(ua) ||
    /; wv\)/i.test(ua) ||
    /Version\/\d+\.\d+.*Chrome/i.test(ua) ||
    Boolean((window as unknown as Record<string, unknown>).Android) ||
    Boolean((window as unknown as Record<string, unknown>).Website2APK)
  );
}

/**
 * Copies text safely to clipboard on both WebView APK and standard browsers
 */
export async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to textarea copy for older Android WebViews
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Universal Android Web-APK & Web WhatsApp Sharing Engine.
 * Works inside wrapped APK WebViews where `window.open(..., '_blank')` is blocked.
 */
export async function shareOnWhatsAppApk(
  messageText: string,
  phoneNumber?: string,
  pdfFile?: File
): Promise<void> {
  const cleanText = messageText.trim();
  await copyTextSafe(cleanText);

  const cleanDigits = (phoneNumber || '').replace(/\D/g, '').slice(-10);
  const fullPhone = cleanDigits.length === 10 ? `91${cleanDigits}` : '';

  // 1. If a PDF file is provided and the Android APK supports native file sharing, share the PDF file + text directly!
  if (pdfFile && typeof navigator !== 'undefined' && navigator.share) {
    try {
      if (!navigator.canShare || navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          files: [pdfFile],
          title: pdfFile.name,
          text: cleanText,
        });
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
    }
  }

  const encodedText = encodeURIComponent(cleanText);
  const whatsappIntentScheme = fullPhone
    ? `whatsapp://send?phone=${fullPhone}&text=${encodedText}`
    : `whatsapp://send?text=${encodedText}`;
  const whatsappApiUrl = fullPhone
    ? `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;

  // 2. Check for common Android Web-APK JavaScript bridges (WebIntoApp, Website2APK, AndroidInterface, etc.)
  const winAny = window as unknown as Record<string, Record<string, unknown>>;
  try {
    if (typeof winAny.Android?.openWhatsApp === 'function') {
      (winAny.Android.openWhatsApp as (t: string, p: string) => void)(
        cleanText,
        fullPhone
      );
      return;
    }
    if (typeof winAny.Android?.openExternalUrl === 'function') {
      (winAny.Android.openExternalUrl as (u: string) => void)(
        whatsappIntentScheme
      );
      return;
    }
    if (typeof winAny.Website2APK?.openExternal === 'function') {
      (winAny.Website2APK.openExternal as (u: string) => void)(
        whatsappApiUrl
      );
      return;
    }
  } catch {
    // Continue to standard scheme navigation
  }

  // 3. On Android / APK WebView, trigger native `whatsapp://send` URI scheme via top-level anchor click
  if (isAndroidOrWebApk()) {
    try {
      const link = document.createElement('a');
      link.href = whatsappIntentScheme;
      link.target = '_top';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Fallback after 1.1s if the WebView wrapper blocked custom scheme and stayed in focus
      setTimeout(() => {
        if (document.visibilityState === 'visible' && document.hasFocus()) {
          if (
            !fullPhone &&
            typeof navigator !== 'undefined' &&
            typeof navigator.share === 'function'
          ) {
            navigator
              .share({
                title: 'CM Inventory Management',
                text: cleanText,
              })
              .catch(() => {
                window.location.assign(whatsappApiUrl);
              });
          } else {
            window.location.assign(whatsappApiUrl);
          }
        }
      }, 1100);
      return;
    } catch {
      // Fallback below
    }
  }

  // 4. Desktop / iOS / Standard Web Browser
  try {
    const a = document.createElement('a');
    a.href = whatsappApiUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    window.location.assign(whatsappApiUrl);
  }
}

/**
 * Triggers native APK file share / download for a generated PDF payload
 */
export async function triggerDirectApkPdfDownloadOrShare(
  payload: ApkPdfPayload,
  preferNativeShare = false
): Promise<boolean> {
  const { fileName, dataUri, base64Raw, pdfBlob, pdfFile, summaryText } =
    payload;

  // 1. If user clicked "Share / Save PDF" on Android APK and Web Share Level 2 is available
  if (preferNativeShare && typeof navigator !== 'undefined' && navigator.share) {
    try {
      if (!navigator.canShare || navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          files: [pdfFile],
          title: fileName,
          text: summaryText,
        });
        return true;
      }
      await navigator.share({
        title: fileName,
        text: summaryText,
      });
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return true;
      }
    }
  }

  // 2. Try Android Web-APK JavaScript download bridges if injected by APK wrapper
  const winAny = window as unknown as Record<string, Record<string, unknown>>;
  try {
    if (typeof winAny.Android?.downloadPdf === 'function') {
      (winAny.Android.downloadPdf as (b64: string, name: string) => void)(
        base64Raw,
        fileName
      );
      return true;
    }
    if (typeof winAny.Android?.saveBase64File === 'function') {
      (
        winAny.Android.saveBase64File as (
          uri: string,
          name: string,
          mime: string
        ) => void
      )(dataUri, fileName, 'application/pdf');
      return true;
    }
  } catch {
    // Continue to anchor download
  }

  // 3. Trigger Base64 Data-URI anchor download (Supported by Android WebView DownloadListener, unlike blob: URLs!)
  try {
    const dataLink = document.createElement('a');
    dataLink.href = dataUri;
    dataLink.download = fileName;
    dataLink.style.display = 'none';
    document.body.appendChild(dataLink);
    dataLink.click();
    document.body.removeChild(dataLink);
  } catch {
    // Ignore
  }

  // 4. On non-Android desktop browsers, also trigger standard Blob URL download for fast large-file saving
  if (!isAndroidOrWebApk()) {
    try {
      const blobUrl = URL.createObjectURL(pdfBlob);
      const blobLink = document.createElement('a');
      blobLink.href = blobUrl;
      blobLink.download = fileName;
      blobLink.style.display = 'none';
      document.body.appendChild(blobLink);
      blobLink.click();
      document.body.removeChild(blobLink);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch {
      // Ignore
    }
  }

  return true;
}

/**
 * Packages a jsPDF document into an APK-compatible payload, triggers download,
 * and opens the In-App APK PDF Preview & Share/Print Modal so the user never
 * hits a blank screen or silent failure inside Android WebView!
 */
export function deliverPdfInApk(
  doc: jsPDF,
  options: {
    fileName: string;
    title: string;
    mode: 'download' | 'print';
    summaryText: string;
    whatsappPhone?: string;
    htmlPreviewLines?: { label: string; value: string }[];
  }
): ApkPdfPayload {
  const safeFileName = options.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const arrayBuffer = doc.output('arraybuffer');
  const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const pdfFile = new File([pdfBlob], safeFileName, {
    type: 'application/pdf',
  });
  const rawDataUri = doc.output('datauristring');
  const base64Raw = rawDataUri.includes(',')
    ? rawDataUri.split(',')[1]
    : rawDataUri;
  // Standardize MIME to application/pdf;base64 for Android WebView DownloadListener compatibility
  const dataUri = `data:application/pdf;base64,${base64Raw}`;

  const payload: ApkPdfPayload = {
    fileName: safeFileName,
    title: options.title,
    mode: options.mode,
    dataUri,
    base64Raw,
    pdfBlob,
    pdfFile,
    summaryText: options.summaryText,
    whatsappPhone: options.whatsappPhone,
    htmlPreviewLines: options.htmlPreviewLines,
  };

  // Notify global modal so in-app preview + 1-tap Share/Save/WhatsApp/Print bar appears immediately
  notifyApkPdfPreview(payload);

  // Also trigger direct download in parallel when mode is 'download'
  if (options.mode === 'download') {
    void triggerDirectApkPdfDownloadOrShare(payload, false);
  }

  return payload;
}

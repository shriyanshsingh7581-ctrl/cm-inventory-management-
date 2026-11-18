import React, { useEffect, useState } from 'react';
import {
  ApkPdfPayload,
  shareOnWhatsAppApk,
  subscribeToApkPdfPreview,
  triggerDirectApkPdfDownloadOrShare,
} from '../utils/apkShareAndPdfEngine';
import {
  Check,
  Download,
  FileText,
  MessageCircle,
  Printer,
  Share2,
  X,
} from 'lucide-react';

/**
 * Global In-App PDF Preview, Download, Print & WhatsApp Share Modal for Android Web-APK.
 * Because Android System WebView blocks `blob:` URL downloads and `_blank` PDF popups,
 * this modal automatically appears whenever any PDF / Print button is tapped, showing
 * the document summary + 1-tap APK Share/Save PDF, Download PDF, WhatsApp Share, and Print!
 */
export const ApkPdfPreviewModal: React.FC = () => {
  const [payload, setPayload] = useState<ApkPdfPayload | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToApkPdfPreview((nextPayload) => {
      setPayload(nextPayload);
      setSavedBanner(
        nextPayload.mode === 'print'
          ? 'Document ready to Print or Share'
          : 'PDF generated! Tap "Save / Share PDF" or "Send on WhatsApp" below.'
      );
    });
    return () => unsub();
  }, []);

  if (!payload) return null;

  const handleSaveOrSharePdf = async () => {
    await triggerDirectApkPdfDownloadOrShare(payload, true);
    setSavedBanner('PDF file shared / downloaded to your phone!');
  };

  const handleDirectDownload = async () => {
    await triggerDirectApkPdfDownloadOrShare(payload, false);
    setSavedBanner(`Saved ${payload.fileName} to Downloads`);
  };

  const handleWhatsAppShare = async () => {
    await shareOnWhatsAppApk(
      payload.summaryText,
      payload.whatsappPhone,
      payload.pdfFile
    );
  };

  const handlePrint = () => {
    try {
      window.print();
    } catch {
      void triggerDirectApkPdfDownloadOrShare(payload, true);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl max-h-[92dvh] overflow-y-auto touch-pan-y no-scrollbar">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base text-[#111827] truncate">
                {payload.title}
              </h3>
              <p className="text-xs text-[#6B7280] font-mono truncate">
                {payload.fileName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPayload(null)}
            className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Banner */}
        {savedBanner && (
          <div className="p-3 rounded-xl bg-[#E8F5EE] border border-[#A7F3D0] text-xs font-semibold text-[#064E3B] flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F7B49] shrink-0" />
            <span>{savedBanner}</span>
          </div>
        )}

        {/* Structured Document Preview Card (Works 100% in Android WebView where iframe PDF rendering is unsupported) */}
        <div className="bg-[#F9FAFB] rounded-2xl border border-[#E5E7EB] p-4 space-y-2.5">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2">
            <span className="text-xs font-bold text-[#0F7B49] uppercase tracking-wider">
              A4 Official PDF Document Preview
            </span>
            <span className="text-[11px] font-semibold text-[#6B7280]">
              Ready for APK &amp; Print
            </span>
          </div>

          {payload.htmlPreviewLines && payload.htmlPreviewLines.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {payload.htmlPreviewLines.map((row, idx) => (
                <div
                  key={idx}
                  className="bg-white p-2.5 rounded-xl border border-[#E5E7EB]"
                >
                  <div className="text-[10px] text-[#6B7280]">{row.label}</div>
                  <div className="font-semibold text-[#111827] mt-0.5 break-words">
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <pre className="text-xs font-sans whitespace-pre-wrap text-[#1F2937] bg-white p-3 rounded-xl border border-[#E5E7EB] max-h-52 overflow-y-auto no-scrollbar">
              {payload.summaryText}
            </pre>
          )}
        </div>

        {/* Primary APK Action Buttons */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleWhatsAppShare}
            className="h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs active:scale-[0.99]"
          >
            <MessageCircle className="w-4 h-4" />
            Send on WhatsApp
          </button>

          <button
            type="button"
            onClick={handleSaveOrSharePdf}
            className="h-12 rounded-xl bg-[#111827] hover:bg-[#1F2937] text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs active:scale-[0.99]"
          >
            <Share2 className="w-4 h-4" />
            Save / Share PDF File
          </button>

          <a
            href={payload.dataUri}
            download={payload.fileName}
            onClick={() => void handleDirectDownload()}
            className="h-11 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] text-[#111827] font-semibold text-xs flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4 text-[#0F7B49]" />
            Download PDF
          </a>

          <button
            type="button"
            onClick={handlePrint}
            className="h-11 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] text-[#111827] font-semibold text-xs flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4 text-[#0F7B49]" />
            Print Document
          </button>
        </div>

        <button
          type="button"
          onClick={() => setPayload(null)}
          className="w-full h-10 rounded-xl bg-[#F3F4F6] text-[#374151] font-semibold text-xs"
        >
          Close Preview
        </button>
      </div>
    </div>
  );
};

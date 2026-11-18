import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface SignaturePadModalProps {
  onSave: (signatureDataUrl: string) => void;
  onClose: () => void;
}

/**
 * Full-screen native signature canvas pad:
 * Header: X | Seller signature (Sign inside the box with your finger) | Clear
 * Body: Full canvas area
 * Bottom: Green "Done" button
 */
export const SignaturePadModal: React.FC<SignaturePadModalProps> = ({
  onSave,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasStrokes(true);
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDrawing = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasStrokes(false);
  };

  const handleDone = () => {
    if (!hasStrokes) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Export onto a clean max-640px JPEG/PNG so high-DPI signatures stay well under Firestore 150KB limit
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / canvas.width);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = Math.max(1, Math.round(canvas.width * scale));
    outCanvas.height = Math.max(1, Math.round(canvas.height * scale));
    const outCtx = outCanvas.getContext('2d');
    if (outCtx) {
      outCtx.fillStyle = '#FFFFFF';
      outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
      outCtx.drawImage(canvas, 0, 0, outCanvas.width, outCanvas.height);
      const pngData = outCanvas.toDataURL('image/png');
      if (pngData.length <= 130000) {
        onSave(pngData);
        return;
      }
      onSave(outCanvas.toDataURL('image/jpeg', 0.8));
      return;
    }

    onSave(canvas.toDataURL('image/jpeg', 0.8));
  };

  return (
    <div className="fixed inset-0 h-dvh z-50 bg-white flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB] shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#111827]"
          >
            <X className="w-5 h-5" />
          </button>
          <div>
            <h2 className="font-display font-bold text-base text-[#111827]">
              Seller signature
            </h2>
            <p className="text-xs text-[#6B7280]">
              Sign inside the box with your finger
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="h-9 px-3.5 rounded-xl border border-[#D1D5DB] text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB]"
        >
          Clear
        </button>
      </div>

      {/* Interactive Signature Canvas */}
      <div className="flex-1 relative bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={endDrawing}
          onMouseLeave={endDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={endDrawing}
          className="w-full h-full cursor-crosshair touch-none"
        />
        {!hasStrokes && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-[#9CA3AF]">
            <p className="text-sm font-medium">Draw seller signature here</p>
          </div>
        )}
      </div>

      {/* Bottom Sticky Done Button */}
      <div className="p-4 border-t border-[#E5E7EB] bg-white shrink-0">
        <button
          type="button"
          disabled={!hasStrokes}
          onClick={handleDone}
          className="w-full h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-base flex items-center justify-center active:scale-[0.99] transition-transform disabled:opacity-50"
        >
          Done
        </button>
      </div>
    </div>
  );
};

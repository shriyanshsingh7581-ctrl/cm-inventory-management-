import React, { useEffect, useRef, useState } from 'react';
import {
  AiExtractedVoiceResult,
  parseVoiceTranscriptWithGroqAi,
  transcribeAudioWithGroqWhisper,
} from '../utils/apkMediaEngine';
import {
  AudioLines,
  Keyboard,
  Loader2,
  Mic,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react';

interface SmartVoiceModalProps {
  isOpen: boolean;
  context: 'buy_phone' | 'sell_phone' | 'search_stock' | 'dues' | 'general';
  title?: string;
  initialMode?: 'auto_record' | 'keyboard_fallback';
  onApplyResult: (result: AiExtractedVoiceResult, rawTranscript: string) => void;
  onClose: () => void;
}

export const SmartVoiceModal: React.FC<SmartVoiceModalProps> = ({
  isOpen,
  context,
  title = '🎙️ Smart Voice Input',
  initialMode = 'auto_record',
  onApplyResult,
  onClose,
}) => {
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processingState, setProcessingState] = useState<
    'idle' | 'transcribing' | 'parsing'
  >('idle');
  const [statusHint, setStatusHint] = useState<string>(
    'कीबोर्ड का माइक (🎤) दबाकर बोलें या नीचे वॉइस रिकॉर्ड करें'
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const nativeAudioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const stopMediaStream = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
  };

  const focusGboardTextarea = () => {
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 80);
  };

  const handleApplyTextWithAi = async (rawTextToParse?: string) => {
    const finalTranscript = (rawTextToParse ?? textInput).trim();
    if (!finalTranscript) {
      focusGboardTextarea();
      return;
    }

    setProcessingState('parsing');
    setStatusHint('AI द्वारा जानकारी भरी जा रही है (Groq Llama 3.3 70B)...');
    try {
      const parsed = await parseVoiceTranscriptWithGroqAi(
        finalTranscript,
        context
      );
      onApplyResult(parsed, finalTranscript);
      onClose();
    } finally {
      setProcessingState('idle');
    }
  };

  // Layer 1: Try MediaRecorder with 1.5s WebView safety timeout; fallback to Layer 2 Gboard focus
  const startLiveRecordingOrFallback = async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof window.MediaRecorder === 'undefined'
    ) {
      // Layer 2 immediate fallback: focus Gboard textarea without any error alert
      setStatusHint(
        'नीचे बॉक्स में कीबोर्ड का माइक (🎤) दबाकर बोलें या "Native Voice Recorder" चुनें'
      );
      focusGboardTextarea();
      return;
    }

    try {
      const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });
      const timeoutPromise = new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), 1500)
      );

      const stream = (await Promise.race([
        streamPromise,
        timeoutPromise,
      ])) as MediaStream | null;

      if (!stream) {
        // Timed out in Android WebView -> fall back to Gboard Voice Typing silently
        setStatusHint(
          'कीबोर्ड का माइक (🎤) दबाकर बोलें (Android Gboard 100% APK Ready)'
        );
        focusGboardTextarea();
        return;
      }

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        if (chunks.length === 0) {
          focusGboardTextarea();
          return;
        }
        const blob = new Blob(chunks, {
          type: recorder.mimeType || 'audio/webm',
        });
        setProcessingState('transcribing');
        setStatusHint('आवाज़ को टेक्स्ट में बदला जा रहा है (Groq Whisper)...');
        try {
          const transcript = await transcribeAudioWithGroqWhisper(blob);
          if (transcript) {
            setTextInput(transcript);
            await handleApplyTextWithAi(transcript);
          } else {
            setStatusHint(
              'आवाज़ साफ़ नहीं आई — कृपया कीबोर्ड का माइक (🎤) दबाकर बोलें'
            );
            setProcessingState('idle');
            focusGboardTextarea();
          }
        } catch {
          setStatusHint(
            'कीबोर्ड का माइक (🎤) दबाकर बोलें और "✨ Apply with AI" दबाएं'
          );
          setProcessingState('idle');
          focusGboardTextarea();
        }
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      setStatusHint('बोलिए... पूरा होने पर "Stop & Apply AI" दबाएं');
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      // APK blocked mic permission -> silently focus Gboard Voice Input box (no error alert!)
      setStatusHint(
        'कीबोर्ड का माइक (🎤) दबाकर बोलें या "Native Voice Recorder" दबाएं'
      );
      focusGboardTextarea();
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopMediaStream();
      return;
    }

    setTextInput('');
    setProcessingState('idle');

    if (initialMode === 'auto_record') {
      void startLiveRecordingOrFallback();
    } else {
      focusGboardTextarea();
    }

    return () => {
      stopMediaStream();
    };
  }, [isOpen]);

  // Layer 2 Native Audio Capture File Handler (`<input type="file" accept="audio/*" capture />`)
  const handleNativeAudioSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setProcessingState('transcribing');
    setStatusHint('Native Audio फ़ाइल प्रोसेस हो रही है (Groq Whisper)...');
    try {
      const transcript = await transcribeAudioWithGroqWhisper(file);
      if (transcript) {
        setTextInput(transcript);
        await handleApplyTextWithAi(transcript);
      } else {
        setProcessingState('idle');
        setStatusHint('कृपया कीबोर्ड का माइक (🎤) दबाकर बोलें');
        focusGboardTextarea();
      }
    } catch {
      setProcessingState('idle');
      setStatusHint('कृपया नीचे बॉक्स में कीबोर्ड माइक (🎤) से बोलें');
      focusGboardTextarea();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Hidden Native Android Hardware Voice Recorder Input */}
      <input
        ref={nativeAudioInputRef}
        type="file"
        accept="audio/*"
        capture
        onChange={handleNativeAudioSelected}
        className="hidden"
      />

      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-sheet-up">
        {/* Header */}
        <div className="px-5 py-4 bg-[#0F7B49] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
              <Mic className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base leading-tight">
                {title}
              </h3>
              <p className="text-[11px] text-[#D1FAE5]">
                Hindi / Hinglish / English · 100% Android APK Compatible
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopMediaStream();
              onClose();
            }}
            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82dvh] overflow-y-auto touch-pan-y no-scrollbar">
          {/* Status / Active Recording Banner */}
          {isRecording ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-red-600 animate-ping" />
                <div>
                  <div className="font-display font-bold text-sm text-red-700">
                    Recording Audio... ({recordingSeconds}s)
                  </div>
                  <div className="text-xs text-red-600">
                    बोलने के बाद Stop दबाएं — AI अपने आप फॉर्म भर देगा
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => stopMediaStream()}
                className="h-10 px-4 rounded-xl bg-red-600 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-xs"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop &amp; Apply AI
              </button>
            </div>
          ) : (
            <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl p-3.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Keyboard className="w-5 h-5 text-[#0F7B49] shrink-0" />
                <p className="text-xs font-semibold text-[#064E3B] leading-snug">
                  {statusHint}
                </p>
              </div>
            </div>
          )}

          {/* Layer 2: Auto-Focused Voice Input Box (Works with Android Gboard hardware mic in 100% of APKs) */}
          <div>
            <label className="block text-xs font-bold text-[#374151] mb-1.5">
              Voice / Text Input Box (Gboard 🎤 Mic Ready)
            </label>
            <textarea
              ref={textareaRef}
              autoFocus
              rows={3}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="कीबोर्ड का माइक (🎤) दबाकर बोलें (जैसे: 2 iPhone 15 65000 में)..."
              className="w-full p-3.5 rounded-2xl bg-[#F9FAFB] border-2 border-[#0F7B49] text-sm font-medium text-[#111827] focus:outline-none focus:bg-white"
            />
          </div>

          {/* Layer 1 & Layer 2 Hardware Audio Recording Buttons */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={processingState !== 'idle'}
              onClick={() => {
                if (isRecording) {
                  stopMediaStream();
                } else {
                  void startLiveRecordingOrFallback();
                }
              }}
              className={`h-11 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                isRecording
                  ? 'bg-red-600 border-red-600 text-white'
                  : 'bg-white border-[#D1D5DB] text-[#111827] hover:bg-[#F9FAFB]'
              }`}
            >
              <AudioLines className="w-4 h-4 text-[#0F7B49]" />
              {isRecording ? 'Stop Mic' : 'Record Live Mic'}
            </button>

            <button
              type="button"
              disabled={processingState !== 'idle'}
              onClick={() => nativeAudioInputRef.current?.click()}
              className="h-11 px-3 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] text-[#111827] text-xs font-semibold flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4 text-[#0F7B49]" />
              Native Voice Recorder
            </button>
          </div>

          {/* Primary "✨ Apply with AI" Action Button */}
          <button
            type="button"
            disabled={processingState !== 'idle' || !textInput.trim()}
            onClick={() => void handleApplyTextWithAi()}
            className="w-full h-12 rounded-2xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-display font-bold text-sm flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 active:scale-[0.99] transition-all"
          >
            {processingState === 'transcribing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Groq Whisper से आवाज़ पढ़ी जा रही है...
              </>
            ) : processingState === 'parsing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                AI द्वारा फॉर्म भरा जा रहा है...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                ✨ Apply with AI
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ApkVoiceButtonProps {
  context: 'buy_phone' | 'sell_phone' | 'search_stock' | 'dues' | 'general';
  label?: string;
  compact?: boolean;
  className?: string;
  onResult: (result: AiExtractedVoiceResult, rawTranscript: string) => void;
}

/**
 * Drop-in universal APK Voice button that opens the 3-Layer APK Voice Engine
 */
export const ApkVoiceButton: React.FC<ApkVoiceButtonProps> = ({
  context,
  label = 'AI Voice',
  compact = false,
  className = '',
  onResult,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Speak in Hindi / Hinglish / English (AI Voice Fill)"
        className={
          className ||
          (compact
            ? 'h-9 px-3 rounded-xl bg-[#E8F5EE] hover:bg-[#D1FAE5] text-[#0F7B49] text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors'
            : 'h-10 px-3.5 rounded-xl bg-[#E8F5EE] hover:bg-[#D1FAE5] text-[#0F7B49] text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors')
        }
      >
        <Mic className="w-3.5 h-3.5" />
        <span>{label}</span>
      </button>

      <SmartVoiceModal
        isOpen={open}
        context={context}
        onApplyResult={onResult}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Square, Play, Pause, Trash2, Sparkles, Loader2, X, CheckCircle2 } from 'lucide-react';

interface VoiceInputPanelProps {
  onAnalyze: (audioBlob: Blob) => Promise<void>;
  onClear?: () => void;
  disabled?: boolean;
  analyzing?: boolean;
  placeholder?: string;
  transcript?: string;
  className?: string;
  compact?: boolean;
  autoAnalyze?: boolean; // Auto-analyze when recording stops
}

const VoiceInputPanel: React.FC<VoiceInputPanelProps> = ({
  onAnalyze,
  onClear,
  disabled = false,
  analyzing = false,
  placeholder = 'Click to record voice input',
  transcript,
  className = '',
  compact = false,
  autoAnalyze = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [audioUrl]);

  // Audio level visualization
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current || !isRecording) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    setAudioLevel(average / 255);

    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, [isRecording]);

  // Start recording
  const startRecording = async () => {
    try {
      setError(null);
      setAudioBlob(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
      });

      streamRef.current = stream;

      // Setup analyser
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Setup recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        setAudioBlob(blob);

        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;

        // Auto-analyze if enabled
        if (autoAnalyze && blob) {
          await onAnalyze(blob);
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      updateAudioLevel();

    } catch (err: any) {
      console.error('Recording error:', err);
      setError(err.message || 'Failed to access microphone');
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  };

  // Toggle playback
  const togglePlayback = () => {
    if (!audioUrl) return;

    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => setIsPlaying(false);
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Clear
  const handleClear = () => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordingTime(0);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    onClear?.();
  };

  // Handle analyze
  const handleAnalyze = async () => {
    if (!audioBlob) return;
    await onAnalyze(audioBlob);
  };

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Compact mode for inline use
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {!isRecording && !audioBlob && (
          <button
            onClick={startRecording}
            disabled={disabled || analyzing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Mic className="h-4 w-4" />
            Voice
          </button>
        )}

        {isRecording && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm text-red-600">
              <span className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
              {formatTime(recordingTime)}
            </span>
            <button
              onClick={stopRecording}
              className="p-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              <Square className="h-4 w-4" />
            </button>
          </div>
        )}

        {audioBlob && !isRecording && (
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlayback}
              className="p-1.5 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="text-xs text-gray-500">{formatTime(recordingTime)}</span>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Analyze
            </button>
            <button
              onClick={handleClear}
              className="p-1 text-gray-400 hover:text-red-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {transcript && (
          <span className="text-sm text-gray-600 truncate max-w-[200px]" title={transcript}>
            "{transcript}"
          </span>
        )}
      </div>
    );
  }

  // Full panel mode
  return (
    <div className={`bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-100 rounded-lg">
            <Mic className="h-4 w-4 text-indigo-600" />
          </div>
          <span className="text-sm font-medium text-indigo-800">Voice Input</span>
        </div>
        {isRecording && (
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-sm font-mono text-gray-600">{formatTime(recordingTime)}</span>
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Audio Level Visualization */}
      {isRecording && (
        <div className="mb-3 h-8 bg-white/50 rounded-lg overflow-hidden flex items-center gap-0.5 px-2">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-indigo-500 rounded-sm transition-all duration-75"
              style={{
                height: `${Math.min(100, Math.max(10, audioLevel * 100 + Math.random() * 20))}%`,
                opacity: audioLevel > 0.1 ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      )}

      {/* Recorded Audio Preview */}
      {audioUrl && !isRecording && (
        <div className="mb-3 flex items-center gap-3 bg-white/60 rounded-lg p-3">
          <button
            onClick={togglePlayback}
            className="p-2 bg-indigo-100 hover:bg-indigo-200 rounded-full transition-colors"
          >
            {isPlaying ? <Pause className="h-4 w-4 text-indigo-600" /> : <Play className="h-4 w-4 text-indigo-600" />}
          </button>
          <div className="flex-1">
            <div className="h-1 bg-indigo-100 rounded-full">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: '100%' }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">Duration: {formatTime(recordingTime)}</p>
          </div>
          <button
            onClick={handleClear}
            className="p-2 hover:bg-red-50 rounded-full"
            title="Clear"
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </button>
        </div>
      )}

      {/* Transcript Display */}
      {transcript && (
        <div className="mb-3 px-3 py-2 bg-white/60 rounded-lg">
          <div className="flex items-center gap-1.5 text-xs text-green-600 mb-1">
            <CheckCircle2 className="h-3 w-3" />
            Transcribed
          </div>
          <p className="text-sm text-gray-700">"{transcript}"</p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        {!isRecording && !audioBlob && (
          <button
            onClick={startRecording}
            disabled={disabled || analyzing}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Mic className="h-4 w-4" />
            Start Recording
          </button>
        )}

        {isRecording && (
          <button
            onClick={stopRecording}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <Square className="h-4 w-4" />
            Stop
          </button>
        )}

        {audioBlob && !isRecording && (
          <>
            <button
              onClick={startRecording}
              disabled={disabled || analyzing}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              <Mic className="h-4 w-4" />
              Re-record
            </button>
            <button
              onClick={handleAnalyze}
              disabled={disabled || analyzing}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-colors"
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Analyze
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Help Text */}
      <p className="mt-3 text-xs text-gray-500 text-center">
        {placeholder}
      </p>
    </div>
  );
};

export default VoiceInputPanel;

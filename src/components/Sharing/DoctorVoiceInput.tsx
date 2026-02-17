import React, { useState } from 'react';
import {
  Mic,
  X,
  CheckCircle2,
  AlertCircle,
  Percent,
  Users,
  Loader2,
} from 'lucide-react';
import { VoiceInputPanel } from '../Voice';
import { supabase, database } from '../../utils/supabase';

interface DoctorSharingAction {
  doctor_name: string;
  matched_doctor_id: string | null;
  matched_doctor_name: string;
  sharing_percent?: number;
  discount_handling?: string;
  outsource_handling?: string;
  test_name?: string;
  matched_test_id?: string;
  matched_test_name?: string;
  test_sharing_percent?: number;
  confidence: number;
}

interface Doctor {
  id: string;
  name: string;
}

interface TestGroup {
  id: string;
  name: string;
  code?: string;
}

interface DoctorVoiceInputProps {
  labId: string;
  doctors: Doctor[];
  tests?: TestGroup[];
  onClose: () => void;
  onSuccess: (actions: DoctorSharingAction[]) => void;
}

const DoctorVoiceInput: React.FC<DoctorVoiceInputProps> = ({
  labId,
  doctors,
  tests = [],
  onClose,
  onSuccess,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [actions, setActions] = useState<DoctorSharingAction[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle voice analysis
  const handleVoiceAnalyze = async (audioBlob: Blob) => {
    setAnalyzing(true);
    setError(null);
    setActions([]);
    setTranscript(null);

    try {
      // Convert to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(audioBlob);
      const audioBase64 = await base64Promise;

      // Call edge function
      const { data, error: fnError } = await supabase.functions.invoke('voice-to-pricing', {
        body: {
          audio_base64: audioBase64,
          mime_type: audioBlob.type || 'audio/webm',
          lab_id: labId,
          mode: 'doctor_sharing',
          context: {
            doctors: doctors.map(d => ({ id: d.id, name: d.name })),
            tests: tests.map(t => ({ id: t.id, name: t.name, code: t.code })),
          },
        },
      });

      if (fnError) throw fnError;

      if (data?.success) {
        setTranscript(data.transcript || '');
        setActions(data.actions || []);
      } else {
        throw new Error(data?.error || 'Analysis failed');
      }

    } catch (err: any) {
      console.error('Voice analysis error:', err);
      setError(err.message || 'Failed to analyze voice input');
    } finally {
      setAnalyzing(false);
    }
  };

  // Remove action from list
  const removeAction = (index: number) => {
    setActions(prev => prev.filter((_, i) => i !== index));
  };

  // Apply actions
  const applyActions = () => {
    if (actions.length === 0) return;
    onSuccess(actions);
  };

  // Format discount handling mode
  const formatMode = (mode?: string) => {
    switch (mode) {
      case 'exclude_from_base': return 'Exclude from Base';
      case 'deduct_from_commission': return 'Deduct from Commission';
      case 'split_50_50': return 'Split 50-50';
      case 'none': return 'No Adjustment';
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-none border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Mic className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Voice Sharing Setup</h2>
              <p className="text-sm text-gray-500">Speak to configure doctor sharing percentages</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Voice Input Panel */}
          <VoiceInputPanel
            onAnalyze={handleVoiceAnalyze}
            onClear={() => { setTranscript(null); setActions([]); }}
            analyzing={analyzing}
            transcript={transcript || undefined}
            placeholder='Say: "Dr. Kumar 20 percent" or "Set Dr. Patel CBC sharing to 25 percent"'
          />

          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Extracted Actions */}
          {actions.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700">
                Detected Sharing Updates ({actions.length})
              </h3>

              {actions.map((action, index) => (
                <div
                  key={index}
                  className="border border-emerald-200 rounded-lg p-4 bg-emerald-50"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <Users className="h-5 w-5 text-emerald-600 mt-0.5" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {action.matched_doctor_name}
                          </span>
                          {!action.matched_doctor_id && (
                            <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">
                              Not Found
                            </span>
                          )}
                        </div>

                        {/* Sharing Percent */}
                        {action.sharing_percent !== undefined && (
                          <div className="flex items-center gap-1 mt-1">
                            <Percent className="h-3 w-3 text-emerald-600" />
                            <span className="text-sm text-gray-700">
                              Default sharing: <strong>{action.sharing_percent}%</strong>
                            </span>
                          </div>
                        )}

                        {/* Test-specific sharing */}
                        {action.test_sharing_percent !== undefined && action.matched_test_name && (
                          <div className="mt-1 text-sm text-gray-600">
                            {action.matched_test_name}: <strong>{action.test_sharing_percent}%</strong>
                          </div>
                        )}

                        {/* Mode changes */}
                        {action.discount_handling && (
                          <div className="mt-1 text-sm text-gray-600">
                            Discount handling: {formatMode(action.discount_handling)}
                          </div>
                        )}
                        {action.outsource_handling && (
                          <div className="mt-1 text-sm text-gray-600">
                            Outsource handling: {formatMode(action.outsource_handling)}
                          </div>
                        )}

                        {/* Confidence */}
                        <div className="mt-1">
                          <span className={`text-xs ${action.confidence >= 0.8 ? 'text-green-600' : 'text-yellow-600'}`}>
                            {Math.round(action.confidence * 100)}% confidence
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeAction(index)}
                      className="p-1 hover:bg-white/50 rounded"
                    >
                      <X className="h-4 w-4 text-gray-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-none border-t border-gray-100 px-6 py-4 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>

          {actions.length > 0 && (
            <button
              onClick={applyActions}
              disabled={processing || !actions.some(a => a.matched_doctor_id)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              Apply {actions.filter(a => a.matched_doctor_id).length} Update{actions.filter(a => a.matched_doctor_id).length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DoctorVoiceInput;

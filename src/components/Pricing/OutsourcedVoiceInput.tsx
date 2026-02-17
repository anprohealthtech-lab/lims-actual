import React, { useState } from 'react';
import {
  Mic,
  X,
  CheckCircle2,
  AlertCircle,
  IndianRupee,
  TestTube,
  Loader2,
} from 'lucide-react';
import { VoiceInputPanel } from '../Voice';
import { supabase, database } from '../../utils/supabase';

interface OutsourcedPricingAction {
  test_name: string;
  matched_test_id: string | null;
  matched_test_name: string;
  lab_name?: string;
  matched_lab_id?: string | null;
  matched_lab_name?: string;
  cost: number;
  currency: string;
  confidence: number;
}

interface TestGroup {
  id: string;
  name: string;
  code?: string;
}

interface OutsourcedLab {
  id: string;
  name: string;
}

interface OutsourcedVoiceInputProps {
  labId: string;
  outsourcedLabId?: string; // If specific to one lab
  outsourcedLabName?: string;
  tests: TestGroup[];
  outsourcedLabs?: OutsourcedLab[];
  onClose: () => void;
  onSuccess: (updates: Array<{ test_id: string; cost: number }>) => void;
}

const OutsourcedVoiceInput: React.FC<OutsourcedVoiceInputProps> = ({
  labId,
  outsourcedLabId,
  outsourcedLabName,
  tests,
  outsourcedLabs = [],
  onClose,
  onSuccess,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [actions, setActions] = useState<OutsourcedPricingAction[]>([]);
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
          mode: 'outsourced_pricing',
          context: {
            tests: tests.map(t => ({ id: t.id, name: t.name, code: t.code })),
            outsourced_labs: outsourcedLabs.map(l => ({ id: l.id, name: l.name })),
          },
        },
      });

      if (fnError) throw fnError;

      if (data?.success) {
        setTranscript(data.transcript || '');
        // Filter to only show actions for current lab if outsourcedLabId is provided
        let filteredActions = data.actions || [];
        if (outsourcedLabId) {
          // Add current lab context to actions that don't have a lab specified
          filteredActions = filteredActions.map((a: any) => ({
            ...a,
            matched_lab_id: a.matched_lab_id || outsourcedLabId,
            matched_lab_name: a.matched_lab_name || outsourcedLabName,
          }));
        }
        setActions(filteredActions);
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
  const applyActions = async () => {
    if (actions.length === 0) return;

    setProcessing(true);
    setError(null);

    try {
      const updates: Array<{ test_id: string; cost: number }> = [];

      for (const action of actions) {
        if (!action.matched_test_id) continue;

        const targetLabId = action.matched_lab_id || outsourcedLabId;
        if (!targetLabId) continue;

        // Save to database
        const { error: saveError } = await supabase
          .from('outsourced_lab_prices')
          .upsert({
            lab_id: labId,
            outsourced_lab_id: targetLabId,
            test_group_id: action.matched_test_id,
            cost: action.cost,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'outsourced_lab_id,test_group_id' });

        if (saveError) {
          console.error('Error saving price:', saveError);
        } else {
          updates.push({ test_id: action.matched_test_id, cost: action.cost });
        }
      }

      onSuccess(updates);

    } catch (err: any) {
      console.error('Apply error:', err);
      setError(err.message || 'Failed to apply updates');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-none border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Mic className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Voice Cost Entry</h2>
              <p className="text-sm text-gray-500">
                {outsourcedLabName
                  ? `Set test costs for ${outsourcedLabName}`
                  : 'Set outsourced test costs by voice'
                }
              </p>
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
            placeholder='Say: "CBC cost 150 rupees" or "TSH 200, Lipid Profile 400"'
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
                Detected Cost Updates ({actions.length})
              </h3>

              {actions.map((action, index) => (
                <div
                  key={index}
                  className="border border-green-200 rounded-lg p-4 bg-green-50"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <TestTube className="h-5 w-5 text-green-600 mt-0.5" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {action.matched_test_name}
                          </span>
                          {!action.matched_test_id && (
                            <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">
                              Not Found
                            </span>
                          )}
                        </div>

                        {/* Cost */}
                        <div className="flex items-center gap-1 mt-1">
                          <IndianRupee className="h-3 w-3 text-green-600" />
                          <span className="text-sm text-gray-700">
                            Cost: <strong>₹{action.cost}</strong>
                          </span>
                        </div>

                        {/* Lab (if multiple) */}
                        {!outsourcedLabId && action.matched_lab_name && (
                          <div className="mt-1 text-sm text-gray-600">
                            Lab: {action.matched_lab_name}
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

          {/* Processing */}
          {processing && (
            <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Saving cost updates...</span>
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
              disabled={processing || !actions.some(a => a.matched_test_id)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {processing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Save {actions.filter(a => a.matched_test_id).length} Cost{actions.filter(a => a.matched_test_id).length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OutsourcedVoiceInput;

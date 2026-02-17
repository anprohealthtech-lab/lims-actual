import React, { useState } from 'react';
import {
  Mic,
  X,
  CheckCircle2,
  AlertCircle,
  Plus,
  Minus,
  RefreshCw,
  Loader2,
  Package,
} from 'lucide-react';
import { VoiceInputPanel } from '../Voice';
import { supabase, database, InventoryItem } from '../../utils/supabase';

interface InventoryAction {
  action: 'add' | 'remove' | 'set';
  item_name: string;
  matched_item_id: string | null;
  matched_item_name: string;
  quantity: number;
  unit: string;
  batch_number?: string;
  expiry_date?: string;
  reason?: string;
  confidence: number;
  is_new_item: boolean;
}

interface InventoryVoiceInputProps {
  labId: string;
  items: InventoryItem[];
  locationId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const InventoryVoiceInput: React.FC<InventoryVoiceInputProps> = ({
  labId,
  items,
  locationId,
  onClose,
  onSuccess,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [actions, setActions] = useState<InventoryAction[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processedCount, setProcessedCount] = useState(0);

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

      // Prepare existing items context
      const existingItems = items.map(i => ({
        id: i.id,
        name: i.name,
        code: i.code,
        unit: i.unit,
      }));

      // Call edge function
      const { data, error: fnError } = await supabase.functions.invoke('voice-to-inventory', {
        body: {
          audio_base64: audioBase64,
          mime_type: audioBlob.type || 'audio/webm',
          lab_id: labId,
          existing_items: existingItems,
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

  // Process all actions
  const processActions = async () => {
    if (actions.length === 0) return;

    setProcessing(true);
    setError(null);
    setProcessedCount(0);

    try {
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        if (action.action === 'add') {
          if (action.matched_item_id) {
            // Add to existing item
            await database.inventory.addStock({
              itemId: action.matched_item_id,
              quantity: action.quantity,
              reason: action.reason || 'Voice input: Stock added',
              batchNumber: action.batch_number,
              expiryDate: action.expiry_date,
              locationId,
            });
          } else {
            // Create new item and add stock
            const { data: newItem } = await database.inventory.createItem({
              name: action.matched_item_name,
              unit: action.unit,
              current_stock: action.quantity,
              batch_number: action.batch_number,
              expiry_date: action.expiry_date,
              location_id: locationId,
            });
          }
        } else if (action.action === 'remove' && action.matched_item_id) {
          await database.inventory.consumeStock({
            itemId: action.matched_item_id,
            quantity: action.quantity,
            reason: action.reason || 'Voice input: Stock removed',
            locationId,
          });
        } else if (action.action === 'set' && action.matched_item_id) {
          await database.inventory.adjustStock({
            itemId: action.matched_item_id,
            newQuantity: action.quantity,
            reason: action.reason || 'Voice input: Stock adjusted',
            locationId,
          });
        }

        setProcessedCount(i + 1);
      }

      // Success!
      onSuccess();

    } catch (err: any) {
      console.error('Process error:', err);
      setError(err.message || 'Failed to process actions');
    } finally {
      setProcessing(false);
    }
  };

  // Get action icon
  const getActionIcon = (action: string) => {
    switch (action) {
      case 'add': return <Plus className="h-4 w-4 text-green-600" />;
      case 'remove': return <Minus className="h-4 w-4 text-red-600" />;
      case 'set': return <RefreshCw className="h-4 w-4 text-blue-600" />;
      default: return <Package className="h-4 w-4 text-gray-600" />;
    }
  };

  // Get action style
  const getActionStyle = (action: string) => {
    switch (action) {
      case 'add': return 'bg-green-50 border-green-200';
      case 'remove': return 'bg-red-50 border-red-200';
      case 'set': return 'bg-blue-50 border-blue-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-none border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Mic className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Voice Stock Update</h2>
              <p className="text-sm text-gray-500">Speak to add, remove, or adjust stock</p>
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
            placeholder='Say: "Add 5 boxes CBC reagent" or "Remove 2 pipette tips"'
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
                Detected Actions ({actions.length})
              </h3>

              {actions.map((action, index) => (
                <div
                  key={index}
                  className={`border rounded-lg p-4 ${getActionStyle(action.action)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {getActionIcon(action.action)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {action.action === 'add' ? 'Add' : action.action === 'remove' ? 'Remove' : 'Set to'}
                          </span>
                          <span className="font-bold text-gray-900">
                            {action.quantity} {action.unit}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-1">
                          {action.matched_item_name}
                          {action.is_new_item && (
                            <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">
                              New Item
                            </span>
                          )}
                        </p>
                        {(action.batch_number || action.expiry_date) && (
                          <div className="flex gap-3 mt-1 text-xs text-gray-500">
                            {action.batch_number && <span>Batch: {action.batch_number}</span>}
                            {action.expiry_date && <span>Exp: {action.expiry_date}</span>}
                          </div>
                        )}
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

          {/* Processing Progress */}
          {processing && (
            <div className="px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="flex items-center gap-2 text-indigo-700">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Processing {processedCount + 1} of {actions.length}...</span>
              </div>
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
              onClick={processActions}
              disabled={processing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Apply {actions.length} Action{actions.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryVoiceInput;

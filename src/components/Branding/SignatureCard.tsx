import React from 'react';
import { Edit2, PenTool, Star, Trash2 } from 'lucide-react';

type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'error' | undefined;

type SignatureType = 'digital' | 'handwritten' | 'stamp' | 'text';

export interface SignatureSummary {
  id: string;
  user_id?: string;
  signature_type: SignatureType;
  signature_name: string;
  is_default: boolean;
  is_active?: boolean;
  file_url?: string;
  text_signature?: string;
  created_at?: string;
  users?: {
    id: string;
    name: string;
    email: string;
    role?: string;
  };
}

interface SignatureCardProps {
  signature: SignatureSummary;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
  processingStatus?: ProcessingStatus;
}

export const SignatureCard: React.FC<SignatureCardProps> = ({
  signature,
  onSetDefault,
  onEdit,
  onDelete,
  processingStatus,
}) => {
  const statusLabel = processingStatus ? `Status: ${processingStatus}` : 'Status: idle';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PenTool className="h-5 w-5 text-indigo-500" />
          <div>
            <p className="text-sm font-semibold text-gray-900">{signature.signature_name}</p>
            <p className="text-xs text-gray-500">{signature.signature_type}</p>
            {signature.users && (
              <p className="text-xs text-gray-400">
                User: {signature.users.name} ({signature.users.email})
              </p>
            )}
          </div>
        </div>
        {signature.is_default && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700">
            <Star className="h-3 w-3" /> Default
          </span>
        )}
      </div>

      {signature.file_url && (
        <div className="mb-3 overflow-hidden rounded-md border border-gray-100 bg-gray-50">
          <img src={signature.file_url} alt={signature.signature_name} className="h-24 w-full object-contain" />
        </div>
      )}

      {signature.text_signature && (
        <p className="mb-3 rounded-md bg-gray-50 p-2 text-sm text-gray-700">{signature.text_signature}</p>
      )}

      <p className="mb-3 text-xs text-gray-500">{statusLabel}</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSetDefault}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Set as default
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Edit2 className="h-3 w-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
};

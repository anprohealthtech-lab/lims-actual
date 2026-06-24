import React, { useState, useEffect } from 'react';
import { database } from '../../utils/supabase';

type SignatureType = 'digital' | 'handwritten' | 'stamp' | 'text';

interface SignatureUploaderProps {
  labId: string;
  userId: string;
  apiBaseUrl?: string;
  onSuccess: () => void;
  onClose: () => void;
}

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, base64] = result.split(',');
      resolve(base64 || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const loadImageFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read signature image'));
    };
    image.src = url;
  });

const canvasToPngFile = (canvas: HTMLCanvasElement, fileName: string) =>
  new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to prepare transparent signature image'));
        return;
      }

      const baseName = fileName.replace(/\.[^.]+$/, '') || 'signature';
      resolve(new File([blob], `${baseName}-transparent.png`, { type: 'image/png' }));
    }, 'image/png');
  });

const removeLightSignatureBackground = async (sourceFile: File): Promise<File> => {
  const image = await loadImageFromFile(sourceFile);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Unable to process signature image');

  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const brightness = (red + green + blue) / 3;
      const isLightPaper = brightness > 220 && max - min < 48;

      if (alpha < 8 || isLightPaper) {
        const softenedAlpha = brightness > 245 ? 0 : Math.max(0, Math.min(alpha, Math.round((245 - brightness) * 10)));
        data[index + 3] = softenedAlpha;
      }

      if (data[index + 3] > 24) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  if (minX > maxX || minY > maxY) {
    return canvasToPngFile(canvas, sourceFile.name);
  }

  const padding = 10;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = cropWidth;
  croppedCanvas.height = cropHeight;
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) throw new Error('Unable to crop signature image');

  croppedCtx.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvasToPngFile(croppedCanvas, sourceFile.name);
};

export const SignatureUploader: React.FC<SignatureUploaderProps> = ({ labId, userId, apiBaseUrl = '', onSuccess, onClose }) => {
  const [signatureName, setSignatureName] = useState('');
  const [signatureType, setSignatureType] = useState<SignatureType>('digital');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // User selection
  const [selectedUserId, setSelectedUserId] = useState<string>(userId);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    loadUsers();
  }, [labId]);

  const loadUsers = async () => {
    try {
      const { data, error } = await database.users.getLabUsers(labId);
      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!signatureName) {
      setError('Signature name is required');
      return;
    }

    if (signatureType === 'text') {
      setError('Text signatures are not yet supported in the upload pipeline');
      return;
    }

    if (!file) {
      setError('Please choose an image file');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const uploadFile = await removeLightSignatureBackground(file);
      const base64Data = await toBase64(uploadFile);
      const contentType = uploadFile.type;
      const fileName = uploadFile.name;

      const response = await fetch(`${apiBaseUrl}/.netlify/functions/branding-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labId,
          userId: selectedUserId,
          signatureType,
          fileName,
          contentType,
          base64Data,
          assetName: signatureName,
          usageContext: ['reports'],
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Upload failed');
      }

      onSuccess();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Upload failed';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Add signature</h2>
            <p className="text-sm text-gray-500">Upload an image signature to process through the ImageKit pipeline.</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">User</label>
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring"
              disabled={isSubmitting || loadingUsers}
            >
              {loadingUsers ? (
                <option>Loading users...</option>
              ) : (
                users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))
              )}
            </select>
            <p className="mt-1 text-xs text-gray-500">Select the user this signature belongs to</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Signature name</label>
            <input
              type="text"
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring"
              placeholder="e.g. Dr. A. Kumar Official Signature"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
            <select
              value={signatureType}
              onChange={(event) => setSignatureType(event.target.value as SignatureType)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring"
              disabled={isSubmitting}
            >
              <option value="digital">Digital</option>
              <option value="handwritten">Handwritten</option>
              <option value="stamp">Stamp</option>
              <option value="text" disabled>Text (coming soon)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Signature file</label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              className="w-full text-sm"
              disabled={isSubmitting}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-70"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Uploading…' : 'Upload signature'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

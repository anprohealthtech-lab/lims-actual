import React, { useState, useCallback, useRef } from 'react';
import { Upload, X, Camera, FileText, Image as ImageIcon, AlertCircle, Check, Loader } from 'lucide-react';
import { database, supabase, uploadFile } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { capturePhoto, isNative } from '../../utils/androidFileUpload';

export interface UploadedFile {
  id: string;
  batchId: string;
  sequence: number;
  label: string; // "Image 1", "Image 2"
  fileName: string;
  fileUrl: string;
  thumbnailUrl?: string;
  file: File;
  uploadStatus: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
  metadata: {
    size: number;
    type: string;
    dimensions?: { width: number; height: number };
  };
}

export interface UploadBatch {
  batchId: string;
  files: UploadedFile[];
  totalFiles: number;
  uploadedAt: Date;
  context: UploadContext;
}

interface UploadContext {
  orderId: string;
  testId?: string;
  scope: 'order' | 'test';
  labId: string;
  patientId: string;
}

interface MultiImageUploaderProps {
  maxFiles?: number; // default 5
  maxSizePerFile?: number; // default 10MB
  acceptedFormats?: string[]; // default ['image/*', '.pdf']
  onUploadComplete: (batch: UploadBatch) => void;
  onUploadProgress?: (progress: { completed: number; total: number }) => void;
  context: {
    orderId: string;
    testId?: string;
    scope: 'order' | 'test';
    patientId: string;
  };
  className?: string;
}

const MultiImageUploader: React.FC<MultiImageUploaderProps> = ({
  maxFiles = 5,
  maxSizePerFile = 10 * 1024 * 1024, // 10MB
  acceptedFormats = ['image/*', '.pdf'],
  onUploadComplete,
  onUploadProgress,
  context,
  className = ''
}) => {
  const { user } = useAuth();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Generate batch ID
  const generateBatchId = () => crypto.randomUUID();

  // Create preview for file
  const createPreview = async (file: File): Promise<string | undefined> => {
    if (!file.type.startsWith('image/')) return undefined;
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  };

  // Get image dimensions
  const getImageDimensions = (file: File): Promise<{ width: number; height: number } | undefined> => {
    if (!file.type.startsWith('image/')) return Promise.resolve(undefined);
    
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      
      img.onerror = () => {
        resolve(undefined);
        URL.revokeObjectURL(url);
      };
      
      img.src = url;
    });
  };

  // Add files to the batch
  const addFiles = useCallback(async (newFiles: File[]) => {
    if (files.length + newFiles.length > maxFiles) {
      alert(`Maximum ${maxFiles} files allowed`);
      return;
    }

    const batchId = files.length === 0 ? generateBatchId() : files[0].batchId;
    const startSequence = files.length + 1;

    const uploadedFiles: UploadedFile[] = await Promise.all(
      newFiles.map(async (file, index) => {
        // Validate file size
        if (file.size > maxSizePerFile) {
          return {
            id: crypto.randomUUID(),
            batchId,
            sequence: startSequence + index,
            label: `Image ${startSequence + index}`,
            fileName: file.name,
            fileUrl: '',
            file,
            uploadStatus: 'error' as const,
            error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB > ${maxSizePerFile / 1024 / 1024}MB)`,
            metadata: {
              size: file.size,
              type: file.type
            }
          };
        }

        // Create thumbnail if image
        const thumbnailUrl = await createPreview(file);
        const dimensions = await getImageDimensions(file);

        return {
          id: crypto.randomUUID(),
          batchId,
          sequence: startSequence + index,
          label: `Image ${startSequence + index}`,
          fileName: file.name,
          fileUrl: '',
          thumbnailUrl,
          file,
          uploadStatus: 'pending' as const,
          metadata: {
            size: file.size,
            type: file.type,
            dimensions
          }
        };
      })
    );

    setFiles(prev => [...prev, ...uploadedFiles]);
  }, [files, maxFiles, maxSizePerFile]);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, [addFiles]);

  // Handle file input change
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
    addFiles(selectedFiles);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle camera input (native or web)
  const handleCameraCapture = async () => {
    if (isNative()) {
      // Use native camera on Android
      try {
        // First check and request permissions
        const { Camera } = await import('@capacitor/camera');
        const permissions = await Camera.checkPermissions();
        
        if (permissions.camera !== 'granted') {
          const requested = await Camera.requestPermissions();
          if (requested.camera !== 'granted') {
            setError('Camera permission is required to take photos. Please enable it in Settings.');
            return;
          }
        }

        // Now try to capture the photo
        const { CameraResultType, CameraSource } = await import('@capacitor/camera');
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          saveToGallery: false,
          correctOrientation: true
        });

        if (!photo.dataUrl) {
          throw new Error('No image data received from camera');
        }

        // Convert base64 to blob for upload
        const response = await fetch(photo.dataUrl);
        const blob = await response.blob();
        const fileName = `camera_capture_${Date.now()}.${photo.format || 'jpg'}`;
        const file = new File([blob], fileName, { type: `image/${photo.format || 'jpeg'}` });
        
        addFiles([file]);
        console.log('Photo captured successfully');
      } catch (error: any) {
        console.error('Camera capture error:', error);
        // More specific error messages
        if (error.message?.includes('User cancelled') || error.message?.includes('cancelled')) {
          console.log('Camera capture cancelled by user');
        } else if (error.message?.includes('No camera') || error.message?.includes('not available')) {
          alert('No camera available on this device');
        } else if (error.message?.includes('permission')) {
          alert('Camera permission denied. Please enable camera access in Settings > Apps > LIMS Builder > Permissions.');
        } else {
          alert(`Failed to capture photo: ${error.message || 'Unknown error'}. Please try again.`);
        }
      }
    } else {
      // Use HTML5 camera input on web
      cameraInputRef.current?.click();
    }
  };

  // Handle web camera input fallback
  const handleCameraInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const capturedFiles = e.target.files ? Array.from(e.target.files) : [];
    addFiles(capturedFiles);
    // Reset input
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Remove file from batch
  const removeFile = (id: string) => {
    setFiles(prev => {
      const updated = prev.filter(f => f.id !== id);
      // Update sequence numbers and labels
      return updated.map((file, index) => ({
        ...file,
        sequence: index + 1,
        label: `Image ${index + 1}`
      }));
    });
  };

  // Reorder files (for future drag & drop functionality)
  // const reorderFiles = (fromIndex: number, toIndex: number) => {
  //   setFiles(prev => {
  //     const updated = [...prev];
  //     const [removed] = updated.splice(fromIndex, 1);
  //     updated.splice(toIndex, 0, removed);
      
  //     // Update sequence numbers and labels
  //     return updated.map((file, index) => ({
  //       ...file,
  //       sequence: index + 1,
  //       label: `Image ${index + 1}`
  //     }));
  //   });
  // };

  // Upload all files
  const uploadAllFiles = async () => {
    if (files.length === 0) return;

    setUploading(true);
    
    try {
      const currentLabId = await database.getCurrentUserLabId();
      if (!currentLabId) throw new Error('Unable to determine lab context');

      const batchId = files[0].batchId;
      
      // Create batch record
      const batchData = {
        id: batchId,
        order_id: context.orderId,
        patient_id: context.patientId,
        upload_type: context.scope,
        total_files: files.length,
        upload_context: {
          testId: context.testId,
          scope: context.scope
        },
        uploaded_by: user?.id,
        lab_id: currentLabId,
        batch_status: 'uploading',
        batch_description: `${context.scope === 'test' ? 'Test-specific' : 'Order-level'} batch upload of ${files.length} files`
      };

      const { error: batchError } = await supabase
        .from('attachment_batches')
        .insert(batchData);
      
      if (batchError) throw batchError;

      // Upload files sequentially with progress updates
      let completed = 0;
      const uploadedAttachments = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Skip files that already have errors
        if (file.uploadStatus === 'error') {
          completed++;
          continue;
        }

        // Update file status to uploading
        setFiles(prev => prev.map(f => 
          f.id === file.id ? { ...f, uploadStatus: 'uploading' } : f
        ));

        try {
          // Generate file path with batch info
          const filePath = `${currentLabId}/${new Date().getFullYear()}/${
            new Date().getMonth() + 1
          }/${batchId}/${file.sequence}_${file.file.name}`;

          // Upload to storage
          const uploadResult = await uploadFile(file.file, filePath);
          
          if (!uploadResult?.publicUrl) {
            throw new Error('Upload failed - no URL returned');
          }

          // Create attachment record
          const attachmentData = {
            batch_id: batchId,
            batch_sequence: file.sequence,
            batch_total: files.length,
            image_label: file.label,
            file_path: filePath,
            file_url: uploadResult.publicUrl,
            original_filename: file.fileName,
            file_size: file.metadata.size,
            file_type: file.metadata.type,
            related_table: 'orders',
            related_id: context.orderId,
            order_id: context.orderId,
            patient_id: context.patientId,
            lab_id: currentLabId,
            uploaded_by: user?.id,
            description: `${file.label} from batch upload`,
            batch_metadata: {
              dimensions: file.metadata.dimensions,
              originalIndex: i + 1,
              uploadContext: context
            }
          };

          const { data: attachment, error: attachmentError } = await supabase
            .from('attachments')
            .insert(attachmentData)
            .select()
            .single();

          if (attachmentError) throw attachmentError;

          // Update file status to completed
          setFiles(prev => prev.map(f => 
            f.id === file.id ? { 
              ...f, 
              uploadStatus: 'completed',
              fileUrl: uploadResult.publicUrl 
            } : f
          ));

          uploadedAttachments.push(attachment);
          completed++;
          
          // Progress callback
          onUploadProgress?.({ completed, total: files.length });

        } catch (error: any) {
          console.error(`Error uploading file ${file.fileName}:`, error);
          
          // Update file status to error
          setFiles(prev => prev.map(f => 
            f.id === file.id ? { 
              ...f, 
              uploadStatus: 'error',
              error: error.message || 'Upload failed'
            } : f
          ));
          
          completed++;
        }
      }

      // Update batch status to completed
      await supabase
        .from('attachment_batches')
        .update({ batch_status: 'completed' })
        .eq('id', batchId);

      // Create upload batch result
      const uploadBatch: UploadBatch = {
        batchId,
        files: files.filter(f => f.uploadStatus === 'completed'),
        totalFiles: files.length,
        uploadedAt: new Date(),
        context: {
          orderId: context.orderId,
          testId: context.testId,
          scope: context.scope,
          labId: currentLabId,
          patientId: context.patientId
        }
      };

      onUploadComplete(uploadBatch);

    } catch (error: any) {
      console.error('Batch upload failed:', error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const completedCount = files.filter(f => f.uploadStatus === 'completed').length;
  const errorCount = files.filter(f => f.uploadStatus === 'error').length;
  const pendingCount = files.filter(f => f.uploadStatus === 'pending').length;

  return (
    <div className={`multi-image-uploader ${className}`}>
      {/* Drop Zone */}
      {files.length === 0 ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive 
              ? 'border-blue-400 bg-blue-50' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <div className="space-y-4">
            <div className="flex justify-center">
              <Upload className="h-12 w-12 text-gray-400" />
            </div>
            
            <div>
              <h3 className="text-lg font-medium text-gray-900">Upload Multiple Images</h3>
              <p className="text-sm text-gray-500 mt-1">
                Drag and drop up to {maxFiles} files, or click to select
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Supports: {acceptedFormats.join(', ')} • Max {formatFileSize(maxSizePerFile)} per file
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 min-h-touch"
              >
                <Upload className="h-4 w-4" />
                Choose Files
              </button>
              
              <button
                onClick={handleCameraCapture}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 min-h-touch"
              >
                <Camera className="h-4 w-4" />
                {isNative() ? 'Open Camera' : 'Take Photos'}
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedFormats.join(',')}
            onChange={handleFileInput}
            className="hidden"
          />
          
          <input
            ref={cameraInputRef}
            type="file"
            multiple
            accept="image/*"
            capture="environment"
            onChange={handleCameraInput}
            className="hidden"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* File List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {files.map((file) => (
              <div
                key={file.id}
                className="border border-gray-200 rounded-lg p-3 bg-white"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-blue-600">
                      {file.label}
                    </div>
                    <div className={`w-2 h-2 rounded-full ${
                      file.uploadStatus === 'completed' ? 'bg-green-500' :
                      file.uploadStatus === 'error' ? 'bg-red-500' :
                      file.uploadStatus === 'uploading' ? 'bg-blue-500 animate-pulse' :
                      'bg-gray-300'
                    }`} />
                  </div>
                  
                  {!uploading && (
                    <button
                      onClick={() => removeFile(file.id)}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Thumbnail */}
                <div className="mb-2">
                  {file.thumbnailUrl ? (
                    <img
                      src={file.thumbnailUrl}
                      alt={file.fileName}
                      className="w-full h-20 object-cover rounded border"
                    />
                  ) : (
                    <div className="w-full h-20 bg-gray-100 rounded border flex items-center justify-center">
                      {file.metadata.type.startsWith('image/') ? (
                        <ImageIcon className="h-8 w-8 text-gray-400" />
                      ) : (
                        <FileText className="h-8 w-8 text-gray-400" />
                      )}
                    </div>
                  )}
                </div>

                {/* File Info */}
                <div className="text-xs text-gray-600">
                  <div className="font-medium truncate">{file.fileName}</div>
                  <div>{formatFileSize(file.metadata.size)}</div>
                  {file.metadata.dimensions && (
                    <div>{file.metadata.dimensions.width} × {file.metadata.dimensions.height}</div>
                  )}
                </div>

                {/* Status */}
                {file.uploadStatus === 'error' && (
                  <div className="mt-2 flex items-center gap-1 text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    <span className="text-xs">{file.error}</span>
                  </div>
                )}
                
                {file.uploadStatus === 'uploading' && (
                  <div className="mt-2 flex items-center gap-1 text-blue-600">
                    <Loader className="h-3 w-3 animate-spin" />
                    <span className="text-xs">Uploading...</span>
                  </div>
                )}
                
                {file.uploadStatus === 'completed' && (
                  <div className="mt-2 flex items-center gap-1 text-green-600">
                    <Check className="h-3 w-3" />
                    <span className="text-xs">Uploaded</span>
                  </div>
                )}
              </div>
            ))}

            {/* Add More Button */}
            {files.length < maxFiles && !uploading && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:border-gray-400 transition-colors flex flex-col items-center justify-center text-center min-h-[120px]"
              >
                <Upload className="h-8 w-8 text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">Add More</span>
                <span className="text-xs text-gray-400">
                  ({maxFiles - files.length} remaining)
                </span>
              </div>
            )}
          </div>

          {/* Upload Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-sm">
                  <span className="font-medium">{files.length}</span> files selected
                </div>
                {completedCount > 0 && (
                  <div className="text-sm text-green-600">
                    {completedCount} completed
                  </div>
                )}
                {errorCount > 0 && (
                  <div className="text-sm text-red-600">
                    {errorCount} errors
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setFiles([])}
                  disabled={uploading}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
                >
                  Clear All
                </button>
                
                <button
                  onClick={uploadAllFiles}
                  disabled={uploading || files.length === 0 || files.every(f => f.uploadStatus === 'completed')}
                  className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {uploading ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload All ({pendingCount})
                    </>
                  )}
                </button>
              </div>
            </div>

            {uploading && (
              <div className="mt-3">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{
                      width: `${((completedCount + errorCount) / files.length) * 100}%`
                    }}
                  />
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {completedCount + errorCount} of {files.length} files processed
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiImageUploader;
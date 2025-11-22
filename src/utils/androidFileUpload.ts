import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { isNative, convertFileSrc } from './platformHelper';

// Re-export commonly used platform helpers
export { isNative, convertFileSrc };

export interface CapturePhotoOptions {
  quality?: number;
  allowEditing?: boolean;
  saveToGallery?: boolean;
  source?: 'camera' | 'gallery' | 'prompt';
}

export interface PhotoResult {
  dataUrl?: string;
  filePath?: string;
  webPath?: string;
  format?: string;
  fileName?: string;
  blob?: Blob;
}

/**
 * Capture or select a photo using native camera on Android
 */
export const capturePhoto = async (options: CapturePhotoOptions = {}): Promise<PhotoResult> => {
  if (!isNative()) {
    throw new Error('Camera is only available on native platforms');
  }

  const {
    quality = 90,
    allowEditing = false,
    saveToGallery = true,
    source = 'prompt',
  } = options;

  try {
    let cameraSource = CameraSource.Prompt;
    if (source === 'camera') {
      cameraSource = CameraSource.Camera;
    } else if (source === 'gallery') {
      cameraSource = CameraSource.Photos;
    }

    const image = await Camera.getPhoto({
      quality,
      allowEditing,
      resultType: CameraResultType.Uri,
      source: cameraSource,
      saveToGallery,
      correctOrientation: true,
    });

    return {
      filePath: image.path,
      webPath: image.webPath,
      format: image.format,
      dataUrl: `data:image/${image.format};base64,${image.base64String}`,
    };
  } catch (error) {
    console.error('Failed to capture photo:', error);
    throw error;
  }
};

/**
 * Convert image URI to base64 for upload
 */
export const readAsBase64 = async (filePath: string): Promise<string> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    const result = await Filesystem.readFile({
      path: filePath,
    });

    return result.data as string;
  } catch (error) {
    console.error('Failed to read file as base64:', error);
    throw error;
  }
};

/**
 * Save base64 image to device filesystem
 */
export const saveBase64Image = async (
  base64Data: string,
  fileName: string,
  directory: Directory = Directory.Data
): Promise<string> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    const result = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory,
    });

    return result.uri;
  } catch (error) {
    console.error('Failed to save image:', error);
    throw error;
  }
};

/**
 * Read file as blob for web compatibility
 */
export const readAsBlob = async (filePath: string): Promise<Blob> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    const base64 = await readAsBase64(filePath);
    const response = await fetch(`data:application/octet-stream;base64,${base64}`);
    return await response.blob();
  } catch (error) {
    console.error('Failed to read file as blob:', error);
    throw error;
  }
};

/**
 * Delete file from filesystem
 */
export const deleteFile = async (
  filePath: string,
  directory: Directory = Directory.Data
): Promise<void> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    await Filesystem.deleteFile({
      path: filePath,
      directory,
    });
  } catch (error) {
    console.error('Failed to delete file:', error);
    throw error;
  }
};

/**
 * Get file URI that can be used in img src
 */
export const getFileUri = (filePath: string): string => {
  if (!isNative()) {
    return filePath;
  }
  return convertFileSrc(filePath);
};

/**
 * Create directory if it doesn't exist
 */
export const createDirectory = async (
  path: string,
  directory: Directory = Directory.Data
): Promise<void> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    await Filesystem.mkdir({
      path,
      directory,
      recursive: true,
    });
  } catch (error) {
    console.error('Failed to create directory:', error);
    throw error;
  }
};

/**
 * List files in directory
 */
export const listFiles = async (
  path: string,
  directory: Directory = Directory.Data
): Promise<string[]> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    const result = await Filesystem.readdir({
      path,
      directory,
    });
    return result.files.map(f => typeof f === 'string' ? f : f.name);
  } catch (error) {
    console.error('Failed to list files:', error);
    throw error;
  }
};

/**
 * Get file info
 */
export const getFileInfo = async (
  filePath: string,
  directory: Directory = Directory.Data
): Promise<{ size: number; ctime: number; mtime: number; uri: string }> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    const result = await Filesystem.stat({
      path: filePath,
      directory,
    });
    return result;
  } catch (error) {
    console.error('Failed to get file info:', error);
    throw error;
  }
};

/**
 * Write text file
 */
export const writeTextFile = async (
  filePath: string,
  data: string,
  directory: Directory = Directory.Data
): Promise<string> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    const result = await Filesystem.writeFile({
      path: filePath,
      data,
      directory,
      encoding: Encoding.UTF8,
    });
    return result.uri;
  } catch (error) {
    console.error('Failed to write text file:', error);
    throw error;
  }
};

/**
 * Read text file
 */
export const readTextFile = async (
  filePath: string,
  directory: Directory = Directory.Data
): Promise<string> => {
  if (!isNative()) {
    throw new Error('Filesystem is only available on native platforms');
  }

  try {
    const result = await Filesystem.readFile({
      path: filePath,
      directory,
      encoding: Encoding.UTF8,
    });
    return result.data as string;
  } catch (error) {
    console.error('Failed to read text file:', error);
    throw error;
  }
};

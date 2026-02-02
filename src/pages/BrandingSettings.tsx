import React, { useState, useEffect } from 'react';
import {
  Upload,
  Image,
  FileText,
  Eye,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2
} from 'lucide-react';
import { supabase, auth, database } from '../utils/supabase';
import { useBrandingProcessingStatus } from '../hooks/useBrandingProcessingStatus';
import { BrandingAssetUploader } from '../components/Branding/BrandingAssetUploader';
import { SignatureUploader } from '../components/Branding/SignatureUploader';
import { BrandingAssetCard } from '../components/Branding/BrandingAssetCard';
import { SignatureCard } from '../components/Branding/SignatureCard';
import { BrandingPreview } from '../components/Branding/BrandingPreview';

interface BrandingAsset {
  id: string;
  asset_type: 'header' | 'footer' | 'watermark' | 'logo' | 'letterhead' | 'front_page' | 'last_page';
  asset_name: string;
  file_url: string;
  file_type: string;
  is_active: boolean;
  is_default: boolean;
  processing_status?: 'pending' | 'processing' | 'ready' | 'error';
  created_at: string;
  variants?: AssetVariant[] | Record<string, string> | null;
}

interface UserSignature {
  id: string;
  signature_type: 'digital' | 'handwritten' | 'stamp' | 'text';
  signature_name: string;
  file_url?: string;
  text_signature?: string;
  is_active: boolean;
  is_default: boolean;
  processing_status?: 'pending' | 'processing' | 'ready' | 'error';
  created_at: string;
  variants?: SignatureVariant[] | Record<string, string> | null;
}

interface AssetVariant {
  id: string;
  variant_type: 'original' | '1x' | '2x' | '3x' | 'thumbnail' | 'optimized';
  format: 'png' | 'webp' | 'jpg';
  file_url: string;
  width: number;
  height: number;
  file_size: number;
  imagekit_url?: string;
}

interface SignatureVariant {
  id: string;
  variant_type: 'original' | '1x' | '2x' | '3x' | 'thumbnail' | 'optimized';
  format: 'png' | 'webp' | 'jpg';
  file_url: string;
  width: number;
  height: number;
  file_size: number;
  imagekit_url?: string;
}

const isPlaceholderId = (value: string) => value.startsWith('temp-');

export const BrandingSettings: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<'assets' | 'signatures' | 'watermark' | 'preview' | 'pdf-settings'>('assets');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [brandingAssets, setBrandingAssets] = useState<BrandingAsset[]>([]);
  const [userSignatures, setUserSignatures] = useState<UserSignature[]>([]);
  const [labId, setLabId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Watermark settings state
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkImageUrl, setWatermarkImageUrl] = useState<string>('');
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.15);
  const [watermarkPosition, setWatermarkPosition] = useState<'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'repeat'>('center');
  const [watermarkSize, setWatermarkSize] = useState<'small' | 'medium' | 'large' | 'full'>('medium');
  const [watermarkRotation, setWatermarkRotation] = useState(0);
  const [savingWatermark, setSavingWatermark] = useState(false);

  // PDF Layout state
  const [pdfSettings, setPdfSettings] = useState<any>({});
  const [savingPdfSettings, setSavingPdfSettings] = useState(false);

  // Upload states
  const [showAssetUploader, setShowAssetUploader] = useState(false);
  const [showSignatureUploader, setShowSignatureUploader] = useState(false);
  const [selectedAssetType, setSelectedAssetType] = useState<'header' | 'footer' | 'watermark' | 'logo' | 'letterhead' | 'front_page' | 'last_page'>('logo');

  // Processing status polling
  const { processingItems, isPolling } = useBrandingProcessingStatus(labId);

  // Load initial data
  useEffect(() => {
    loadBrandingData();
  }, []);

  const loadBrandingData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get current lab ID
      const currentLabId = await database.getCurrentUserLabId();
      if (!currentLabId) {
        throw new Error('Lab ID not found');
      }
      setLabId(currentLabId);

      // Get current user ID
      const { user, error: authError } = await auth.getCurrentUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }
      setCurrentUserId(user.id);

      // Load lab watermark & PDF settings
      const { data: labData, error: labError } = await supabase
        .from('labs')
        .select('watermark_enabled, watermark_image_url, watermark_opacity, watermark_position, watermark_size, watermark_rotation, pdf_layout_settings')
        .eq('id', currentLabId)
        .single();

      if (!labError && labData) {
        setWatermarkEnabled(labData.watermark_enabled || false);
        setWatermarkImageUrl(labData.watermark_image_url || '');
        setWatermarkOpacity(labData.watermark_opacity || 0.15);
        setWatermarkPosition(labData.watermark_position || 'center');
        setWatermarkSize(labData.watermark_size || 'medium');
        setWatermarkRotation(labData.watermark_rotation || 0);

        // Load PDF Settings
        if (labData.pdf_layout_settings) {
          setPdfSettings(labData.pdf_layout_settings);
        } else {
          // Initialize defaults - use 'inherit' for headerTextColor so text remains visible
          // regardless of letterhead design. Labs with dark header areas can set to 'white'.
          setPdfSettings({
            resultColors: { enabled: true, high: '#dc2626', low: '#ea580c', normal: '#16a34a' },
            headerTextColor: 'inherit',
            headerHeight: '90px',
            footerHeight: '80px',
            margins: { top: '180px', bottom: '150px', left: '20px', right: '20px' }
          });
        }
      }

      // Load branding assets
      if (!currentLabId) {
        throw new Error('No lab ID found for current user');
      }

      // Load branding assets
      const { data: assets, error: assetsError } = await database.labBrandingAssets.getAll(currentLabId);
      if (assetsError) {
        throw new Error(`Failed to load branding assets: ${assetsError.message}`);
      }

      // Load ALL lab user signatures (not just current user's)
      const { data: signatures, error: signaturesError } = await database.userSignatures.getAllForLab(currentLabId);
      if (signaturesError) {
        throw new Error(`Failed to load signatures: ${signaturesError.message}`);
      }

      setBrandingAssets(assets || []);
      setUserSignatures(signatures || []);
    } catch (err) {
      console.error('Error loading branding data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load branding data');
    } finally {
      setLoading(false);
    }
  };

  // Handle upload completion
  const handleAssetUploaded = async () => {
    await loadBrandingData();
    setShowAssetUploader(false);
  };

  const handleSignatureUploaded = async () => {
    await loadBrandingData();
    setShowSignatureUploader(false);
  };

  // Handle setting as default
  const handleSetAssetDefault = async (assetId: string) => {
    if (isPlaceholderId(assetId)) {
      return;
    }

    try {
      const { error } = await database.labBrandingAssets.setDefault(assetId);
      if (error) {
        throw new Error(error.message);
      }

      // Refresh data to show updated defaults
      await loadBrandingData();
    } catch (err) {
      console.error('Error setting asset as default:', err);
      // Show error toast
    }
  };

  const handleSetSignatureDefault = async (signatureId: string) => {
    if (isPlaceholderId(signatureId)) {
      return;
    }

    try {
      const { error } = await database.userSignatures.setDefault(signatureId);
      if (error) {
        throw new Error(error.message);
      }

      // Refresh data to show updated defaults
      await loadBrandingData();
    } catch (err) {
      console.error('Error setting signature as default:', err);
      // Show error toast
    }
  };

  // Handle delete
  const handleDeleteAsset = async (assetId: string) => {
    if (!confirm('Are you sure you want to delete this branding asset?')) {
      return;
    }

    if (isPlaceholderId(assetId)) {
      setBrandingAssets(prev => prev.filter(asset => asset.id !== assetId));
      return;
    }

    try {
      const { error } = await database.labBrandingAssets.delete(assetId);
      if (error) {
        throw new Error(error.message);
      }

      setBrandingAssets(prev => prev.filter(asset => asset.id !== assetId));
    } catch (err) {
      console.error('Error deleting asset:', err);
      // Show error toast
    }
  };

  const handleDeleteSignature = async (signatureId: string) => {
    if (!confirm('Are you sure you want to delete this signature?')) {
      return;
    }

    if (isPlaceholderId(signatureId)) {
      setUserSignatures(prev => prev.filter(signature => signature.id !== signatureId));
      return;
    }

    try {
      const { error } = await database.userSignatures.delete(signatureId);
      if (error) {
        throw new Error(error.message);
      }

      setUserSignatures(prev => prev.filter(signature => signature.id !== signatureId));
    } catch (err) {
      console.error('Error deleting signature:', err);
      // Show error toast
    }
  };

  const handleSaveWatermarkSettings = async () => {
    if (!labId) return;

    setSavingWatermark(true);
    try {
      const { error } = await supabase
        .from('labs')
        .update({
          watermark_enabled: watermarkEnabled,
          watermark_image_url: watermarkImageUrl,
          watermark_opacity: watermarkOpacity,
          watermark_position: watermarkPosition,
          watermark_size: watermarkSize,
          watermark_rotation: watermarkRotation
        })
        .eq('id', labId);

      if (error) throw error;

      alert('✅ Watermark settings saved successfully!\n\nAll new reports will automatically include the watermark.');
    } catch (err) {
      console.error('Error saving watermark settings:', err);
      alert('Failed to save watermark settings. Please try again.');
    } finally {
      setSavingWatermark(false);
    }
  };

  const handleSavePdfSettings = async () => {
    if (!labId) return;

    setSavingPdfSettings(true);
    try {
      const { error } = await supabase
        .from('labs')
        .update({
          pdf_layout_settings: pdfSettings
        })
        .eq('id', labId);

      if (error) throw error;

      alert('✅ PDF settings saved successfully!');
    } catch (err) {
      console.error('Error saving PDF settings:', err);
      alert('Failed to save PDF settings. Please try again.');
    } finally {
      setSavingPdfSettings(false);
    }
  };

  const getProcessingStatusIcon = (status?: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'ready':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getAssetTypeIcon = (type: string) => {
    switch (type) {
      case 'logo':
        return <Image className="w-5 h-5" />;
      case 'header':
      case 'footer':
        return <FileText className="w-5 h-5" />;
      case 'watermark':
        return <Eye className="w-5 h-5" />;
      case 'letterhead':
      case 'front_page':
      case 'last_page':
        return <FileText className="w-5 h-5" />;
      default:
        return <Image className="w-5 h-5" />;
    }
  };

  const groupAssetsByType = (assets: BrandingAsset[]) => {
    return assets.reduce((groups, asset) => {
      if (!groups[asset.asset_type]) {
        groups[asset.asset_type] = [];
      }
      groups[asset.asset_type].push(asset);
      return groups;
    }, {} as Record<string, BrandingAsset[]>);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Loading branding settings...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-center mb-2">
          <AlertTriangle className="w-5 h-5 text-red-500 mr-2" />
          <h3 className="font-semibold text-red-800">Error Loading Branding Settings</h3>
        </div>
        <p className="text-red-700">{error}</p>
        <button
          onClick={loadBrandingData}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const groupedAssets = groupAssetsByType(brandingAssets);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Branding Settings</h1>
          <p className="text-gray-600 mt-1">
            Manage your lab's branding assets and digital signatures
          </p>
        </div>
        <div className="flex gap-2">
          {isPolling && (
            <div className="flex items-center text-sm text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Processing {processingItems.length} item(s)
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'assets', label: 'Branding Assets', icon: Image },
            { id: 'watermark', label: 'Watermark Settings', icon: Eye },
            { id: 'pdf-settings', label: 'PDF Layout', icon: FileText },
            { id: 'signatures', label: 'Digital Signatures', icon: FileText },
            { id: 'preview', label: 'Preview & Export', icon: Eye }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id as any)}
                className={`flex items-center px-1 py-4 border-b-2 font-medium text-sm ${currentTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <Icon className="w-4 h-4 mr-2" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {currentTab === 'assets' && (
        <div className="space-y-6">
          {/* Upload Section */}
          <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-6">
            <div className="text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">Upload New Branding Asset</h3>
              <p className="mt-1 text-sm text-gray-500">
                Upload logos, headers, footers, watermarks, or letterheads
              </p>
              <div className="mt-6 flex gap-2 justify-center flex-wrap">
                {(['logo', 'header', 'footer', 'watermark', 'letterhead', 'front_page', 'last_page'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedAssetType(type);
                      setShowAssetUploader(true);
                    }}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    {getAssetTypeIcon(type)}
                    <span className="ml-2 capitalize">{type}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Assets by Type */}
          {Object.entries(groupedAssets).map(([type, assets]) => (
            <div key={type} className="space-y-4">
              <div className="flex items-center">
                {getAssetTypeIcon(type)}
                <h3 className="ml-2 text-lg font-medium text-gray-900 capitalize">{type}s</h3>
                <span className="ml-2 text-sm text-gray-500">({assets.length})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {assets.map((asset) => (
                  <BrandingAssetCard
                    key={asset.id}
                    asset={asset}
                    onSetDefault={() => handleSetAssetDefault(asset.id)}
                    onDelete={() => handleDeleteAsset(asset.id)}
                    processingStatus={processingItems.find(item =>
                      item.asset_id === asset.id && item.asset_type === 'branding_asset'
                    )?.status}
                  />
                ))}
              </div>
            </div>
          ))}

          {brandingAssets.length === 0 && (
            <div className="text-center py-12">
              <Image className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No branding assets</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by uploading your first asset.</p>
            </div>
          )}
        </div>
      )}

      {currentTab === 'watermark' && (
        <div className="space-y-6">
          {/* Watermark Settings Card */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Automatic Report Watermark</h3>
            <p className="text-sm text-gray-600 mb-6">
              Configure watermark settings to automatically apply to all generated reports. This is faster and more scalable than external API watermarking.
            </p>

            {/* Enable/Disable Toggle */}
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <label className="text-sm font-medium text-gray-900">Enable Watermark</label>
                  <p className="text-xs text-gray-500 mt-1">Apply watermark to all generated reports</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={watermarkEnabled}
                      onChange={(e) => setWatermarkEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                  <span className="text-sm font-medium text-gray-700">
                    {watermarkEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>

              {watermarkEnabled && (
                <>
                  {/* Watermark Image Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-900">Watermark Image</label>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={watermarkImageUrl}
                        onChange={(e) => setWatermarkImageUrl(e.target.value)}
                        placeholder="Enter image URL or select from assets below"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                    </div>
                    {watermarkImageUrl && (
                      <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200">
                        <img
                          src={watermarkImageUrl}
                          alt="Watermark Preview"
                          className="max-h-24 mx-auto"
                          style={{ opacity: watermarkOpacity }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Quick select from existing assets */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-900">Or select from your assets:</label>
                    <div className="grid grid-cols-4 gap-2">
                      {brandingAssets
                        .filter(asset => asset.asset_type === 'watermark' || asset.asset_type === 'logo')
                        .map((asset) => (
                          <button
                            key={asset.id}
                            onClick={() => setWatermarkImageUrl(asset.file_url)}
                            className={`p-2 border-2 rounded-lg hover:border-blue-500 transition ${watermarkImageUrl === asset.file_url ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                              }`}
                          >
                            <img src={asset.file_url} alt={asset.asset_name} className="w-full h-16 object-contain" />
                            <p className="text-xs text-gray-600 mt-1 truncate">{asset.asset_name}</p>
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* Opacity Slider */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-900">
                      Opacity: {(watermarkOpacity * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      value={watermarkOpacity * 100}
                      onChange={(e) => setWatermarkOpacity(parseInt(e.target.value) / 100)}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>5% (Very Light)</span>
                      <span>50% (Visible)</span>
                    </div>
                  </div>

                  {/* Position Selector */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-900">Position</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: 'top-left', label: 'Top Left' },
                        { value: 'center', label: 'Center' },
                        { value: 'top-right', label: 'Top Right' },
                        { value: 'bottom-left', label: 'Bottom Left' },
                        { value: 'repeat', label: 'Repeat' },
                        { value: 'bottom-right', label: 'Bottom Right' }
                      ].map((pos) => (
                        <button
                          key={pos.value}
                          onClick={() => setWatermarkPosition(pos.value as any)}
                          className={`px-3 py-2 text-sm border rounded-md transition ${watermarkPosition === pos.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                            : 'border-gray-300 text-gray-700 hover:border-blue-300'
                            }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Size Selector */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-900">Size</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { value: 'small', label: 'Small (40%)' },
                        { value: 'medium', label: 'Medium (60%)' },
                        { value: 'large', label: 'Large (80%)' },
                        { value: 'full', label: 'Full (100%)' }
                      ].map((size) => (
                        <button
                          key={size.value}
                          onClick={() => setWatermarkSize(size.value as any)}
                          className={`px-3 py-2 text-sm border rounded-md transition ${watermarkSize === size.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                            : 'border-gray-300 text-gray-700 hover:border-blue-300'
                            }`}
                        >
                          {size.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotation Slider */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-900">
                      Rotation: {watermarkRotation}°
                    </label>
                    <input
                      type="range"
                      min="-45"
                      max="45"
                      value={watermarkRotation}
                      onChange={(e) => setWatermarkRotation(parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>-45° (Left)</span>
                      <span>0° (Straight)</span>
                      <span>45° (Right)</span>
                    </div>
                  </div>
                </>
              )}

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-gray-200">
                <button
                  onClick={handleSaveWatermarkSettings}
                  disabled={savingWatermark}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {savingWatermark ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Save Watermark Settings
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-blue-900 mb-1">How Automatic Watermarking Works</h4>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                  <li>Watermark is applied during HTML-to-PDF generation (instant, no delays)</li>
                  <li>No external API calls required (free and scalable)</li>
                  <li>Works offline and handles unlimited reports</li>
                  <li>Settings apply to all templates unless overridden</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {currentTab === 'signatures' && (
        <div className="space-y-6">
          {/* Upload Section */}
          <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-6">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">Add Digital Signature</h3>
              <p className="mt-1 text-sm text-gray-500">
                Upload signature images or create text-based signatures
              </p>
              <div className="mt-6">
                <button
                  onClick={() => setShowSignatureUploader(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Add Signature
                </button>
              </div>
            </div>
          </div>

          {/* Signatures Grid */}
          {userSignatures.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {userSignatures.map((signature) => (
                <SignatureCard
                  key={signature.id}
                  signature={signature}
                  onSetDefault={() => handleSetSignatureDefault(signature.id)}
                  onDelete={() => handleDeleteSignature(signature.id)}
                  processingStatus={processingItems.find(item =>
                    item.asset_id === signature.id && item.asset_type === 'user_signature'
                  )?.status}
                />
              ))}
            </div>
          )}

          {userSignatures.length === 0 && (
            <div className="text-center py-12">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No signatures</h3>
              <p className="mt-1 text-sm text-gray-500">Add your first digital signature to get started.</p>
            </div>
          )}
        </div>
      )}

      {currentTab === 'preview' && (
        <BrandingPreview
          brandingAssets={brandingAssets}
          userSignatures={userSignatures}
        />
      )}

      {currentTab === 'pdf-settings' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">PDF Layout & Colors</h3>
            <p className="text-sm text-gray-600 mb-6">
              Configure global settings for your PDF reports, including result flag colors and layout dimensions.
            </p>

            {/* Result Colors */}
            <div className="border-b border-gray-200 pb-6 mb-6">
              <h4 className="text-md font-medium text-gray-900 mb-3">Result Flag Colors</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <label className="text-sm font-medium text-gray-700">Enable Colored Results</label>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pdfSettings?.resultColors?.enabled ?? true}
                      onChange={(e) => setPdfSettings({
                        ...pdfSettings,
                        resultColors: { ...pdfSettings?.resultColors, enabled: e.target.checked }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">High / Critical</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={pdfSettings?.resultColors?.high || '#dc2626'}
                        onChange={(e) => setPdfSettings({
                          ...pdfSettings,
                          resultColors: { ...pdfSettings?.resultColors, high: e.target.value }
                        })}
                        className="h-8 w-12 p-0 border-0 rounded"
                      />
                      <span className="text-xs text-gray-600">{pdfSettings?.resultColors?.high || '#dc2626'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Low</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={pdfSettings?.resultColors?.low || '#ea580c'}
                        onChange={(e) => setPdfSettings({
                          ...pdfSettings,
                          resultColors: { ...pdfSettings?.resultColors, low: e.target.value }
                        })}
                        className="h-8 w-12 p-0 border-0 rounded"
                      />
                      <span className="text-xs text-gray-600">{pdfSettings?.resultColors?.low || '#ea580c'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Normal</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={pdfSettings?.resultColors?.normal || '#16a34a'}
                        onChange={(e) => setPdfSettings({
                          ...pdfSettings,
                          resultColors: { ...pdfSettings?.resultColors, normal: e.target.value }
                        })}
                        className="h-8 w-12 p-0 border-0 rounded"
                      />
                      <span className="text-xs text-gray-600">{pdfSettings?.resultColors?.normal || '#16a34a'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Header Settings */}
            <div className="border-b border-gray-200 pb-6 mb-6">
              <h4 className="text-md font-medium text-gray-900 mb-3">Header & Footer</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Header Text Color</label>
                  <select
                    value={pdfSettings?.headerTextColor || 'inherit'}
                    onChange={(e) => setPdfSettings({ ...pdfSettings, headerTextColor: e.target.value })}
                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                  >
                    <option value="inherit">Default / Inherit (Recommended)</option>
                    <option value="white">White (For dark letterhead headers)</option>
                    <option value="black">Black</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Header Height (px)</label>
                  <input
                    type="number"
                    value={Math.round(parseInt(String(pdfSettings?.headerHeight || '90')))}
                    onChange={(e) => setPdfSettings({ ...pdfSettings, headerHeight: e.target.value + 'px' })}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Layout Settings */}
            <div>
              <h4 className="text-md font-medium text-gray-900 mb-3">Margins & Dimensions</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Top Margin</label>
                  <input
                    type="text"
                    value={pdfSettings?.margins?.top || '180px'}
                    onChange={(e) => setPdfSettings({
                      ...pdfSettings,
                      margins: { ...pdfSettings?.margins, top: e.target.value }
                    })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Bottom Margin</label>
                  <input
                    type="text"
                    value={pdfSettings?.margins?.bottom || '150px'}
                    onChange={(e) => setPdfSettings({
                      ...pdfSettings,
                      margins: { ...pdfSettings?.margins, bottom: e.target.value }
                    })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Left Margin</label>
                  <input
                    type="text"
                    value={pdfSettings?.margins?.left || '20px'}
                    onChange={(e) => setPdfSettings({
                      ...pdfSettings,
                      margins: { ...pdfSettings?.margins, left: e.target.value }
                    })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Right Margin</label>
                  <input
                    type="text"
                    value={pdfSettings?.margins?.right || '20px'}
                    onChange={(e) => setPdfSettings({
                      ...pdfSettings,
                      margins: { ...pdfSettings?.margins, right: e.target.value }
                    })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-6 mt-6 border-t border-gray-200">
              <button
                onClick={handleSavePdfSettings}
                disabled={savingPdfSettings}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingPdfSettings ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Save PDF Settings
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Upload Modals */}
      {showAssetUploader && labId && (
        <BrandingAssetUploader
          assetType={selectedAssetType}
          labId={labId}
          onSuccess={handleAssetUploaded}
          onClose={() => setShowAssetUploader(false)}
        />
      )}

      {showSignatureUploader && labId && currentUserId && (
        <SignatureUploader
          labId={labId}
          userId={currentUserId}
          onSuccess={handleSignatureUploaded}
          onClose={() => setShowSignatureUploader(false)}
        />
      )}
    </div>
  );
};
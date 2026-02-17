export interface BrandingAsset {
  id: string;
  lab_id: string;
  asset_type: 'header' | 'footer' | 'logo' | 'signature' | 'other';
  url: string;
  name: string;
  is_default: boolean;
}

export interface ReportConfig {
  headerId: string | 'none';
  footerId: string | 'none';
  showAbnormalColors: boolean;
  showSignature: boolean;
  showQrCode: boolean;
  showMethodology: boolean;
  headerHeight: number; // in mm
  footerHeight: number; // in mm
  extraAssets: ExtraAsset[];
}

export interface ExtraAsset {
  id: string;
  assetId: string;
  url: string;
  position: { x: number; y: number }; // Absolute position in mm relative to page top-left
  size: { width: number; height: number }; // in mm
}

export interface ReportData {
  order: any;
  patient: any;
  tests: any[];
  lab: any;
  extras?: any; // Added to support report extras (trends, summary)
}

import { createClient } from '@supabase/supabase-js';
import { generateOrderSampleId, getOrderAssignedColor, generateOrderQRCodeData } from './colorAssignment';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface ReportTemplateContextMeta {
  orderNumber: string;
  orderDate: string | null;
  status: string;
  totalAmount: number | null;
  createdAt: string | null;
  allAnalytesApproved: boolean | null;
}

export interface ReportTemplatePatient {
  name: string;
  displayId: string;
  age: number | null;
  gender: string;
  phone: string;
  dateOfBirth: string | null;
  registrationDate: string | null;
}

export interface ReportTemplateOrder {
  sampleCollectedAt: string | null;
  sampleCollectedBy: string;
  sampleId: string;
  locationId: string;
  locationName: string;
  referringDoctorId: string;
  referringDoctorName: string;
  approvedAt: string | null;
}

export interface ReportTemplateAnalyteRow {
  result_id?: string;
  analyte_id?: string;
  parameter?: string;
  value?: string;
  unit?: string;
  reference_range?: string;
  flag?: string;
  verify_status?: string;
  test_name?: string;
  test_group_id?: string;
}

export interface ReportTemplateContext {
  orderId: string;
  patientId: string | null;
  labId: string | null;
  meta: ReportTemplateContextMeta;
  patient: ReportTemplatePatient;
  order: ReportTemplateOrder;
  analytes: ReportTemplateAnalyteRow[];
  analyteParameters: string[];
  testGroupIds: string[];
  placeholderValues: Record<string, string | number | boolean | null>;
  labBranding?: ReportTemplateLabBranding;
}

export interface ReportTemplateLabBranding {
  defaultHeaderHtml?: string | null;
  defaultFooterHtml?: string | null;
}

// Branding & Signature System Interfaces
export interface LabBrandingAsset {
  id: string;
  lab_id: string;
  asset_type: 'header' | 'footer' | 'watermark' | 'logo' | 'letterhead';
  asset_name: string;
  file_url: string;
  file_path: string;
  file_type: string;
  file_size?: number;
  dimensions?: { width: number; height: number };
  variants?: Record<string, string> | null;
  imagekit_url?: string | null;
  imagekit_file_id?: string | null;
  is_active: boolean;
  is_default: boolean;
  description?: string;
  usage_context?: string[];
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

export interface LabUserSignature {
  id: string;
  lab_id: string;
  user_id: string;
  signature_type: 'digital' | 'handwritten' | 'stamp' | 'text';
  signature_name: string;
  file_url?: string;
  file_path?: string;
  file_type?: string;
  file_size?: number;
  dimensions?: { width: number; height: number };
  variants?: Record<string, string> | null;
  imagekit_url?: string | null;
  imagekit_file_id?: string | null;
  text_signature?: string;
  signature_data?: Record<string, any>;
  is_active: boolean;
  is_default: boolean;
  description?: string;
  usage_context?: string[];
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

export interface LabReportBrandingDefaults {
  labId: string;
  labName?: string | null;
  defaultReportHeaderHtml: string | null;
  defaultReportFooterHtml: string | null;
}

interface LabContactRecord {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  license_number: string | null;
}

type BrandingAssetSnippet = Pick<LabBrandingAsset, 'asset_type' | 'asset_name' | 'description' | 'file_url' | 'imagekit_url' | 'variants'>;

const escapeHtml = (value: string): string => {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return value.replace(/[&<>\"']/g, (char) => map[char] ?? char);
};

const joinDisplayParts = (parts: Array<string | null | undefined>, separator: string): string => {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(separator);
};

const pickAssetPrimaryUrl = (asset?: BrandingAssetSnippet | null): string | null => {
  if (!asset) {
    return null;
  }

  if (asset.imagekit_url && asset.imagekit_url.trim().length > 0) {
    return asset.imagekit_url.trim();
  }

  const variants = asset.variants && typeof asset.variants === 'object' ? asset.variants : null;
  if (variants) {
    const variantKeys = ['optimized', 'optimized_url', 'optimizedUrl', 'default', 'original'];
    for (const key of variantKeys) {
      const candidate = (variants as Record<string, unknown>)[key];
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    for (const value of Object.values(variants)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }

  if (asset.file_url && asset.file_url.trim().length > 0) {
    return asset.file_url.trim();
  }

  return null;
};

const composeHeaderHtml = (lab: LabContactRecord, asset?: BrandingAssetSnippet | null): string => {
  const logoUrl = pickAssetPrimaryUrl(asset);
  const displayName = escapeHtml(lab.name ?? asset?.asset_name ?? 'Laboratory');
  const addressLine = joinDisplayParts(
    [lab.address, lab.city, lab.state, lab.pincode],
    ', '
  );
  const contactLine = joinDisplayParts([lab.phone, lab.email], ' • ');
  const descriptionLine = asset?.description ? escapeHtml(asset.description) : '';

  const addressHtml = addressLine
    ? `<div style="font-size:12px;color:#4b5563;">${escapeHtml(addressLine)}</div>`
    : '';
  const contactHtml = contactLine
    ? `<div style="font-size:12px;color:#4b5563;margin-top:2px;">${escapeHtml(contactLine)}</div>`
    : '';
  const descriptionHtml = descriptionLine
    ? `<div style="font-size:11px;color:#6b7280;margin-top:6px;">${descriptionLine}</div>`
    : '';

  const logoHtml = logoUrl
    ? `<div style="flex:0 0 auto;max-width:220px;display:flex;align-items:center;justify-content:flex-start;">
        <img src="${escapeHtml(logoUrl)}" alt="${displayName} branding" style="max-height:80px;width:auto;object-fit:contain;" />
      </div>`
    : '';

  return `
    <div style="width:100%;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
      ${logoHtml}
      <div style="flex:1 1 auto;text-align:right;">
        <div style="font-size:18px;font-weight:600;color:#111827;">${displayName}</div>
        ${addressHtml}
        ${contactHtml}
        ${descriptionHtml}
      </div>
    </div>
  `.trim();
};

const composeFooterHtml = (lab: LabContactRecord, asset?: BrandingAssetSnippet | null): string => {
  const accentName = escapeHtml(lab.name ?? asset?.asset_name ?? 'Laboratory');
  const addressLine = joinDisplayParts(
    [lab.address, lab.city, lab.state, lab.pincode],
    ', '
  );
  const contactLine = joinDisplayParts([lab.phone, lab.email], ' • ');
  const licenseLine = lab.license_number ? `License: ${escapeHtml(lab.license_number)}` : '';
  const descriptionLine = asset?.description ? escapeHtml(asset.description) : '';
  const logoUrl = pickAssetPrimaryUrl(asset);

  const addressHtml = addressLine
    ? `<div style="margin-top:6px;">${escapeHtml(addressLine)}</div>`
    : '';
  const contactHtml = contactLine
    ? `<div style="margin-top:4px;">${escapeHtml(contactLine)}</div>`
    : '';
  const licenseHtml = licenseLine ? `<div style="margin-top:4px;color:#6b7280;">${licenseLine}</div>` : '';
  const descriptionHtml = descriptionLine
    ? `<div style="margin-top:6px;color:#6b7280;">${descriptionLine}</div>`
    : '';

  const logoHtml = logoUrl
    ? `<div style="flex:0 0 auto;max-width:180px;display:flex;justify-content:flex-end;">
        <img src="${escapeHtml(logoUrl)}" alt="${accentName} seal" style="max-height:70px;width:auto;object-fit:contain;" />
      </div>`
    : '';

  return `
    <div style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:18px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:12px;color:#4b5563;">
      <div style="flex:1 1 auto;line-height:1.45;">
        <div style="font-weight:600;color:#111827;">${accentName}</div>
        ${addressHtml}
        ${contactHtml}
        ${licenseHtml}
        ${descriptionHtml}
      </div>
      ${logoHtml}
    </div>
  `.trim();
};


// File upload utilities
export const uploadFile = async (
  file: File, 
  filePath: string, 
  options?: { upsert?: boolean }
) => {
  const { data, error } = await supabase.storage
    .from('attachments')
    .upload(filePath, file, {
      upsert: options?.upsert || false,
      contentType: file.type
    });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  // Get public URL
  const { data: publicUrlData } = supabase.storage
    .from('attachments')
    .getPublicUrl(data.path);

  return {
    path: data.path,
    publicUrl: publicUrlData.publicUrl,
    fullPath: data.fullPath
  };
};

// Generate organized file path
export const generateFilePath = (
  fileName: string,
  patientId?: string,
  labId?: string,
  category: string = 'general'
): string => {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  
  if (labId && patientId) {
    return `${category}/${labId}/${patientId}_${timestamp}_${sanitizedFileName}`;
  } else if (patientId) {
    return `${category}/${patientId}_${timestamp}_${sanitizedFileName}`;
  } else {
    return `${category}/${timestamp}_${sanitizedFileName}`;
  }
};

// Generate branding asset file path
export const generateBrandingFilePath = (
  labId: string,
  assetType: 'header' | 'footer' | 'watermark' | 'logo' | 'letterhead',
  fileName: string
): string => {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `attachments/labs/${labId}/branding/${assetType}/${timestamp}_${sanitizedFileName}`;
};

// Generate user signature file path
export const generateSignatureFilePath = (
  labId: string,
  userId: string,
  fileName: string
): string => {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `attachments/labs/${labId}/users/${userId}/signature/${timestamp}_${sanitizedFileName}`;
};

// Auth helper functions
export const auth = {
  signUp: async (email: string, password: string, userData?: any) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData
      }
    });
    return { data, error };
  },

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  getCurrentUser: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    return { user, error };
  },

  getSession: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    return { session, error };
  }
};

// Database helper functions for patients
export const database = { 
  // Helper to get current user's lab ID
  getCurrentUserLabId: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      console.error('Error fetching user:', error);
      return null;
    }
    
    // Primary: Check users table for lab_id (most reliable)
    try {
      const { data: userData, error: userDataError } = await supabase
        .from('users')
        .select('lab_id')
        .eq('email', user.email) // Match by email since auth.users.id might be different from public.users.id
        .eq('status', 'Active')
        .single();
      
      if (!userDataError && userData?.lab_id) {
        return userData.lab_id;
      }
    } catch (err) {
      console.warn('Could not fetch lab_id from users table:', err);
    }
    
    // Secondary: Check if lab_id is in user metadata (fallback)
    if (user?.user_metadata?.lab_id) {
      console.warn('Using lab_id from user metadata (consider updating users table):', user.user_metadata.lab_id);
      return user.user_metadata.lab_id;
    }
    
    // Tertiary: Check user_labs table for user-lab assignment (if exists)
    try {
      const { data: userLab, error: userLabError } = await supabase
        .from('user_labs')
        .select('lab_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();
      
      if (!userLabError && userLab?.lab_id) {
        console.warn('Using lab_id from user_labs table (consider updating users table):', userLab.lab_id);
        return userLab.lab_id;
      }
    } catch (err) {
      // user_labs table might not exist, which is fine
    }
    
    // Final fallback: For development/demo purposes, get first available lab
    try {
      const { data: labs, error: labError } = await supabase
        .from('labs')
        .select('id')
        .eq('is_active', true)
        .limit(1);
      
      if (!labError && labs && labs.length > 0) {
        console.warn('Lab ID not found for user. Using first available lab for demo:', labs[0].id);
        console.warn('Please update the users table with proper lab_id for user:', user.email);
        return labs[0].id;
      }
    } catch (err) {
      console.warn('Could not fetch default lab:', err);
    }
    
    console.error('No lab_id found for user and no default lab available');
    return null;
  },


  labs: {
    getBrandingDefaults: async (): Promise<{ data: LabReportBrandingDefaults | null; error: Error | null }> => {
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('labs')
        .select('id, name, default_report_header_html, default_report_footer_html')
        .eq('id', labId)
        .maybeSingle();

      if (error) {
        return { data: null, error };
      }

      if (!data) {
        return { data: null, error: null };
      }

      const payload: LabReportBrandingDefaults = {
        labId: data.id,
        labName: data.name ?? null,
        defaultReportHeaderHtml: data.default_report_header_html ?? null,
        defaultReportFooterHtml: data.default_report_footer_html ?? null,
      };

      return { data: payload, error: null };
    },

    updateBrandingHtmlDefaults: async (
      input: { headerHtml?: string | null; footerHtml?: string | null },
      labIdOverride?: string
    ): Promise<{ data: LabReportBrandingDefaults | null; error: Error | null }> => {
      const labId = labIdOverride || (await database.getCurrentUserLabId());
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const updatePayload: Record<string, string | null> = {};
      if (Object.prototype.hasOwnProperty.call(input, 'headerHtml')) {
        updatePayload.default_report_header_html = input.headerHtml ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'footerHtml')) {
        updatePayload.default_report_footer_html = input.footerHtml ?? null;
      }

      if (Object.keys(updatePayload).length === 0) {
        return { data: null, error: null };
      }

      updatePayload.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('labs')
        .update(updatePayload)
        .eq('id', labId)
        .select('id, name, default_report_header_html, default_report_footer_html')
        .maybeSingle();

      if (error) {
        return { data: null, error };
      }

      if (!data) {
        return { data: null, error: null };
      }

      return {
        data: {
          labId: data.id,
          labName: data.name ?? null,
          defaultReportHeaderHtml: data.default_report_header_html ?? null,
          defaultReportFooterHtml: data.default_report_footer_html ?? null,
        },
        error: null,
      };
    },

    getDefaultApprovalSignature: async (labId: string): Promise<string | null> => {
      try {
        // First try to get from lab's default branding
        const { data: brandingData, error: brandingError } = await supabase
          .from('lab_branding_assets')
          .select('file_url, imagekit_url, processed_url')
          .eq('lab_id', labId)
          .eq('asset_type', 'signature')
          .eq('is_default', true)
          .single();

        if (!brandingError && brandingData) {
          return brandingData.imagekit_url || brandingData.processed_url || brandingData.file_url;
        }

        // Fallback: Get any signature from users in this lab
        const { data: userSignature, error: userError } = await supabase
          .from('lab_user_signatures')
          .select('signature_url, processed_signature_url, imagekit_url')
          .eq('lab_id', labId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (!userError && userSignature) {
          return userSignature.imagekit_url || userSignature.processed_signature_url || userSignature.signature_url;
        }

        return null;
      } catch (error) {
        console.error('Error fetching default approval signature:', error);
        return null;
      }
    }
  },

  auth: {
    getCurrentUser: async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) {
          return { data: null, error };
        }
        return { data: { user }, error: null };
      } catch (error) {
        console.error('Error fetching current user:', error);
        return { data: null, error };
      }
    },

    getCurrentUserWithLab: async (): Promise<{ data: any; error: any }> => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) return { data: null, error: authError };

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select(`
            id,
            email,
            lab_id,
            raw_user_meta_data,
            labs(id, name, code)
          `)
          .eq('email', authData.user.email)
          .eq('status', 'Active')
          .single();

        return { data: userData, error: userError };
      } catch (error) {
        console.error('Error fetching current user with lab:', error);
        return { data: null, error };
      }
    }
  },

  users: {
    getLabUsers: async (labId: string): Promise<{ data: any[]; error: any }> => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select(`
            id,
            email,
            raw_user_meta_data,
            lab_id,
            created_at,
            status,
            lab_user_signatures(
              id,
              signature_url,
              processed_signature_url,
              imagekit_url,
              is_active
            )
          `)
          .eq('lab_id', labId)
          .eq('status', 'Active')
          .order('created_at', { ascending: false });

        return { data: data || [], error };
      } catch (error) {
        console.error('Error fetching lab users:', error);
        return { data: [], error };
      }
    },

    getSignatureByUserId: async (userId: string, labId?: string): Promise<string | null> => {
      try {
        let query = supabase
          .from('lab_user_signatures')
          .select('signature_url, processed_signature_url, imagekit_url')
          .eq('user_id', userId)
          .eq('is_active', true);

        // If labId is provided, filter by it for additional security
        if (labId) {
          query = query.eq('lab_id', labId);
        }

        const { data, error } = await query.single();

        if (error || !data) return null;

        // Prefer processed/imagekit URL, fallback to original
        return data.imagekit_url || data.processed_signature_url || data.signature_url;
      } catch (error) {
        console.error('Error fetching user signature:', error);
        return null;
      }
    }
  },

  aiProtocols: {
    create: async (payload: {
      name: string;
      lab_id: string;
      category: string;
      status: string;
      description?: string | null;
      config?: Record<string, unknown>;
      ui_config?: Record<string, unknown>;
      result_mapping?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase
        .from('ai_protocols')
        .insert({
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      return { data, error };
    },

    update: async (protocolId: string, updates: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from('ai_protocols')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', protocolId)
        .select()
        .single();

      return { data, error };
    },

    getById: async (protocolId: string) => {
      const { data, error } = await supabase
        .from('ai_protocols')
        .select('*')
        .eq('id', protocolId)
        .single();

      return { data, error };
    }
  },

  patients: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('is_active', true)
        .eq('lab_id', lab_id)
        .order('created_at', { ascending: false });
      return { data, error };
    },

    getAllWithTestCounts: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('patients')
        .select(`
          *,
          orders!inner(count)
        `)
        .eq('is_active', true)
        .eq('lab_id', lab_id)
        .order('created_at', { ascending: false });
      // Optionally, transform data here if needed
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('id', id)
        .single();
      return { data, error };
    },

    create: async (patientData: any) => {
      const { requestedTests, referring_doctor, referring_doctor_id, ...patientDetails } = patientData;
      
      // Get current user's lab_id
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      // Get today's date in DD-Mon-YYYY format
      const today = new Date();
      const day = today.getDate().toString().padStart(2, '0');
      const month = today.toLocaleString('en-US', { month: 'short' });
      const year = today.getFullYear();
      const dateFormatted = `${day}-${month}-${year}`;
      
      // Count patients registered today to determine sequential number
      const { count: todayCount, error: countError } = await supabase
        .from('patients')
        .select('id', { count: 'exact', head: true })
        .eq('lab_id', lab_id)
        .gte('created_at', today.toISOString().split('T')[0]);
      
      if (countError) {
        console.error('Error counting today\'s patients:', countError);
        return { data: null, error: countError };
      }
      
      // Calculate sequential number (1-indexed)
      const sequentialNumber = (todayCount || 0) + 1;
      
      // Generate display_id in format DD-Mon-YYYY-SeqNum
      const display_id = `${dateFormatted}-${sequentialNumber}`;
      
      // Create patient with display_id and lab_id
      const { data, error } = await supabase
        .from('patients')
        .insert([{
          ...patientDetails,
          referring_doctor,
          display_id,
          lab_id
        }])
        .select()
        .single();
      
      if (error || !data) {
        return { data, error };
      }

      // Patient created successfully - QR codes and colors are now handled in orders
      // Step 3: Create order if tests were requested
      if (requestedTests && requestedTests.length > 0) {
        try {
          // Get test groups from database to match test names
          const { data: testGroups, error: testGroupsError } = await supabase
            .from('test_groups')
            .select('*');
          
          if (testGroupsError) {
            console.error('Error fetching test groups:', testGroupsError);
          } else {
            // Match requested tests to test groups
            const matchedTests: string[] = [];
            let totalAmount = 0;
            
            requestedTests.forEach((testName: string) => {
              const matchedGroup = testGroups?.find(group => 
                group.name.toLowerCase().includes(testName.toLowerCase()) ||
                testName.toLowerCase().includes(group.name.toLowerCase())
              );
              
              if (matchedGroup) {
                matchedTests.push(matchedGroup.name);
                totalAmount += matchedGroup.price;
              } else {
                // Add unmatched tests as-is for manual review
                matchedTests.push(testName);
                totalAmount += 500; // Default price for unmatched tests
              }
            });
            
            if (matchedTests.length > 0) {
              // Create order for the new patient
              const orderData = {
                patient_name: data.name,
                patient_id: data.id,
                tests: matchedTests,
                status: 'Sample Collection',
                priority: 'Normal',
                order_date: new Date().toISOString().split('T')[0],
                expected_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 2 days from now
                total_amount: totalAmount,
                doctor: referring_doctor || 'Self',
                referring_doctor_id: referring_doctor_id || null,
              };
              
              const { data: orderResult, error: orderError } = await database.orders.create(orderData);

              if (orderError) {
                console.error('Order creation failed:', orderError);
              } else {
                console.log('Order created successfully:', orderResult?.id);
                return {
                  data: {
                    ...data,
                    order_created: true,
                    order_id: orderResult?.id,
                    matched_tests: matchedTests.length,
                    total_tests: requestedTests.length,
                  },
                  error: null,
                };
              }
            }
          }
        } catch (orderCreationError) {
          console.error('Error in order creation process:', orderCreationError);
          // Don't fail patient creation if order creation fails
        }
      }
      
      // Patient created successfully
      return { data: data, error: null };
    },

    update: async (id: string, patientData: any) => {
      const { data, error } = await supabase
        .from('patients')
        .update(patientData)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    delete: async (id: string) => {
      const { error } = await supabase
        .from('patients')
        .update({ is_active: false })
        .eq('id', id);
      return { error };
    }
  },
  
  // Get today's patient count for color assignment
  getTodaysPatientsCount: async () => {
    const today = new Date().toISOString().split('T')[0];
    const { count, error } = await supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', today);
    
    return { count: count || 0, error };
  },
  
  reports: {
    getTemplateContext: async (orderId: string) => {
      if (!orderId) {
        return { data: null, error: new Error('orderId is required') };
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('Failed to load session for template context:', sessionError);
        return { data: null, error: sessionError };
      }

      const accessToken = session?.access_token;
      if (!accessToken) {
        return { data: null, error: new Error('No active session found for current user') };
      }

      let response: Response;
      try {
        response = await fetch('/.netlify/functions/get-template-context', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ orderId }),
        });
      } catch (networkError) {
        console.error('Network error fetching report template context:', networkError);
        return { data: null, error: networkError instanceof Error ? networkError : new Error('Network error') };
      }

      let payload: { success?: boolean; context?: ReportTemplateContext; error?: string } | null = null;
      try {
        payload = (await response.json()) as typeof payload;
      } catch (parseError) {
        console.error('Failed to parse template context response:', parseError);
        return {
          data: null,
          error: new Error('Invalid response from template context endpoint'),
        };
      }

      if (!response.ok) {
        const message = payload?.error || `Template context request failed with status ${response.status}`;
        return { data: null, error: new Error(message) };
      }

      if (!payload?.success) {
        const message = payload?.error || 'Failed to load report context';
        return { data: null, error: new Error(message) };
      }

      const context = payload.context;

      if (!context) {
        return { data: null, error: new Error('No context returned for order') };
      }

      const placeholderValues = context.placeholderValues;
      const normalizedPlaceholderValues: Record<string, string | number | boolean | null> =
        placeholderValues && typeof placeholderValues === 'object' && !Array.isArray(placeholderValues)
          ? (placeholderValues as Record<string, string | number | boolean | null>)
          : {};

      const labBrandingSource = context.labBranding && typeof context.labBranding === 'object' && !Array.isArray(context.labBranding)
        ? (context.labBranding as { defaultHeaderHtml?: unknown; defaultFooterHtml?: unknown })
        : undefined;

      const normalizedLabBranding: ReportTemplateLabBranding | undefined = labBrandingSource
        ? {
            defaultHeaderHtml:
              typeof labBrandingSource.defaultHeaderHtml === 'string'
                ? labBrandingSource.defaultHeaderHtml
                : labBrandingSource.defaultHeaderHtml == null
                  ? null
                  : String(labBrandingSource.defaultHeaderHtml),
            defaultFooterHtml:
              typeof labBrandingSource.defaultFooterHtml === 'string'
                ? labBrandingSource.defaultFooterHtml
                : labBrandingSource.defaultFooterHtml == null
                  ? null
                  : String(labBrandingSource.defaultFooterHtml),
          }
        : undefined;

      const normalized: ReportTemplateContext = {
        ...context,
        orderId: context.orderId ? String(context.orderId) : '',
        patientId: context.patientId ? String(context.patientId) : null,
        labId: context.labId ? String(context.labId) : null,
        analyteParameters: Array.isArray(context.analyteParameters)
          ? context.analyteParameters.map((param) => (param == null ? '' : String(param))).filter((param) => param.length > 0)
          : [],
        testGroupIds: Array.isArray(context.testGroupIds)
          ? context.testGroupIds.map((id) => (id == null ? '' : String(id))).filter((id) => id.length > 0)
          : [],
        analytes: Array.isArray(context.analytes) ? (context.analytes as ReportTemplateAnalyteRow[]) : [],
        placeholderValues: normalizedPlaceholderValues,
        labBranding: normalizedLabBranding,
      };

      return { data: normalized, error: null };
    },

    getAll: async () => {
      const { data, error } = await supabase
        .from('reports')
        .select('id, patient_id, result_id, status, generated_date, doctor, notes, created_at, updated_at, patients(name), results(test_name)')
        .order('generated_date', { ascending: false });
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('id', id)
        .single();
      return { data, error };
    },

    create: async (reportData: any) => {
      const { data, error } = await supabase
        .from('reports')
        .insert([reportData])
        .select()
        .single();
      return { data, error };
    },

    update: async (id: string, reportData: any) => {
      const { data, error } = await supabase
        .from('reports')
        .update(reportData)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    delete: async (id: string) => {
      const { error } = await supabase
        .from('reports')
        .delete()
        .eq('id', id);
      return { error };
    }
  },

  labTemplates: {
    list: async (labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: [], error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('lab_templates')
        .select('*')
        .eq('lab_id', labId)
        .order('template_name', { ascending: true });

      return { data: (data as any[]) || [], error };
    },

    getById: async (templateId: string, labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('lab_templates')
        .select('*')
        .eq('lab_id', labId)
        .eq('id', templateId)
        .single();

      return { data, error };
    },

    create: async (params: {
      labId?: string;
      name: string;
      description?: string | null;
      category?: string | null;
      testGroupId?: string | null;
      project?: any;
      html?: string | null;
      css?: string | null;
      components?: any;
      styles?: any;
      userId?: string | null;
      isDefault?: boolean;
    }) => {
      const labId = params.labId || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const payload = {
        lab_id: labId,
        template_name: params.name,
        template_description: params.description ?? null,
        test_group_id: params.testGroupId ?? null,
        category: params.category ?? 'general',
        gjs_project: params.project ?? null,
        gjs_html: params.html ?? null,
        gjs_css: params.css ?? null,
        gjs_components: params.components ?? null,
        gjs_styles: params.styles ?? null,
        is_default: params.isDefault ?? false,
        created_by: params.userId ?? null,
        updated_by: params.userId ?? null,
      };

      const { data, error } = await supabase
        .from('lab_templates')
        .insert([payload])
        .select('*')
        .single();

      if (error || !data) {
        return { data: null, error };
      }

      await supabase
        .from('lab_template_versions')
        .insert({
          template_id: data.id,
          version_number: 1,
          gjs_project: params.project ?? null,
          gjs_html: params.html ?? null,
          gjs_css: params.css ?? null,
          gjs_components: params.components ?? null,
          gjs_styles: params.styles ?? null,
          created_by: params.userId ?? null,
          version_name: 'Initial',
        });

      return { data, error: null };
    },

    saveProject: async (params: {
      templateId: string;
      labId?: string;
      project: any;
      html?: string | null;
      css?: string | null;
      components?: any;
      styles?: any;
      userId?: string | null;
    }) => {
      const labId = params.labId || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const existing = await supabase
        .from('lab_templates')
        .select('template_version')
        .eq('lab_id', labId)
        .eq('id', params.templateId)
        .single();

      if (existing.error) {
        return { data: null, error: existing.error };
      }

      const currentVersion = (existing.data?.template_version as number | null) ?? 1;
      const nextVersion = currentVersion + 1;

      const { data, error } = await supabase
        .from('lab_templates')
        .update({
          gjs_project: params.project ?? null,
          gjs_html: params.html ?? null,
          gjs_css: params.css ?? null,
          gjs_components: params.components ?? null,
          gjs_styles: params.styles ?? null,
          template_version: nextVersion,
          updated_by: params.userId ?? null,
        })
        .eq('lab_id', labId)
        .eq('id', params.templateId)
        .select('*')
        .single();

      if (error || !data) {
        return { data: null, error };
      }

      await supabase
        .from('lab_template_versions')
        .insert({
          template_id: params.templateId,
          version_number: nextVersion,
          gjs_project: params.project ?? null,
          gjs_html: params.html ?? null,
          gjs_css: params.css ?? null,
          gjs_components: params.components ?? null,
          gjs_styles: params.styles ?? null,
          created_by: params.userId ?? null,
          version_name: `v${nextVersion}`,
        });

      return { data, error: null };
    },

    updateMetadata: async (params: {
      templateId: string;
      labId?: string;
      name?: string;
      description?: string | null;
      category?: string | null;
      testGroupId?: string | null;
      isDefault?: boolean;
      userId?: string | null;
    }) => {
      const labId = params.labId || (await database.getCurrentUserLabId());
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const updates: Record<string, any> = {
        updated_by: params.userId ?? null,
      };

      if (typeof params.name === 'string') {
        updates.template_name = params.name;
      }
      if (params.description !== undefined) {
        updates.template_description = params.description;
      }
      if (params.category !== undefined) {
        updates.category = params.category ?? null;
      }
      if (params.testGroupId !== undefined) {
        updates.test_group_id = params.testGroupId ?? null;
      }
      if (typeof params.isDefault === 'boolean') {
        updates.is_default = params.isDefault;
      }

      const { data, error } = await supabase
        .from('lab_templates')
        .update(updates)
        .eq('lab_id', labId)
        .eq('id', params.templateId)
        .select('*')
        .single();

      return { data, error };
    },

    updateVerification: async (params: {
      templateId: string;
      labId?: string;
      status: string;
      summary?: string | null;
      details?: Record<string, any> | null;
      checkedAt?: string;
      userId?: string | null;
    }) => {
      const labId = params.labId || (await database.getCurrentUserLabId());
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const updates: Record<string, any> = {
        ai_verification_status: params.status,
        ai_verification_summary: params.summary ?? null,
        ai_verification_details: params.details ?? null,
        ai_verification_checked_at: params.checkedAt ?? new Date().toISOString(),
        updated_by: params.userId ?? null,
      };

      const { data, error } = await supabase
        .from('lab_templates')
        .update(updates)
        .eq('lab_id', labId)
        .eq('id', params.templateId)
        .select('*')
        .single();

      return { data, error };
    },

    delete: async (templateId: string, labIdOverride?: string) => {
      const labId = labIdOverride || (await database.getCurrentUserLabId());
      if (!labId) {
        return { error: new Error('No lab_id found for current user') };
      }

      // Delete template versions first (foreign key constraint)
      const { error: versionsError } = await supabase
        .from('lab_template_versions')
        .delete()
        .eq('template_id', templateId);

      if (versionsError) {
        return { error: versionsError };
      }

      // Delete the main template
      const { error } = await supabase
        .from('lab_templates')
        .delete()
        .eq('lab_id', labId)
        .eq('id', templateId);

      return { error };
    },
  },

  templateParameters: {
    listLabParameters: async (labIdOverride?: string) => {
      const labId = labIdOverride || (await database.getCurrentUserLabId());
      if (!labId) {
        return { data: [], error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('lab_analytes')
        .select(
          `
            id,
            analyte_id,
            lab_specific_name,
            lab_specific_unit,
            lab_specific_reference_range,
            lab_specific_interpretation_low,
            lab_specific_interpretation_normal,
            lab_specific_interpretation_high,
            name,
            unit,
            reference_range,
            interpretation_low,
            interpretation_normal,
            interpretation_high,
            analytes:analytes!inner ( id, name, unit, reference_range )
          `
        )
        .eq('lab_id', labId)
        .eq('is_active', true)
        .eq('visible', true)
  .order('lab_specific_name', { ascending: true, nullsFirst: false })
  .order('name', { ascending: true, nullsFirst: false });

      if (error) {
        return { data: [], error };
      }

      const mapped = (data || []).map((row: any) => {
        const baseAnalyte = row.analytes || {};
        const label = (row.lab_specific_name || row.name || baseAnalyte.name || 'Analyte').trim();
        const slug = label.replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, '');

        return {
          id: row.analyte_id || row.id || baseAnalyte.id,
          label,
          placeholder: `{{${slug || 'Analyte'}}}`,
          unit: row.lab_specific_unit || row.unit || baseAnalyte.unit || null,
          referenceRange:
            row.lab_specific_reference_range ||
            row.reference_range ||
            baseAnalyte.reference_range ||
            null,
        };
      });

      return { data: mapped, error: null };
    },

    listTestGroupParameters: async (testGroupId: string) => {
      if (!testGroupId) {
        return { data: [], error: new Error('testGroupId is required') };
      }

      const { data, error } = await supabase
        .from('test_group_analytes')
        .select(
          `analyte_id,
           analytes ( id, name, unit, reference_range )`
        )
        .eq('test_group_id', testGroupId)
        .order('created_at', { ascending: true });

      if (error) {
        return { data: [], error };
      }

      const mapped = (data || []).map((row: any) => {
        const analyte = row.analytes || {};
        const label = analyte.name || 'Unnamed Analyte';
        const baseSlug = label
          .replace(/[^a-zA-Z0-9]+/g, ' ')
          .trim()
          .replace(/\s+/g, '');
        const finalSlug = baseSlug.replace(/^(\d+)/, 'n$1');
        return {
          id: analyte.id || row.analyte_id,
          label,
          placeholder: `{{${finalSlug}}}`,
          unit: analyte.unit || null,
          referenceRange: analyte.reference_range || null,
        };
      });

      return { data: mapped, error: null };
    },

    listPatientParameters: async (patientId: string) => {
      if (!patientId) {
        return { data: [], error: new Error('patientId is required') };
      }

      const { data, error } = await supabase
        .from('patients')
        .select(`
          id,
          name,
          gender,
          date_of_birth,
          default_doctor_id,
          default_location_id
        `)
        .eq('id', patientId)
        .single();

      if (error || !data) {
        return { data: [], error: error || new Error('Patient not found') };
      }

      const placeholders = [
        { key: 'patientName', label: 'Patient Name', value: data.name || '' },
        { key: 'patientGender', label: 'Patient Gender', value: data.gender || '' },
        { key: 'patientDOB', label: 'Patient Date of Birth', value: data.date_of_birth || '' },
        { key: 'patientId', label: 'Patient ID', value: data.id },
      ];

      const mapped = placeholders.map((item) => ({
        id: item.key,
        label: item.label,
        placeholder: `{{${item.key}}}`,
        value: item.value,
      }));

      return { data: mapped, error: null };
    },
  },
  
  orders: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          patients(name, age, gender),
          order_tests(test_name, created_at),
          results(id, status, result_values(parameter, value, unit, reference_range, flag))
        `)
        .eq('lab_id', lab_id)
        .order('order_date', { ascending: false });
      
      if (error || !data) return { data, error };
      
      // Sort order_tests by creation date (newest first) for each order
      data.forEach((order: any) => {
        if (order.order_tests && order.order_tests.length > 0) {
          order.order_tests.sort((a: any, b: any) => {
            const dateA = new Date(a.created_at || new Date());
            const dateB = new Date(b.created_at || new Date());
            return dateB.getTime() - dateA.getTime();
          });
        }
      });
      
      // Manually fetch attachments for each order
      const ordersWithAttachments = await Promise.all(
        data.map(async (order) => {
          const { data: orderAttachments } = await supabase
            .from('attachments')
            .select('id, file_url, original_filename, file_type')
            .eq('related_table', 'orders')
            .eq('related_id', order.id);
          
          return {
            ...order,
            attachments: orderAttachments || []
          };
        })
      );
      
      return { data: ordersWithAttachments, error: null };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_tests(*, created_at)
        `)
        .eq('id', id)
        .single();
      
      // Sort order_tests by creation date (newest first) if data exists
      if (data && data.order_tests) {
        data.order_tests.sort((a: any, b: any) => {
          const dateA = new Date(a.created_at || a.created_at);
          const dateB = new Date(b.created_at || b.created_at);
          return dateB.getTime() - dateA.getTime();
        });
      }
      
      return { data, error };
    },

    create: async (orderData: any) => {
      // Get current user's lab_id
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      // Get current auth user id for created_by
      const { data: auth } = await supabase.auth.getUser();
      const authUserId = auth?.user?.id || null;
      
      // First get the daily sequence for sample ID generation
      const orderDate = orderData.order_date || new Date().toISOString().split('T')[0];
      
      // Count existing orders for this date to get sequence number (filtered by lab_id)
      const { count: dailyOrderCount, error: countError } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('lab_id', lab_id)
        .gte('order_date', orderDate)
        .lt('order_date', new Date(new Date(orderDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      
      if (countError) {
        console.error('Error counting daily orders:', countError);
        return { data: null, error: countError };
      }
      
      const dailySequence = (dailyOrderCount || 0) + 1;
      
      // Generate sample tracking data for this order
      const sampleId = generateOrderSampleId(new Date(orderDate), dailySequence);
      const { color_code, color_name } = getOrderAssignedColor(dailySequence);
      
      // Create the order with sample tracking data and lab_id
      const { tests, ...orderDetails } = orderData;
      const orderWithSample = {
        ...orderDetails,
        sample_id: sampleId,
        color_code,
        color_name,
        lab_id,
        created_by: orderDetails?.created_by ?? authUserId,
        status: orderData.status || 'Order Created' // Default status
      };
      
      const { data: order, error } = await supabase
        .from('orders')
        .insert([orderWithSample])
        .select()
        .single();

      if (error) {
        return { data: null, error };
      }

      // Generate QR code data with the created order ID
      const qrCodeData = generateOrderQRCodeData({
        id: order.id,
        patientId: order.patient_id,
        sampleId: order.sample_id,
        orderDate: order.order_date,
        colorCode: order.color_code,
        colorName: order.color_name,
        patientName: order.patient_name
      });

      // Update order with QR code data
      const { data: updatedOrder, error: updateError } = await supabase
        .from('orders')
        .update({ qr_code_data: qrCodeData })
        .eq('id', order.id)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating order with QR code:', updateError);
        return { data: order, error: updateError };
      }

      // Then create the associated tests only if there are tests to create
      if (updatedOrder && tests && Array.isArray(tests) && tests.length > 0) {
        let orderTestsData: any[] = [];
        
        // Handle both string array (legacy) and object array (new format)
        if (typeof tests[0] === 'string') {
          // Legacy format - lookup test_group_ids from test_groups table
          const validTestNames = tests.filter(test => test && typeof test === 'string' && test.trim() !== '');
          
          if (validTestNames.length > 0) {
            const { data: testGroups, error: testGroupError } = await supabase
              .from('test_groups')
              .select('id, name')
              .in('name', validTestNames);
            
            if (testGroupError) {
              console.error('Error fetching test groups:', testGroupError);
            }
            
            // Create a map of test name to test_group_id
            const testGroupMap = new Map<string, string>();
            (testGroups || []).forEach(tg => {
              testGroupMap.set(tg.name, tg.id);
            });
            
            orderTestsData = validTestNames.map(testName => ({
              order_id: updatedOrder.id,
              test_name: testName,
              test_group_id: testGroupMap.get(testName) || null,
              sample_id: updatedOrder.sample_id,
              lab_id
            }));
          }
        } else {
          // New format - tests are objects with id and name
          const validTestObjects = tests.filter(test => 
            test && 
            typeof test === 'object' && 
            test.name && 
            test.name.trim() !== ''
          );
          
          orderTestsData = validTestObjects.map(test => ({
            order_id: updatedOrder.id,
            test_name: test.name,
            test_group_id: test.type === 'test' ? test.id : null, // Only include test_group_id for individual tests, not packages
            sample_id: updatedOrder.sample_id,
            lab_id
          }));
        }
        
        if (orderTestsData.length > 0) {
          console.log('Creating order_tests with test_group_ids:', orderTestsData);
          
          const { error: orderTestsError } = await supabase
            .from('order_tests')
            .insert(orderTestsData);
          
          if (orderTestsError) {
            console.error('Error creating order tests:', orderTestsError);
            return { data: updatedOrder, error: orderTestsError };
          }
          
          console.log(`✅ Created ${orderTestsData.length} order test records with proper test_group_ids`);
        }
      }

      return { data: { ...updatedOrder, tests: tests || [] }, error: null };
    },

    update: async (id: string, orderData: any) => {
      const { data, error } = await supabase
        .from('orders')
        .update(orderData)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    // NEW: Sample collection methods
    markSampleCollected: async (orderId: string, collectedBy?: string) => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const collectorName = collectedBy || auth?.user?.user_metadata?.full_name || auth?.user?.email || 'Unknown User';
        
        const { data, error } = await supabase
          .from('orders')
          .update({
            sample_collected_at: new Date().toISOString(),
            sample_collected_by: collectorName,
            status: 'Sample Collection',
            status_updated_at: new Date().toISOString(),
            status_updated_by: collectorName
          })
          .eq('id', orderId)
          .select()
          .single();
        
        if (error) {
          console.error('Error marking sample as collected:', error);
          return { data: null, error };
        }
        
        console.log('Sample marked as collected successfully:', data);
        return { data, error: null };
      } catch (err) {
        console.error('Error in markSampleCollected:', err);
        return { data: null, error: err };
      }
    },

    markSampleNotCollected: async (orderId: string) => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const updaterName = auth?.user?.user_metadata?.full_name || auth?.user?.email || 'Unknown User';
        
        const { data, error } = await supabase
          .from('orders')
          .update({
            sample_collected_at: null,
            sample_collected_by: null,
            status: 'Order Created',
            status_updated_at: new Date().toISOString(),
            status_updated_by: updaterName
          })
          .eq('id', orderId)
          .select()
          .single();
        
        if (error) {
          console.error('Error marking sample as not collected:', error);
          return { data: null, error };
        }
        
        console.log('Sample marked as not collected successfully:', data);
        return { data, error: null };
      } catch (err) {
        console.error('Error in markSampleNotCollected:', err);
        return { data: null, error: err };
      }
    },

    updateStatus: async (orderId: string, newStatus: string, updatedBy?: string) => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const updaterName = updatedBy || auth?.user?.user_metadata?.full_name || auth?.user?.email || 'Unknown User';
        
        const { data, error } = await supabase
          .from('orders')
          .update({
            status: newStatus,
            status_updated_at: new Date().toISOString(),
            status_updated_by: updaterName
          })
          .eq('id', orderId)
          .select()
          .single();
        
        if (error) {
          console.error('Error updating order status:', error);
          return { data: null, error };
        }
        
        console.log('Order status updated successfully:', data);
        return { data, error: null };
      } catch (err) {
        console.error('Error in updateStatus:', err);
        return { data: null, error: err };
      }
    },
    delete: async (id: string) => {
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', id);
      return { error };
    },

    // Auto-update order status based on results
    checkAndUpdateStatus: async (orderId: string) => {
      try {
        // Get order with tests and results
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select(`
            *,
            order_tests(test_name),
            results(id, status, result_values(id))
          `)
          .eq('id', orderId)
          .single();

        if (orderError || !order) {
          console.error('Error fetching order for status check:', orderError);
          return { data: null, error: orderError };
        }

        const totalTests = order.order_tests?.length || 0;
        const results = order.results || [];
        
        // Count results by status
        const resultsWithValues = results.filter((r: any) => r.result_values && r.result_values.length > 0);
        const approvedResults = results.filter((r: any) => r.status === 'Approved');
        
        let newStatus = order.status;
        
        // Determine new status based on completion
        if (order.status === 'In Progress') {
          // If all tests have results submitted, move to Pending Approval
          if (resultsWithValues.length >= totalTests && totalTests > 0) {
            newStatus = 'Pending Approval';
          }
        } else if (order.status === 'Pending Approval') {
          // If all results are approved, move to Completed
          if (approvedResults.length >= totalTests && totalTests > 0) {
            newStatus = 'Completed';
          }
        }

        // Update status if it changed
        if (newStatus !== order.status) {
          const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update({ 
              status: newStatus,
              status_updated_at: new Date().toISOString(),
              status_updated_by: 'System (Auto)'
            })
            .eq('id', orderId)
            .select()
            .single();

          if (updateError) {
            console.error('Error updating order status:', updateError);
            return { data: null, error: updateError };
          }

          console.log(`Order ${orderId} status automatically updated from "${order.status}" to "${newStatus}"`);
          return { data: { ...updatedOrder, statusChanged: true, previousStatus: order.status }, error: null };
        }

        return { data: { ...order, statusChanged: false }, error: null };
      } catch (error) {
        console.error('Error in checkAndUpdateStatus:', error);
        return { data: null, error };
      }
    },

    // Mark order as delivered (manual trigger)
    markAsDelivered: async (orderId: string, deliveredBy?: string) => {
      try {
        const { data: updatedOrder, error } = await supabase
          .from('orders')
          .update({ 
            status: 'Delivered',
            delivered_at: new Date().toISOString(),
            delivered_by: deliveredBy || 'System',
            status_updated_at: new Date().toISOString(),
            status_updated_by: deliveredBy || 'System'
          })
          .eq('id', orderId)
          .select()
          .single();

        if (error) {
          console.error('Error marking order as delivered:', error);
          return { data: null, error };
        }

        console.log(`Order ${orderId} marked as delivered`);
        return { data: updatedOrder, error: null };
      } catch (error) {
        console.error('Error in markAsDelivered:', error);
        return { data: null, error };
      }
    }
  },
  
  results: {
    getAll: async () => {
      const { data, error } = await supabase
        .from('results')
        .select(`
          *, 
          result_values(*), 
          attachment_id, 
          extracted_by_ai, 
          ai_confidence, 
          manually_verified, 
          ai_extraction_metadata
        `) // Include AI and attachment columns
        .order('entered_date', { ascending: false });
      
      if (error || !data) {
        return { data, error };
      }

      // For each result, if it doesn't have a direct attachment_id, 
      // check for attachments linked to its order
      const enrichedData = await Promise.all(
        data.map(async (result) => {
          if (!result.attachment_id && result.order_id) {
            // Look for attachments linked to this order
            const { data: orderAttachments } = await supabase
              .from('attachments')
              .select('id, file_url, description, original_filename')
              .eq('related_table', 'orders')
              .eq('related_id', result.order_id)
              .order('created_at', { ascending: false })
              .limit(1);
            
            if (orderAttachments && orderAttachments.length > 0) {
              return {
                ...result,
                attachment_id: orderAttachments[0].id,
                attachment_info: orderAttachments[0]
              };
            }
          }
          return result;
        })
      );

      return { data: enrichedData, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('results')
        .select('*, result_values(*), attachment_id, extracted_by_ai, ai_confidence, manually_verified, ai_extraction_metadata')
        .eq('id', id)
        .single();
      
      if (error || !data) {
        return { data, error };
      }

      // If no direct attachment_id, check for attachments linked to the order
      if (!data.attachment_id && data.order_id) {
        const { data: orderAttachments } = await supabase
          .from('attachments')
          .select('id, file_url, description, original_filename')
          .eq('related_table', 'orders')
          .eq('related_id', data.order_id)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (orderAttachments && orderAttachments.length > 0) {
          return {
            data: {
              ...data,
              attachment_id: orderAttachments[0].id,
              attachment_info: orderAttachments[0]
            },
            error: null
          };
        }
      }

      return { data, error };
    },

    getByOrderId: async (orderId: string) => {
      const { data, error } = await supabase
        .from('results')
        .select('*, result_values(*), attachment_id, extracted_by_ai, ai_confidence, manually_verified, ai_extraction_metadata')
        .eq('order_id', orderId)
        .order('entered_date', { ascending: false });
      
      if (error || !data) {
        return { data, error };
      }

      // For each result, if it doesn't have a direct attachment_id, 
      // check for attachments linked to this order
      const enrichedData = await Promise.all(
        data.map(async (result) => {
          if (!result.attachment_id) {
            // Look for attachments linked to this order
            const { data: orderAttachments } = await supabase
              .from('attachments')
              .select('id, file_url, description, original_filename')
              .eq('related_table', 'orders')
              .eq('related_id', orderId)
              .order('created_at', { ascending: false })
              .limit(1);
            
            if (orderAttachments && orderAttachments.length > 0) {
              return {
                ...result,
                attachment_id: orderAttachments[0].id,
                attachment_info: orderAttachments[0]
              };
            }
          }
          return result;
        })
      );

      return { data: enrichedData, error };
    },
    create: async (resultData: any) => {
      const { values, ...rest } = resultData; // Separate values array
      const { data: result, error } = await supabase
        .from('results')
        .insert([rest]) // This will now include attachment_id and AI fields if provided
        .select()
        .single();

      if (error) {
        return { data: null, error };
      }

      if (result && values && values.length > 0) {
        // First, get all analytes to map parameter names to analyte_ids
        const { data: analytes, error: analytesError } = await supabase
          .from('analytes')
          .select('id, name');
        
        if (analytesError) {
          console.error('Error fetching analytes:', analytesError);
          return { data: null, error: analytesError };
        }

        // Create a map of analyte names to IDs
        const analyteMap = new Map(analytes?.map(a => [a.name, a.id]) || []);

        const resultValuesToInsert = values.map((val: any) => ({
          result_id: result.id,
          order_id: result.order_id, // Add order_id for trigger compatibility
          analyte_id: analyteMap.get(val.parameter) || null, // Map parameter name to analyte_id
          parameter: val.parameter, // Keep parameter name as well
          value: val.value,
          unit: val.unit,
          reference_range: val.reference_range,
          flag: val.flag,
        }));
        
        const { error: valuesError } = await supabase
          .from('result_values')
          .insert(resultValuesToInsert);

        if (valuesError) {
          // Optionally, handle rollback of the result if result_values insertion fails
          console.error('Error inserting result values:', valuesError);
          return { data: null, error: valuesError };
        }
      }

      // Auto-update order status after result creation
      if (result.order_id) {
        await database.orders.checkAndUpdateStatus(result.order_id);
      }

      return { data: result, error: null };
    },

    update: async (id: string, resultData: any) => {
      const { values, ...rest } = resultData; // Separate values array from main result data
      
      // First update the main result record
      const { data: result, error } = await supabase
        .from('results')
        .update(rest)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return { data: null, error };
      }

      // If values are provided, update the result_values table
      if (result && values && values.length > 0) {
        // First delete existing result_values for this result
        const { error: deleteError } = await supabase
          .from('result_values')
          .delete()
          .eq('result_id', id);

        if (deleteError) {
          console.error('Error deleting existing result values:', deleteError);
          return { data: null, error: deleteError };
        }

        // Then insert the new result_values
        // First, get all analytes to map parameter names to analyte_ids
        const { data: analytes, error: analytesError } = await supabase
          .from('analytes')
          .select('id, name');
        
        if (analytesError) {
          console.error('Error fetching analytes:', analytesError);
          return { data: null, error: analytesError };
        }

        // Create a map of analyte names to IDs
        const analyteMap = new Map(analytes?.map(a => [a.name, a.id]) || []);

        const resultValuesToInsert = values.map((val: any) => ({
          result_id: id,
          order_id: result.order_id, // Add order_id for trigger compatibility
          analyte_id: analyteMap.get(val.parameter) || null, // Map parameter name to analyte_id
          parameter: val.parameter, // Keep parameter name as well
          value: val.value,
          unit: val.unit,
          reference_range: val.reference_range,
          flag: val.flag,
        }));
        
        const { error: valuesError } = await supabase
          .from('result_values')
          .insert(resultValuesToInsert);

        if (valuesError) {
          console.error('Error inserting updated result values:', valuesError);
          return { data: null, error: valuesError };
        }
      }

      // Auto-update order status after result update (especially for approval)
      if (result.order_id) {
        await database.orders.checkAndUpdateStatus(result.order_id);
      }
      
      return { data: result, error: null };
    },

    delete: async (id: string) => {
      const { error } = await supabase
        .from('results')
        .delete()
        .eq('id', id);
      return { error };
    },

    getByPatientId: async (patientId: string) => {
      const { data, error } = await supabase
        .from('results')
        .select('*, result_values(*), attachment_id, extracted_by_ai, ai_confidence, manually_verified, ai_extraction_metadata')
        .eq('patient_id', patientId)
        .order('entered_date', { ascending: false });
      
      if (error || !data) {
        return { data, error };
      }

      // For each result, if it doesn't have a direct attachment_id, 
      // check for attachments linked to its order
      const enrichedData = await Promise.all(
        data.map(async (result) => {
          if (!result.attachment_id && result.order_id) {
            // Look for attachments linked to this order
            const { data: orderAttachments } = await supabase
              .from('attachments')
              .select('id, file_url, description, original_filename')
              .eq('related_table', 'orders')
              .eq('related_id', result.order_id)
              .order('created_at', { ascending: false })
              .limit(1);
            
            if (orderAttachments && orderAttachments.length > 0) {
              return {
                ...result,
                attachment_id: orderAttachments[0].id,
                attachment_info: orderAttachments[0]
              };
            }
          }
          return result;
        })
      );

      return { data: enrichedData, error };
    },

    // New function to get results by attachment ID
    getByAttachmentId: async (attachmentId: string) => {
      const { data, error } = await supabase
        .from('results')
        .select('*, result_values(*), attachment_id, extracted_by_ai, ai_confidence, manually_verified, ai_extraction_metadata')
        .eq('attachment_id', attachmentId)
        .order('entered_date', { ascending: false });
      return { data, error };
    }
  },

  resultValues: {
    updateVerificationStatus: async (resultValueIds: string[], status: 'approved' | 'rejected' | 'pending', note?: string): Promise<{ data: any; error: any }> => {
      try {
        // Get current user
        const { data: currentUser } = await database.auth.getCurrentUser();
        if (!currentUser?.user) {
          throw new Error('User not authenticated');
        }

        const updateData: any = {
          verify_status: status,
          verified: status === 'approved',
          verified_by: currentUser.user.id,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        if (note) {
          updateData.verify_note = note;
        }

        const { data, error } = await supabase
          .from('result_values')
          .update(updateData)
          .in('id', resultValueIds)
          .select(`
            id,
            verify_status,
            verified_by,
            verified_at,
            order_id,
            users:verified_by(id, email, raw_user_meta_data, lab_id)
          `);

        // Log the verification event if we have workflow support
        if (!error && data && data.length > 0) {
          try {
            await database.workflows?.logStepEvent({
              order_id: data[0]?.order_id || '',
              step_name: 'result_verification',
              user_id: currentUser.user.id,
              event_data: {
                result_value_ids: resultValueIds,
                status,
                note
              }
            });
          } catch (workflowError) {
            console.warn('Could not log workflow event:', workflowError);
            // Don't fail the main operation if workflow logging fails
          }
        }

        return { data, error };
      } catch (error) {
        console.error('Error updating verification status:', error);
        return { data: null, error };
      }
    },

    bulkApprove: async (resultValueIds: string[], note?: string): Promise<{ data: any; error: any }> => {
      return database.resultValues.updateVerificationStatus(resultValueIds, 'approved', note);
    },

    bulkReject: async (resultValueIds: string[], note?: string): Promise<{ data: any; error: any }> => {
      return database.resultValues.updateVerificationStatus(resultValueIds, 'rejected', note);
    },

    getVerifierSignature: async (resultValueId: string): Promise<string | null> => {
      try {
        const { data, error } = await supabase
          .from('result_values')
          .select(`
            verified_by,
            lab_id,
            users:verified_by(
              id,
              lab_id,
              lab_user_signatures(
                signature_url,
                processed_signature_url,
                imagekit_url,
                is_active
              )
            )
          `)
          .eq('id', resultValueId)
          .eq('verify_status', 'approved')
          .single();

        if (error || !data?.verified_by || !data.users?.lab_user_signatures?.length) {
          return null;
        }

        // Get the active signature for this user
        const signature = data.users.lab_user_signatures.find((sig: any) => sig.is_active);
        if (!signature) return null;

        // Return best available URL
        return signature.imagekit_url || signature.processed_signature_url || signature.signature_url;
      } catch (error) {
        console.error('Error fetching verifier signature:', error);
        return null;
      }
    },

    getApproverInfo: async (resultId: string): Promise<{ userId: string; labId: string } | null> => {
      try {
        const { data, error } = await supabase
          .from('result_values')
          .select(`
            verified_by,
            lab_id,
            users:verified_by(id, email, lab_id)
          `)
          .eq('result_id', resultId)
          .eq('verify_status', 'approved')
          .single();

        if (error || !data?.verified_by) return null;

        return {
          userId: data.verified_by,
          labId: data.lab_id || data.users?.lab_id
        };
      } catch (error) {
        console.error('Error fetching approver info:', error);
        return null;
      }
    },

    getPendingForLab: async (labId: string): Promise<{ data: any[]; error: any }> => {
      try {
        const { data, error } = await supabase
          .from('result_values')
          .select(`
            id,
            parameter,
            value,
            verify_status,
            verified_by,
            verified_at,
            order_id,
            result_id,
            lab_id,
            orders(id, order_number, patient_id, patients(name)),
            users:verified_by(email, raw_user_meta_data)
          `)
          .eq('lab_id', labId)
          .in('verify_status', ['pending', 'rejected'])
          .order('created_at', { ascending: false });

        return { data: data || [], error };
      } catch (error) {
        console.error('Error fetching pending results:', error);
        return { data: [], error };
      }
    }
  },



  invoices: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      // Query invoices with basic data
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          invoice_items(*)
        `)
        .eq('lab_id', lab_id)
        .order('invoice_date', { ascending: false });
      
      if (error) {
        return { data: null, error };
      }
      
      // Add paid_amount = 0 to all invoices (will be calculated by payments functionality later)
      const invoicesWithPayments = (data || []).map(invoice => ({
        ...invoice,
        paid_amount: 0,
        payment_status: invoice.status
      }));
      
      return { data: invoicesWithPayments, error: null };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          invoice_items(*)
        `)
        .eq('id', id)
        .single();
      return { data, error };
    },

    create: async (invoiceData: any) => {
      const { invoice_items, ...invoiceDetails } = invoiceData;
      
      // Get current user's lab_id
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      // First create the invoice with lab_id
      const { data: invoice, error } = await supabase
        .from('invoices')
        .insert([{ ...invoiceDetails, lab_id }])
        .select()
        .single();

      if (error) {
        return { data: null, error };
      }

      // Then create the associated invoice items
      if (invoice && invoice_items && invoice_items.length > 0) {
        const invoiceItemsToInsert = invoice_items.map((item: any) => ({
          ...item,
          invoice_id: invoice.id,
          lab_id
        }));

        const { error: itemsError } = await supabase
          .from('invoice_items')
          .insert(invoiceItemsToInsert);

        if (itemsError) {
          console.error('Error inserting invoice items:', itemsError);
          return { data: invoice, error: itemsError };
        }
      }

      return { data: { ...invoice, invoice_items }, error: null };
    },

    update: async (id: string, invoiceData: any) => {
      const { data, error } = await supabase
        .from('invoices')
        .update(invoiceData)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    delete: async (id: string) => {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', id);
      return { error };
    },

    // NEW: Dual invoice system methods
    getUnbilledByAccount: async (accountId: string, billingPeriod?: string) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      let query = supabase
        .from('invoices')
        .select(`
          *,
          invoice_items(*)
        `)
        .eq('lab_id', lab_id)
        .eq('account_id', accountId)
        .eq('invoice_type', 'account')
        .is('consolidated_invoice_id', null); // Not yet consolidated

      if (billingPeriod) {
        query = query.eq('billing_period', billingPeriod);
      }

      const { data, error } = await query.order('invoice_date', { ascending: false });
      return { data, error };
    },

    getByBillingPeriod: async (billingPeriod: string) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          invoice_items(*),
          accounts(name)
        `)
        .eq('lab_id', lab_id)
        .eq('billing_period', billingPeriod)
        .order('account_id')
        .order('invoice_date', { ascending: false });
      
      return { data, error };
    },

    markAsConsolidated: async (invoiceIds: string[], consolidatedInvoiceId: string) => {
      const { data, error } = await supabase
        .from('invoices')
        .update({ consolidated_invoice_id: consolidatedInvoiceId })
        .in('id', invoiceIds)
        .select();
      
      return { data, error };
    },

    getByOrderId: async (orderId: string) => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          invoice_items(*)
        `)
        .eq('order_id', orderId)
        .order('invoice_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      return { data, error };
    }
  },

  // NEW: Consolidated invoices methods
  consolidatedInvoices: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('consolidated_invoices')
        .select(`
          *,
          accounts(name)
        `)
        .eq('lab_id', lab_id)
        .order('invoice_date', { ascending: false });
      
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('consolidated_invoices')
        .select(`
          *,
          accounts(name)
        `)
        .eq('id', id)
        .single();
      
      return { data, error };
    },

    create: async (consolidatedData: any) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('consolidated_invoices')
        .insert([{ ...consolidatedData, lab_id }])
        .select()
        .single();
      
      return { data, error };
    },

    update: async (id: string, updates: any) => {
      const { data, error } = await supabase
        .from('consolidated_invoices')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      return { data, error };
    },

    getByAccount: async (accountId: string) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('consolidated_invoices')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('account_id', accountId)
        .order('billing_period', { ascending: false });
      
      return { data, error };
    }
  },
  
  invoice_items: {
    create: async (items: any[]) => {
      const { data, error } = await supabase
        .from('invoice_items')
        .insert(items)
        .select();
      return { data, error };
    },
    
    update: async (id: string, itemData: any) => {
      const { data, error } = await supabase
        .from('invoice_items')
        .update(itemData)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },
    
    delete: async (id: string) => {
      const { error } = await supabase
        .from('invoice_items')
        .delete()
        .eq('id', id);
      return { error };
    }
  },
  
  payments: {
    getByInvoiceId: async (invoiceId: string) => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });
      return { data, error };
    },
    
    create: async (paymentData: any) => {
      // Get current user's lab_id if not already provided
      if (!paymentData.lab_id) {
        const lab_id = await database.getCurrentUserLabId();
        if (!lab_id) {
          return { data: null, error: new Error('No lab_id found for current user') };
        }
        paymentData.lab_id = lab_id;
      }
      
      const { data, error } = await supabase
        .from('payments')
        .insert([paymentData])
        .select()
        .single();
      return { data, error };
    },
    
    getPaymentSummary: async (startDate?: string, endDate?: string, method?: string) => {
      let query = supabase
        .from('payments')
        .select('*');
      
      if (startDate) {
        query = query.gte('payment_date', startDate);
      }
      
      if (endDate) {
        query = query.lte('payment_date', endDate);
      }
      
      if (method) {
        query = query.eq('payment_method', method);
      }
      
      const { data, error } = await query.order('payment_date', { ascending: false });
      return { data, error };
    }
  },

  analytes: {
    getAll: async () => {
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        console.warn('No lab ID found for current user, fetching all active analytes globally. This might not be the intended behavior for a multi-lab setup.');
        const { data, error } = await supabase
          .from('analytes')
          .select('*')
          .eq('is_active', true)
          .order('name');
        return { data, error };
      }

      // Fetch analytes joined with lab_analytes for the specific lab
      const { data, error } = await supabase
        .from('lab_analytes')
        .select(`
          is_active,
          visible,
          lab_specific_reference_range,
          lab_specific_interpretation_low,
          lab_specific_interpretation_normal,
          lab_specific_interpretation_high,
          analytes(*)
        `)
        .eq('lab_id', labId)
        .eq('is_active', true)
        .eq('visible', true);
      
      if (error) {
        return { data: null, error };
      }
      
      // Flatten the structure to match the expected Analyte interface
      const formattedData = Array.isArray(data)
        ? data.map(item => {
            // item.analytes may be an array or object, handle accordingly
            const analyteObj = Array.isArray(item.analytes) ? item.analytes[0] : item.analytes;
            if (analyteObj) {
              return {
                ...analyteObj,
                is_active: item.is_active,
                visible: item.visible,
                // Prioritize lab-specific values if they exist, otherwise use global
                referenceRange: item.lab_specific_reference_range || analyteObj.reference_range,
                interpretation: {
                  low: item.lab_specific_interpretation_low || analyteObj.interpretation_low,
                  normal: item.lab_specific_interpretation_normal || analyteObj.interpretation_normal,
                  high: item.lab_specific_interpretation_high || analyteObj.interpretation_high,
                },
              };
            }
            return null;
          }).filter(Boolean)
        : [];
      return { data: formattedData, error: null };
    },

    // Get global analytes (for master analyte management)
    getAllGlobal: async () => {
      const { data, error } = await supabase
        .from('analytes')
        .select('*')
        .eq('is_global', true)
        .eq('is_active', true)
        .order('name');
      return { data, error };
    },

    // Create a new analyte
    create: async (analyteData: {
      name: string;
      unit: string;
      reference_range: string;
      low_critical?: string;
      high_critical?: string;
      interpretation_low?: string;
      interpretation_normal?: string;
      interpretation_high?: string;
      category?: string;
      is_global?: boolean;
      is_active?: boolean;
      ai_processing_type?: string;
      ai_prompt_override?: string;
    }) => {
      const { data, error } = await supabase
        .from('analytes')
        .insert([{
          name: analyteData.name,
          unit: analyteData.unit,
          reference_range: analyteData.reference_range,
          low_critical: analyteData.low_critical,
          high_critical: analyteData.high_critical,
          interpretation_low: analyteData.interpretation_low,
          interpretation_normal: analyteData.interpretation_normal,
          interpretation_high: analyteData.interpretation_high,
          category: analyteData.category || 'General', // Ensure category is never null
          is_global: analyteData.is_global || false,
          is_active: analyteData.is_active !== false, // Default to true
          ai_processing_type: analyteData.ai_processing_type,
          ai_prompt_override: analyteData.ai_prompt_override
        }])
        .select()
        .single();
      return { data, error };
    },

    // Update analyte global status
    updateGlobalStatus: async (analyteId: string, isGlobal: boolean) => {
      const { data, error } = await supabase
        .from('analytes')
        .update({ is_global: isGlobal })
        .eq('id', analyteId)
        .select()
        .single();
      return { data, error };
    },

    // Update analyte
    update: async (analyteId: string, updates: {
      name?: string;
      unit?: string;
      reference_range?: string;
      low_critical?: string;
      high_critical?: string;
      interpretation_low?: string;
      interpretation_normal?: string;
      interpretation_high?: string;
      category?: string;
      is_active?: boolean;
      ai_processing_type?: string;
      ai_prompt_override?: string;
    }) => {
      const { data, error } = await supabase
        .from('analytes')
        .update({
          name: updates.name,
          unit: updates.unit,
          reference_range: updates.reference_range,
          low_critical: updates.low_critical,
          high_critical: updates.high_critical,
          interpretation_low: updates.interpretation_low,
          interpretation_normal: updates.interpretation_normal,
          interpretation_high: updates.interpretation_high,
          category: updates.category,
          is_active: updates.is_active,
          ai_processing_type: updates.ai_processing_type,
          ai_prompt_override: updates.ai_prompt_override,
          updated_at: new Date().toISOString()
        })
        .eq('id', analyteId)
        .select()
        .single();
      return { data, error };
    },
  },

  // Workflow dynamic engine helpers (lab scoped)
  workflows: {
    create: async (payload: {
      name: string;
      description?: string | null;
      type: string;
      category?: string | null;
      is_active?: boolean;
      lab_id?: string | null;
    }) => {
      const { data, error } = await supabase
        .from('workflows')
        .insert({
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      return { data, error };
    },

    getLabWorkflowForTest: async (labId: string, testCode: string) => {
      try {
        // Find mapping
        const { data: mapping, error: mapError } = await supabase
          .from('test_workflow_map')
          .select('id, workflow_version_id')
          .eq('lab_id', labId)
          .eq('test_code', testCode)
          .eq('is_default', true)
          .maybeSingle();
        if (mapError || !mapping) return { data: null, error: mapError };
        const { data: version, error: verError } = await supabase
          .from('workflow_versions')
          .select('id, version, definition, workflow_id')
          .eq('id', mapping.workflow_version_id)
          .single();
        if (verError) return { data: null, error: verError };
        return { data: version, error: null };
      } catch (e: any) {
        return { data: null, error: e };
      }
    },
    getOrderWorkflowInstance: async (orderId: string) => {
      const { data, error } = await supabase
        .from('order_workflow_instances')
        .select('id, workflow_version_id, current_step_id, started_at, completed_at')
        .eq('order_id', orderId)
        .maybeSingle();
      return { data, error };
    },
    createOrderWorkflowInstance: async (orderId: string, workflowVersionId: string, firstStepId: string) => {
      const { data, error } = await supabase
        .from('order_workflow_instances')
        .insert({ order_id: orderId, workflow_version_id: workflowVersionId, current_step_id: firstStepId })
        .select()
        .single();
      return { data, error };
    },
    updateOrderWorkflowCurrentStep: async (instanceId: string, nextStepId: string | null) => {
      const patch: any = { current_step_id: nextStepId };
      if (!nextStepId) patch.completed_at = new Date().toISOString();
      const { data, error } = await supabase
        .from('order_workflow_instances')
        .update(patch)
        .eq('id', instanceId)
        .select()
        .single();
      return { data, error };
    },
    insertStepEvent: async (instanceId: string, stepId: string, eventType: string, payload?: any) => {
      const { data, error } = await supabase
        .from('workflow_step_events')
        .insert({ instance_id: instanceId, step_id: stepId, event_type: eventType, payload })
        .select()
        .single();
      return { data, error };
    },
    
    logStepEvent: async (eventData: {
      order_id: string;
      step_name: string;
      user_id: string;
      event_data?: any;
    }): Promise<void> => {
      try {
        await supabase
          .from('workflow_step_events')
          .insert({
            ...eventData,
            created_at: new Date().toISOString()
          });
      } catch (error) {
        console.error('Error logging workflow step event:', error);
      }
    }
  },

  workflowVersions: {
    create: async (payload: {
      workflow_id: string;
      version: string;
      definition: Record<string, unknown>;
      description?: string | null;
      active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from('workflow_versions')
        .insert({
          workflow_id: payload.workflow_id,
          version: parseInt(payload.version) || 1,
          definition: payload.definition,
          description: payload.description || null,
          active: payload.active || false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      return { data, error };
    },

    update: async (versionId: string, updates: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from('workflow_versions')
        .update(updates)
        .eq('id', versionId)
        .select()
        .single();

      return { data, error };
    },

    getById: async (versionId: string) => {
      const { data, error } = await supabase
        .from('workflow_versions')
        .select('*')
        .eq('id', versionId)
        .single();

      return { data, error };
    },

    getAll: async () => {
      const { data, error } = await supabase
        .from('workflow_versions')
        .select(`
          id,
          name,
          description,
          active,
          created_at,
          version
        `)
        .order('created_at', { ascending: false });

      return { data, error };
    }
  },

  testWorkflowMap: {
    create: async (payload: {
      test_code: string;
      workflow_version_id: string;
      test_group_id?: string | null;
      lab_id?: string | null;
      is_default?: boolean;
    }) => {
      const { data, error } = await supabase
        .from('test_workflow_map')
        .insert({
          ...payload,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      return { data, error };
    }
  },

  aiIssues: {
    create: async (payload: {
      workflow_version_id: string;
      issue_type: string;
      description: string;
      severity?: string;
      metadata?: Record<string, unknown> | null;
    }) => {
      const { data, error } = await supabase
        .from('ai_issues')
        .insert({
          ...payload,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      return { data, error };
    }
  },

  // Lab-specific analyte management
  labAnalytes: {
    // Get lab-specific analyte configuration
    getByLabAndAnalyte: async (labId: string, analyteId: string) => {
      const { data, error } = await supabase
        .from('lab_analytes')
        .select(`
          *,
          analytes(*)
        `)
        .eq('lab_id', labId)
        .eq('analyte_id', analyteId)
        .single();
      return { data, error };
    },

    // Update lab-specific analyte settings
    updateLabSpecific: async (labId: string, analyteId: string, updates: {
      is_active?: boolean;
      visible?: boolean;
      lab_specific_reference_range?: string;
      lab_specific_interpretation_low?: string;
      lab_specific_interpretation_normal?: string;
      lab_specific_interpretation_high?: string;
    }) => {
      const { data, error } = await supabase
        .from('lab_analytes')
        .update(updates)
        .eq('lab_id', labId)
        .eq('analyte_id', analyteId)
        .select()
        .single();
      return { data, error };
    },

    // Add global analytes to a specific lab
    addGlobalAnalytesToLab: async (labId: string) => {
      const { data, error } = await supabase.rpc('add_global_analytes_to_lab', {
        target_lab_id: labId
      });
      return { data, error };
    },

    // Get all lab analytes for a specific lab (including inactive/invisible ones)
    getAllForLab: async (labId: string) => {
      const { data, error } = await supabase
        .from('lab_analytes')
        .select(`
          *,
          analytes(*)
        `)
        .eq('lab_id', labId)
        .order('analytes(name)');
      return { data, error };
    },

    // Sync global analytes to all labs
    syncGlobalAnalytesToAllLabs: async () => {
      const { data, error } = await supabase.rpc('sync_global_analytes_to_all_labs');
      return { data, error };
    },

    // Get analyte usage statistics
    getUsageStats: async () => {
      const { data, error } = await supabase.rpc('get_analyte_lab_usage_stats');
      return { data, error };
    },
    // ...existing code...
  },

  testGroups: {
    listByLab: async (labIdOverride?: string) => {
      const labId = labIdOverride || (await database.getCurrentUserLabId());
      if (!labId) {
        return { data: [], error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('test_groups')
        .select('id, name, category, lab_id')
        .eq('is_active', true)
        .or(`lab_id.eq.${labId},lab_id.is.null`)
        .order('name', { ascending: true });

      return { data: (data as any[]) || [], error };
    },

    getByLabId: async (labId: string) => {
      const { data, error } = await supabase
        .from('test_groups')
        .select('id, name, category, lab_id, description')
        .eq('is_active', true)
        .or(`lab_id.eq.${labId},lab_id.is.null`)
        .order('name', { ascending: true });

      return { data: (data as any[]) || [], error };
    },

    list: async (labIdOverride?: string) => {
      return database.testGroups.listByLab(labIdOverride);
    },

    getAll: async () => {
      const { data, error } = await supabase
        .from('test_groups')
        .select(`
          id,
          name,
          code,
          category,
          clinical_purpose,
          price,
          turnaround_time,
          sample_type,
          requires_fasting,
          is_active,
          created_at,
          updated_at,
          default_ai_processing_type,
          group_level_prompt,
          lab_id,
          to_be_copied,
          test_group_analytes(
            analyte_id,
            analytes(
              id,
              name,
              unit,
              reference_range,
              ai_processing_type,
              ai_prompt_override,
              group_ai_mode
            )
          )
        `)
        .eq('is_active', true)
        .order('name');
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('test_groups')
        .select(`
          id,
          name,
          code,
          category,
          clinical_purpose,
          price,
          turnaround_time,
          sample_type,
          requires_fasting,
          is_active,
          created_at,
          updated_at,
          default_ai_processing_type,
          group_level_prompt,
          lab_id,
          to_be_copied,
          test_group_analytes(
            analyte_id,
            analytes(
              id,
              name,
              unit,
              reference_range,
              ai_processing_type,
              ai_prompt_override,
              group_ai_mode
            )
          )
        `)
        .eq('id', id)
        .single();
      return { data, error };
    },

    getByNames: async (names: string[]) => {
      const { data, error } = await supabase
        .from('test_groups')
        .select(`
          id,
          name,
          code,
          category,
          clinical_purpose,
          price,
          turnaround_time,
          sample_type,
          requires_fasting,
          is_active,
          created_at,
          updated_at,
          default_ai_processing_type,
          group_level_prompt,
          lab_id,
          to_be_copied,
          test_group_analytes(
            analyte_id,
            analytes(
              id,
              name,
              unit,
              reference_range,
              ai_processing_type,
              ai_prompt_override,
              group_ai_mode
            )
          )
        `)
        .in('name', names)
        .eq('is_active', true);
      return { data, error };
    },

    create: async (testGroupData: any) => {
      try {
        // Ensure all required fields have valid values
        const sanitizedData = {
          name: testGroupData.name || 'Unnamed Test Group',
          code: testGroupData.code || 'UNNAMED',
          category: testGroupData.category || 'Laboratory',
          clinical_purpose: testGroupData.clinicalPurpose || 'Clinical assessment and diagnosis',
          price: testGroupData.price || 0,
          turnaround_time: testGroupData.turnaroundTime || '24 hours',
          sample_type: testGroupData.sampleType || 'Serum',
          requires_fasting: testGroupData.requiresFasting || false,
          is_active: testGroupData.isActive !== false,
          default_ai_processing_type: testGroupData.default_ai_processing_type || 'ocr_report',
          group_level_prompt: testGroupData.group_level_prompt || null,
          lab_id: testGroupData.lab_id || null,
          to_be_copied: testGroupData.to_be_copied || false
        };

        console.log('Creating test group with data:', sanitizedData);

        // Step 1: Create the test group
        const { data: testGroup, error: testGroupError } = await supabase
          .from('test_groups')
          .insert([sanitizedData])
          .select()
          .single();

        if (testGroupError) {
          console.error('Error creating test group:', testGroupError);
          return { data: null, error: testGroupError };
        }

        // Step 2: Create test group analyte relationships
        if (testGroupData.analytes && testGroupData.analytes.length > 0) {
          const analyteRelations = testGroupData.analytes.map((analyteId: string) => ({
            test_group_id: testGroup.id,
            analyte_id: analyteId
          }));

          const { error: relationError } = await supabase
            .from('test_group_analytes')
            .insert(analyteRelations);

          if (relationError) {
            console.error('Error creating test group analyte relations:', relationError);
            // Still return the test group even if analyte relations failed
            return { data: testGroup, error: relationError };
          }
        }

        return { data: testGroup, error: null };
      } catch (error) {
        console.error('Unexpected error creating test group:', error);
        return { data: null, error };
      }
    },

    update: async (id: string, updates: any) => {
      try {
        // Step 1: Update the test group
        const { data, error } = await supabase
          .from('test_groups')
          .update({
            name: updates.name,
            code: updates.code,
            category: updates.category,
            clinical_purpose: updates.clinicalPurpose,
            price: updates.price,
            turnaround_time: updates.turnaroundTime,
            sample_type: updates.sampleType,
            requires_fasting: updates.requiresFasting,
            is_active: updates.isActive,
            default_ai_processing_type: updates.default_ai_processing_type,
            group_level_prompt: updates.group_level_prompt,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select()
          .single();
        
        if (error) {
          console.error('Error updating test group:', error);
          return { data: null, error };
        }

        // Step 2: Update analyte relationships if analytes are provided
        if (updates.analytes && Array.isArray(updates.analytes)) {
          // First delete existing analyte relationships
          const { error: deleteError } = await supabase
            .from('test_group_analytes')
            .delete()
            .eq('test_group_id', id);

          if (deleteError) {
            console.error('Error deleting existing analyte relationships:', deleteError);
            return { data, error: deleteError };
          }

          // Then insert new analyte relationships
          if (updates.analytes.length > 0) {
            const analyteRelations = updates.analytes.map((analyteId: string) => ({
              test_group_id: id,
              analyte_id: analyteId
            }));

            const { error: insertError } = await supabase
              .from('test_group_analytes')
              .insert(analyteRelations);

            if (insertError) {
              console.error('Error inserting new analyte relationships:', insertError);
              return { data, error: insertError };
            }
          }
        }
        
        return { data, error: null };
      } catch (error) {
        console.error('Unexpected error updating test group:', error);
        return { data: null, error };
      }
    },

    delete: async (id: string) => {
      // First delete analyte relationships
      await supabase
        .from('test_group_analytes')
        .delete()
        .eq('test_group_id', id);

      // Then delete the test group
      const { error } = await supabase
        .from('test_groups')
        .delete()
        .eq('id', id);
      
      return { error };
    }
  },

  packages: {
    getAll: async () => {
      const { data, error } = await supabase
        .from('packages')
        .select(`
          id,
          name,
          description,
          price,
          is_active,
          created_at,
          updated_at,
          lab_id,
          package_test_groups(
            test_group_id,
            test_groups(
              id,
              name,
              code,
              category,
              price
            )
          )
        `)
        .eq('is_active', true)
        .order('name');
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('packages')
        .select(`
          id,
          name,
          description,
          price,
          is_active,
          created_at,
          updated_at,
          lab_id,
          package_test_groups(
            test_group_id,
            test_groups(
              id,
              name,
              code,
              category,
              price,
              clinical_purpose,
              turnaround_time,
              sample_type,
              requires_fasting
            )
          )
        `)
        .eq('id', id)
        .single();
      return { data, error };
    },

    create: async (packageData: any) => {
      const { data, error } = await supabase
        .from('packages')
        .insert([packageData])
        .select()
        .single();
      return { data, error };
    },

    update: async (id: string, packageData: any) => {
      const { data, error } = await supabase
        .from('packages')
        .update(packageData)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    delete: async (id: string) => {
      // First delete related package_test_groups
      await supabase
        .from('package_test_groups')
        .delete()
        .eq('package_id', id);

      // Then delete the package
      const { error } = await supabase
        .from('packages')
        .delete()
        .eq('id', id);
      
      return { error };
    }
  },

};

// Database helper functions for attachments
export const attachments = {
  // Upload file with metadata including test-level support
  upload: async (file: File, metadata: {
    patient_id?: string;
    related_table: string;
    related_id: string;
    order_id?: string;
    order_test_id?: string; // New field for test-level attachments
    description?: string;
    tag?: string;
  }) => {
    try {
      const labId = await database.getCurrentUserLabId();
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const filePath = `attachments/${labId}/${fileName}`;

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('attachments')
        .getPublicUrl(filePath);

      // Save attachment metadata
      const { data, error } = await supabase
        .from('attachments')
        .insert({
          patient_id: metadata.patient_id,
          related_table: metadata.related_table,
          related_id: metadata.related_id,
          order_id: metadata.order_id,
          order_test_id: metadata.order_test_id, // Save test association
          file_url: publicUrl,
          file_type: file.type,
          file_path: filePath,
          original_filename: file.name,
          stored_filename: fileName,
          file_size: file.size,
          description: metadata.description,
          tag: metadata.tag,
          lab_id: labId,
          uploaded_by: (await supabase.auth.getUser()).data.user?.id
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error uploading attachment:', error);
      return { data: null, error };
    }
  },

  // Get attachments by order test ID
  getByOrderTest: async (orderTestId: string) => {
    try {
      const { data, error } = await supabase
        .from('attachments')
        .select('*')
        .eq('order_test_id', orderTestId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching test attachments:', error);
      return { data: null, error };
    }
  },

  // Get attachments by order with test information
  getByOrderWithTestInfo: async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .from('attachments')
        .select(`
          *,
          order_tests!attachments_order_test_id_fkey(
            id,
            test_name,
            test_group_id
          )
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching order attachments:', error);
      return { data: null, error };
    }
  },

  getByRelatedId: async (relatedTable: string, relatedId: string) => {
    const { data, error } = await supabase
      .from('attachments')
      .select('*')
      .eq('related_table', relatedTable)
      .eq('related_id', relatedId)
      .order('created_at', { ascending: false });
    return { data, error };
  },

  // Helper function specifically for orders (commonly used)
  getByOrderId: async (orderId: string) => {
    return attachments.getByRelatedId('orders', orderId);
  },

  // Helper function specifically for patients
  getByPatientIdRelated: async (patientId: string) => {
    return attachments.getByRelatedId('patients', patientId);
  },

  // Helper function specifically for results
  getByResultId: async (resultId: string) => {
    return attachments.getByRelatedId('results', resultId);
  },

  getByPatientId: async (patientId: string) => {
    const { data, error } = await supabase
      .from('attachments')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    return { data, error };
  },

  getByLabId: async (labId: string) => {
    const { data, error } = await supabase
      .from('attachments')
      .select('*')
      .eq('lab_id', labId)
      .order('created_at', { ascending: false });
    return { data, error };
  },
  getById: async (id: string) => {
    const { data, error } = await supabase
      .from('attachments')
      .select('*')
      .eq('id', id)
      .single();
    return { data, error };
  },

  create: async (attachmentData: any) => {
    const { data, error } = await supabase
      .from('attachments')
      .insert([attachmentData])
      .select()
      .single();
    return { data, error };
  },

  updateDescription: async (id: string, description: string) => {
    const { data, error } = await supabase
      .from('attachments')
      .update({ description })
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  },
  delete: async (id: string) => {
    // First get the file path to delete from storage
    const { data: attachment, error: fetchError } = await supabase
      .from('attachments')
      .select('file_path')
      .eq('id', id)
      .single();
    
    if (fetchError) {
      return { error: fetchError };
    }
    
    // Delete from storage
    if (attachment?.file_path) {
      const { error: storageError } = await supabase.storage
        .from('attachments')
        .remove([attachment.file_path]);
      
      if (storageError) {
        console.warn('Failed to delete file from storage:', storageError);
      }
    }
    
    // Delete from database
    const { error } = await supabase
      .from('attachments')
      .delete()
      .eq('id', id);
    return { error };
  }
};

// Database helper functions for OCR results
export const ocrResults = {
  getByAttachmentId: async (attachmentId: string) => {
    const { data, error } = await supabase
      .from('ocr_results')
      .select('*')
      .eq('attachment_id', attachmentId)
      .order('created_at', { ascending: false });
    return { data, error };
  },

  create: async (ocrData: any) => {
    const { data, error } = await supabase
      .from('ocr_results')
      .insert([ocrData])
      .select()
      .single();
    return { data, error };
  }
};

// User management helper functions
export const userManagement = {
  // Get current user's profile from public.users
  getCurrentUserProfile: async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { data: null, error: authError };
    }

    const { data, error } = await supabase
      .from('users')
      .select(`
        *,
        labs(id, name, code)
      `)
      .eq('email', user.email)
      .single();
    
    return { data, error };
  },

  // Update user's lab assignment
  updateUserLab: async (userId: string, labId: string) => {
    const { data, error } = await supabase
      .from('users')
      .update({ 
        lab_id: labId,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();
    
    return { data, error };
  },

  // Get all users for a specific lab
  getUsersByLab: async (labId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select(`
        id,
        name,
        email,
        role,
        status,
        join_date,
        last_login
      `)
      .eq('lab_id', labId)
      .eq('status', 'Active')
      .order('name');
    
    return { data, error };
  }
};

// Phase 2 API Methods - Master Data Management
const masterDataAPI = {
  // Doctors API
  doctors: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('doctors')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('is_active', true)
        .order('name');
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('doctors')
        .select('*')
        .eq('id', id)
        .single();
      return { data, error };
    },

    search: async (searchTerm: string) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('doctors')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('is_active', true)
        .or(`name.ilike.%${searchTerm}%,license_number.ilike.%${searchTerm}%,specialization.ilike.%${searchTerm}%,hospital.ilike.%${searchTerm}%`)
        .order('name')
        .limit(20);
      return { data, error };
    },

    create: async (doctorData: {
      name: string;
      license_number?: string;
      specialization?: string;
      phone?: string;
      email?: string;
      hospital?: string;
      address?: string;
      is_referring_doctor?: boolean;
      notes?: string;
    }) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('doctors')
        .insert([{
          ...doctorData,
          lab_id,
          is_active: true,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      return { data, error };
    },

    update: async (id: string, updates: {
      name?: string;
      license_number?: string;
      specialization?: string;
      phone?: string;
      email?: string;
      hospital?: string;
      address?: string;
      is_referring_doctor?: boolean;
      notes?: string;
      is_active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from('doctors')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    delete: async (id: string) => {
      const { data, error } = await supabase
        .from('doctors')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    }
  },

  // Locations API  
  locations: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('is_active', true)
        .order('name');
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('id', id)
        .single();
      return { data, error };
    },

    getWithCreditBalance: async (id: string) => {
      const { data, error } = await supabase
        .from('locations')
        .select(`
          *,
          credit_transactions!location_id(
            amount,
            type,
            created_at
          )
        `)
        .eq('id', id)
        .single();

      if (error || !data) {
        return { data, error };
      }

      // Calculate current credit balance
      const creditTransactions = data.credit_transactions || [];
      const totalCredits = creditTransactions
        .filter((t: any) => t.type === 'credit')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      const totalDebits = creditTransactions
        .filter((t: any) => t.type === 'debit')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      
      const currentBalance = totalCredits - totalDebits;

      return {
        data: {
          ...data,
          current_credit_balance: currentBalance
        },
        error: null
      };
    },

    create: async (locationData: {
      name: string;
      code?: string;
      address?: string;
      phone?: string;
      email?: string;
      contact_person?: string;
      credit_limit?: number;
      collection_percentage?: number;
      is_cash_collection_center?: boolean;
      notes?: string;
    }) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('locations')
        .insert([{
          ...locationData,
          lab_id,
          is_active: true,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      return { data, error };
    },

    update: async (id: string, updates: {
      name?: string;
      code?: string;
      address?: string;
      phone?: string;
      email?: string;
      contact_person?: string;
      credit_limit?: number;
      collection_percentage?: number;
      is_cash_collection_center?: boolean;
      notes?: string;
      is_active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from('locations')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    delete: async (id: string) => {
      const { data, error } = await supabase
        .from('locations')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    checkCreditLimit: async (id: string, orderAmount: number) => {
      const { data: location, error } = await supabase
        .from('locations')
        .select(`
          *,
          credit_transactions!location_id(
            amount,
            transaction_type,
            created_at
          )
        `)
        .eq('id', id)
        .single();

      if (error || !location) {
        return { 
          allowed: false, 
          currentBalance: 0, 
          creditLimit: 0, 
          availableCredit: 0,
          name: '',
          error 
        };
      }

      // Calculate current credit balance
      const creditTransactions = location.credit_transactions || [];
      const totalCredits = creditTransactions
        .filter((t: any) => t.transaction_type === 'credit')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      const totalDebits = creditTransactions
        .filter((t: any) => t.transaction_type === 'debit')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      
      const currentBalance = totalCredits - totalDebits;
      const creditLimit = location.credit_limit || 0;
      const availableCredit = creditLimit - currentBalance;
      const allowed = orderAmount <= availableCredit;

      return {
        allowed,
        currentBalance,
        creditLimit,
        availableCredit,
        name: location.name,
        error: null
      };
    }
  },

  // Accounts API
  accounts: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('is_active', true)
        .order('name');
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', id)
        .single();
      return { data, error };
    },

    search: async (searchTerm: string) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('is_active', true)
        .or(`name.ilike.%${searchTerm}%,type.ilike.%${searchTerm}%,contact_person.ilike.%${searchTerm}%`)
        .order('name')
        .limit(20);
      return { data, error };
    },

    create: async (accountData: {
      name: string;
      type: 'hospital' | 'corporate' | 'insurer' | 'clinic' | 'doctor' | 'other';
      contact_person?: string;
      phone?: string;
      email?: string;
      address?: string;
      credit_limit?: number;
      default_discount_percent?: number;
      payment_terms?: number;
      notes?: string;
    }) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('accounts')
        .insert([{
          ...accountData,
          lab_id,
          is_active: true,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      return { data, error };
    },

    update: async (id: string, updates: {
      name?: string;
      type?: 'hospital' | 'corporate' | 'insurer' | 'clinic' | 'doctor' | 'other';
      contact_person?: string;
      phone?: string;
      email?: string;
      address?: string;
      credit_limit?: number;
      default_discount_percent?: number;
      payment_terms?: number;
      notes?: string;
      is_active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from('accounts')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    delete: async (id: string) => {
      const { data, error } = await supabase
        .from('accounts')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    checkCreditLimit: async (id: string, orderAmount: number) => {
      const { data: account, error } = await supabase
        .from('accounts')
        .select(`
          *,
          credit_transactions!account_id(
            amount,
            transaction_type,
            created_at
          )
        `)
        .eq('id', id)
        .single();

      if (error || !account) {
        return { 
          allowed: false, 
          currentBalance: 0, 
          creditLimit: 0, 
          availableCredit: 0,
          name: '',
          error 
        };
      }

      // Calculate current credit balance
      const creditTransactions = account.credit_transactions || [];
      const totalCredits = creditTransactions
        .filter((t: any) => t.transaction_type === 'credit')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      const totalDebits = creditTransactions
        .filter((t: any) => t.transaction_type === 'debit')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      
      const currentBalance = totalCredits - totalDebits;
      const creditLimit = account.credit_limit || 0;
      const availableCredit = creditLimit - currentBalance;
      const allowed = orderAmount <= availableCredit;

      return {
        allowed,
        currentBalance,
        creditLimit,
        availableCredit,
        name: account.name,
        error: null
      };
    }
  },

  // Order Tests API
  orderTests: {
    getUnbilledByOrder: async (orderId: string) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('order_tests')
        .select('id, test_group_id, test_name, price, is_billed, invoice_id')
        .eq('order_id', orderId)
        .eq('is_billed', false)
        .order('test_name');
      
      return { data, error };
    },

    getAll: async (orderId: string) => {
      const { data, error } = await supabase
        .from('order_tests')
        .select('*')
        .eq('order_id', orderId)
        .order('test_name');
      
      return { data, error };
    },

    updateBillingStatus: async (testId: string, billingData: {
      is_billed: boolean;
      invoice_id?: string;
      billed_at?: string;
      billed_amount?: number;
    }) => {
      const { data, error } = await supabase
        .from('order_tests')
        .update(billingData)
        .eq('id', testId)
        .select()
        .single();
      
      return { data, error };
    }
  },

  // Enhanced Payments API
  enhancedPayments: {
    getAllPayments: async (filters?: {
      startDate?: string;
      endDate?: string;
      paymentMethod?: string;
      locationId?: string;
    }) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      let query = supabase
        .from('payments')
        .select(`
          *,
          invoices(
            id,
            invoice_number,
            total_amount,
            status
          ),
          locations(
            id,
            name
          ),
          cash_registers(
            id,
            register_name
          )
        `)
        .eq('lab_id', lab_id);

      if (filters?.startDate) {
        query = query.gte('payment_date', filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte('payment_date', filters.endDate);
      }
      if (filters?.paymentMethod) {
        query = query.eq('payment_method', filters.paymentMethod);
      }
      if (filters?.locationId) {
        query = query.eq('location_id', filters.locationId);
      }

      const { data, error } = await query.order('payment_date', { ascending: false });
      return { data, error };
    },

    createPayment: async (paymentData: {
      invoice_id: string;
      amount: number;
      payment_method: 'cash' | 'card' | 'upi' | 'cheque' | 'bank_transfer' | 'credit';
      reference_number?: string;
      location_id?: string;
      cash_register_id?: string;
      cheque_number?: string;
      cheque_date?: string;
      bank_name?: string;
      notes?: string;
    }) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      // Start transaction
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .insert([{
          ...paymentData,
          lab_id,
          payment_date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (paymentError) {
        return { data: null, error: paymentError };
      }

      // Update invoice status based on payment
      if (payment) {
        await masterDataAPI.enhancedPayments.updateInvoiceStatus(paymentData.invoice_id);
        
        // If cash payment and register specified, update cash register
        if (paymentData.payment_method === 'cash' && paymentData.cash_register_id) {
          await masterDataAPI.cashRegister.addTransaction(paymentData.cash_register_id, {
            type: 'collection',
            amount: paymentData.amount,
            description: `Payment for Invoice #${payment.id}`,
            reference_id: payment.id
          });
        }

        // If credit payment, create credit transaction
        if (paymentData.payment_method === 'credit' && paymentData.location_id) {
          await masterDataAPI.creditTransactions.create({
            location_id: paymentData.location_id,
            amount: paymentData.amount,
            type: 'debit',
            description: `Payment for Invoice #${payment.id}`,
            reference_type: 'payment',
            reference_id: payment.id
          });
        }
      }

      return { data: payment, error: null };
    },

    updateInvoiceStatus: async (invoiceId: string) => {
      // Get total payments for this invoice
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('invoice_id', invoiceId);

      // Get invoice total
      const { data: invoice } = await supabase
        .from('invoices')
        .select('total_amount')
        .eq('id', invoiceId)
        .single();

      if (!invoice || !payments) return;

      const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      const invoiceTotal = parseFloat(invoice.total_amount);

      let status = 'pending';
      if (totalPaid >= invoiceTotal) {
        status = 'paid';
      } else if (totalPaid > 0) {
        status = 'partially_paid';
      }

      await supabase
        .from('invoices')
        .update({ 
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', invoiceId);
    },

    getPaymentsByInvoice: async (invoiceId: string) => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          *,
          locations(name),
          cash_registers(register_name)
        `)
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });
      return { data, error };
    }
  },

  // Cash Register API
  cashRegister: {
    getAll: async () => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }
      
      const { data, error } = await supabase
        .from('cash_registers')
        .select('*')
        .eq('lab_id', lab_id)
        .eq('is_active', true)
        .order('register_name');
      return { data, error };
    },

    getById: async (id: string) => {
      const { data, error } = await supabase
        .from('cash_registers')
        .select(`
          *,
          cash_register_transactions(
            id,
            type,
            amount,
            description,
            transaction_date,
            created_at
          )
        `)
        .eq('id', id)
        .single();

      if (error || !data) {
        return { data, error };
      }

      // Calculate current balance
      const transactions = data.cash_register_transactions || [];
      const collections = transactions
        .filter((t: any) => t.type === 'collection')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      const expenses = transactions
        .filter((t: any) => t.type === 'expense')
        .reduce((sum: number, t: any) => sum + parseFloat(t.amount), 0);
      
      const currentBalance = parseFloat(data.opening_balance) + collections - expenses;

      return {
        data: {
          ...data,
          current_balance: currentBalance,
          total_collections: collections,
          total_expenses: expenses
        },
        error: null
      };
    },

    create: async (registerData: {
      register_name: string;
      location_id?: string;
      opening_balance: number;
      responsible_person?: string;
      description?: string;
    }) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('cash_registers')
        .insert([{
          ...registerData,
          lab_id,
          is_active: true,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      return { data, error };
    },

    addTransaction: async (registerId: string, transactionData: {
      type: 'collection' | 'expense';
      amount: number;
      description: string;
      reference_id?: string;
    }) => {
      const { data, error } = await supabase
        .from('cash_register_transactions')
        .insert([{
          cash_register_id: registerId,
          ...transactionData,
          transaction_date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      return { data, error };
    },

    getDailyReconciliation: async (registerId: string, date: string) => {
      const { data: register, error: registerError } = await masterDataAPI.cashRegister.getById(registerId);
      if (registerError || !register) {
        return { data: null, error: registerError };
      }

      const { data: transactions, error: transactionsError } = await supabase
        .from('cash_register_transactions')
        .select('*')
        .eq('cash_register_id', registerId)
        .eq('transaction_date', date)
        .order('created_at');

      if (transactionsError) {
        return { data: null, error: transactionsError };
      }

      const dailyCollections = transactions
        ?.filter(t => t.type === 'collection')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0) || 0;
      
      const dailyExpenses = transactions
        ?.filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0) || 0;

      return {
        data: {
          register,
          date,
          transactions: transactions || [],
          daily_collections: dailyCollections,
          daily_expenses: dailyExpenses,
          net_change: dailyCollections - dailyExpenses,
          expected_balance: register.current_balance
        },
        error: null
      };
    },

    closeDay: async (registerId: string, closingData: {
      closing_balance: number;
      variance?: number;
      notes?: string;
    }) => {
      const date = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('cash_register_closings')
        .insert([{
          cash_register_id: registerId,
          closing_date: date,
          ...closingData,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      return { data, error };
    },

    // Phase 4 methods for CashReconciliation
    getOrCreate: async (date: string, locationId: string, shift: 'morning' | 'afternoon' | 'night' | 'full_day') => {
      const labId = await database.getCurrentUserLabId();
      const { data, error } = await supabase
        .from('cash_register')
        .select('*')
        .eq('lab_id', labId)
        .eq('register_date', date)
        .eq('location_id', locationId)
        .eq('shift', shift)
        .maybeSingle();

      if (error) return { data: null, error };
      if (data) return { data, error: null };

      const { data: created, error: insertErr } = await supabase
        .from('cash_register')
        .insert({
          lab_id: labId,
          register_date: date,
          location_id: locationId,
          shift,
          opening_balance: 0,
          system_amount: 0,
        })
        .select('*')
        .single();
      return { data: created, error: insertErr };
    },

    update: async (id: string, patch: Partial<{ system_amount: number }>) =>
      supabase.from('cash_register').update(patch).eq('id', id),

    reconcile: async (id: string, actualAmount: number, notes?: string) =>
      supabase
        .from('cash_register')
        .update({
          actual_amount: actualAmount,
          reconciled: true,
          notes: notes || null,
          reconciled_at: new Date().toISOString(),
        })
        .eq('id', id)
  },

  // Credit Transactions API
  creditTransactions: {
    getByLocation: async (locationId: string, limit?: number) => {
      let query = supabase
        .from('credit_transactions')
        .select('*')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;
      return { data, error };
    },

    create: async (transactionData: {
      location_id: string;
      amount: number;
      type: 'credit' | 'debit';
      description: string;
      reference_type?: string;
      reference_id?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase
        .from('credit_transactions')
        .insert([{
          ...transactionData,
          transaction_date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      return { data, error };
    },

    getCreditSummaryByLocation: async (locationId: string) => {
      const { data: transactions, error } = await supabase
        .from('credit_transactions')
        .select('amount, type')
        .eq('location_id', locationId);

      if (error || !transactions) {
        return { data: null, error };
      }

      const totalCredits = transactions
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      
      const totalDebits = transactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      return {
        data: {
          location_id: locationId,
          total_credits: totalCredits,
          total_debits: totalDebits,
          current_balance: totalCredits - totalDebits
        },
        error: null
      };
    },

    getLocationCreditReport: async (startDate?: string, endDate?: string) => {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      let query = supabase
        .from('credit_transactions')
        .select(`
          *,
          locations!location_id(
            id,
            name,
            credit_limit
          )
        `)
        .eq('locations.lab_id', lab_id);

      if (startDate) {
        query = query.gte('transaction_date', startDate);
      }
      if (endDate) {
        query = query.lte('transaction_date', endDate);
      }

      const { data, error } = await query.order('transaction_date', { ascending: false });
      return { data, error };
    }
  },

  // --- NEW Phase 4: Account-aware invoice helpers used by Billing page/PaymentCapture ---
  // NOTE: Renamed to avoid overriding the primary invoices API above (which includes create/update/delete)
  invoicesV4: {
    getById: async (id: string) =>
      supabase
        .from('invoices')
        .select('*, locations(name), accounts(name)')
        .eq('id', id)
        .single(),

    getAll: async () =>
      supabase
        .from('invoices')
        .select('*, locations(name), accounts(name)')
        .order('created_at', { ascending: false }),

    getByStatus: async (status: 'Unpaid' | 'Paid' | 'Partial') =>
      supabase
        .from('invoices')
        .select('*, locations(name), accounts(name)')
        .eq('status', status)
        .order('created_at', { ascending: false }),
  },

  // --- NEW Phase 4: Payments (used by PaymentCapture & CashReconciliation) ---
  payments: {
    create: async (payload: {
      invoice_id: string;
      amount: number;
      payment_method: 'cash' | 'card' | 'upi' | 'bank' | 'credit_adjustment';
      payment_reference?: string | null;
      payment_date: string; // YYYY-MM-DD
      location_id?: string | null;
      account_id?: string | null;
      notes?: string | null;
    }) => supabase.from('payments').insert(payload).single(),

    getByInvoice: async (invoiceId: string) =>
      supabase.from('payments').select('*').eq('invoice_id', invoiceId).order('created_at'),

    getByInvoiceId: async (invoiceId: string) => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });
      return { data, error };
    },

    // For Cash Reconciliation (cash-only, date + location)
    getByDateRange: async (fromDate: string, toDate: string, locationId: string) =>
      supabase
        .from('payments')
        .select('*, invoices(patient_name)')
        .eq('payment_method', 'cash')
        .eq('location_id', locationId)
        .gte('payment_date', fromDate)
        .lte('payment_date', toDate)
        .order('created_at'),
  },

  // --- NEW Phase 4: Cash Register helpers used by CashReconciliation ---
  // (Merged into main cashRegister object above)
};

// Branding & Signature System API
const brandingSignatureAPI = {
  // Lab Branding Assets
  labBrandingAssets: {
    getAll: async (labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: [], error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('lab_branding_assets')
        .select('*')
        .eq('lab_id', labId)
        .eq('is_active', true)
        .order('asset_type')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      return { data: (data as LabBrandingAsset[]) || [], error };
    },

    getByType: async (assetType: string, labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: [], error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('lab_branding_assets')
        .select('*')
        .eq('lab_id', labId)
        .eq('asset_type', assetType)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      return { data: (data as LabBrandingAsset[]) || [], error };
    },

    getDefault: async (assetType: string, labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data, error } = await supabase
        .from('lab_branding_assets')
        .select('*')
        .eq('lab_id', labId)
        .eq('asset_type', assetType)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();

      return { data: data as LabBrandingAsset | null, error };
    },

    create: async (assetData: {
      asset_type: 'header' | 'footer' | 'watermark' | 'logo' | 'letterhead';
      asset_name: string;
      file: File;
      description?: string;
      usage_context?: string[];
      is_default?: boolean;
      dimensions?: { width: number; height: number };
    }) => {
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      // Generate file path
      const filePath = generateBrandingFilePath(labId, assetData.asset_type, assetData.file.name);

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(filePath, assetData.file);

      if (uploadError) {
        return { data: null, error: uploadError };
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('attachments')
        .getPublicUrl(filePath);

      // Create database record
      const { data, error } = await supabase
        .from('lab_branding_assets')
        .insert([{
          lab_id: labId,
          asset_type: assetData.asset_type,
          asset_name: assetData.asset_name,
          file_url: publicUrl,
          file_path: filePath,
          file_type: assetData.file.type,
          file_size: assetData.file.size,
          dimensions: assetData.dimensions,
          description: assetData.description,
          usage_context: assetData.usage_context || ['reports'],
          is_default: assetData.is_default || false,
          is_active: true,
          created_by: userId,
          updated_by: userId
        }])
        .select()
        .single();

      return { data: data as LabBrandingAsset | null, error };
    },

    update: async (assetId: string, updates: {
      asset_name?: string;
      description?: string;
      usage_context?: string[];
      is_active?: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      const { data, error } = await supabase
        .from('lab_branding_assets')
        .update({
          ...updates,
          updated_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq('id', assetId)
        .select()
        .single();

      return { data: data as LabBrandingAsset | null, error };
    },

    setDefault: async (assetId: string, labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      // Get asset to find its type
      const { data: asset, error: assetError } = await supabase
        .from('lab_branding_assets')
        .select('asset_type')
        .eq('id', assetId)
        .single();

      if (assetError || !asset) {
        return { data: null, error: assetError || new Error('Asset not found') };
      }

      // Use RPC function to set default
      const { data, error } = await supabase.rpc('set_default_branding_asset', {
        p_asset_id: assetId,
        p_lab_id: labId,
        p_asset_type: asset.asset_type
      });

      if (error) {
        return { data, error };
      }

      const shouldSync = asset.asset_type === 'header' || asset.asset_type === 'footer';
      if (shouldSync) {
        const syncResult = await syncLabBrandingDefaultsForLab(labId);
        if (syncResult.error) {
          return { data, error: syncResult.error };
        }
      }

      return { data, error: null };
    },

    delete: async (assetId: string) => {
      // Get asset file path
      const { data: asset, error: fetchError } = await supabase
        .from('lab_branding_assets')
        .select('file_path')
        .eq('id', assetId)
        .single();

      if (fetchError) {
        return { error: fetchError };
      }

      // Delete from storage
      if (asset?.file_path) {
        await supabase.storage
          .from('attachments')
          .remove([asset.file_path]);
      }

      // Delete from database
      const { error } = await supabase
        .from('lab_branding_assets')
        .delete()
        .eq('id', assetId);

      return { error };
    }
  },

  // User Signatures
  userSignatures: {
    getAll: async (userIdOverride?: string, labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: [], error: new Error('No lab_id found for current user') };
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userId = userIdOverride || user?.id;

      if (!userId) {
        return { data: [], error: new Error('No user_id found') };
      }

      const { data, error } = await supabase
        .from('lab_user_signatures')
        .select('*')
        .eq('lab_id', labId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      return { data: (data as LabUserSignature[]) || [], error };
    },

    getDefault: async (userIdOverride?: string, labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userId = userIdOverride || user?.id;

      if (!userId) {
        return { data: null, error: new Error('No user_id found') };
      }

      const { data, error } = await supabase
        .from('lab_user_signatures')
        .select('*')
        .eq('lab_id', labId)
        .eq('user_id', userId)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();

      return { data: data as LabUserSignature | null, error };
    },

    create: async (signatureData: {
      signature_type: 'digital' | 'handwritten' | 'stamp' | 'text';
      signature_name: string;
      file?: File;
      text_signature?: string;
      signature_data?: Record<string, any>;
      description?: string;
      usage_context?: string[];
      is_default?: boolean;
      dimensions?: { width: number; height: number };
    }) => {
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      if (!userId) {
        return { data: null, error: new Error('No user_id found') };
      }

      let filePath: string | undefined;
      let fileUrl: string | undefined;
      let fileType: string | undefined;
      let fileSize: number | undefined;

      // Upload file if provided (for digital/handwritten/stamp signatures)
      if (signatureData.file) {
        filePath = generateSignatureFilePath(labId, userId, signatureData.file.name);

        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(filePath, signatureData.file);

        if (uploadError) {
          return { data: null, error: uploadError };
        }

        const { data: { publicUrl } } = supabase.storage
          .from('attachments')
          .getPublicUrl(filePath);

        fileUrl = publicUrl;
        fileType = signatureData.file.type;
        fileSize = signatureData.file.size;
      }

      // Create database record
      const { data, error } = await supabase
        .from('lab_user_signatures')
        .insert([{
          lab_id: labId,
          user_id: userId,
          signature_type: signatureData.signature_type,
          signature_name: signatureData.signature_name,
          file_url: fileUrl,
          file_path: filePath,
          file_type: fileType,
          file_size: fileSize,
          dimensions: signatureData.dimensions,
          text_signature: signatureData.text_signature,
          signature_data: signatureData.signature_data,
          description: signatureData.description,
          usage_context: signatureData.usage_context || ['reports'],
          is_default: signatureData.is_default || false,
          is_active: true,
          created_by: userId,
          updated_by: userId
        }])
        .select()
        .single();

      return { data: data as LabUserSignature | null, error };
    },

    update: async (signatureId: string, updates: {
      signature_name?: string;
      text_signature?: string;
      signature_data?: Record<string, any>;
      description?: string;
      usage_context?: string[];
      is_active?: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      const { data, error } = await supabase
        .from('lab_user_signatures')
        .update({
          ...updates,
          updated_by: userId,
          updated_at: new Date().toISOString()
        })
        .eq('id', signatureId)
        .select()
        .single();

      return { data: data as LabUserSignature | null, error };
    },

    setDefault: async (signatureId: string, userIdOverride?: string, labIdOverride?: string) => {
      const labId = labIdOverride || await database.getCurrentUserLabId();
      if (!labId) {
        return { data: null, error: new Error('No lab_id found for current user') };
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userId = userIdOverride || user?.id;

      if (!userId) {
        return { data: null, error: new Error('No user_id found') };
      }

      // Use RPC function to set default
      const { data, error } = await supabase.rpc('set_default_user_signature', {
        p_signature_id: signatureId,
        p_user_id: userId,
        p_lab_id: labId
      });

      return { data, error };
    },

    delete: async (signatureId: string) => {
      // Get signature file path
      const { data: signature, error: fetchError } = await supabase
        .from('lab_user_signatures')
        .select('file_path')
        .eq('id', signatureId)
        .single();

      if (fetchError) {
        return { error: fetchError };
      }

      // Delete from storage if file exists
      if (signature?.file_path) {
        await supabase.storage
          .from('attachments')
          .remove([signature.file_path]);
      }

      // Delete from database
      const { error } = await supabase
        .from('lab_user_signatures')
        .delete()
        .eq('id', signatureId);

      return { error };
    }
  }
};

// Merge master data APIs into main database object

Object.assign(database, masterDataAPI, brandingSignatureAPI);

// Workflow management helpers
export const workflowVersions = {
  getAll: async () => {
    const { data, error } = await supabase
      .from('workflow_versions')
      .select(`
        *,
        workflows(name, description, type, category, lab_id, is_active)
      `)
      .order('created_at', { ascending: false });
    return { data, error };
  },

  getById: async (id: string) => {
    const { data, error } = await supabase
      .from('workflow_versions')
      .select(`
        *,
        workflows(name, description, type, category, lab_id, is_active)
      `)
      .eq('id', id)
      .single();
    return { data, error };
  },

  getByWorkflowId: async (workflowId: string) => {
    const { data, error } = await supabase
      .from('workflow_versions')
      .select('*')
      .eq('workflow_id', workflowId)
      .order('version', { ascending: false });
    return { data, error };
  },

  create: async (versionData: {
    workflow_id: string;
    version: string;
    definition: any;
    description?: string;
    active?: boolean;
  }) => {
    const { data, error } = await supabase
      .from('workflow_versions')
      .insert([versionData])
      .select()
      .single();
    return { data, error };
  },

  update: async (id: string, updates: {
    definition?: any;
    description?: string;
    active?: boolean;
  }) => {
    const { data, error } = await supabase
      .from('workflow_versions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('workflow_versions')
      .delete()
      .eq('id', id);
    return { error };
  }
};

export const workflows = {
  getAll: async () => {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .order('created_at', { ascending: false });
    return { data, error };
  },

  getById: async (id: string) => {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .single();
    return { data, error };
  },

  create: async (workflowData: {
    name: string;
    description?: string;
    type: string;
    category?: string;
    lab_id: string;
    is_active?: boolean;
  }) => {
    const { data, error } = await supabase
      .from('workflows')
      .insert([workflowData])
      .select()
      .single();
    return { data, error };
  },

  update: async (id: string, updates: {
    name?: string;
    description?: string;
    type?: string;
    category?: string;
    is_active?: boolean;
  }) => {
    const { data, error } = await supabase
      .from('workflows')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('workflows')
      .delete()
      .eq('id', id);
    return { error };
  }
};

export const aiProtocols = {
  getAll: async () => {
    const { data, error } = await supabase
      .from('ai_protocols')
      .select('*')
      .order('created_at', { ascending: false });
    return { data, error };
  },

  getById: async (id: string) => {
    const { data, error } = await supabase
      .from('ai_protocols')
      .select('*')
      .eq('id', id)
      .single();
    return { data, error };
  },

  create: async (protocolData: {
    name: string;
    description?: string;
    config: any;
    status?: string;
    lab_id: string;
  }) => {
    const { data, error } = await supabase
      .from('ai_protocols')
      .insert([protocolData])
      .select()
      .single();
    return { data, error };
  },

  update: async (id: string, updates: {
    name?: string;
    description?: string;
    config?: any;
    status?: string;
  }) => {
    const { data, error } = await supabase
      .from('ai_protocols')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('ai_protocols')
      .delete()
      .eq('id', id);
    return { error };
  }
};

export const testWorkflowMap = {
  getAll: async (labIdOverride?: string) => {
    const labId = labIdOverride || await database.getCurrentUserLabId();
    if (!labId) {
      return { data: [], error: new Error('No lab_id found for current user') };
    }

    const { data, error } = await supabase
      .from('test_workflow_map')
      .select(`
        id,
        workflow_version_id,
        test_group_id,
        analyte_id,
        is_default,
        is_active,
        priority,
        created_at,
        workflow_versions!inner(id, name),
        test_groups!inner(id, name, lab_id),
        analytes(id, name)
      `)
      .eq('test_groups.lab_id', labId)
      .order('priority', { ascending: true });
    return { data, error };
  },

  getByTestGroupId: async (testGroupId: string, labIdOverride?: string) => {
    const labId = labIdOverride || await database.getCurrentUserLabId();
    if (!labId) {
      return { data: [], error: new Error('No lab_id found for current user') };
    }

    const { data, error } = await supabase
      .from('test_workflow_map')
      .select(`
        id,
        workflow_version_id,
        test_group_id,
        analyte_id,
        is_default,
        is_active,
        priority,
        workflow_versions(id, name, definition, active),
        test_groups!inner(id, name, lab_id),
        analytes(id, name)
      `)
      .eq('test_groups.lab_id', labId)
      .eq('test_group_id', testGroupId)
      .eq('is_active', true)
      .order('priority', { ascending: true });
    return { data, error };
  },

  create: async (mappingData: {
    test_group_id?: string;
    analyte_id?: string;
    workflow_version_id: string;
    is_active?: boolean;
    is_default?: boolean;
    priority?: number;
    lab_id?: string;
  }) => {
    const labId = mappingData.lab_id || await database.getCurrentUserLabId();
    if (!labId) {
      return { data: null, error: new Error('No lab_id found for current user') };
    }

    const payload = {
      ...mappingData,
      lab_id: labId,
      is_active: mappingData.is_active ?? true,
      is_default: mappingData.is_default ?? false,
      priority: mappingData.priority ?? 1
    };

    const { data, error } = await supabase
      .from('test_workflow_map')
      .insert([payload])
      .select()
      .single();
    return { data, error };
  },

  update: async (id: string, updates: {
    workflow_version_id?: string;
    is_active?: boolean;
    is_default?: boolean;
    priority?: number;
  }, labIdOverride?: string) => {
    const labId = labIdOverride || await database.getCurrentUserLabId();
    if (!labId) {
      return { data: null, error: new Error('No lab_id found for current user') };
    }

    const { data, error } = await supabase
      .from('test_workflow_map')
      .update(updates)
      .eq('id', id)
      .eq('lab_id', labId)
      .select()
      .single();
    return { data, error };
  },

  delete: async (id: string, labIdOverride?: string) => {
    const labId = labIdOverride || await database.getCurrentUserLabId();
    if (!labId) {
      return { error: new Error('No lab_id found for current user') };
    }

    const { error } = await supabase
      .from('test_workflow_map')
      .delete()
      .eq('id', id)
      .eq('lab_id', labId);
    return { error };
  }
};

// Add workflow helpers to database object
Object.assign(database, {
  workflowVersions,
  workflows,
  aiProtocols,
  testWorkflowMap
});

async function syncLabBrandingDefaultsForLab(
  labId: string
): Promise<{ error: Error | null }> {
  const { data: labRecord, error: labFetchError } = await supabase
    .from('labs')
    .select('id, name, address, city, state, pincode, phone, email, license_number')
    .eq('id', labId)
    .maybeSingle();

  if (labFetchError) {
    return { error: labFetchError };
  }

  if (!labRecord) {
    return { error: new Error('Lab not found while syncing branding defaults') };
  }

  const { data: assets, error: assetsError } = await supabase
    .from('lab_branding_assets')
    .select('asset_type, asset_name, description, file_url, imagekit_url, variants')
    .eq('lab_id', labId)
    .eq('is_default', true)
    .in('asset_type', ['header', 'footer']);

  if (assetsError) {
    return { error: assetsError };
  }

  const assetList = Array.isArray(assets) ? (assets as BrandingAssetSnippet[]) : [];
  const headerAsset = assetList.find((asset) => asset.asset_type === 'header') ?? null;
  const footerAsset = assetList.find((asset) => asset.asset_type === 'footer') ?? null;

  const headerHtml = composeHeaderHtml(labRecord as LabContactRecord, headerAsset);
  const footerHtml = composeFooterHtml(labRecord as LabContactRecord, footerAsset);

  const updateResult = await database.labs.updateBrandingHtmlDefaults(
    {
      headerHtml,
      footerHtml,
    },
    labId
  );

  return { error: updateResult.error };
}

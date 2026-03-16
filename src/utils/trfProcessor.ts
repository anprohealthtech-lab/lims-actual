import { supabase, uploadFile, generateFilePath } from './supabase';

export interface TRFPatientInfo {
  name: string;
  age?: number;
  gender?: 'Male' | 'Female' | 'Other';
  phone?: string;
  email?: string;
  address?: string;
  confidence: number;
}

export interface TRFTestRequest {
  testName: string;
  testGroupId?: string;
  matched: boolean;
  matchedTestName?: string;
  matchConfidence?: number;
  confidence: number;
  isSelected: boolean;  // Whether the test checkbox is selected in TRF
}

export interface TRFDoctorInfo {
  name: string;
  specialization?: string;
  registrationNumber?: string;
  confidence: number;
}

export interface TRFExtractionResult {
  success: boolean;
  patientInfo?: TRFPatientInfo;
  requestedTests?: TRFTestRequest[];
  doctorInfo?: TRFDoctorInfo;
  clinicalNotes?: string;
  location?: string;
  sampleCollectionDate?: string;
  urgency?: 'Normal' | 'Urgent' | 'STAT';
  matchedPatient?: {
    id: string;
    name: string;
    phone: string;
    matchConfidence: number;
    matchReason?: 'phone_and_name' | 'phone_only' | 'phone_only_name_mismatch' | 'name_only';
  };
  matchedDoctor?: {
    id: string;
    name: string;
    specialization?: string;
    matchConfidence: number;
  };
  error?: string;
  metadata?: any;
}

export interface TRFProcessingProgress {
  stage: 'uploading' | 'ocr' | 'nlp' | 'matching' | 'complete' | 'error';
  message: string;
  progress: number; // 0-100
}

/**
 * Upload TRF image and process with OCR + NLP
 */
export async function processTRFImage(
  file: File,
  onProgress?: (progress: TRFProcessingProgress) => void,
  options?: {
    enableOptimization?: boolean;
  }
): Promise<TRFExtractionResult> {
  try {
    // Stage 0: Optimize image if enabled (default: true)
    const enableOptimization = options?.enableOptimization !== false;
    let fileToUpload = file;
    
    if (enableOptimization && file.type.startsWith('image/')) {
      onProgress?.({
        stage: 'uploading',
        message: 'Optimizing image for faster processing...',
        progress: 5
      });

      try {
        // Dynamic import to avoid circular dependencies
        const { smartOptimizeImage } = await import('./imageOptimizer');
        const result = await smartOptimizeImage(file);
        fileToUpload = result.file;
        
        if (result.stats) {
          console.log(`TRF image optimized: ${result.stats.savedPercent}% reduction`, {
            original: `${(result.stats.originalSize / 1024 / 1024).toFixed(2)} MB`,
            optimized: `${(result.stats.optimizedSize / 1024 / 1024).toFixed(2)} MB`
          });
        }
      } catch (optimizationError) {
        console.warn('Image optimization failed, using original file:', optimizationError);
        // Continue with original file if optimization fails
      }
    }

    // Stage 1: Upload file
    onProgress?.({
      stage: 'uploading',
      message: 'Uploading test request form...',
      progress: 10
    });

    const filePath = generateFilePath(
      fileToUpload.name,
      undefined,
      undefined,
      'trf-uploads'
    );

    const uploadResult = await uploadFile(fileToUpload, filePath);

    // Get current user's lab_id
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    // Get user's lab_id from the users table
    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .select('lab_id')
      .eq('id', userId)
      .single();

    if (userError || !userRecord?.lab_id) {
      throw new Error('Failed to get user lab information');
    }

    const labId = userRecord.lab_id;

    // Create a temporary UUID for pending attachments (will be updated when order is created)
    // Using a well-known UUID that indicates "pending order association"
    const PENDING_ORDER_UUID = '00000000-0000-0000-0000-000000000000';
    
    // Create attachment record
    const { data: attachment, error: attachmentError } = await supabase
      .from('attachments')
      .insert({
        related_table: 'orders',
        related_id: PENDING_ORDER_UUID, // Temporary placeholder UUID, will be updated when order is created
        file_url: uploadResult.publicUrl,
        file_path: uploadResult.path,
        original_filename: file.name,
        stored_filename: filePath.split('/').pop(),
        file_type: file.type,
        file_size: file.size,
        description: 'Test Request Form for order creation',
        uploaded_by: userId,
        lab_id: labId, // Required field
        upload_timestamp: new Date().toISOString(),
        processing_status: 'pending' // Mark as pending for TRF processing
      })
      .select()
      .single();

    if (attachmentError) {
      throw new Error(`Failed to save attachment: ${attachmentError.message}`);
    }

    // Stage 2: OCR + NLP Processing
    onProgress?.({
      stage: 'ocr',
      message: 'Extracting text with Google Vision AI...',
      progress: 30
    });

    const { data, error } = await supabase.functions.invoke('process-trf', {
      body: { attachmentId: attachment.id }
    });

    if (error) {
      throw new Error(`TRF processing failed: ${error.message}`);
    }

    onProgress?.({
      stage: 'nlp',
      message: 'Analyzing document with AI...',
      progress: 60
    });

    // Simulate NLP stage (already done in backend)
    await new Promise(resolve => setTimeout(resolve, 500));

    onProgress?.({
      stage: 'matching',
      message: 'Matching tests and patients...',
      progress: 80
    });

    // Simulate matching stage (already done in backend)
    await new Promise(resolve => setTimeout(resolve, 500));

    onProgress?.({
      stage: 'complete',
      message: 'Processing complete!',
      progress: 100
    });

    return {
      ...data,
      attachmentId: attachment.id
    };

  } catch (error: any) {
    onProgress?.({
      stage: 'error',
      message: error.message || 'Failed to process TRF',
      progress: 0
    });

    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
}

/**
 * Convert TRF extraction result to order form data
 */
export function trfToOrderFormData(extraction: TRFExtractionResult) {
  // Filter to only include tests that are marked as selected (isSelected: true)
  const selectedTests = extraction.requestedTests?.filter(test => 
    test.matched && test.testGroupId && test.isSelected === true
  ) || [];

  const unselectedTests = extraction.requestedTests?.filter(test => 
    !test.matched || !test.testGroupId || test.isSelected !== true
  ) || [];

  return {
    // Patient data
    patientData: extraction.patientInfo ? {
      name: extraction.patientInfo.name || '',
      age: extraction.patientInfo.age?.toString() || '',
      gender: extraction.patientInfo.gender || 'Male',
      phone: extraction.patientInfo.phone || '',
      email: extraction.patientInfo.email || '',
      address: extraction.patientInfo.address || ''
    } : null,

    // Matched patient ID (if found)
    matchedPatientId: extraction.matchedPatient?.id || null,
    matchConfidence: extraction.matchedPatient?.matchConfidence || 0,

    // Test selections (only matched tests that are marked as selected)
    selectedTestIds: selectedTests.map(test => test.testGroupId!),

    // Unmatched tests (for manual selection)
    unmatchedTests: unselectedTests.map(test => test.testName),

    // Clinical notes
    clinicalNotes: extraction.clinicalNotes || '',

    // Other metadata
    urgency: extraction.urgency || 'Normal',
    doctorName: extraction.doctorInfo?.name || '',
    location: extraction.location || '',
    expectedDate: extraction.sampleCollectionDate || new Date().toISOString().split('T')[0]
  };
}

/**
 * Format confidence score for display
 */
export function formatConfidence(confidence: number): {
  label: string;
  color: string;
  bgColor: string;
} {
  if (confidence >= 0.9) {
    return {
      label: 'High Confidence',
      color: 'text-green-700',
      bgColor: 'bg-green-100'
    };
  } else if (confidence >= 0.7) {
    return {
      label: 'Medium Confidence',
      color: 'text-yellow-700',
      bgColor: 'bg-yellow-100'
    };
  } else {
    return {
      label: 'Low Confidence',
      color: 'text-red-700',
      bgColor: 'bg-red-100'
    };
  }
}

/**
 * Validate extracted patient data
 */
export function validatePatientData(patientInfo?: TRFPatientInfo): {
  isValid: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  if (!patientInfo) {
    return { isValid: false, missing: ['All patient information'] };
  }

  if (!patientInfo.name || patientInfo.name.trim().length < 2) {
    missing.push('Patient name');
  }

  if (!patientInfo.phone || !/^\d{10}$/.test(patientInfo.phone.replace(/\D/g, ''))) {
    missing.push('Valid phone number');
  }

  return {
    isValid: missing.length === 0,
    missing
  };
}

/**
 * Auto-create patient from TRF extraction if not matched
 */
export async function autoCreatePatientFromTRF(
  patientInfo: TRFPatientInfo,
  labId: string
): Promise<{ id: string; name: string; age?: number; gender?: string; phone?: string; age_unit?: string; [key: string]: any } | null> {
  try {
    // Validate required fields
    if (!patientInfo.name || !patientInfo.phone) {
      console.warn('Cannot auto-create patient: missing name or phone');
      return null;
    }

    // Create patient with default values for all required NOT NULL fields
    const { data: newPatient, error } = await supabase
      .from('patients')
      .insert({
        name: patientInfo.name,
        age: patientInfo.age || 0,  // Default age to 0 if not provided (NOT NULL constraint)
        gender: patientInfo.gender || 'Male',
        phone: patientInfo.phone,
        email: patientInfo.email || '',  // Default to empty string
        address: patientInfo.address || '',  // NOT NULL constraint
        city: '',  // NOT NULL constraint
        state: '',  // NOT NULL constraint
        pincode: '',  // NOT NULL constraint
        lab_id: labId,
        created_at: new Date().toISOString(),
      })
      .select('id, name, age, gender, phone, age_unit, dob, date_of_birth, default_doctor_id, default_location_id, default_payment_type')
      .single();

    if (error) {
      console.error('Failed to auto-create patient:', error);
      return null;
    }

    console.log('Auto-created patient:', newPatient);
    return newPatient;
  } catch (error) {
    console.error('Error in autoCreatePatientFromTRF:', error);
    return null;
  }
}

/**
 * Find doctor by name (exact or fuzzy match) - DO NOT create new doctor
 */
export async function findDoctorByName(
  doctorName: string,
  labId: string
): Promise<{ id: string; name: string } | null> {
  try {
    if (!doctorName || doctorName.trim().length < 2) {
      console.log('❌ Doctor name too short or empty:', doctorName);
      return null;
    }

    console.log(`🔍 Searching for doctor: "${doctorName}" in lab: ${labId}`);

    // Search for exact match first
    const { data: exactMatch, error: exactError } = await supabase
      .from('doctors')
      .select('id, name')
      .eq('lab_id', labId)
      .ilike('name', doctorName.trim())
      .maybeSingle(); // Use maybeSingle() instead of single() to avoid error on no results

    if (exactMatch && !exactError) {
      console.log('✓ Found exact doctor match:', exactMatch);
      return exactMatch;
    }

    console.log('⚠ No exact match, trying fuzzy search...');

    // Search for partial match (fuzzy)
    const { data: doctors } = await supabase
      .from('doctors')
      .select('id, name')
      .eq('lab_id', labId);

    console.log(`📋 Found ${doctors?.length || 0} doctors in lab for fuzzy matching`);
    if (doctors && doctors.length > 0) {
      console.log(`📋 Sample doctors:`, doctors.slice(0, 5).map(d => `"${d.name}"`).join(', '));
    }

    if (doctors && doctors.length > 0) {
      // Normalize name: remove periods, extra spaces, and convert to lowercase
      const normalizeDocName = (name: string) => 
        name.toLowerCase()
          .replace(/\./g, '') // Remove periods
          .replace(/\s+/g, ' ') // Collapse multiple spaces
          .trim();
      
      const searchName = normalizeDocName(doctorName);
      console.log(`🔍 Normalized search name: "${searchName}"`);
      
      for (const doctor of doctors) {
        const docName = normalizeDocName(doctor.name || '');
        
        // Check if names contain each other (after normalization)
        if (docName.includes(searchName) || searchName.includes(docName)) {
          console.log(`✓ Found fuzzy doctor match: "${doctor.name}" (normalized: "${docName}")`);
          return doctor;
        }
      }
    }

    // No match found - DO NOT create new doctor
    console.log('❌ No doctor match found for:', doctorName);
    return null;
  } catch (error) {
    console.error('Error in findDoctorByName:', error);
    return null;
  }
}

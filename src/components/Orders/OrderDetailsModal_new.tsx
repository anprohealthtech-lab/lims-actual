import React, { useState } from 'react';
import { X, Upload, FileText, Brain, Zap, CheckCircle, AlertTriangle, Target, Layers, TestTube2, QrCode, Calendar, Clock, ArrowRight, Printer } from 'lucide-react';
import QRCodeLib from 'qrcode';
import { supabase, uploadFile, generateFilePath, database } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { calculateFlagsForResults } from '../../utils/flagCalculation';

interface WorkflowStep {
  name: string;
  description: string;
  completed: boolean;
  current: boolean;
  timestamp?: string;
}

interface NextStep {
  action: string;
  description: string;
  urgent?: boolean;
  priority?: 'low' | 'medium' | 'high';
  assignedTo?: string;
  deadline?: string;
}

interface StatusAction {
  status: string;
  label: string;
  primary?: boolean;
}

// Helper function to get workflow steps based on current status
const getWorkflowSteps = (currentStatus: string): WorkflowStep[] => {
  const allSteps = [
    { name: 'Order Created', description: 'Order placed and confirmed' },
    { name: 'Sample Collection', description: 'Collect sample from patient' },
    { name: 'In Progress', description: 'Laboratory analysis in progress' },
    { name: 'Pending Approval', description: 'Results awaiting approval' },
    { name: 'Completed', description: 'Results approved and ready' },
    { name: 'Delivered', description: 'Results delivered to patient' },
  ];

  const statusOrder = ['Order Created', 'Sample Collection', 'In Progress', 'Pending Approval', 'Completed', 'Delivered'];
  const currentIndex = statusOrder.indexOf(currentStatus);

  return allSteps.map((step, index) => ({
    ...step,
    completed: index < currentIndex,
    current: index === currentIndex,
    timestamp: index <= currentIndex ? new Date().toISOString() : undefined
  }));
};

// Helper function to get next steps based on current status
const getNextSteps = (currentStatus: string, order: any): NextStep[] => {
  switch (currentStatus) {
    case 'Order Created':
      return [
        {
          action: 'Collect Sample',
          description: `Collect ${order.color_name || 'assigned'} tube sample from patient ${order.patient_name}`,
          urgent: true,
          priority: 'high',
          assignedTo: 'Sample Collection Team',
          deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
        }
      ];
    case 'Sample Collection':
      return [
        {
          action: 'Begin Laboratory Analysis',
          description: 'Process sample and begin testing procedures',
          priority: 'high',
          assignedTo: 'Laboratory Team',
          deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
        }
      ];
    case 'In Progress':
      return [
        {
          action: 'Complete Testing',
          description: 'Finish all laboratory tests and enter results',
          priority: 'medium',
          assignedTo: 'Lab Technicians',
        },
        {
          action: 'Enter Results',
          description: 'Input test results into the system',
          priority: 'high',
          assignedTo: 'Data Entry Team',
        }
      ];
    case 'Pending Approval':
      return [
        {
          action: 'Review & Approve Results',
          description: 'Medical review and approval of test results',
          urgent: true,
          priority: 'high',
          assignedTo: 'Medical Officer',
          deadline: order.expected_date
        }
      ];
    case 'Completed':
      return [
        {
          action: 'Deliver Results',
          description: 'Send results to patient via preferred method',
          priority: 'medium',
          assignedTo: 'Patient Services',
        }
      ];
    case 'Delivered':
      return [
        {
          action: 'Follow Up',
          description: 'Follow up with patient if needed',
          priority: 'low',
          assignedTo: 'Patient Care Team',
        }
      ];
    default:
      return [];
  }
};

// Helper function to get available status actions
const getAvailableStatusActions = (currentStatus: string): StatusAction[] => {
  switch (currentStatus) {
    case 'Order Created':
      return [
        { status: 'Sample Collection', label: 'Mark Sample Collected', primary: true }
      ];
    case 'Sample Collection':
      return [
        { status: 'In Progress', label: 'Start Processing', primary: true }
      ];
    case 'In Progress':
      return [
        { status: 'Pending Approval', label: 'Submit for Approval', primary: true }
      ];
    case 'Pending Approval':
      return [
        { status: 'Completed', label: 'Approve Results', primary: true },
        { status: 'In Progress', label: 'Return for Revision' }
      ];
    case 'Completed':
      return [
        { status: 'Delivered', label: 'Mark as Delivered', primary: true }
      ];
    default:
      return [];
  }
};

interface ExtractedValue {
  parameter: string;
  value: string;
  unit: string;
  reference: string;
  flag?: string;
}

interface Order {
  id: string;
  patient_name: string;
  patient_id: string;
  tests: string[];
  status: string;
  priority: string;
  order_date: string;
  expected_date: string;
  total_amount: number;
  doctor: string;
  // Sample tracking fields
  sample_id?: string;
  color_code?: string;
  color_name?: string;
  qr_code_data?: string;
  sample_collected_at?: string;
  sample_collected_by?: string;
}

interface OrderDetailsModalProps {
  order: Order;
  onClose: () => void;
  onUpdateStatus: (orderId: string, newStatus: string) => void;
  onSubmitResults: (orderId: string, resultsData: ExtractedValue[]) => void;
}

const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({
  order,
  onClose,
  onUpdateStatus,
  onSubmitResults
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'details' | 'results'>('details');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);
  const [ocrResults, setOcrResults] = useState<any>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [extractedValues, setExtractedValues] = useState<ExtractedValue[]>([]);
  const [manualValues, setManualValues] = useState<ExtractedValue[]>([]);
  const [allAnalytes, setAllAnalytes] = useState<any[]>([]);
  const [existingResultId, setExistingResultId] = useState<string | null>(null);
  const [orderAnalytes, setOrderAnalytes] = useState<any[]>([]);
  const [selectedAnalyteForAI, setSelectedAnalyteForAI] = useState<any | null>(null);
  const [aiProcessingConfig, setAiProcessingConfig] = useState<{type: string, prompt?: string} | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submittingResults, setSubmittingResults] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Function to generate QR code as data URL for display
  const generateQRCodeDataURL = async (data: string): Promise<string> => {
    try {
      return await QRCodeLib.toDataURL(data, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
    } catch (error) {
      console.error('Error generating QR code:', error);
      // Fallback to placeholder pattern
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 200;
      canvas.height = 200;
      
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = '#ffffff';
        
        // Create a simple pattern as fallback
        for (let i = 0; i < 20; i++) {
          for (let j = 0; j < 20; j++) {
            if ((i + j) % 3 === 0 || i === j) {
              ctx.fillRect(i * 10, j * 10, 10, 10);
            }
          }
        }
      }
      
      return canvas.toDataURL('image/png');
    }
  };

  // State for QR code image
  const [qrCodeImage, setQrCodeImage] = useState<string>('');

  // Generate QR code when component mounts or QR data changes
  React.useEffect(() => {
    if (order.qr_code_data) {
      generateQRCodeDataURL(order.qr_code_data).then(setQrCodeImage);
    }
  }, [order.qr_code_data]);

  // Function to print QR code
  const handlePrintQRCode = async () => {
    if (!order.qr_code_data) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const qrCodeImageForPrint = await generateQRCodeDataURL(order.qr_code_data);
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Sample QR Code - ${order.sample_id}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 20px;
              text-align: center;
            }
            .qr-container {
              border: 2px solid #000;
              padding: 20px;
              display: inline-block;
              margin: 20px;
            }
            .qr-code {
              width: 200px;
              height: 200px;
              margin: 10px auto;
              border: 1px solid #ccc;
            }
            .sample-info {
              margin-top: 20px;
              text-align: left;
            }
            .sample-info div {
              margin: 5px 0;
            }
            .color-indicator {
              width: 30px;
              height: 30px;
              border-radius: 50%;
              display: inline-block;
              margin-right: 10px;
              vertical-align: middle;
              border: 2px solid #333;
            }
            @media print {
              body { margin: 0; }
            }
          </style>
        </head>
        <body>
          <div class="qr-container">
            <h2>Sample Tracking Label</h2>
            <img src="${qrCodeImageForPrint}" alt="QR Code" class="qr-code" />
            <div class="sample-info">
              <div><strong>Sample ID:</strong> ${order.sample_id}</div>
              <div><strong>Patient:</strong> ${order.patient_name}</div>
              <div><strong>Order ID:</strong> ${order.id}</div>
              <div>
                <strong>Sample Tube:</strong>
                <span class="color-indicator" style="background-color: ${order.color_code}"></span>
                ${order.color_name}
              </div>
              <div><strong>Order Date:</strong> ${new Date(order.order_date).toLocaleDateString()}</div>
              <div><strong>Tests:</strong> ${order.tests.join(', ')}</div>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() {
                window.close();
              };
            };
          </script>
        </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  React.useEffect(() => {
    // Fetch all analytes from database
    fetchAllAnalytes();
    
    // Fetch analytes for this order
    fetchOrderAnalytes();
  }, []);

  // Update manual values when order analytes are loaded
  React.useEffect(() => {
    if (orderAnalytes.length > 0) {
      setManualValues(orderAnalytes.map(analyte => ({
        parameter: analyte.name,
        value: '',
        unit: analyte.unit || '',
        reference: analyte.reference_range || '',
        flag: undefined
      })));
      
      // After setting analytes, load existing results if any
      fetchExistingResult();
    }
  }, [orderAnalytes]);

  const fetchAllAnalytes = async () => {
    try {
      const { data, error } = await supabase
        .from('analytes')
        .select('id, name, unit, reference_range, low_critical, high_critical, category, ai_processing_type, ai_prompt_override')
        .eq('is_active', true);
      
      if (error) {
        console.error('Error fetching analytes:', error);
      } else {
        setAllAnalytes(data || []);
        console.log('Fetched analytes for AI extraction:', data?.length || 0);
      }
    } catch (err) {
      console.error('Error fetching analytes:', err);
    }
  };

  const fetchOrderAnalytes = async () => {
    try {
      // Get test groups for this order
      const { data: orderData, error: orderError } = await database.orders.getById(order.id);
      
      if (orderError || !orderData) {
        console.error('Error fetching order details:', orderError);
        return;
      }
      
      // Get test groups from order_tests (already sorted by newest first)
      const testNames = orderData.order_tests?.map((test: any) => test.test_name) || order.tests;
      
      console.log('Test names in order:', testNames);
      
      // Get current user's lab_id
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) {
        console.error('No lab context found');
        return;
      }

      // Fetch test groups that match the test names (lab-scoped)
      const { data: testGroups, error: testGroupsError } = await supabase
        .from('test_groups')
        .select(`
          id,
          name,
          test_group_analytes(
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
        .in('name', testNames)
        .or(`lab_id.eq.${lab_id},lab_id.is.null`);
      
      if (testGroupsError) {
        console.error('Error fetching test groups:', testGroupsError);
        return;
      }
      
      console.log('Fetched test groups:', testGroups);
      
      // Extract analytes in the same order as testNames (preserve order)
      const allAnalytes: any[] = [];
      testNames.forEach((testName: string) => {
        const matchingTestGroup = testGroups?.find(tg => tg.name === testName);
        if (matchingTestGroup && matchingTestGroup.test_group_analytes) {
          const testAnalytes = matchingTestGroup.test_group_analytes.map((tga: any) => tga.analytes);
          allAnalytes.push(...testAnalytes);
        }
      });
      
      console.log('Extracted analytes from test groups:', allAnalytes);
      
      if (allAnalytes.length > 0) {
        setOrderAnalytes(allAnalytes);
        console.log('Set order analytes with AI config:', allAnalytes.length);
      }
    } catch (err) {
      console.error('Error fetching order analytes:', err);
    }
  };

  const fetchExistingResult = async () => {
    try {
      const { data, error } = await database.results.getByOrderId(order.id);
      
      if (error) {
        console.error('Error fetching existing result:', error);
        return;
      }
      
      if (data && data.length > 0) {
        const mostRecentResult = data[0]; // Get the most recent result
        setExistingResultId(mostRecentResult.id);
        
        // Populate manual values with existing result values
        if (mostRecentResult.result_values && mostRecentResult.result_values.length > 0) {
          setManualValues(prevManualValues => {
            const updatedValues = [...prevManualValues];
            mostRecentResult.result_values.forEach((resultValue: any) => {
              const index = updatedValues.findIndex(val => val.parameter === resultValue.parameter);
              if (index !== -1) {
                updatedValues[index] = {
                  ...updatedValues[index],
                  value: resultValue.value,
                  unit: resultValue.unit,
                  reference: resultValue.reference_range,
                  flag: resultValue.flag
                };
              }
            });
            return updatedValues;
          });
        }
      }
    } catch (err) {
      console.error('Error fetching existing result:', err);
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setOcrError(null);
    
    try {
      // Generate file path for order results
      const filePath = generateFilePath(
        file.name, 
        order.patient_id, 
        undefined, 
        'order-results'
      );
      
      // Upload to Supabase Storage
      const uploadResult = await uploadFile(file, filePath);
      
      // Get current user's lab_id
      const currentLabId = await database.getCurrentUserLabId();
      
      // Insert attachment record
      const { data: attachment, error } = await supabase
        .from('attachments')
        .insert([{
          patient_id: order.patient_id,
          lab_id: currentLabId,
          related_table: 'orders',
          related_id: order.id,
          file_url: uploadResult.publicUrl,
          file_path: uploadResult.path,
          original_filename: file.name,
          stored_filename: filePath.split('/').pop(),
          file_type: file.type,
          file_size: file.size,
          description: `Lab result document for order ${order.id}`,
          uploaded_by: user?.id || null,
          upload_timestamp: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to save attachment metadata: ${error.message}`);
      }
      
      setAttachmentId(attachment.id);
      setUploadedFile(file);
      
      console.log('File uploaded successfully for order:', {
        orderId: order.id,
        attachmentId: attachment.id,
        filePath: uploadResult.path
      });
      
    } catch (error) {
      console.error('Error uploading file:', error);
      setOcrError('Failed to upload file. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleRunAIProcessing = async (analyteConfig?: {type: string, prompt?: string}) => {
    if (!attachmentId) {
      setOcrError('Please upload a file first.');
      return;
    }
    
    const processingType = analyteConfig?.type || aiProcessingConfig?.type || 'ocr_report';
    const customPrompt = analyteConfig?.prompt || aiProcessingConfig?.prompt;
    
    console.log('Starting AI processing for order results:', {
      attachmentId,
      processingType,
      hasCustomPrompt: !!customPrompt
    });
    
    setIsOCRProcessing(true);
    setOcrError(null);
    
    // Identify analytes that are currently missing values in the manual entry form
    const analytesToExtract = manualValues
      .filter(val => val.value.trim() === '')
      .map(val => val.parameter);

    console.log('Analytes to extract:', analytesToExtract);

    try {
      // Step 1: Call vision-ocr Edge Function
      console.log('Calling vision-ocr Edge Function...');
      const visionResponse = await supabase.functions.invoke('vision-ocr', {
        body: {
          attachmentId,
          documentType: processingType === 'ocr_report' ? 'printed-report' : undefined,
          testType: processingType === 'vision_card' ? 'test-card' : 
                   processingType === 'vision_color' ? 'color-analysis' : undefined,
          aiProcessingType: processingType,
          analysisType: processingType === 'ocr_report' ? 'text' :
                       processingType === 'vision_card' ? 'objects' :
                       processingType === 'vision_color' ? 'colors' : 'all'
        }
      });
      
      if (visionResponse.error) {
        throw new Error(`Vision OCR failed: ${visionResponse.error.message}`);
      }
      
      const visionData = visionResponse.data;
      console.log('Vision OCR completed. Extracted text length:', visionData.fullText?.length || 0);
      
      // Use the detected processing type from vision-ocr response (auto-detection result)
      const detectedProcessingType = visionData?.metadata?.aiProcessingType || processingType;
      console.log('Using processing type:', detectedProcessingType, '(detected from vision-ocr)');
      
      // Step 2: Call gemini-nlp Edge Function with metadata headers
      console.log('Calling gemini-nlp Edge Function...');
      const geminiResponse = await supabase.functions.invoke('gemini-nlp', {
        body: {
          rawText: visionData.fullText,
          visionResults: visionData,
          originalBase64Image: visionData.originalBase64Image,
          documentType: detectedProcessingType === 'ocr_report' ? 'printed-report' : undefined,
          testType: detectedProcessingType === 'vision_card' ? 'test-card' :
                   detectedProcessingType === 'vision_color' ? 'color-analysis' : undefined,
          aiProcessingType: detectedProcessingType,  // Use detected type from vision-ocr
          aiPromptOverride: customPrompt,
          allAnalytes: allAnalytes,
          analytesToExtract: analytesToExtract.length > 0 ? analytesToExtract : undefined,
        },
        headers: {
          'x-attachment-id': attachmentId,
          'x-order-id': order.id
        }
      });
      
      if (geminiResponse.error) {
        throw new Error(`Gemini NLP failed: ${geminiResponse.error.message}`);
      }
      
      const result = geminiResponse.data;
      console.log('Gemini NLP completed successfully. Result:', result);
      
      // Check if the response is the simplified key-value pair object
      if (analytesToExtract.length > 0 && result && typeof result === 'object' && !Array.isArray(result) && !result.extractedParameters) {
        console.log('Received simplified AI response. Updating manual values.');
        setOcrResults(result); // Store the raw AI response for debugging if needed

        setManualValues(prevManualValues => {
          const updatedValues = [...prevManualValues];
          for (const paramName in result) {
            if (Object.prototype.hasOwnProperty.call(result, paramName)) {
              const extractedValue = result[paramName];
              const index = updatedValues.findIndex(val => val.parameter === paramName);
              if (index !== -1) {
                updatedValues[index] = { ...updatedValues[index], value: extractedValue };
              }
            }
          }
          return updatedValues;
        });

        // Clear extractedValues as they are not directly used in this flow
        setExtractedValues([]);

      } else if (result.extractedParameters && Array.isArray(result.extractedParameters)) {
        // This is the detailed response, handle it as before if analytesToExtract was not used
        const extractedParams = result.extractedParameters.map((param: any) => ({
          parameter: param.parameter,
          value: param.value,
          unit: param.unit || '',
          reference: param.reference_range || '',
          flag: param.flag || undefined,
          matched: !!param.matched,
          analyte_id: param.analyte_id || null,
          confidence: param.confidence || 0.95,
        }));

        setExtractedValues(extractedParams);
        setOcrResults(result);

        // Merge extracted values into manual values for display
        setManualValues(prevManualValues => {
          const updatedValues = [...prevManualValues];
          extractedParams.forEach((extracted: any) => {
            const index = updatedValues.findIndex(val => val.parameter === extracted.parameter);
            if (index !== -1) {
              updatedValues[index] = { ...updatedValues[index], value: extracted.value, flag: extracted.flag };
            }
          });
          return updatedValues;
        });

        console.log('OCR results processed (detailed):', {
          extractedCount: extractedParams.length,
          matchedCount: extractedParams.filter((p: any) => p.matched).length,
        });

      } else if (result.rawText) { // Fallback for raw text
        setOcrError('OCR extracted text but could not parse structured data. Please enter results manually.');
        console.log('Raw OCR text:', result.rawText);
      } else {
        setOcrError('No structured data could be extracted from the document.');
      }
      
    } catch (error) {
      console.error('Error running AI processing - Full details:', error);
      setOcrError('Failed to process document. Please try again.');
    } finally {
      setIsOCRProcessing(false);
    }
  };

  const handleManualValueChange = (index: number, field: keyof ExtractedValue, value: string) => {
    setManualValues(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handleSaveDraft = async () => {
    const validResults = manualValues.filter(value => value.value.trim() !== '');
    if (validResults.length === 0) {
      alert('Please enter at least one test result before saving draft.');
      return;
    }
    
    setSavingDraft(true);
    setSaveMessage(null);
    
    try {
      // Prepare result values with calculated flags
      const resultValues = validResults.map(item => ({
        parameter: item.parameter,
        value: item.value,
        unit: item.unit,
        reference_range: item.reference,
        flag: item.flag // Keep existing flag if manually set
      }));

      // Auto-calculate flags for values that don't have them
      const valuesWithFlags = calculateFlagsForResults(resultValues);

      const resultData = {
        order_id: order.id,
        patient_name: order.patient_name,
        patient_id: order.patient_id,
        test_name: order.tests.join(', '),
        status: 'Entered' as const,
        entered_by: user?.user_metadata?.full_name || user?.email || 'Unknown User',
        entered_date: new Date().toISOString().split('T')[0],
        values: valuesWithFlags
      };
      
      let result;
      if (existingResultId) {
        // Update existing result
        const { data, error } = await database.results.update(existingResultId, resultData);
        if (error) {
          throw new Error(`Failed to update draft: ${error.message}`);
        }
        result = data;
      } else {
        // Create new result
        const { data, error } = await database.results.create(resultData);
        if (error) {
          throw new Error(`Failed to save draft: ${error.message}`);
        }
        result = data;
        setExistingResultId(result.id);
      }
      
      setSaveMessage('Draft saved successfully!');
      setTimeout(() => setSaveMessage(null), 3000);
      
    } catch (error) {
      console.error('Error saving draft:', error);
      setSaveMessage('Failed to save draft. Please try again.');
      setTimeout(() => setSaveMessage(null), 5000);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmitResults = () => {
    const validResults = manualValues.filter(value => value.value.trim() !== '');
    if (validResults.length === 0) {
      alert('Please enter at least one test result.');
      return;
    }
    
    setSubmittingResults(true);
    
    try {
      const resultData = {
        order_id: order.id,
        patient_name: order.patient_name,
        patient_id: order.patient_id,
        test_name: order.tests.join(', '),
        status: 'Under Review' as const,
        entered_by: user?.user_metadata?.full_name || user?.email || 'Unknown User',
        entered_date: new Date().toISOString().split('T')[0],
        values: validResults.map(item => ({
          parameter: item.parameter,
          value: item.value,
          unit: item.unit,
          reference_range: item.reference,
          flag: item.flag
        }))
      };
      
      if (existingResultId) {
        // Update existing result with final submission
        database.results.update(existingResultId, resultData)
          .then(({ data, error }) => {
            if (error) {
              console.error('Error updating result:', error);
              setSubmittingResults(false);
              return;
            }
            console.log('Result updated successfully:', data);
            onSubmitResults(order.id, validResults);
            setSubmittingResults(false);
          })
          .catch((error) => {
            console.error('Error updating result:', error);
            setSubmittingResults(false);
          });
      } else {
        // Create new result for final submission
        database.results.create(resultData)
          .then(({ data, error }) => {
            if (error) {
              console.error('Error creating result:', error);
              setSubmittingResults(false);
              return;
            }
            console.log('Result created successfully:', data);
            setExistingResultId(data.id);
            onSubmitResults(order.id, validResults);
            setSubmittingResults(false);
          })
          .catch((error) => {
            console.error('Error creating result:', error);
            setSubmittingResults(false);
          });
      }
    } catch (error) {
      console.error('Error submitting results:', error);
      setSubmittingResults(false);
    }
  };

  const handleSelectAnalyteForAI = (analyte: any) => {
    setSelectedAnalyteForAI(analyte);
    setAiProcessingConfig({
      type: analyte.ai_processing_type || 'ocr_report',
      prompt: analyte.ai_prompt_override || undefined
    });
  };

  // Utility functions for styling
  const styleUtils = {
    aiProcessingType: {
      label: (type: string) => ({
        'none': 'Manual Entry Only',
        'ocr_report': 'OCR Report Processing',
        'vision_card': 'Vision Card Analysis',
        'vision_color': 'Vision Color Analysis'
      }[type] || type),
      color: (type: string) => ({
        'none': 'bg-gray-100 text-gray-800',
        'ocr_report': 'bg-blue-100 text-blue-800',
        'vision_card': 'bg-green-100 text-green-800',
        'vision_color': 'bg-purple-100 text-purple-800'
      }[type] || 'bg-gray-100 text-gray-800')
    },
    status: (status: string) => ({
      'Sample Collection': 'bg-blue-100 text-blue-800',
      'In Progress': 'bg-orange-100 text-orange-800',
      'Pending Approval': 'bg-yellow-100 text-yellow-800',
      'Completed': 'bg-green-100 text-green-800',
      'Delivered': 'bg-gray-100 text-gray-800',
    }[status] || 'bg-gray-100 text-gray-800'),
    priority: (priority: string) => ({
      'Normal': 'bg-gray-100 text-gray-800',
      'Urgent': 'bg-orange-100 text-orange-800',
      'STAT': 'bg-red-100 text-red-800',
    }[priority] || 'bg-gray-100 text-gray-800'),
    flag: (flag?: string) => {
      switch (flag) {
        case 'H': case 'High': return 'text-red-600 bg-red-100';
        case 'L': case 'Low': return 'text-blue-600 bg-blue-100';
        case 'C': case 'Critical': return 'text-orange-600 bg-orange-100';
        default: return '';
      }
    },
    confidence: (confidence: number) => {
      if (confidence >= 0.95) return 'text-green-600 bg-green-100';
      if (confidence >= 0.90) return 'text-yellow-600 bg-yellow-100';
      return 'text-red-600 bg-red-100';
    }
  };

  const getAIProcessingTypeLabel = styleUtils.aiProcessingType.label;
  const getAIProcessingTypeColor = styleUtils.aiProcessingType.color;
  const getStatusColor = styleUtils.status;
  const getPriorityColor = styleUtils.priority;
  const getFlagColor = styleUtils.flag;
  const getConfidenceColor = styleUtils.confidence;

  // Constants
  const FLAG_OPTIONS = [
    { value: '', label: 'Normal' },
    { value: 'H', label: 'High' },
    { value: 'L', label: 'Low' },
    { value: 'C', label: 'Critical' }
  ];

  // Render file upload section
  const renderFileUpload = () => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Upload {
          aiProcessingConfig?.type === 'vision_card' ? 'Test Card Image' :
          aiProcessingConfig?.type === 'vision_color' ? 'Color Analysis Image' :
          'Lab Result Document'
        }
      </label>
      <div className="border-2 border-dashed border-purple-300 rounded-lg p-4 text-center hover:border-purple-400 transition-colors">
        {uploadedFile ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center">
              <div className="bg-purple-100 p-3 rounded-full">
                <FileText className="h-8 w-8 text-purple-600" />
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{uploadedFile.name}</div>
              <div className="text-xs text-gray-500">{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</div>
              {aiProcessingConfig && (
                <div className="text-xs text-purple-600 mt-1">
                  AI Type: {getAIProcessingTypeLabel(aiProcessingConfig.type)}
                </div>
              )}
            </div>
            <button
              onClick={() => document.getElementById('file-upload')?.click()}
              className="text-purple-600 hover:text-purple-700 text-sm font-medium bg-purple-100 px-3 py-1 rounded"
            >
              Change File
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="bg-purple-100 p-3 rounded-full">
                <Upload className="h-8 w-8 text-purple-600" />
              </div>
            </div>
            <div>
              <button
                onClick={() => document.getElementById('file-upload')?.click()}
                disabled={isUploading}
                className="flex items-center justify-center mx-auto px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed transition-colors"
              >
                {isUploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload {
                      aiProcessingConfig?.type === 'vision_card' ? 'Test Card' :
                      aiProcessingConfig?.type === 'vision_color' ? 'Color Image' :
                      'Document'
                    }
                  </>
                )}
              </button>
              <p className="text-xs text-gray-500 mt-2">
                {aiProcessingConfig?.type === 'ocr_report' ? 'Supports JPG, PNG, PDF (max 10MB)' :
                 'Supports JPG, PNG (max 10MB)'}
              </p>
              {aiProcessingConfig && (
                <p className="text-xs text-purple-600 mt-1">
                  Optimized for: {getAIProcessingTypeLabel(aiProcessingConfig.type)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      
      <input
        id="file-upload"
        type="file"
        accept={aiProcessingConfig?.type === 'ocr_report' ? 'image/*,.pdf' : 'image/*'}
        onChange={handleFileInputChange}
        className="hidden"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Order Details</h2>
            <p className="text-sm text-gray-600 mt-1">Order ID: {order.id}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <div className="flex space-x-8 px-6">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Order Details
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'results'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              AI Result Entry
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'details' ? (
            <div className="space-y-6">
              {/* Order Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-blue-600 font-medium">Patient</div>
                    <div className="text-blue-900 font-semibold">{order.patient_name}</div>
                    <div className="text-blue-700 text-sm">{order.patient_id}</div>
                  </div>
                  <div>
                    <div className="text-blue-600 font-medium">Status</div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-blue-600 font-medium">Priority</div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(order.priority)}`}>
                      {order.priority}
                    </span>
                  </div>
                  <div>
                    <div className="text-blue-600 font-medium">Amount</div>
                    <div className="text-blue-900 font-semibold">₹{order.total_amount.toLocaleString()}</div>
                  </div>
                </div>
              </div>

              {/* Sample Tracking Information */}
              {order.sample_id && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <TestTube2 className="h-5 w-5 mr-2 text-green-600" />
                    Sample Tracking Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Sample ID & Color */}
                    <div className="flex items-center space-x-4">
                      <div 
                        className="w-12 h-12 rounded-full border-4 border-gray-300 flex-shrink-0"
                        style={{ backgroundColor: order.color_code }}
                        title={`Sample Color: ${order.color_name}`}
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-700">Sample ID</div>
                        <div className="text-lg font-bold text-green-900">{order.sample_id}</div>
                        <div className="text-sm text-green-700">{order.color_name} Tube</div>
                      </div>
                    </div>

                    {/* QR Code */}
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                        <div className="flex items-center">
                          <QrCode className="h-4 w-4 mr-1" />
                          QR Code
                        </div>
                        {order.qr_code_data && (
                          <button
                            onClick={handlePrintQRCode}
                            className="flex items-center px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                          >
                            <Printer className="h-3 w-3 mr-1" />
                            Print Label
                          </button>
                        )}
                      </div>
                      {order.qr_code_data ? (
                        <div className="space-y-3">
                          {/* Visual QR Code Display */}
                          <div className="bg-white border-2 border-green-300 rounded-lg p-4 text-center">
                            <div className="mb-2">
                              {qrCodeImage ? (
                                <img 
                                  src={qrCodeImage}
                                  alt="Sample QR Code"
                                  className="w-32 h-32 mx-auto border border-gray-300 rounded"
                                />
                              ) : (
                                <div className="w-32 h-32 mx-auto border border-gray-300 rounded bg-gray-100 flex items-center justify-center">
                                  <QrCode className="h-8 w-8 text-gray-400" />
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-gray-600">
                              Scan to access sample information
                            </div>
                          </div>
                          
                          {/* QR Code Data Details */}
                          <div className="bg-gray-50 border border-green-300 rounded-lg p-3">
                            <div className="text-xs font-medium text-gray-700 mb-2">QR Code Data:</div>
                            <div className="text-xs font-mono text-gray-600 bg-white border rounded p-2 max-h-20 overflow-y-auto">
                              {JSON.stringify(JSON.parse(order.qr_code_data), null, 2)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                          <QrCode className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                          No QR code generated
                        </div>
                      )}
                    </div>

                    {/* Collection Status */}
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">Collection Status</div>
                      {order.sample_collected_at ? (
                        <div className="bg-green-100 border border-green-300 rounded-lg p-3">
                          <div className="flex items-center text-green-800 mb-1">
                            <CheckCircle className="h-4 w-4 mr-1" />
                            <span className="font-medium">Collected</span>
                          </div>
                          <div className="text-xs text-green-700">
                            {new Date(order.sample_collected_at).toLocaleString()}
                          </div>
                          {order.sample_collected_by && (
                            <div className="text-xs text-green-700">
                              By: {order.sample_collected_by}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-yellow-100 border border-yellow-300 rounded-lg p-3">
                          <div className="flex items-center text-yellow-800 mb-1">
                            <Clock className="h-4 w-4 mr-1" />
                            <span className="font-medium">Pending Collection</span>
                          </div>
                          <div className="text-xs text-yellow-700">
                            Sample needs to be collected from patient
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tests Ordered */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Tests Ordered</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {order.tests.map((test, index) => (
                    <div key={index} className="bg-gray-50 rounded-lg p-4">
                      <div className="font-medium text-gray-900">{test}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Timeline & Workflow */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Current Workflow */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <ArrowRight className="h-5 w-5 mr-2 text-blue-600" />
                    Workflow Progress
                  </h3>
                  <div className="space-y-4">
                    {getWorkflowSteps(order.status).map((step, index) => (
                      <div key={step.name} className="flex items-center space-x-3">
                        <div className={`
                          w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                          ${step.completed ? 'bg-green-500 text-white' : 
                            step.current ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'}
                        `}>
                          {step.completed ? <CheckCircle className="h-4 w-4" /> : index + 1}
                        </div>
                        <div className="flex-1">
                          <div className={`font-medium ${
                            step.current ? 'text-blue-900' : 
                            step.completed ? 'text-green-900' : 'text-gray-600'
                          }`}>
                            {step.name}
                          </div>
                          <div className="text-sm text-gray-500">{step.description}</div>
                          {step.timestamp && (
                            <div className="text-xs text-gray-400">
                              {new Date(step.timestamp).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Next Steps & Actions */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <Calendar className="h-5 w-5 mr-2 text-orange-600" />
                    Next Steps
                  </h3>
                  <div className="space-y-4">
                    {getNextSteps(order.status, order).map((step, index) => (
                      <div key={index} className={`
                        p-4 rounded-lg border-l-4 
                        ${step.urgent ? 'bg-red-50 border-red-400' : 
                          step.priority === 'high' ? 'bg-orange-50 border-orange-400' :
                          'bg-blue-50 border-blue-400'}
                      `}>
                        <div className={`font-medium ${
                          step.urgent ? 'text-red-900' :
                          step.priority === 'high' ? 'text-orange-900' : 'text-blue-900'
                        }`}>
                          {step.action}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">{step.description}</div>
                        {step.assignedTo && (
                          <div className="text-xs text-gray-500 mt-2">
                            Assigned to: {step.assignedTo}
                          </div>
                        )}
                        {step.deadline && (
                          <div className="text-xs text-gray-500">
                            Deadline: {new Date(step.deadline).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Status Update Actions */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Status Updates</h3>
                <div className="flex flex-wrap gap-3">
                  {getAvailableStatusActions(order.status).map((action) => (
                    <button
                      key={action.status}
                      onClick={() => onUpdateStatus(order.id, action.status)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        action.primary 
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* AI OCR Section */}
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-purple-900 mb-4 flex items-center">
                  <Brain className="h-5 w-5 mr-2" />
                  AI-Powered Result Processing
                </h3>
                
                {/* Analyte AI Configuration Display */}
                {orderAnalytes.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-purple-900 mb-3">Available AI Processing for Order Analytes</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {orderAnalytes.map((analyte) => (
                        <div 
                          key={analyte.id}
                          onClick={() => handleSelectAnalyteForAI(analyte)}
                          className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                            selectedAnalyteForAI?.id === analyte.id
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">{analyte.name}</div>
                              <div className="text-xs text-gray-500">{analyte.category}</div>
                            </div>
                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                              getAIProcessingTypeColor(analyte.ai_processing_type || 'none')
                            }`}>
                              {getAIProcessingTypeLabel(analyte.ai_processing_type || 'none')}
                            </span>
                          </div>
                          {analyte.ai_prompt_override && (
                            <div className="mt-2 text-xs text-purple-600 bg-purple-100 px-2 py-1 rounded">
                              Custom AI prompt configured
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    
                    {selectedAnalyteForAI && (
                      <div className="mt-4 p-3 bg-white border border-purple-200 rounded-lg">
                        <h5 className="text-sm font-medium text-purple-900 mb-2">
                          AI Configuration for {selectedAnalyteForAI.name}
                        </h5>
                        <div className="grid grid-cols-2 gap-4 text-xs text-purple-800">
                          <div>
                            <div className="font-medium">Processing Type:</div>
                            <div>{getAIProcessingTypeLabel(selectedAnalyteForAI.ai_processing_type || 'none')}</div>
                          </div>
                          <div>
                            <div className="font-medium">Custom Prompt:</div>
                            <div>{selectedAnalyteForAI.ai_prompt_override ? 'Yes' : 'Default'}</div>
                          </div>
                        </div>
                        {selectedAnalyteForAI.ai_prompt_override && (
                          <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-xs">
                            <div className="font-medium text-purple-900 mb-1">Custom Prompt:</div>
                            <div className="text-purple-800 italic">
                              {selectedAnalyteForAI.ai_prompt_override.substring(0, 100)}
                              {selectedAnalyteForAI.ai_prompt_override.length > 100 ? '...' : ''}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                <div className="space-y-4">
                  {/* File Upload */}
                  {renderFileUpload()}
                  
                  {/* OCR Processing */}
                  {uploadedFile && attachmentId && (
                    <div className="space-y-3">
                      <button
                        onClick={() => handleRunAIProcessing()}
                        disabled={isOCRProcessing}
                        className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all"
                      >
                        {isOCRProcessing ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                            Processing with AI...
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 mr-2" />
                            <Brain className="h-4 w-4 mr-2" />
                            Process with AI {selectedAnalyteForAI ? `(${selectedAnalyteForAI.name})` : ''}
                          </>
                        )}
                      </button>
                      
                      {isOCRProcessing && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <div className="text-sm text-blue-800 space-y-1">
                            <div className="flex items-center">
                              <Layers className="h-4 w-4 mr-2" />
                              AI Processing Pipeline Active ({getAIProcessingTypeLabel(aiProcessingConfig?.type || 'ocr_report')})
                            </div>
                            <div>• Google Vision AI: {
                              aiProcessingConfig?.type === 'vision_card' ? 'Analyzing test card objects...' :
                              aiProcessingConfig?.type === 'vision_color' ? 'Analyzing colors and patterns...' :
                              'Extracting text from document...'
                            }</div>
                            <div>• Gemini NLP: {
                              aiProcessingConfig?.prompt ? 'Using custom prompt...' : 'Using default analysis...'
                            }</div>
                            <div>• Database matching: Linking to analyte definitions...</div>
                            <div>• Auto-filling result entry form...</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* OCR Error */}
                  {ocrError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="flex items-center">
                        <AlertTriangle className="h-4 w-4 text-red-500 mr-2" />
                        <span className="text-red-700 text-sm">{ocrError}</span>
                      </div>
                    </div>
                  )}
                  
                  {/* OCR Success */}
                  {ocrResults && extractedValues.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-center mb-3">
                        <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                        <span className="text-green-700 text-sm font-medium">
                          AI processing completed! ({getAIProcessingTypeLabel(aiProcessingConfig?.type || 'ocr_report')})
                        </span>
                      </div>
                      
                      {/* OCR Processing Summary */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="text-center">
                          <div className="text-lg font-bold text-green-600">{extractedValues.length}</div>
                          <div className="text-xs text-green-700">Parameters Found</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-blue-600">{manualValues.length}</div>
                          <div className="text-xs text-blue-700">Expected Count</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-purple-600">
                            {extractedValues.filter((v: any) => v.matched).length}
                          </div>
                          <div className="text-xs text-purple-700">DB Matched</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-orange-600">
                            {Math.round((ocrResults.metadata?.ocrConfidence || 0.95) * 100)}%
                          </div>
                          <div className="text-xs text-orange-700">Confidence</div>
                        </div>
                      </div>
                      
                      {/* Processing Method */}
                      <div className="text-xs text-green-600 bg-white border border-green-200 rounded p-2">
                        <strong>Processing Method:</strong> {ocrResults.metadata?.processingMethod || 'Google Vision AI + Gemini NLP'}
                        {aiProcessingConfig?.prompt && (
                          <div className="mt-1"><strong>Custom Prompt:</strong> Applied</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* AI OCR Extracted Results Display */}
              {extractedValues.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <Target className="h-5 w-5 mr-2 text-green-600" />
                    AI OCR Extracted Results
                  </h3>
                  
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Parameter
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Value
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Unit
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Reference Range
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Flag
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            DB Match
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Confidence
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {extractedValues.map((value, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {value.parameter}
                            </td>
                            <td className="px-4 py-3 text-sm font-bold text-gray-900">
                              {value.value}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {value.unit}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {value.reference}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {value.flag && (
                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getFlagColor(value.flag)}`}>
                                  {value.flag}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {(value as any).matched ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Matched
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                  New
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {(value as any).confidence && (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getConfidenceColor((value as any).confidence)}`}>
                                  {Math.round((value as any).confidence * 100)}%
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Manual Result Entry */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Manual Result Entry & Verification</h3>
                  {selectedAnalyteForAI && (
                    <div className="text-sm text-purple-600 bg-purple-100 px-3 py-1 rounded">
                      AI Config: {selectedAnalyteForAI.name}
                    </div>
                  )}
                </div>
                
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Parameter
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Value
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Unit
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Reference Range
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Flag
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {manualValues.map((value, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {value.parameter}
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={value.value}
                              onChange={(e) => handleManualValueChange(index, 'value', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="Enter value"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={value.unit}
                              onChange={(e) => handleManualValueChange(index, 'unit', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="Unit"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={value.reference}
                              onChange={(e) => handleManualValueChange(index, 'reference', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="Reference range"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={value.flag || ''}
                              onChange={(e) => handleManualValueChange(index, 'flag', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              {FLAG_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Save Message */}
                {saveMessage && (
                  <div className={`mt-4 p-3 rounded-lg ${
                    saveMessage.includes('successfully') 
                      ? 'bg-green-50 border border-green-200 text-green-700' 
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    <div className="flex items-center">
                      {saveMessage.includes('successfully') ? (
                        <CheckCircle className="h-4 w-4 mr-2" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 mr-2" />
                      )}
                      {saveMessage}
                    </div>
                  </div>
                )}
                
                <div className="mt-6 flex justify-end space-x-4">
                  <button
                    onClick={handleSaveDraft}
                    disabled={savingDraft}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
                  >
                    {savingDraft ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-600 border-t-transparent mr-2 inline-block"></div>
                        Saving Draft...
                      </>
                    ) : (
                      'Save Draft'
                    )}
                  </button>
                  <button
                    onClick={handleSubmitResults}
                    disabled={submittingResults}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {submittingResults ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2 inline-block"></div>
                        Submitting...
                      </>
                    ) : (
                      'Submit Results'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderDetailsModal;
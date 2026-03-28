import React, { useState, useEffect, useRef } from 'react';
import { X, Layers, TestTube, DollarSign, Clock, Settings, Plus, Search, AlertCircle, Brain, Building2, Edit, Sparkles, FileText, Code, RefreshCw, Calculator, Eye, EyeOff, Unlink } from 'lucide-react';

const CKEDITOR_VERSION = '47.1.0';
const CKEDITOR_SCRIPT_URL = `https://cdn.ckeditor.com/ckeditor5/${CKEDITOR_VERSION}/ckeditor5.umd.js`;
const CKEDITOR_CSS_URL = `https://cdn.ckeditor.com/ckeditor5/${CKEDITOR_VERSION}/ckeditor5.css`;
import { database, supabase } from '../../utils/supabase';
import AnalyteForm from './AnalyteForm';
import { SimpleAnalyteEditor } from '../TestGroups/SimpleAnalyteEditor';
import ReportImportWizard from './ReportImportWizard';

interface TestGroupFormProps {
  onClose: () => void;
  onSubmit: (data: any) => void;
  testGroup?: TestGroup | null;
}

interface TestGroup {
  id: string;
  name: string;
  code: string;
  category: string;
  clinicalPurpose: string;
  methodology?: string;
  description?: string;
  department?: string;
  analytes: string[];
  price: number;
  turnaroundTime: string;
  tat_hours?: number;
  sampleType: string;
  requiresFasting: boolean;
  isActive: boolean;
  createdDate: string;
  lab_id?: string;
  to_be_copied?: boolean;
  is_outsourced?: boolean;
  default_outsourced_lab_id?: string;
  default_ai_processing_type?: string;
  group_level_prompt?: string;
  testType?: string;
  gender?: string;
  sampleColor?: string;
  barcodeSuffix?: string;
  lmpRequired?: boolean;
  idRequired?: boolean;
  consentForm?: boolean;
  preCollectionGuidelines?: string;
  flabsId?: string;
  onlyFemale?: boolean;
  onlyMale?: boolean;
  onlyBilling?: boolean;
  startFromNextPage?: boolean;
  ref_range_ai_config?: any;
  required_patient_inputs?: string[];
  default_template_style?: string | null;
  collection_charge?: number | null;
  report_priority?: number | null;
  print_options?: {
    tableBorders?: boolean;
    flagColumn?: boolean;
    flagAsterisk?: boolean;
    flagAsteriskCritical?: boolean;
    headerBackground?: string;
    alternateRows?: boolean;
    baseFontSize?: number;
  } | null;
  group_interpretation?: string | null;
}

const TestGroupForm: React.FC<TestGroupFormProps> = ({ onClose, onSubmit, testGroup }) => {
  const [formData, setFormData] = useState({
    name: testGroup?.name || '',
    code: testGroup?.code || '',
    category: testGroup?.category || '',
    clinicalPurpose: testGroup?.clinicalPurpose || '',
    methodology: testGroup?.methodology || '',
    description: testGroup?.description || '',
    department: testGroup?.department || '',
    selectedAnalytes: testGroup?.analytes || [],
    price: testGroup?.price?.toString() || '',
    collection_charge: testGroup?.collection_charge?.toString() || '',
    turnaroundTime: testGroup?.turnaroundTime || '',
    tat_hours: testGroup?.tat_hours?.toString() || '3',
    sampleType: testGroup?.sampleType || '',
    requiresFasting: testGroup?.requiresFasting ?? false,
    isActive: testGroup?.isActive ?? true,
    default_ai_processing_type: testGroup?.default_ai_processing_type || 'THERMAL_SLIP_OCR',
    group_level_prompt: testGroup?.group_level_prompt || '',
    // New fields from the screenshot
    testType: testGroup?.testType || 'Default',
    gender: testGroup?.gender || 'Both',
    sampleColor: testGroup?.sampleColor || 'Red',
    barcodeSuffix: testGroup?.barcodeSuffix || '',
    lmpRequired: testGroup?.lmpRequired ?? false,
    idRequired: testGroup?.idRequired ?? false,
    consentForm: testGroup?.consentForm ?? false,
    preCollectionGuidelines: testGroup?.preCollectionGuidelines || '',
    flabsId: testGroup?.flabsId || '',
    onlyFemale: testGroup?.onlyFemale ?? false,
    onlyMale: testGroup?.onlyMale ?? false,
    onlyBilling: testGroup?.onlyBilling ?? false,
    startFromNextPage: testGroup?.startFromNextPage ?? false,
    default_template_style: testGroup?.default_template_style || '',
    report_priority: testGroup?.report_priority?.toString() || '',
    print_options: testGroup?.print_options ?? null,
    is_outsourced: testGroup?.is_outsourced ?? false,
    default_outsourced_lab_id: testGroup?.default_outsourced_lab_id || '',
    ref_range_ai_config: testGroup?.ref_range_ai_config || { enabled: false, consider_age: true },
    required_patient_inputs: testGroup?.required_patient_inputs || [],
    group_interpretation: testGroup?.group_interpretation || '',
  });

  const [analytes, setAnalytes] = useState<any[]>([]);
  const [outsourcedLabs, setOutsourcedLabs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [showAnalyteForm, setShowAnalyteForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingAttachedAnalyte, setEditingAttachedAnalyte] = useState<any>(null);
  const [labMethodOptions, setLabMethodOptions] = useState<string[]>([]);
  const [newMethodValue, setNewMethodValue] = useState('');
  const [methodError, setMethodError] = useState<string | null>(null);
  // Per-analyte metadata for sort_order, section_heading, and is_visible (keyed by analyte_id)
  const [analyteMetadata, setAnalyteMetadata] = useState<Record<string, { sort_order: number; section_heading: string; is_visible: boolean }>>({});
  // All analytes linked to this test group (including hidden/inactive lab_analytes)
  const [allLinkedAnalytes, setAllLinkedAnalytes] = useState<any[]>([]);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [syncingGlobal, setSyncingGlobal] = useState(false);
  const [syncGlobalResult, setSyncGlobalResult] = useState<string | null>(null);

  // Group interpretation CKEditor state
  const [interpEditorInstance, setInterpEditorInstance] = useState<any>(null);
  const [interpCkLoaded, setInterpCkLoaded] = useState(false);
  const [interpTab, setInterpTab] = useState<'visual' | 'html'>('visual');
  const [showInterpEditor, setShowInterpEditor] = useState(!!testGroup?.group_interpretation);
  const interpEditorRef = useRef<HTMLDivElement>(null);

  // Load analytes and outsourced labs
  useEffect(() => {
    loadData();
    loadLabMethodOptions();
  }, []);

  // Load CKEditor for group interpretation editor
  useEffect(() => {
    if (!showInterpEditor) return;
    if (interpCkLoaded) return;
    const load = async () => {
      if ((window as any).CKEDITOR) { setInterpCkLoaded(true); return; }
      if (!document.querySelector(`link[href="${CKEDITOR_CSS_URL}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = CKEDITOR_CSS_URL;
        document.head.appendChild(link);
      }
      if (!document.querySelector(`script[src="${CKEDITOR_SCRIPT_URL}"]`)) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = CKEDITOR_SCRIPT_URL; s.async = true;
          s.onload = () => resolve(); s.onerror = () => reject();
          document.head.appendChild(s);
        });
      }
      setInterpCkLoaded(true);
    };
    load().catch(console.error);
  }, [showInterpEditor]);

  // Init CKEditor once loaded and ref is ready
  useEffect(() => {
    if (!interpCkLoaded || !interpEditorRef.current || interpEditorInstance || interpTab !== 'visual') return;
    const init = async () => {
      try {
        const CKE = (window as any).CKEDITOR;
        if (!CKE) return;
        const { Essentials, Bold, Italic, Underline, Link, List, Paragraph, Heading,
                Alignment, Indent, IndentBlock, Table, TableToolbar, BlockQuote, Undo, SourceEditing } = CKE;
        const editor = await CKE.ClassicEditor.create(interpEditorRef.current, {
          licenseKey: (import.meta.env.VITE_CKEDITOR_LICENSE_KEY as string) || '',
          plugins: [Essentials, Bold, Italic, Underline, Link, List, Paragraph, Heading,
                    Alignment, Indent, IndentBlock, Table, TableToolbar, BlockQuote, Undo, SourceEditing],
          toolbar: ['heading', '|', 'bold', 'italic', 'underline', '|',
                    'link', 'bulletedList', 'numberedList', '|',
                    'alignment', 'indent', 'outdent', '|',
                    'insertTable', 'blockQuote', '|', 'undo', 'redo'],
          table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
        });
        editor.setData(formData.group_interpretation || '');
        editor.model.document.on('change:data', () => {
          setFormData(prev => ({ ...prev, group_interpretation: editor.getData() }));
        });
        const el = editor.ui.view.editable.element;
        if (el) { el.style.minHeight = '140px'; el.style.maxHeight = '320px'; el.style.overflowY = 'auto'; }
        setInterpEditorInstance(editor);
      } catch (e) { console.error('CKEditor init error', e); }
    };
    init();
  }, [interpCkLoaded, interpTab]);

  const loadData = async () => {
    try {
      setLoading(true);
      const requests: Promise<any>[] = [
        database.analytes.getAll(),
        supabase.from('outsourced_labs').select('*').eq('is_active', true).order('name') as unknown as Promise<any>,
      ];
      if (testGroup?.id) {
        requests.push(
          supabase
            .from('test_group_analytes')
            .select('analyte_id, sort_order, section_heading, is_visible')
            .eq('test_group_id', testGroup.id) as unknown as Promise<any>
        );
      }

      const [analytesRes, labsRes, tgaRes] = await Promise.all(requests);

      // Fetch all linked analytes directly (bypasses lab_analytes visibility filter)
      let linkedRes: any = null;
      if (testGroup?.id) {
        linkedRes = await supabase
          .from('test_group_analytes')
          .select('analyte_id, analytes!inner(id, name, unit, reference_range, category, is_active)')
          .eq('test_group_id', testGroup.id);
      }

      if (analytesRes.error) {
        console.error('Error loading analytes:', analytesRes.error);
      } else {
        setAnalytes(analytesRes.data || []);
      }

      if (labsRes.error) {
        console.error('Error loading outsourced labs:', labsRes.error);
      } else {
        setOutsourcedLabs(labsRes.data || []);
      }

      if (tgaRes && !tgaRes.error && tgaRes.data) {
        const meta: Record<string, { sort_order: number; section_heading: string; is_visible: boolean }> = {};
        for (const row of tgaRes.data) {
          meta[row.analyte_id] = {
            sort_order: row.sort_order ?? 0,
            section_heading: row.section_heading ?? '',
            is_visible: row.is_visible ?? true,
          };
        }
        setAnalyteMetadata(meta);
      }

      if (linkedRes && !linkedRes.error && linkedRes.data) {
        const linked = (linkedRes.data as any[]).map((row: any) => {
          const a = Array.isArray(row.analytes) ? row.analytes[0] : row.analytes;
          if (!a) return null;
          return {
            ...a,
            referenceRange: a.reference_range,
          };
        }).filter(Boolean);
        setAllLinkedAnalytes(linked);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLabMethodOptions = async () => {
    try {
      const { data, error: loadError } = await database.labs.getById();
      if (loadError) {
        console.error('Failed to load lab method options:', loadError);
        return;
      }
      const options = Array.isArray(data?.method_options) ? data.method_options : [];
      setLabMethodOptions(options);
    } catch (error) {
      console.error('Failed to load lab method options:', error);
    }
  };

  const handleAddMethodOption = async () => {
    setMethodError(null);
    const trimmed = newMethodValue.trim();
    if (!trimmed) return;
    if (labMethodOptions.some((option) => option.toLowerCase() === trimmed.toLowerCase())) {
      setFormData(prev => ({ ...prev, methodology: trimmed }));
      setNewMethodValue('');
      return;
    }

    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        setMethodError('No lab context found.');
        return;
      }

      const nextOptions = [...labMethodOptions, trimmed];
      const { error: updateError } = await database.labs.update(labId, {
        method_options: nextOptions,
      });

      if (updateError) {
        setMethodError(updateError instanceof Error ? updateError.message : 'Failed to add method');
        return;
      }

      setLabMethodOptions(nextOptions);
      setFormData(prev => ({ ...prev, methodology: trimmed }));
      setNewMethodValue('');
    } catch (error) {
      console.error('Failed to update lab method options:', error);
      setMethodError(error instanceof Error ? error.message : 'Failed to add method');
    }
  };

  // Filter analytes based on search query and showSelectedOnly toggle
  const filteredAnalytes = analytes.filter(analyte => {
    const matchesSearch =
      analyte.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      analyte.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      analyte.unit.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSelected = !showSelectedOnly || formData.selectedAnalytes.includes(analyte.id);
    return matchesSearch && matchesSelected;
  });

  const handleAddNewAnalyte = async (analyteData: any) => {
    try {
      // Use database.analytes.create() — this also creates the lab_analytes row
      // so the analyte becomes visible in the Analytes list immediately
      const { data, error } = await database.analytes.create({
        name: analyteData.name,
        unit: analyteData.unit,
        reference_range: analyteData.referenceRange,
        low_critical: analyteData.lowCritical,
        high_critical: analyteData.highCritical,
        interpretation_low: analyteData.interpretation?.low,
        interpretation_normal: analyteData.interpretation?.normal,
        interpretation_high: analyteData.interpretation?.high,
        category: analyteData.category,
        is_active: analyteData.isActive ?? true,
        is_global: false,
        ai_processing_type: analyteData.aiProcessingType,
        ai_prompt_override: analyteData.aiPromptOverride,
        group_ai_mode: analyteData.groupAiMode || 'individual',
        is_calculated: analyteData.isCalculated || false,
        formula: analyteData.isCalculated ? (analyteData.formula || null) : null,
        formula_variables: analyteData.isCalculated && analyteData.formulaVariables?.length
          ? analyteData.formulaVariables
          : [],
        formula_description: analyteData.isCalculated ? (analyteData.formulaDescription || null) : null,
      });

      if (error) {
        console.error('Error creating analyte:', error);
        alert('Failed to create analyte. Please try again.');
        return;
      }

      // Save lab-specific analyte_dependencies if source analytes were selected
      if (analyteData.isCalculated && analyteData.sourceDependencies?.length > 0) {
        const depsLabId = await database.getCurrentUserLabId();
        const { error: depError } = await database.analyteDependencies.setDependencies(
          data.id,
          analyteData.sourceDependencies,
          depsLabId ?? undefined
        );
        if (depError) {
          console.error('Error creating dependencies:', depError);
        }
      }

      // Refresh analytes list
      await loadData();

      // Auto-select the newly created analyte
      setFormData(prev => ({
        ...prev,
        selectedAnalytes: [...prev.selectedAnalytes, data.id]
      }));

      setShowAnalyteForm(false);
      alert('Analyte created successfully for your lab!');
    } catch (error) {
      console.error('Error creating analyte:', error);
      alert('Failed to create analyte. Please try again.');
    }
  };

  const handleUpdateAttachedAnalyte = async (updatedAnalyte: any) => {
    try {
        console.log("Updating Attached Analyte", updatedAnalyte);
        // Update lab-specific analyte settings in lab_analytes (not global analytes table)
        const labId = await database.getCurrentUserLabId();
        if (!labId) throw new Error('Unable to determine lab context');
        const { error } = await database.labAnalytes.updateLabSpecific(labId, updatedAnalyte.id, {
            name: updatedAnalyte.name,
            unit: updatedAnalyte.unit,
            reference_range: updatedAnalyte.referenceRange,
            low_critical: updatedAnalyte.lowCritical,
            high_critical: updatedAnalyte.highCritical,
            interpretation_low: updatedAnalyte.interpretationLow,
            interpretation_normal: updatedAnalyte.interpretationNormal,
            interpretation_high: updatedAnalyte.interpretationHigh,
            category: updatedAnalyte.category,
            is_active: updatedAnalyte.isActive,
            ai_processing_type: updatedAnalyte.aiProcessingType,
            ref_range_knowledge: updatedAnalyte.ref_range_knowledge,
        });

        if (error) throw error;

        // Update local state 'analytes' array to reflect changes immediately
        setAnalytes(prev => prev.map(a => a.id === updatedAnalyte.id ? {
            ...a,
            name: updatedAnalyte.name,
            unit: updatedAnalyte.unit,
            referenceRange: updatedAnalyte.referenceRange,
            category: updatedAnalyte.category,
            // ... map other fields if needed for display ...
        } : a));
        
        // Also refresh data to be sure
        await loadData();

        setEditingAttachedAnalyte(null);
    } catch (err: any) {
        console.error("Error updating attached analyte:", err);
        alert("Failed to update analyte: " + err.message);
    }
  };

  const categories = [
    'Hematology',
    'Biochemistry',
    'Serology',
    'Microbiology',
    'Immunology',
    'Molecular Biology',
    'Histopathology',
    'Cytology',
    'Clinical Pathology',
  ];

  const sampleTypes = [
    'EDTA Blood',
    'Serum',
    'Plasma',
    'Urine',
    'Stool',
    'CSF',
    'Sputum',
    'Swab',
    'Tissue',
    'Other',
  ];

  const handleSyncFromGlobal = async () => {
    if (!testGroup?.name || syncingGlobal) return;
    setSyncingGlobal(true);
    setSyncGlobalResult(null);
    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) throw new Error('Unable to determine lab context');
      const { data, error: fnError } = await supabase.functions.invoke('onboarding-lab', {
        body: { lab_id: labId, mode: 'single', test_group_name: testGroup.name }
      });
      if (fnError) throw new Error(fnError.message);
      if (!data?.success) throw new Error(data?.error || 'Sync failed');
      const parts = [];
      if (data.analytesAdded) parts.push(`${data.analytesAdded} added`);
      if (data.analytesUpdated) parts.push(`${data.analytesUpdated} updated`);
      if (data.interpretationSynced) parts.push('interpretation updated');
      const msg = parts.length ? `Synced: ${parts.join(', ')}` : 'Synced: already up to date';
      setSyncGlobalResult(msg);
      // Refresh metadata so sort_order and section_heading populate from the DB
      await loadData();
    } catch (err: any) {
      setSyncGlobalResult(`Error: ${err.message}`);
    } finally {
      setSyncingGlobal(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // Get current user's lab_id
      const labId = await database.getCurrentUserLabId();

      // Auto-sync legacy booleans from required_patient_inputs
      const rpi = formData.required_patient_inputs;

      onSubmit({
        ...formData,
        category: formData.category || null,
        analytes: formData.selectedAnalytes,
        analyteMetadata,
        price: parseFloat(formData.price),
        collection_charge: formData.collection_charge ? parseFloat(formData.collection_charge) : null,
        tat_hours: parseFloat(formData.tat_hours) || 3,
        default_ai_processing_type: formData.default_ai_processing_type,
        group_level_prompt: formData.group_level_prompt,
        methodology: formData.methodology || null,
        description: formData.description || null,
        department: formData.department || null,
        lab_id: labId,
        to_be_copied: false,
        is_outsourced: formData.is_outsourced,
        default_outsourced_lab_id: formData.default_outsourced_lab_id || null,
        ref_range_ai_config: formData.ref_range_ai_config,
        required_patient_inputs: formData.required_patient_inputs,
        default_template_style: formData.default_template_style || null,
        report_priority: formData.report_priority ? parseInt(formData.report_priority, 10) : null,
        print_options: formData.print_options || null,
        group_interpretation: formData.group_interpretation || null,
        // Auto-sync legacy boolean fields from required_patient_inputs
        lmpRequired: rpi.includes('lmp'),
        idRequired: rpi.includes('id_document'),
        consentForm: rpi.includes('consent_form'),
      });
    } catch (error) {
      console.error('Error getting lab ID:', error);
      alert('Error: Could not determine your lab. Please try again.');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleAnalyteSelection = (analyteId: string) => {
    setFormData(prev => ({
      ...prev,
      selectedAnalytes: prev.selectedAnalytes.includes(analyteId)
        ? prev.selectedAnalytes.filter(id => id !== analyteId)
        : [...prev.selectedAnalytes, analyteId]
    }));
  };

  // Provider-only controls: keep code in place but hidden from lab UI.
  const showProviderOnlyFields = false;

  const aiProcessingTypes = [
    { value: 'MANUAL_ENTRY_NO_VISION', label: 'Manual Entry (No AI)', description: 'Manual data entry without AI vision processing' },
    { value: 'THERMAL_SLIP_OCR', label: 'Thermal Slip OCR', description: 'Extract values from thermal printer slips (analyzers)' },
    { value: 'INSTRUMENT_SCREEN_OCR', label: 'Instrument Screen OCR', description: 'Extract values from instrument display screens' },
    { value: 'RAPID_CARD_LFA', label: 'Rapid Card / LFA', description: 'Analyze lateral flow assay cards (pregnancy, malaria, etc.)' },
    { value: 'COLOR_STRIP_MULTIPARAM', label: 'Color Strip (Multi-param)', description: 'Multi-parameter color strip analysis (urine, water)' },
    { value: 'SINGLE_WELL_COLORIMETRIC', label: 'Single Well Colorimetric', description: 'Single well/tube color analysis (ELISA, chemistry)' },
    { value: 'AGGLUTINATION_CARD', label: 'Agglutination Card', description: 'Blood typing and agglutination pattern analysis' },
    { value: 'MICROSCOPY_MORPHOLOGY', label: 'Microscopy Morphology', description: 'Microscope image analysis (blood smear, microbiology)' },
    { value: 'ZONE_OF_INHIBITION', label: 'Zone of Inhibition', description: 'Antibiotic sensitivity zone measurement' },
    { value: 'MENISCUS_SCALE_READING', label: 'Meniscus Scale Reading', description: 'ESR tube or graduated scale reading' },
    { value: 'SAMPLE_QUALITY_TUBE_CHECK', label: 'Sample Quality Check', description: 'Sample quality verification (hemolysis, lipemia)' },
    { value: 'UNKNOWN_NEEDS_REVIEW', label: 'Unknown (Needs Review)', description: 'Uncategorized - requires manual classification' },
  ];

  // Build selected analyte details: prefer rich lab_analytes data, fall back to global analytes
  // This ensures hidden/inactive lab_analytes are still shown, AND newly added analytes appear too
  const selectedAnalyteDetails = (() => {
    const linkedIds = new Set(allLinkedAnalytes.map((a: any) => a.id));
    // Existing linked analytes (may include hidden/inactive ones)
    const base = allLinkedAnalytes.map((linked: any) => {
      const rich = analytes.find(a => a.id === linked.id);
      return rich || linked;
    });
    // Newly checked analytes not yet in the DB-fetched list
    const newlyAdded = analytes.filter(a =>
      formData.selectedAnalytes.includes(a.id) && !linkedIds.has(a.id)
    );
    const analytePool = [...base, ...newlyAdded].filter(a =>
      formData.selectedAnalytes.includes(a.id)
    );
    // Sort by sort_order (0 means unset, put those last)
    return [...analytePool].sort((a, b) => {
      const oa = analyteMetadata[a.id]?.sort_order ?? 0;
      const ob = analyteMetadata[b.id]?.sort_order ?? 0;
      if (oa === 0 && ob === 0) return 0;
      if (oa === 0) return 1;
      if (ob === 0) return -1;
      return oa - ob;
    });
  })();

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4" style={{ zIndex: 99999 }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <Layers className="h-6 w-6 mr-2 text-green-600" />
            {testGroup ? 'Edit Test Group' : 'Create Test Group'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 p-1 rounded"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <TestTube className="h-5 w-5 mr-2" />
              Basic Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Group Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g., Complete Blood Count"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Code *
                </label>
                <input
                  type="text"
                  name="code"
                  required
                  value={formData.code}
                  onChange={handleChange}
                  placeholder="e.g., CBC"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select Category</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sample Type *
                </label>
                <select
                  name="sampleType"
                  required
                  value={formData.sampleType}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select Sample Type</option>
                  {sampleTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Clinical Purpose *
              </label>
              <textarea
                name="clinicalPurpose"
                required
                rows={2}
                value={formData.clinicalPurpose}
                onChange={handleChange}
                placeholder="Describe the clinical purpose and indications for this test group"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Methodology / Technique
              </label>
              <select
                name="methodology"
                value={formData.methodology}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select Method</option>
                {labMethodOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newMethodValue}
                  onChange={(e) => setNewMethodValue(e.target.value)}
                  placeholder="Add new method"
                  className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={handleAddMethodOption}
                  className="px-3 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800"
                >
                  Add Method
                </button>
              </div>
              {methodError && (
                <div className="text-xs text-red-600 mt-1">{methodError}</div>
              )}
              <div className="text-xs text-gray-500 mt-1">
                Methods are saved per lab and available for all analytes and test groups.
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department
                </label>
                <input
                  type="text"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  placeholder="e.g., Hematology, Biochemistry"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                name="description"
                rows={2}
                value={formData.description}
                onChange={handleChange}
                placeholder="Brief description of this test group"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Test Configuration - Enhanced Settings */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Settings className="h-5 w-5 mr-2 text-purple-600" />
              Test Configuration Settings
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Test Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Type
                </label>
                <select
                  name="testType"
                  value={formData.testType}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="Default">Default</option>
                  <option value="Special">Special</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Routine">Routine</option>
                </select>
              </div>

              {/* Gender */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender *
                </label>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="gender"
                      value="Male"
                      checked={formData.gender === 'Male'}
                      onChange={handleChange}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm text-gray-700">Male</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="gender"
                      value="Female"
                      checked={formData.gender === 'Female'}
                      onChange={handleChange}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm text-gray-700">Female</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="gender"
                      value="Both"
                      checked={formData.gender === 'Both'}
                      onChange={handleChange}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm text-gray-700">Both</span>
                  </label>
                </div>
              </div>

              {/* Test Code (moved here for better organization) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Test Code *
                </label>
                <input
                  type="text"
                  name="code"
                  required
                  value={formData.code}
                  onChange={handleChange}
                  placeholder="e.g., 17OHP"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Sample Color */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sample Color
                </label>
                <select
                  name="sampleColor"
                  value={formData.sampleColor}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="Red">Red</option>
                  <option value="Blue">Blue</option>
                  <option value="Green">Green</option>
                  <option value="Yellow">Yellow</option>
                  <option value="Purple">Purple</option>
                  <option value="Gray">Gray</option>
                  <option value="Pink">Pink</option>
                  <option value="Orange">Orange</option>
                </select>
              </div>

              {/* Barcode Suffix */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Barcode Suffix
                </label>
                <input
                  type="text"
                  name="barcodeSuffix"
                  value={formData.barcodeSuffix}
                  onChange={handleChange}
                  placeholder="Enter suffix"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* Price */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price (₹) *
                </label>
                <input
                  type="number"
                  name="price"
                  required
                  min="0"
                  step="0.01"
                  value={formData.price}
                  onChange={handleChange}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* Collection Charge */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Collection Charge (₹)
                </label>
                <input
                  type="number"
                  name="collection_charge"
                  min="0"
                  step="0.01"
                  value={formData.collection_charge}
                  onChange={handleChange}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Extra charge for sample collection (e.g. home visit)</p>
              </div>

              {/* TAT Hours */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  TAT (Hours) *
                </label>
                <input
                  type="number"
                  name="tat_hours"
                  required
                  min="0.5"
                  max="720"
                  step="0.5"
                  value={formData.tat_hours}
                  onChange={handleChange}
                  placeholder="3"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Turnaround time for this test (used for TAT breach alerts)</p>
              </div>
            </div>

            {showProviderOnlyFields && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Flabs ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Flabs ID
                  </label>
                  <input
                    type="text"
                    name="flabsId"
                    value={formData.flabsId}
                    onChange={handleChange}
                    placeholder="FLT0625"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Additional Options */}
            <div className="bg-amber-50 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-900 mb-3">
                Additional Options
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="isActive"
                    checked={formData.isActive}
                    onChange={handleChange}
                    className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">Is Active</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="requiresFasting"
                    checked={formData.requiresFasting}
                    onChange={handleChange}
                    className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">Requires Fasting</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="onlyFemale"
                    checked={formData.onlyFemale}
                    onChange={handleChange}
                    className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">Only Female</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="onlyMale"
                    checked={formData.onlyMale}
                    onChange={handleChange}
                    className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">Only Male</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="onlyBilling"
                    checked={formData.onlyBilling}
                    onChange={handleChange}
                    className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">Only Billing</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="startFromNextPage"
                    checked={formData.startFromNextPage}
                    onChange={handleChange}
                    className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">Start from Next Page</span>
                </label>
              </div>
	              {/* Per-test-group PDF layout override */}
	              <div className="mt-3">
	                <label className="block text-sm font-medium text-gray-700 mb-1">
	                  Report Priority
	                </label>
	                <input
	                  type="number"
	                  name="report_priority"
	                  min="0"
	                  step="1"
	                  value={formData.report_priority}
	                  onChange={handleChange}
	                  placeholder="Leave blank for normal/default"
	                  className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
	                />
	                <p className="text-xs text-gray-500 mt-1">
	                  Lower numbers print earlier. Example: CBC `10`, Lipid `20`, Culture `900`.
	                </p>
	              </div>
	              <div className="mt-3">
	                <label className="block text-sm font-medium text-gray-700 mb-1">
	                  Report Layout Style
	                </label>
                <select
                  name="default_template_style"
                  value={formData.default_template_style}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Lab Default</option>
                  <option value="beautiful">Beautiful (3-Column Color Matrix)</option>
                  <option value="classic">Classic (Plain Table)</option>
                  <option value="basic">Basic (Old School - No Color)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Forces this layout for this test group, overriding both the lab default and any linked custom template.
                </p>
              </div>

              {/* Print Style Overrides */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Print Style Overrides</label>
                  {formData.print_options && Object.keys(formData.print_options).length > 0 && (
                    <button type="button"
                      onClick={() => setFormData(prev => ({ ...prev, print_options: null }))}
                      className="text-xs text-red-500 hover:text-red-700 font-medium">
                      ↩ Clear all — use lab defaults
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium text-xs">↩ Lab</span> = inherit lab setting &nbsp;·&nbsp;
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500 text-white text-xs">On/Off</span> = override for this test group only
                </p>
                <div className="border border-amber-200 rounded-lg p-3 bg-amber-50 space-y-2.5">
                  {([
                    { key: 'tableBorders', label: 'Table Borders' },
                    { key: 'flagColumn', label: 'Flag Column (Classic)' },
                    { key: 'flagAsterisk', label: 'Flag Asterisk * on H/L' },
                    { key: 'flagAsteriskCritical', label: 'Critical Double **', disabledWhen: !(formData.print_options as any)?.flagAsterisk },
                    { key: 'boldAllValues', label: 'Bold All Values' },
                    { key: 'boldAbnormalValues', label: 'Bold Abnormal Values' },
                    { key: 'alternateRows', label: 'Alternate Row Shading' },
                  ] as { key: string; label: string; disabledWhen?: boolean }[]).map(({ key, label, disabledWhen }) => {
                    const opts = (formData.print_options || {}) as Record<string, unknown>;
                    const isSet = key in opts && opts[key] !== undefined;
                    const val = opts[key];
                    const clearKey = (k: string) => setFormData(prev => {
                      const next = { ...(prev.print_options || {}) } as Record<string, unknown>;
                      delete next[k];
                      return { ...prev, print_options: Object.keys(next).length > 0 ? next as typeof prev.print_options : null };
                    });
                    const setKey = (k: string, v: unknown) => setFormData(prev => ({ ...prev, print_options: { ...(prev.print_options || {}), [k]: v } }));
                    return (
                      <div key={key} className={`flex items-center justify-between${disabledWhen ? ' opacity-40 pointer-events-none' : ''}`}>
                        <span className="text-sm text-gray-700">{label}</span>
                        <div className="flex items-center gap-1">
                          {(['lab', 'on', 'off'] as const).map(opt => {
                            const active = opt === 'lab' ? !isSet : opt === 'on' ? val === true : val === false;
                            return (
                              <button type="button" key={opt}
                                onClick={() => opt === 'lab' ? clearKey(key) : setKey(key, opt === 'on')}
                                className={`px-2 py-0.5 text-xs rounded border transition-colors ${active ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-500 border-gray-300 hover:border-amber-400'}`}>
                                {opt === 'lab' ? '↩ Lab' : opt === 'on' ? 'On' : 'Off'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Header Color */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Header Color</span>
                    <div className="flex items-center gap-2">
                      {(formData.print_options as any)?.headerBackground ? (
                        <button type="button"
                          onClick={() => setFormData(prev => {
                            const next = { ...(prev.print_options || {}) } as Record<string, unknown>;
                            delete next.headerBackground;
                            return { ...prev, print_options: Object.keys(next).length > 0 ? next as typeof prev.print_options : null };
                          })}
                          className="text-xs px-2 py-0.5 rounded border bg-white text-gray-500 border-gray-300 hover:border-amber-400">
                          ↩ Lab
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Lab default</span>
                      )}
                      <input type="color"
                        value={(formData.print_options as any)?.headerBackground || '#0b4aa2'}
                        onChange={(e) => setFormData(prev => ({ ...prev, print_options: { ...(prev.print_options || {}), headerBackground: e.target.value } }))}
                        className="h-7 w-7 rounded border border-gray-300 cursor-pointer" />
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Font Size (px)</span>
                    <div className="flex items-center gap-2">
                      {(formData.print_options as any)?.baseFontSize !== undefined && (
                        <button type="button"
                          onClick={() => setFormData(prev => {
                            const next = { ...(prev.print_options || {}) } as Record<string, unknown>;
                            delete next.baseFontSize;
                            return { ...prev, print_options: Object.keys(next).length > 0 ? next as typeof prev.print_options : null };
                          })}
                          className="text-xs px-2 py-0.5 rounded border bg-white text-gray-500 border-gray-300 hover:border-amber-400">
                          ↩ Lab
                        </button>
                      )}
                      <input type="number" min={8} max={24}
                        value={(formData.print_options as any)?.baseFontSize ?? ''}
                        placeholder="Lab default"
                        onChange={(e) => setFormData(prev => ({ ...prev, print_options: { ...(prev.print_options || {}), baseFontSize: e.target.value ? parseInt(e.target.value) : undefined } }))}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Group Interpretation */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-medium text-purple-900">Group Interpretation</span>
                  <span className="text-xs text-purple-500 bg-purple-100 px-1.5 py-0.5 rounded">Shown in report after results</span>
                </div>
                {!showInterpEditor ? (
                  <button
                    type="button"
                    onClick={() => setShowInterpEditor(true)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                  >
                    <Plus className="h-3 w-3" /> Add Interpretation
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setShowInterpEditor(false); setFormData(prev => ({ ...prev, group_interpretation: '' })); }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
              {showInterpEditor && (
                <div className="mt-2">
                  <p className="text-xs text-purple-600 mb-2">
                    Rich text rendered after this test group's result table in all report styles. Font size inherits the test group's base font size setting.
                  </p>
                  {/* Tab bar */}
                  <div className="flex gap-1 mb-2">
                    <button
                      type="button"
                      onClick={() => setInterpTab('visual')}
                      className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${interpTab === 'visual' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400'}`}
                    >
                      <FileText className="h-3 w-3" /> Visual
                    </button>
                    <button
                      type="button"
                      onClick={() => setInterpTab('html')}
                      className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${interpTab === 'html' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400'}`}
                    >
                      <Code className="h-3 w-3" /> HTML
                    </button>
                  </div>
                  {/* Visual (CKEditor) tab — always mounted so CKEditor stays bound to its DOM node */}
                  <div style={{ display: interpTab === 'visual' ? 'block' : 'none' }} className="border border-purple-200 rounded bg-white">
                    {!interpCkLoaded && (
                      <div className="flex items-center justify-center h-24 text-sm text-gray-400">Loading editor…</div>
                    )}
                    <div ref={interpEditorRef} style={{ display: interpCkLoaded ? 'block' : 'none' }} />
                  </div>
                  {/* HTML tab */}
                  {interpTab === 'html' && (
                    <textarea
                      rows={8}
                      value={formData.group_interpretation || ''}
                      onChange={(e) => {
                        const html = e.target.value;
                        setFormData(prev => ({ ...prev, group_interpretation: html }));
                        // Sync to CKEditor if active
                        if (interpEditorInstance) {
                          try { interpEditorInstance.setData(html); } catch (_) {}
                        }
                      }}
                      placeholder="<p>Paste or type HTML here...</p>"
                      className="w-full px-3 py-2 border border-purple-200 rounded bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Pre-Collection Guidelines */}
            <div className="bg-green-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={!!formData.preCollectionGuidelines}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        setFormData(prev => ({ ...prev, preCollectionGuidelines: '' }));
                      } else {
                        setFormData(prev => ({ ...prev, preCollectionGuidelines: ' ' }));
                      }
                    }}
                    className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-900">Pre-Collection Guidelines</span>
                </label>
                {formData.preCollectionGuidelines && (
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, preCollectionGuidelines: '' }))}
                    className="text-sm text-green-600 hover:text-green-700"
                  >
                    Clear
                  </button>
                )}
              </div>
              {formData.preCollectionGuidelines && (
                <textarea
                  name="preCollectionGuidelines"
                  rows={3}
                  value={formData.preCollectionGuidelines}
                  onChange={handleChange}
                  placeholder="Enter pre-collection guidelines for this test (e.g., fasting requirements, timing instructions)..."
                  className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              )}
            </div>
          </div>

          {/* Required Patient Inputs & Pre-Conditions */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <AlertCircle className="h-5 w-5 mr-2 text-blue-600" />
              Required Patient Inputs & Pre-Conditions
            </h3>
            <p className="text-sm text-gray-500 -mt-2">
              When checked, the order form will require these inputs before submission.
            </p>

            <div className="bg-blue-50 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: 'pregnancy_status', label: 'Pregnancy Status' },
                  { key: 'lmp', label: 'LMP (Last Menstrual Period)' },
                  { key: 'weight', label: 'Weight' },
                  { key: 'height', label: 'Height' },
                  { key: 'blood_pressure', label: 'Blood Pressure' },
                  { key: 'id_document', label: 'ID Document (Aadhaar etc.)' },
                  { key: 'consent_form', label: 'Consent Form' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center px-3 py-2 border rounded-md bg-white hover:bg-blue-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.required_patient_inputs.includes(key)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          required_patient_inputs: checked
                            ? [...prev.required_patient_inputs, key]
                            : prev.required_patient_inputs.filter(f => f !== key)
                        }));
                      }}
                      className="h-4 w-4 text-blue-600 rounded"
                    />
                    <span className="ml-2 text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* AI Reference Range Configuration */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Brain className="h-5 w-5 mr-2 text-purple-600" />
              AI Reference Range Configuration
            </h3>

            <div className="bg-purple-50 rounded-lg p-4 space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.ref_range_ai_config?.enabled}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    ref_range_ai_config: { ...prev.ref_range_ai_config, enabled: e.target.checked }
                  }))}
                  className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                />
                <span className="ml-2 font-medium text-gray-900">Enable AI Reference Range Determination</span>
              </label>

              {formData.ref_range_ai_config?.enabled && (
                <div className="ml-6 grid grid-cols-2 gap-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.ref_range_ai_config?.consider_age}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        ref_range_ai_config: { ...prev.ref_range_ai_config, consider_age: e.target.checked }
                      }))}
                      className="h-4 w-4 text-purple-600 rounded"
                    />
                    <span className="ml-2 text-sm">Consider Exact Age (Pediatric)</span>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Analyte Selection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">Select Analytes</h3>
              <button
                type="button"
                onClick={() => setShowAnalyteForm(true)}
                className="flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add New Analyte
              </button>
            </div>

            {/* Search Box + Show Selected Toggle */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search analytes by name, category, or unit..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showSelectedOnly}
                  onChange={(e) => setShowSelectedOnly(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                Show Selected ({formData.selectedAnalytes.length})
              </label>
            </div>

            {/* No Analytes Available Message */}
            {!loading && analytes.length === 0 && (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">No Analytes Available</h4>
                <p className="text-gray-600 mb-4">
                  You need to create analytes before you can create a test group.
                  <br />
                  <span className="text-sm text-blue-600">Analytes will be created for your lab. Owner can promote good ones to global templates.</span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowAnalyteForm(true)}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mx-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Analyte
                </button>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-600 mt-2">Loading analytes...</p>
              </div>
            )}

            {/* No Search Results */}
            {!loading && analytes.length > 0 && filteredAnalytes.length === 0 && (searchQuery || showSelectedOnly) && (
              <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                <Search className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600 mb-4">
                  {showSelectedOnly && !searchQuery
                    ? 'No analytes selected yet.'
                    : `No analytes found matching "${searchQuery}"`}
                  <br />
                  <span className="text-sm text-blue-600">
                    {showSelectedOnly && !searchQuery ? 'Select analytes from the full list.' : 'Create a new analyte for your lab.'}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowAnalyteForm(true)}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mx-auto"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Analyte
                </button>
              </div>
            )}

            {/* Analyte Selection Grid */}
            {filteredAnalytes.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-4">
                {filteredAnalytes.map((analyte) => (
                  <label key={analyte.id} className="flex items-start p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.selectedAnalytes.includes(analyte.id)}
                      onChange={() => handleAnalyteSelection(analyte.id)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-1"
                    />
                    <div className="ml-3 flex-1">
                      <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                        {analyte.name}
                        {analyte.is_calculated && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded border border-amber-300">
                            <Calculator className="w-3 h-3" />
                            Calc
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Unit: {analyte.unit} • Range: {analyte.referenceRange}
                      </div>
                      <div className="text-xs text-gray-400">
                        Category: {analyte.category}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Selected Analytes Summary */}
            {formData.selectedAnalytes.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-green-900">
                    Selected Analytes ({formData.selectedAnalytes.length}
                    {Object.values(analyteMetadata).filter(m => !m.is_visible).length > 0 && (
                      <span className="text-orange-600 ml-1 text-sm font-normal">
                        · {Object.values(analyteMetadata).filter(m => !m.is_visible).length} hidden on report
                      </span>
                    )})
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove all ${formData.selectedAnalytes.length} analytes from this test group?`)) {
                          setFormData(prev => ({ ...prev, selectedAnalytes: [] }));
                          setAnalyteMetadata({});
                        }
                      }}
                      className="flex items-center gap-1 px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors text-xs"
                      title="Remove all analytes from this test group"
                    >
                      <X className="h-3 w-3" />
                      Remove All
                    </button>
                    {testGroup?.id && (
                      <div className="flex flex-col items-end">
                        <button
                          type="button"
                          onClick={handleSyncFromGlobal}
                          disabled={syncingGlobal}
                          className="flex items-center gap-1 px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs"
                          title="Pull sort order & section headings from global catalog"
                        >
                          <RefreshCw className={`h-3 w-3 ${syncingGlobal ? 'animate-spin' : ''}`} />
                          {syncingGlobal ? 'Syncing...' : 'Sync from Global'}
                        </button>
                        {syncGlobalResult && (
                          <span className={`text-xs mt-1 ${syncGlobalResult.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
                            {syncGlobalResult}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-3">Set sort order and optional section sub-headings for PDF report grouping.</p>
                <div className="space-y-2">
                  {selectedAnalyteDetails.map((analyte) => {
                    const meta = analyteMetadata[analyte.id] || { sort_order: 0, section_heading: '', is_visible: true };
                    const isHidden = !meta.is_visible;
                    return (
                      <div key={analyte.id} className={`p-2 rounded border shadow-sm ${isHidden ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-green-100'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {meta.sort_order > 0 && (
                              <span className="text-xs font-bold text-gray-400 w-5 text-right">{meta.sort_order}.</span>
                            )}
                            <span className={`font-medium text-sm ${isHidden ? 'text-gray-500' : 'text-gray-800'}`}>{analyte.name}</span>
                            <span className="text-xs text-gray-400">
                              {analyte.referenceRange ? `(${analyte.referenceRange})` : ''}
                              {analyte.unit ? ` [${analyte.unit}]` : ''}
                            </span>
                            {isHidden && (
                              <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Hidden on Report</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              title={isHidden ? 'Show on report' : 'Hide on report'}
                              onClick={() => setAnalyteMetadata(prev => ({
                                ...prev,
                                [analyte.id]: { ...meta, is_visible: !meta.is_visible }
                              }))}
                              className={`p-1 rounded hover:bg-gray-100 ${isHidden ? 'text-orange-500' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                              {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingAttachedAnalyte(analyte)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 flex items-center"
                            >
                              <Edit className="w-3 h-3 mr-1" />
                              Edit
                            </button>
                            <button
                              type="button"
                              title="Delink analyte from this test group"
                              onClick={() => {
                                if (confirm(`Remove "${analyte.name}" from this test group?`)) {
                                  setFormData(prev => ({ ...prev, selectedAnalytes: prev.selectedAnalytes.filter((id: string) => id !== analyte.id) }));
                                  setAllLinkedAnalytes(prev => prev.filter(a => a.id !== analyte.id));
                                  setAnalyteMetadata(prev => { const next = { ...prev }; delete next[analyte.id]; return next; });
                                }
                              }}
                              className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                            >
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <div className="flex items-center gap-1">
                            <label className="text-xs text-gray-500 whitespace-nowrap">Order:</label>
                            <input
                              type="number"
                              min={0}
                              value={meta.sort_order}
                              onChange={(e) => setAnalyteMetadata(prev => ({
                                ...prev,
                                [analyte.id]: { ...meta, sort_order: parseInt(e.target.value) || 0 }
                              }))}
                              className="w-14 text-xs border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                          <div className="flex items-center gap-1 flex-1">
                            <label className="text-xs text-gray-500 whitespace-nowrap">Section Heading:</label>
                            <input
                              type="text"
                              value={meta.section_heading}
                              placeholder="e.g. Chemical Examination"
                              onChange={(e) => setAnalyteMetadata(prev => ({
                                ...prev,
                                [analyte.id]: { ...meta, section_heading: e.target.value }
                              }))}
                              className="flex-1 text-xs border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>



          {/* Outsourced Configuration */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Building2 className="h-5 w-5 mr-2 text-blue-600" />
              Outsourced Configuration
            </h3>

            <div className="space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="is_outsourced"
                  checked={formData.is_outsourced}
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">This test is outsourced to an external lab</span>
              </label>

              {formData.is_outsourced && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default Outsourced Lab
                  </label>
                  <select
                    name="default_outsourced_lab_id"
                    value={formData.default_outsourced_lab_id}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select Lab</option>
                    {outsourcedLabs.map(lab => (
                      <option key={lab.id} value={lab.id}>{lab.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Select the default lab where this test is sent. You can change this per order.
                  </p>
                </div>
              )}
            </div>
          </div>

          {showProviderOnlyFields && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 flex items-center">
                <Brain className="h-5 w-5 mr-2 text-purple-600" />
                AI Processing Configuration (for this Test Group)
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default AI Processing Type
                  </label>
                  <select
                    name="default_ai_processing_type"
                    value={formData.default_ai_processing_type}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {aiProcessingTypes.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                  <div className="text-xs text-gray-500 mt-1">
                    {aiProcessingTypes.find(t => t.value === formData.default_ai_processing_type)?.description}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Group-Level AI Prompt (Optional)
                  </label>
                  <textarea
                    name="group_level_prompt"
                    rows={4}
                    value={formData.group_level_prompt}
                    onChange={handleChange}
                    placeholder="Enter a custom prompt for AI processing at the test group level. This overrides analyte-level prompts if group AI mode is 'group_only'."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <div className="text-xs text-gray-500 mt-1">This prompt will be used if the analyte's AI mode is 'group_only' or 'both'.</div>
                </div>
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-6 border-t border-gray-200">
            <div className="flex items-center gap-2">
              {testGroup?.id && (
                <button
                  type="button"
                  onClick={() => setShowImportWizard(true)}
                  className="flex items-center gap-2 px-4 py-2 border border-purple-300 text-purple-700 rounded-md hover:bg-purple-50 transition-colors text-sm"
                >
                  <Sparkles className="h-4 w-4" />
                  Import from Report
                </button>
              )}
              {testGroup?.id && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={handleSyncFromGlobal}
                    disabled={syncingGlobal}
                    className="flex items-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                    title="Reattach any missing analytes from global catalog (non-destructive)"
                  >
                    <RefreshCw className={`h-4 w-4 ${syncingGlobal ? 'animate-spin' : ''}`} />
                    {syncingGlobal ? 'Syncing...' : 'Sync from Global'}
                  </button>
                  {syncGlobalResult && (
                    <span className={`text-xs mt-1 ${syncGlobalResult.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
                      {syncGlobalResult}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={formData.selectedAnalytes.length === 0}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {testGroup ? 'Update Test Group' : 'Create Test Group'}
              </button>
            </div>
          </div>
        </form>
      </div >

       {/* Analyte Form Modal */}
       {
         showAnalyteForm && (
           <AnalyteForm
             onClose={() => setShowAnalyteForm(false)}
             onSubmit={handleAddNewAnalyte}
           />
         )
       }

        {/* Edit Attached Analyte Modal */}
        {editingAttachedAnalyte && (
            <SimpleAnalyteEditor
                analyte={editingAttachedAnalyte}
                availableAnalytes={analytes
                  .filter(a => !a.is_calculated && a.id !== editingAttachedAnalyte.id)
                  .map(a => ({ id: a.id, name: a.name, unit: a.unit || '', category: a.category }))}
                testGroupAnalyteIds={formData.selectedAnalytes.filter((id: string) => id !== editingAttachedAnalyte.id)}
                onSave={handleUpdateAttachedAnalyte}
                onCancel={() => setEditingAttachedAnalyte(null)}
            />
        )}

        {/* AI Report Import Wizard */}
        {showImportWizard && testGroup?.id && (
          <ReportImportWizard
            testGroupId={testGroup.id}
            testGroup={{
              methodology: formData.methodology,
              sampleType: formData.sampleType,
            }}
            existingAnalytes={analytes
              .filter(a => formData.selectedAnalytes.includes(a.id))
              .map(a => ({
                id: a.id,
                lab_analyte_id: a.lab_analyte_id ?? a.id,
                name: a.name,
                code: a.code ?? '',
                unit: a.unit ?? '',
                reference_range: a.reference_range ?? '',
                reference_range_male: a.reference_range_male ?? null,
                reference_range_female: a.reference_range_female ?? null,
              }))}
            existingTga={Object.entries(analyteMetadata).map(([analyte_id, meta]) => ({
              analyte_id,
              sort_order: meta.sort_order,
              section_heading: meta.section_heading,
            }))}
            onClose={() => setShowImportWizard(false)}
            onApplied={() => {
              setShowImportWizard(false);
              loadData(); // reload analytes + TGA metadata
            }}
          />
        )}
    </div >
  );
};

export default TestGroupForm;

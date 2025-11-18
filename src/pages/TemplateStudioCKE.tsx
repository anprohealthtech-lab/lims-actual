import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CheckCircle2,
  Eye,
  FileCode,
  FilePlus2,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Wand2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import TemplateAIConsole from '../components/TemplateStudio/TemplateAIConsole';
import TemplateAIAuditModal, { TemplateAuditResult } from '../components/TemplateStudio/TemplateAIAuditModal';
import PlaceholderPicker, { PlaceholderOption } from '../components/TemplateStudio/PlaceholderPicker';
import { useAuth } from '../contexts/AuthContext';
import { database, LabBrandingAsset, LabUserSignature } from '../utils/supabase';
import { ensureReportRegions } from '../utils/reportTemplateRegions';
import '../styles/report-baseline.css';

interface LabTemplateRecord {
  id: string;
  template_name: string;
  template_description?: string | null;
  gjs_html?: string | null;
  gjs_css?: string | null;
  template_version?: number | null;
  updated_at?: string | null;
  is_default?: boolean | null;
  category?: string | null;
  test_group_id?: string | null;
  ai_verification_status?: string | null;
  ai_verification_summary?: string | null;
  ai_verification_details?: unknown;
  ai_verification_checked_at?: string | null;
}

interface TestGroupOption {
  id: string;
  name: string;
  category?: string | null;
}

type RawTestGroupRow = {
  id: string;
  name: string;
  category?: string | null;
};

interface AuditTestGroup {
  id: string;
  name: string;
  analytes: Array<{
    id: string;
    name: string;
    unit: string | null;
    reference_range: string | null;
  }>;
}

type RawTestGroupAnalyte = {
  analytes?: {
    id?: string | null;
    name?: string | null;
    unit?: string | null;
    reference_range?: string | null;
  } | null;
  analyte_id?: string | null;
};

const REQUIRED_PLACEHOLDERS: Record<string, string> = {
  patientName: '{{patientName}}',
  patientAge: '{{patientAge}}',
  patientGender: '{{patientGender}}',
  patientId: '{{patientId}}',
  registrationDate: '{{registrationDate}}',
  locationName: '{{locationName}}',
  sampleCollectedAt: '{{sampleCollectedAt}}',
  approvedAt: '{{approvedAt}}',
  referringDoctorName: '{{referringDoctorName}}',
  reportDate: '{{reportDate}}',
  orderId: '{{orderId}}',
  labName: '{{labName}}',
};

const PLACEHOLDER_REGEX = /{{\s*([^{}]+)\s*}}/g;

const BRANDING_TYPE_LABELS: Record<LabBrandingAsset['asset_type'], string> = {
  logo: 'Logo',
  header: 'Header',
  footer: 'Footer',
  watermark: 'Watermark',
  letterhead: 'Letterhead',
};

const VARIANT_LABEL_OVERRIDES: Record<string, string> = {
  optimized: 'Optimized',
  preview1x: 'Preview 1x',
  preview2x: 'Preview 2x',
  webp: 'WebP',
};

const toTitleCase = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const parseVariantMap = (value: unknown): Record<string, string> => {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, url]) => {
          if (typeof url === 'string' && url.length) {
            acc[key] = url;
          }
          return acc;
        }, {});
      }
    } catch (err) {
      console.warn('Failed to parse variant JSON', err);
    }
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, url]) => {
      if (typeof url === 'string' && url.length) {
        acc[key] = url;
      }
      return acc;
    }, {});
  }

  return {};
};

const formatVariantLabel = (variantKey: string) =>
  VARIANT_LABEL_OVERRIDES[variantKey] ||
  toTitleCase(
    variantKey
      .replace(/([a-z])([0-9])/g, '$1 $2')
      .replace(/([0-9])x/i, '$1x')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
  );

const CKEDITOR_VERSION = '47.1.0';
const CKBOX_VERSION = '2.6.1';
const CKEDITOR_SCRIPT_URL = `https://cdn.ckeditor.com/ckeditor5/${CKEDITOR_VERSION}/ckeditor5.umd.js`;
const CKEDITOR_PREMIUM_SCRIPT_URL = `https://cdn.ckeditor.com/ckeditor5-premium-features/${CKEDITOR_VERSION}/ckeditor5-premium-features.umd.js`;
const CKEDITOR_CSS_URL = `https://cdn.ckeditor.com/ckeditor5/${CKEDITOR_VERSION}/ckeditor5.css`;
const CKEDITOR_PREMIUM_CSS_URL = `https://cdn.ckeditor.com/ckeditor5-premium-features/${CKEDITOR_VERSION}/ckeditor5-premium-features.css`;
const CKBOX_SCRIPT_URL = `https://cdn.ckbox.io/ckbox/${CKBOX_VERSION}/ckbox.js`;

const resourcePromises: Record<string, Promise<void>> = {};

const ensureStylesheet = (href: string) => {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (resourcePromises[href]) {
    return resourcePromises[href];
  }

  resourcePromises[href] = new Promise<void>((resolve, reject) => {
    const existing = Array.from(document.getElementsByTagName('link')).find((link) => link.href === href);
    if (existing) {
      resolve();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.crossOrigin = 'anonymous';
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
    document.head.appendChild(link);
  });

  return resourcePromises[href];
};

const ensureScript = (src: string) => {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (resourcePromises[src]) {
    return resourcePromises[src];
  }

  resourcePromises[src] = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  return resourcePromises[src];
};

const loadCkeditorResources = async () => {
  await Promise.all([
    ensureStylesheet(CKEDITOR_CSS_URL),
    ensureStylesheet(CKEDITOR_PREMIUM_CSS_URL),
    ensureScript(CKEDITOR_SCRIPT_URL),
    ensureScript(CKEDITOR_PREMIUM_SCRIPT_URL),
    ensureScript(CKBOX_SCRIPT_URL),
  ]);
};

interface PremiumEditorConfigOptions {
  initialData: string;
  licenseKey?: string;
  tokenUrl?: string;
  aiKey?: string;
}

const buildPremiumEditorConfig = (
  options: PremiumEditorConfigOptions,
  CKEDITOR: any,
  premiumFeatures: any
) => {
  const {
    Autoformat,
    AutoImage,
    AutoLink,
    Autosave,
    BalloonToolbar,
    Bold,
    CKBox,
    CKBoxImageEdit,
    CloudServices,
    Code,
    CodeBlock,
    Emoji,
    Essentials,
    FindAndReplace,
    GeneralHtmlSupport,
    Heading,
    Alignment,
    Indent,
    IndentBlock,
    Subscript,
    Superscript,
    FontFamily,
    FontSize,
    FontColor,
    FontBackgroundColor,
    HorizontalLine,
    HtmlComment,
    // HtmlEmbed, // Removed - not allowed by license
    ImageBlock,
    ImageCaption,
    ImageInline,
    ImageInsert,
    ImageInsertViaUrl,
    ImageResize,
    ImageStyle,
    ImageTextAlternative,
    ImageToolbar,
    ImageUpload,
    Italic,
    Link,
    LinkImage,
    List,
    ListProperties,
    Mention,
    PageBreak,
    Paragraph,
    PasteFromOffice,
    PictureEditing,
    RemoveFormat,
    SelectAll,
    ShowBlocks,
    SpecialCharacters,
    SpecialCharactersEssentials,
    Table,
    TableCaption,
    TableCellProperties,
    TableColumnResize,
    TableProperties,
    TableToolbar,
    TextTransformation,
    TodoList,
    WordCount,
  } = CKEDITOR;

  const {
    AIAssistant,
    OpenAITextAdapter,
    PasteFromOfficeEnhanced,
    SourceEditingEnhanced,
  } = premiumFeatures;

  const aiEnabled = Boolean(options.aiKey && AIAssistant && OpenAITextAdapter);

  const toolbarItems = [
    'undo',
    'redo',
    '|',
    'findAndReplace',
    'selectAll',
    '|',
    ...(aiEnabled ? ['aiCommands', 'aiAssistant', '|'] : []),
    'sourceEditingEnhanced',
    'showBlocks',
    '|',
    'heading',
      'alignment',
    '|',
    'fontFamily',
    'fontSize',
    '|',
    'bold',
    'italic',
    'subscript',
    'superscript',
    'code',
    'removeFormat',
    '|',
    'fontColor',
    'fontBackgroundColor',
    '|',
    'emoji',
    'specialCharacters',
    'link',
    'insertImage',
    'ckbox',
    'insertTable',
    'horizontalLine',
    'pageBreak',
    'codeBlock',
    // 'htmlEmbed', // Removed - not allowed by license
    '|',
    'bulletedList',
    'numberedList',
    'todoList',
    '|',
    'outdent',
    'indent',
  ];

  const plugins = [
    Autoformat,
    AutoImage,
    AutoLink,
    Autosave,
    BalloonToolbar,
    Bold,
    CKBox,
    CKBoxImageEdit,
    CloudServices,
    Code,
    CodeBlock,
    Emoji,
    Essentials,
    FindAndReplace,
    GeneralHtmlSupport,
    Heading,
    Alignment,
    Indent,
    IndentBlock,
    Subscript,
    Superscript,
    FontFamily,
    FontSize,
    FontColor,
    FontBackgroundColor,
    HorizontalLine,
    HtmlComment,
    // HtmlEmbed, // Removed - not allowed by license
    ImageBlock,
    ImageCaption,
    ImageInline,
    ImageInsert,
    ImageInsertViaUrl,
    ImageResize,
    ImageStyle,
    ImageTextAlternative,
    ImageToolbar,
    ImageUpload,
    Italic,
    Link,
    LinkImage,
    List,
    ListProperties,
    Mention,
    PageBreak,
    Paragraph,
    PasteFromOffice,
    PasteFromOfficeEnhanced,
    PictureEditing,
    RemoveFormat,
    SelectAll,
    ShowBlocks,
    SourceEditingEnhanced,
    SpecialCharacters,
    SpecialCharactersEssentials,
    Table,
    TableCaption,
    TableCellProperties,
    TableColumnResize,
    TableProperties,
    TableToolbar,
    TextTransformation,
    TodoList,
    WordCount,
    Alignment,
  ];

  if (aiEnabled) {
    plugins.push(AIAssistant, OpenAITextAdapter);
  }

  const config: any = {
    toolbar: {
      items: toolbarItems,
      shouldNotGroupWhenFull: false,
    },
    plugins,
    balloonToolbar: aiEnabled
      ? ['aiAssistant', '|', 'bold', 'italic', 'subscript', 'superscript', 'alignment', '|', 'link', 'insertImage', '|', 'bulletedList', 'numberedList']
      : ['bold', 'italic', 'subscript', 'superscript', 'alignment', '|', 'link', 'insertImage', '|', 'bulletedList', 'numberedList'],
    initialData: options.initialData || '',
    licenseKey: options.licenseKey || '',
    placeholder: 'Type or paste your content here!',
    htmlSupport: {
      allow: [
        {
          name: /^.*$/,
          styles: true,
          attributes: true,
          classes: true,
        },
      ],
    },
    image: {
      toolbar: [
        'toggleImageCaption',
        'imageTextAlternative',
        '|',
        'imageStyle:inline',
        'imageStyle:wrapText',
        'imageStyle:breakText',
        '|',
        'resizeImage',
        '|',
        'alignment:left',
        'alignment:center',
        'alignment:right',
        '|',
        'ckboxImageEdit',
      ],
    },
    table: {
      contentToolbar: [
        'tableColumn',
        'tableRow',
        'mergeTableCells',
        'tableProperties',
        'tableCellProperties',
      ],
      tableProperties: {
        defaultProperties: { borderStyle: 'solid', borderColor: '#e5e7eb', borderWidth: '1px', alignment: 'center' },
      },
      tableCellProperties: {
        defaultProperties: { horizontalAlignment: 'center', padding: '4px' },
      }
    },
    link: {
      addTargetToExternalLinks: true,
      defaultProtocol: 'https://',
      decorators: {
        toggleDownloadable: {
          mode: 'manual',
          label: 'Downloadable',
          attributes: {
            download: 'file',
          },
        },
      },
    },
    list: {
      properties: {
        styles: true,
        startIndex: true,
        reversed: true,
      },
    },
    alignment: {
      options: [ 'left', 'center', 'right', 'justify' ]
    },
    fontFamily: {
      options: [
        'default',
        'Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, sans-serif',
        'Arial, Helvetica, sans-serif',
        'Times New Roman, Times, serif',
        'Georgia, serif',
      ],
      supportAllValues: true,
    },
    fontSize: {
      options: [10, 12, 14, 16, 18, 20, 24],
      supportAllValues: true,
    },
    fontColor: {
      columns: 8,
      documentColors: 16,
    },
    fontBackgroundColor: {
      columns: 8,
      documentColors: 16,
    },
    indentBlock: {
      offset: 24,
      unit: 'px',
    },
    mention: {
      feeds: [
        {
          marker: '{{',
          feed: [
            '{{patientName}}',
            '{{patientAge}}',
            '{{patientGender}}',
            '{{patientDOB}}',
            '{{patientId}}',
            '{{orderId}}',
            '{{sampleId}}',
            '{{registrationDate}}',
            '{{locationName}}',
            '{{sampleCollectedAt}}',
            '{{approvedAt}}',
            '{{referringDoctorName}}',
            '{{reportDate}}',
            '{{approverSignature}}',
            '{{approvedByName}}',
            '{{approverName}}',
            '{{approverRole}}',
            '{{labName}}',
            '{{labAddress}}',
            '{{labPhone}}',
            '{{labEmail}}',
            '{{labLogoUrl}}',
          ],
          minimumCharacters: 0,
        },
      ],
    },
    wordCount: {
      onUpdate: (stats: any) => {
        // Word count stats available: stats.words, stats.characters
        if (typeof window !== 'undefined' && (window as any).ckeditorWordCount) {
          (window as any).ckeditorWordCount = stats;
        }
      },
    },
  };

  if (aiEnabled) {
    config.ai = {
      assistant: {
        adapter: {
          openAI: {
            requestHeaders: {
              Authorization: `Bearer ${options.aiKey}`,
            },
          },
        },
      },
    };
  }

  if (options.tokenUrl) {
    config.cloudServices = {
      tokenUrl: options.tokenUrl,
    };
  }

  return config;
};

const extractPlaceholders = (html: string): string[] => {
  const tokens = new Set<string>();
  if (!html) {
    return [];
  }

  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_REGEX.exec(html)) !== null) {
    const token = match[1]?.trim();
    if (token) {
      tokens.add(`{{${token}}}`);
    }
  }

  return Array.from(tokens);
};

const mapAuditStatusToVerification = (status: TemplateAuditResult['status']) => {
  switch (status) {
    case 'pass':
      return 'verified';
    case 'attention':
      return 'attention_needed';
    default:
      return 'changes_required';
  }
};

const RISKY_HTML_PATTERNS = [/<script/i, /javascript:/i, /onload\s*=/i, /onerror\s*=/i, /<iframe/i];

const hasRiskyMarkup = (html: string) => RISKY_HTML_PATTERNS.some((pattern) => pattern.test(html));

const findMissingPlaceholders = (
  beforeHtml: string,
  afterHtml: string,
  allowedRemovals: string[] = [],
  protectedPlaceholders?: string[]
): string[] => {
  const beforeSet = new Set(extractPlaceholders(beforeHtml));
  const afterSet = new Set(extractPlaceholders(afterHtml));
  const missing: string[] = [];
  const allowedSet = new Set(allowedRemovals);
  const protectedSet = protectedPlaceholders ? new Set(protectedPlaceholders) : beforeSet;

  beforeSet.forEach((token) => {
    if (!afterSet.has(token) && !allowedSet.has(token) && protectedSet.has(token)) {
      missing.push(token);
    }
  });

  return missing;
};

const buildInstructionFromAudit = (audit: TemplateAuditResult): string => {
  const lines: string[] = [];
  lines.push('Apply the audit findings to fix the lab report template.');
  if (audit.summary) {
    lines.push(`Audit summary: ${audit.summary}`);
  }

  if (audit.patientMetadata && audit.patientMetadata.missingColumns?.length) {
    lines.push(
      `Add the missing patient metadata columns: ${audit.patientMetadata.missingColumns.join(', ')} in the patient info table immediately after the header.`
    );
  }

  if (audit.headerFooter) {
    const headerIssues: string[] = [];
    if (!audit.headerFooter.headerImage) {
      headerIssues.push('add or restore the header image/logo container at the top with a placeholder img using {{headerImageUrl}}');
    }
    if (!audit.headerFooter.footerImage) {
      headerIssues.push('include a footer image container before the end of the document');
    }
    if (!audit.headerFooter.signatureBlock) {
      headerIssues.push('ensure the footer includes a signature block with {{signatoryImageUrl}} plus text placeholders for name and title');
    }
    if (headerIssues.length) {
      lines.push(headerIssues.join('; '));
    }
  }

  if (audit.placeholders?.requiredMissing?.length) {
    lines.push(`Insert the missing required placeholders exactly as listed: ${audit.placeholders.requiredMissing.join(', ')}.`);
  }

  if (audit.placeholders?.unknownPlaceholders?.length) {
    lines.push(`Review unknown placeholders to ensure they are legitimate: ${audit.placeholders.unknownPlaceholders.join(', ')}.`);
  }

  if (audit.analyteCoverage?.referencedButUnknown?.length) {
    lines.push(
      `Remove or rename analyte placeholders not present in the linked test group: ${audit.analyteCoverage.referencedButUnknown.join(', ')}.`
    );
  }

  if (audit.analyteCoverage?.missingFromTemplate?.length) {
    lines.push(
      `Add analyte rows or placeholders for missing test group analytes: ${audit.analyteCoverage.missingFromTemplate.join(', ')}.`
    );
  }

  if (audit.recommendations?.length) {
    lines.push(`Follow these additional recommendations: ${audit.recommendations.join('; ')}.`);
  }

  lines.push('Keep all existing placeholders intact unless instructed otherwise and maintain an accessible, printable layout.');
  lines.push('Audit details (JSON):');
  lines.push(JSON.stringify(audit, null, 2));

  return lines.join('\n');
};

const TemplateStudioCKE: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [labId, setLabId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<LabTemplateRecord[]>([]);
  const [templateMeta, setTemplateMeta] = useState<LabTemplateRecord | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [htmlContent, setHtmlContentState] = useState('');
  const [cssContent, setCssContent] = useState('');
  const [ckeditorInstance, setCkeditorInstance] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [editorBooting, setEditorBooting] = useState(true);
  const [metadataDraft, setMetadataDraft] = useState({
    name: '',
    description: '',
    category: 'reports',
    testGroupId: '',
  });
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [testGroups, setTestGroups] = useState<TestGroupOption[]>([]);
  const [testGroupsLoading, setTestGroupsLoading] = useState(false);
  const [testGroupsError, setTestGroupsError] = useState<string | null>(null);
  const [isAiConsoleOpen, setIsAiConsoleOpen] = useState(false);
  const [placeholderPickerOpen, setPlaceholderPickerOpen] = useState(false);
  const [placeholderOptions, setPlaceholderOptions] = useState<PlaceholderOption[]>([]);
  const [placeholderLoading, setPlaceholderLoading] = useState(false);
  const [placeholderError, setPlaceholderError] = useState<string | null>(null);
  const [isSourcePreviewOpen, setIsSourcePreviewOpen] = useState(false);
  const [sourceCopyState, setSourceCopyState] = useState<'html' | 'css' | null>(null);
  const [isA4PreviewOpen, setIsA4PreviewOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<TemplateAuditResult | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditImplementing, setAuditImplementing] = useState(false);

  const setHtmlContent = useCallback(
    (value: string) => {
      setHtmlContentState(ensureReportRegions(value || ''));
    },
    [setHtmlContentState]
  );
  const [auditSuccessMessage, setAuditSuccessMessage] = useState<string | null>(null);
  const [auditRevertSnapshot, setAuditRevertSnapshot] = useState<{ html: string; css: string } | null>(null);

  const PATIENT_PLACEHOLDER_OPTIONS: PlaceholderOption[] = useMemo(
    () => [
      { id: 'patientName', label: 'Patient Name', placeholder: '{{patientName}}', group: 'patient' },
      { id: 'patientAge', label: 'Patient Age', placeholder: '{{patientAge}}', group: 'patient' },
      { id: 'patientGender', label: 'Patient Gender', placeholder: '{{patientGender}}', group: 'patient' },
      { id: 'patientDOB', label: 'Patient Date of Birth', placeholder: '{{patientDOB}}', group: 'patient' },
      { id: 'patientId', label: 'Patient ID', placeholder: '{{patientId}}', group: 'patient' },
      { id: 'referringDoctorName', label: 'Referring Doctor Name', placeholder: '{{referringDoctorName}}', group: 'patient' },
      { id: 'registrationDate', label: 'Registration Date', placeholder: '{{registrationDate}}', group: 'patient' },
      { id: 'locationName', label: 'Location / Collection Centre', placeholder: '{{locationName}}', group: 'patient' },
      { id: 'sampleCollectedAt', label: 'Sample Collected At', placeholder: '{{sampleCollectedAt}}', group: 'patient' },
      { id: 'approvedAt', label: 'Approved / Verified At', placeholder: '{{approvedAt}}', group: 'patient' },
      { id: 'orderId', label: 'Order ID', placeholder: '{{orderId}}', group: 'patient' },
      { id: 'approverSignature', label: 'Approver Signature (Dynamic)', placeholder: '{{approverSignature}}', group: 'patient' },
      { id: 'approvedByName', label: 'Approved By Name', placeholder: '{{approvedByName}}', group: 'patient' },
      { id: 'approverName', label: 'Approver Name', placeholder: '{{approverName}}', group: 'patient' },
      { id: 'approverRole', label: 'Approver Role', placeholder: '{{approverRole}}', group: 'patient' },
    ],
    []
  );

  const LAB_META_PLACEHOLDER_OPTIONS: PlaceholderOption[] = useMemo(
    () => [
      { id: 'labName', label: 'Lab Name', placeholder: '{{labName}}', group: 'lab' },
      { id: 'labAddress', label: 'Lab Address', placeholder: '{{labAddress}}', group: 'lab' },
      { id: 'labPhone', label: 'Lab Phone', placeholder: '{{labPhone}}', group: 'lab' },
      { id: 'labEmail', label: 'Lab Email', placeholder: '{{labEmail}}', group: 'lab' },
      { id: 'labWebsite', label: 'Lab Website', placeholder: '{{labWebsite}}', group: 'lab' },
      { id: 'labLogoUrl', label: 'Lab Logo URL', placeholder: '{{labLogoUrl}}', group: 'lab' },
      { id: 'labSignatureImageUrl', label: 'Signature Image URL', placeholder: '{{labSignatureImageUrl}}', group: 'lab' },
    ],
    []
  );

  const DEFAULT_PLACEHOLDER_OPTIONS: PlaceholderOption[] = useMemo(
    () => [...LAB_META_PLACEHOLDER_OPTIONS, ...PATIENT_PLACEHOLDER_OPTIONS],
    [LAB_META_PLACEHOLDER_OPTIONS, PATIENT_PLACEHOLDER_OPTIONS]
  );

  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<any>(null);
  const htmlRef = useRef(htmlContent);
  const cssRef = useRef(cssContent);

  const ckeditorLicenseKey = import.meta.env.VITE_CKEDITOR_LICENSE_KEY as string | undefined;
  const ckeditorTokenUrl = import.meta.env.VITE_CKEDITOR_TOKEN_URL as string | undefined;
  const ckeditorAiApiKey = import.meta.env.VITE_CKEDITOR_AI_API_KEY as string | undefined;

  useEffect(() => {
    htmlRef.current = htmlContent;
  }, [htmlContent]);

  useEffect(() => {
    cssRef.current = cssContent;
  }, [cssContent]);

  useEffect(() => {
    if (isLoading || editorInstanceRef.current || typeof window === 'undefined') {
      return;
    }

    let isMounted = true;
    setEditorBooting(true);

    const waitForContainer = async () => {
      let attempts = 0;
      while (isMounted && !editorContainerRef.current && attempts < 40) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        attempts += 1;
      }

      if (!isMounted || !editorContainerRef.current) {
        throw new Error('Editor container not ready');
      }

      return editorContainerRef.current;
    };

    const initialiseEditor = async () => {
      try {
        await loadCkeditorResources();
        await waitForContainer();

        if (!isMounted || !editorContainerRef.current) {
          return;
        }

        const globalObject = window as unknown as {
          CKEDITOR?: any;
          CKEDITOR_PREMIUM_FEATURES?: any;
        };

        const CKEDITOR = globalObject.CKEDITOR;
        const premiumFeatures = globalObject.CKEDITOR_PREMIUM_FEATURES;

        if (!CKEDITOR?.ClassicEditor || !premiumFeatures) {
          throw new Error('CKEditor premium bundle is not available on window.');
        }

        const editorConfig = buildPremiumEditorConfig(
          {
            initialData: htmlRef.current,
            licenseKey: ckeditorLicenseKey,
            tokenUrl: ckeditorTokenUrl,
            aiKey: ckeditorAiApiKey,
          },
          CKEDITOR,
          premiumFeatures
        );

        const editor = await CKEDITOR.ClassicEditor.create(editorContainerRef.current, editorConfig);

        editor.editing.view.change((writer: any) => {
          const root = editor.editing.view.document.getRoot();
          writer.setStyle('min-height', '560px', root);
          writer.addClass('limsv2-report', root);
        });

        editor.model.document.on('change:data', () => {
          const data = editor.getData();
          if (htmlRef.current !== data) {
            htmlRef.current = data;
            setHtmlContent(data);
          }
        });

        editorInstanceRef.current = editor;
        setCkeditorInstance(editor);
        setEditorBooting(false);
      } catch (err) {
        console.error('Failed to initialise CKEditor premium editor:', err);
        if (isMounted) {
          setEditorBooting(false);
          setError('Unable to load the premium editor. Please refresh and try again or contact support.');
        }
      }
    };

    initialiseEditor();

    return () => {
      isMounted = false;
      const instance = editorInstanceRef.current;
      if (instance && typeof instance.destroy === 'function') {
        instance.destroy().catch((destroyErr: unknown) => {
          console.warn('Failed to cleanly destroy CKEditor instance:', destroyErr);
        });
      }
      editorInstanceRef.current = null;
    };
  }, [ckeditorAiApiKey, ckeditorLicenseKey, ckeditorTokenUrl, isLoading, selectedTemplateId]);

  const fetchAvailablePlaceholderOptions = useCallback(async (): Promise<PlaceholderOption[]> => {
    const aggregated: PlaceholderOption[] = [...LAB_META_PLACEHOLDER_OPTIONS];

    if (labId) {
      try {
        const [labParamsResult, brandingResult, signatureResult] = await Promise.all([
          database.templateParameters.listLabParameters(labId),
          database.labBrandingAssets.getAll(labId),
          database.userSignatures.getAll(user?.id, labId),
        ]);

        if (labParamsResult.error) {
          console.warn('Lab parameter fetch failed:', labParamsResult.error);
        } else if (labParamsResult.data?.length) {
          aggregated.push(
            ...labParamsResult.data.map((item) => ({
              ...item,
              group: 'lab' as const,
            }))
          );
        }

        if (brandingResult.error) {
          console.warn('Branding asset fetch failed:', brandingResult.error);
        } else if (brandingResult.data?.length) {
          const byType = new Map<LabBrandingAsset['asset_type'], LabBrandingAsset>();

          brandingResult.data.forEach((asset) => {
            if (!asset || !asset.file_url) {
              return;
            }
            const current = byType.get(asset.asset_type);
            if (!current || asset.is_default) {
              byType.set(asset.asset_type, asset);
            }
          });

          byType.forEach((asset, assetType) => {
            const friendlyType = BRANDING_TYPE_LABELS[assetType] || toTitleCase(assetType);
            const baseLabel = `Branding · ${friendlyType}`;
            const variantMap = parseVariantMap(asset.variants);
            const optimizedUrl = variantMap.optimized || asset.file_url;

            if (!optimizedUrl) {
              return;
            }

            const shouldConstrainWidth = assetType === 'header' || assetType === 'footer' || assetType === 'watermark';
            aggregated.push({
              id: `branding-${asset.id}-${variantMap.optimized ? 'optimized' : 'preferred'}`,
              label: `${baseLabel} (${variantMap.optimized ? 'Optimized' : 'Original'})`,
              placeholder: optimizedUrl,
              group: 'branding',
              assetType,
              variantKey: variantMap.optimized ? 'optimized' : 'original',
              preferredWidth: shouldConstrainWidth ? 1000 : null,
              preferredHeight: null,
              removeBackground: assetType === 'watermark',
            });
          });
        }

        if (signatureResult.error) {
          console.warn('Signature fetch failed:', signatureResult.error);
        } else if (signatureResult.data?.length) {
          const signatures = signatureResult.data as LabUserSignature[];
          const defaultSignature = signatures.find((sig) => sig.is_default) || signatures[0];

          if (defaultSignature) {
            const friendlyName = defaultSignature.signature_name || 'Signature';
            const baseLabel = `Signature · ${friendlyName}`;

            if (defaultSignature.file_url) {
              const variants = parseVariantMap(defaultSignature.variants);
              const optimizedSignature = variants.optimized || defaultSignature.file_url;

              aggregated.push({
                id: `signature-${defaultSignature.id}-${variants.optimized ? 'optimized' : 'preferred'}`,
                label: `${baseLabel} (${variants.optimized ? 'Optimized' : 'Original'})`,
                placeholder: optimizedSignature,
                group: 'signature',
                assetType: 'signature',
                variantKey: variants.optimized ? 'optimized' : 'original',
                preferredWidth: 200,
                preferredHeight: 200,
                removeBackground: true,
              });
            }

            if (defaultSignature.text_signature) {
              aggregated.push({
                id: `signature-${defaultSignature.id}-text`,
                label: `${baseLabel} (Text)`,
                placeholder: defaultSignature.text_signature,
                group: 'signature',
              });
            }
          }
        }
      } catch (err) {
        console.error('Failed to gather lab placeholders', err);
      }

      if (templateMeta?.test_group_id) {
        const { data: testParams, error: testError } = await database.templateParameters.listTestGroupParameters(
          templateMeta.test_group_id
        );
        if (testError) {
          console.warn('Test group parameter fetch failed:', testError);
        } else if (testParams?.length) {
          aggregated.push(
            ...testParams.map((item) => ({
              ...item,
              group: 'test' as const,
            }))
          );
        }
      }
    }

    aggregated.push(...PATIENT_PLACEHOLDER_OPTIONS);

    const uniqueByPlaceholder = new Map<string, PlaceholderOption>();
    aggregated.forEach((option) => {
      const existing = uniqueByPlaceholder.get(option.placeholder);
      if (!existing) {
        uniqueByPlaceholder.set(option.placeholder, option);
        return;
      }

      if (existing.group !== option.group) {
        uniqueByPlaceholder.set(option.placeholder, {
          ...existing,
          group: existing.group === 'lab' ? existing.group : option.group,
        });
      }
    });

    return Array.from(uniqueByPlaceholder.values());
  }, [LAB_META_PLACEHOLDER_OPTIONS, PATIENT_PLACEHOLDER_OPTIONS, labId, templateMeta?.test_group_id, user?.id]);

  const loadPlaceholderOptions = useCallback(async () => {
    setPlaceholderLoading(true);
    setPlaceholderError(null);

    try {
      const options = await fetchAvailablePlaceholderOptions();
      setPlaceholderOptions(options);
    } catch (err) {
      console.error('Placeholder option fetch failed:', err);
      setPlaceholderOptions(DEFAULT_PLACEHOLDER_OPTIONS);
      setPlaceholderError('Unable to load lab/test placeholders. Showing default placeholder set instead.');
    } finally {
      setPlaceholderLoading(false);
    }
  }, [DEFAULT_PLACEHOLDER_OPTIONS, fetchAvailablePlaceholderOptions]);

  useEffect(() => {
    if (!placeholderPickerOpen) {
      return;
    }
    loadPlaceholderOptions().catch((err) => {
      console.warn('Placeholder loader rejected:', err);
    });
  }, [loadPlaceholderOptions, placeholderPickerOpen]);

  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (!editor || typeof editor.getData !== 'function' || typeof editor.setData !== 'function') {
      return;
    }

    const currentData = editor.getData();
    if (currentData !== htmlContent) {
      editor.setData(htmlContent || '');
    }
  }, [htmlContent]);

  const handleInsertPlaceholder = useCallback(
    (option: PlaceholderOption) => {
      const instance = ckeditorInstance || editorInstanceRef.current;
      if (!instance) {
        setPlaceholderError('Editor is not ready yet. Try again in a moment.');
        return;
      }

      const token = option.placeholder;
      if (!token || typeof token !== 'string') {
        setPlaceholderError('Selected placeholder did not include any content to insert.');
        return;
      }

      const isImagePlaceholder = option.group === 'branding' || option.group === 'signature';

      try {
        instance.model.change((writer: any) => {
          const selection = instance.model.document.selection;

          if (isImagePlaceholder) {
            const attributes: Record<string, string> = {
              src: token,
              alt: option.label || 'Lab asset',
            };

            const styleSegments: string[] = [];

            if (option.preferredWidth) {
              const constrainedWidth = Math.max(option.preferredWidth, 1);
              attributes.width = String(constrainedWidth);
              styleSegments.push(`width:${constrainedWidth}px`, `max-width:${constrainedWidth}px`);
              if (!option.preferredHeight) {
                styleSegments.push('height:auto');
              }
            }

            if (option.preferredHeight) {
              const constrainedHeight = Math.max(option.preferredHeight, 1);
              attributes.height = String(constrainedHeight);
              styleSegments.push(`height:${constrainedHeight}px`);
            }

            if (option.preferredWidth || option.preferredHeight) {
              styleSegments.push('object-fit:contain');
            }

            if (option.removeBackground) {
              styleSegments.push('background:none transparent', 'background-image:none');
            }
            
            // Add background layer styling for watermarks
            if (option.assetType === 'watermark') {
              styleSegments.push(
                'position:absolute',
                'top:50%',
                'left:50%',
                'transform:translate(-50%, -50%)',
                'z-index:1',
                'opacity:0.15',
                'pointer-events:none'
              );
            }

            if (!option.preferredWidth && !option.preferredHeight) {
              styleSegments.push('max-width:100%', 'height:auto');
            }

            if (styleSegments.length) {
              attributes.style = Array.from(new Set(styleSegments)).join(';');
            }

            const imageElement = writer.createElement('imageBlock', attributes);
            instance.model.insertContent(imageElement, selection);
            return;
          }

          // For signature placeholders, insert as image tag instead of plain text
          if (token === '{{approverSignature}}' || token === '{{approvedBySignature}}') {
            const imgHtml = `<img src="${token}" alt="Approver Signature" style="max-width:200px;height:auto;object-fit:contain;" />`;
            const viewFragment = instance.data.processor.toView(imgHtml);
            const modelFragment = instance.data.toModel(viewFragment);
            instance.model.insertContent(modelFragment, selection);
          } else {
            const insertPosition = selection.getFirstPosition();
            if (insertPosition) {
              writer.insertText(token, insertPosition);
            } else {
              const textNode = writer.createText(token);
              instance.model.insertContent(textNode, selection);
            }
          }
        });

        setPlaceholderPickerOpen(false);
        setPlaceholderError(null);
      } catch (err) {
        console.error('Failed to insert placeholder:', err);
        setPlaceholderError('Unable to insert placeholder. Select an insertion point and try again.');
      }
    },
    [ckeditorInstance]
  );

  const handleCopySource = useCallback(
    async (variant: 'html' | 'css') => {
      const value = variant === 'html' ? htmlContent : cssContent;
      try {
        await navigator.clipboard.writeText(value || '');
        setSourceCopyState(variant);
        window.setTimeout(() => setSourceCopyState(null), 2000);
      } catch (err) {
        console.warn('Failed to copy source', err);
        setSourceCopyState(null);
      }
    },
    [cssContent, htmlContent]
  );

  const handleConvertToWatermark = useCallback(() => {
    const instance = ckeditorInstance || editorInstanceRef.current;
    if (!instance) {
      alert('Editor is not ready');
      return;
    }

    try {
      instance.model.change((writer: any) => {
        const selection = instance.model.document.selection;
        const selectedElement = selection.getSelectedElement();

        if (!selectedElement || !selectedElement.is('element', 'imageBlock')) {
          alert('Please select an image first to convert it to a watermark');
          return;
        }

        // Apply watermark styling
        const watermarkStyles = [
          'position:absolute',
          'top:50%',
          'left:50%',
          'transform:translate(-50%, -50%)',
          'z-index:1',
          'opacity:0.15',
          'pointer-events:none',
          'max-width:80%',
          'height:auto',
          'background:none transparent',
          'background-image:none'
        ].join(';');

        writer.setAttribute('style', watermarkStyles, selectedElement);
        writer.setAttribute('class', 'report-watermark', selectedElement);
        
        alert('✅ Image converted to watermark background layer!\n\nThe image now has:\n• Low opacity (15%)\n• Centered position\n• Behind content (z-index: 1)\n• Content will appear above it (z-index: 3)');
      });
    } catch (err) {
      console.error('Failed to convert to watermark:', err);
      alert('Failed to apply watermark styling. Please try again.');
    }
  }, [ckeditorInstance]);

  // Sidebar collapse/expand for more editor space
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleAddImageOverlay = useCallback(() => {
    const instance = ckeditorInstance || editorInstanceRef.current;
    if (!instance) {
      alert('Editor is not ready');
      return;
    }

    try {
      const selection = instance.model.document.selection;
      const selectedElement = selection.getSelectedElement();

      if (!selectedElement || !selectedElement.is('element', 'imageBlock')) {
        alert('Please select an image first to add text overlay');
        return;
      }

      const overlayText = prompt('Enter the text to display over the image:', 'Sample Overlay Text');
      if (!overlayText) return;

      const imageUrl = selectedElement.getAttribute('src');
      
      // Create HTML with image and overlay text
      const overlayHtml = `
        <div style="position:relative;display:inline-block;max-width:100%;">
          <img src="${imageUrl}" style="display:block;width:100%;height:auto;" />
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10;background:rgba(0,0,0,0.6);color:white;padding:12px 24px;border-radius:8px;font-size:18px;font-weight:bold;text-align:center;white-space:nowrap;">
            ${overlayText}
          </div>
        </div>
      `;

      instance.model.change((writer: any) => {
        // Convert HTML to CKEditor model
        const viewFragment = instance.data.processor.toView(overlayHtml);
        const modelFragment = instance.data.toModel(viewFragment);
        
        // Replace the selected image with the overlay container
        const parent = selectedElement.parent;
        const index = parent.getChildIndex(selectedElement);
        
        writer.remove(selectedElement);
        writer.insert(modelFragment, parent, index);
      });

      alert('✅ Text overlay added to image!\n\nYou can edit the HTML to customize:\n• Text content\n• Colors\n• Position\n• Background\n• Font size');
    } catch (err) {
      console.error('Failed to add image overlay:', err);
      alert('Failed to add overlay. Please try again.');
    }
  }, [ckeditorInstance]);

  const identityId = user?.id;

  useEffect(() => {
    let isActive = true;

    const bootstrap = async () => {
      if (!identityId) {
        if (isActive) {
          setIsLoading(false);
          setTemplateMeta(null);
        }
        return;
      }

      try {
        if (isActive) {
          setIsLoading(true);
          setError(null);
        }

        const currentLabId = await database.getCurrentUserLabId();

        if (!isActive) {
          return;
        }

        if (!currentLabId) {
          setLabId(null);
          setTemplateMeta(null);
          setError('Unable to determine lab context for your account. Please contact support.');
          return;
        }

        setLabId(currentLabId);

        const { data: templateRows, error: templatesError } = await database.labTemplates.list(currentLabId);
        console.log('📋 Template fetch result:', { templateRows, templatesError, currentLabId });
        if (templatesError) {
          throw templatesError;
        }

        const normalizedTemplates = (templateRows || []) as LabTemplateRecord[];
        console.log('📋 Normalized templates:', normalizedTemplates);
        let templateRecord = (normalizedTemplates.find((tpl) => tpl.is_default) || normalizedTemplates[0]) as
          | LabTemplateRecord
          | undefined;

        if (!templateRecord) {
          const { data: createdTemplate, error: createError } = await database.labTemplates.create({
            labId: currentLabId,
            name: 'Default Lab Template',
            description: 'Auto-generated default template for this lab.',
            category: 'reports',
          });

          if (createError || !createdTemplate) {
            throw createError || new Error('Template creation failed');
          }

          templateRecord = createdTemplate as LabTemplateRecord;
          normalizedTemplates.push(templateRecord);
        }

        if (!isActive) {
          return;
        }

        setTemplates(normalizedTemplates);
        setTemplateMeta(templateRecord);
        setSelectedTemplateId(templateRecord?.id || null);
        setHtmlContent(templateRecord?.gjs_html || '');
        setCssContent(templateRecord?.gjs_css || '');
        setLastSavedAt(templateRecord?.updated_at ? new Date(templateRecord.updated_at) : null);
        setSaveError(null);
      } catch (err) {
        console.error('Failed to initialize CKEditor Template Studio:', err);
        if (isActive) {
          setTemplateMeta(null);
          setError('Unable to load or create a lab template. Please try again or contact support.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    if (!authLoading) {
      bootstrap();
    }

    return () => {
      isActive = false;
    };
  }, [authLoading, identityId]);

  useEffect(() => {
    if (!saveMessage) {
      return;
    }

    const timer = window.setTimeout(() => setSaveMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [saveMessage]);

  useEffect(() => {
    if (!metadataMessage) {
      return;
    }

    const timer = window.setTimeout(() => setMetadataMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [metadataMessage]);

  useEffect(() => {
    if (!templateMeta) {
      setMetadataDraft({
        name: '',
        description: '',
        category: 'reports',
        testGroupId: '',
      });
      setAuditResult(null);
      return;
    }

    setMetadataDraft({
      name: templateMeta.template_name || '',
      description: templateMeta.template_description || '',
      category: templateMeta.category || 'reports',
      testGroupId: templateMeta.test_group_id || '',
    });

    if (templateMeta.ai_verification_details) {
      if (typeof templateMeta.ai_verification_details === 'string') {
        try {
          const parsed = JSON.parse(templateMeta.ai_verification_details) as TemplateAuditResult;
          setAuditResult(parsed);
        } catch (err) {
          console.warn('Failed to parse stored AI verification details:', err);
          setAuditResult(null);
        }
      } else {
        setAuditResult(templateMeta.ai_verification_details as TemplateAuditResult);
      }
    } else {
      setAuditResult(null);
    }
  }, [templateMeta]);

  useEffect(() => {
    if (!labId) {
      setTestGroups([]);
      return;
    }

    let isActive = true;

    const fetchTestGroups = async () => {
      setTestGroupsLoading(true);
      setTestGroupsError(null);

      const { data, error: testGroupError } = await database.testGroups.listByLab(labId);

      if (!isActive) {
        return;
      }

      if (testGroupError) {
        console.error('Failed to load test groups for CKEditor Template Studio:', testGroupError);
        setTestGroupsError('Unable to load test groups. Linking is temporarily unavailable.');
        setTestGroups([]);
      } else {
        const rawGroups = Array.isArray(data) ? (data as RawTestGroupRow[]) : [];
        const mapped = rawGroups.map((group) => ({
          id: group.id,
          name: group.name,
          category: group.category ?? null,
        }));
        setTestGroups(mapped);
      }

      setTestGroupsLoading(false);
    };

    fetchTestGroups();

    return () => {
      isActive = false;
    };
  }, [labId]);

  const verificationStatusBadge = useMemo(() => {
    const status = templateMeta?.ai_verification_status;
    if (!status) {
      return null;
    }

    const map: Record<string, { label: string; classes: string }> = {
      verified: {
        label: 'AI Verified',
        classes: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
      },
      attention_needed: {
        label: 'Needs Attention',
        classes: 'border border-amber-200 bg-amber-50 text-amber-700',
      },
      changes_required: {
        label: 'Requires Changes',
        classes: 'border border-red-200 bg-red-50 text-red-700',
      },
      pass: {
        label: 'AI Pass',
        classes: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
      },
      attention: {
        label: 'Needs Attention',
        classes: 'border border-amber-200 bg-amber-50 text-amber-700',
      },
      fail: {
        label: 'Requires Changes',
        classes: 'border border-red-200 bg-red-50 text-red-700',
      },
    };

    return map[status] || {
      label: status,
      classes: 'border border-gray-200 bg-gray-100 text-gray-700',
    };
  }, [templateMeta?.ai_verification_status]);

  const editorAdapter = useMemo(
    () => ({
      getHtml: () => {
        const instance = editorInstanceRef.current || ckeditorInstance;
        return instance?.getData?.() ?? htmlRef.current;
      },
      getCss: () => cssRef.current,
      setComponents: (value: string) => {
        setHtmlContent(value);
        const instance = editorInstanceRef.current || ckeditorInstance;
        if (instance?.setData) {
          instance.setData(value);
        } else {
          htmlRef.current = value;
        }
      },
      setStyle: (value: string) => {
        setCssContent(value || '');
      },
    }),
    [ckeditorInstance, setHtmlContent, setCssContent]
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      console.log('🔄 Template select triggered:', templateId);
      const template = templates.find((tpl) => tpl.id === templateId);
      console.log('📄 Found template:', template?.template_name);
      if (!template) {
        console.warn('❌ Template not found for ID:', templateId);
        return;
      }

      // Get the HTML content
      const htmlContent = template.gjs_html || '';
      console.log('💾 Loading HTML content (length):', htmlContent.length);
      
      // Update all state - React will remount editor due to key change
      setSelectedTemplateId(templateId);
      setTemplateMeta(template);
      setHtmlContent(htmlContent);
      setCssContent(template.gjs_css || '');
      htmlRef.current = htmlContent;
      cssRef.current = template.gjs_css || '';
      
      setLastSavedAt(template?.updated_at ? new Date(template.updated_at) : null);
      setSaveMessage(null);
      setSaveError(null);
      setAuditSuccessMessage(null);
      setAuditRevertSnapshot(null);
      
      console.log('✅ Template state updated, editor will remount');
    },
    [templates, setHtmlContent, setCssContent]
  );

  const handleCreateTemplate = useCallback(async () => {
    if (!labId) {
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const baseName = `New Template ${timestamp}`;
    const existingNames = new Set(
      templates
        .map((tpl) => tpl.template_name?.trim().toLowerCase())
        .filter((name): name is string => Boolean(name))
    );

    let candidateName = baseName;
    let suffix = 2;
    while (existingNames.has(candidateName.trim().toLowerCase())) {
      candidateName = `${baseName} (${suffix})`;
      suffix += 1;
    }

    try {
      const { data, error: createError } = await database.labTemplates.create({
        labId,
        name: candidateName,
        description: 'New template created from CKEditor Template Studio',
        category: 'reports',
      });

      if (createError || !data) {
        throw createError || new Error('Unable to create template');
      }

      const createdTemplate = data as LabTemplateRecord;
      setTemplates((prev) => [...prev, createdTemplate]);
      setSelectedTemplateId(createdTemplate.id);
      setTemplateMeta(createdTemplate);
      setHtmlContent(createdTemplate.gjs_html || '');
      setCssContent(createdTemplate.gjs_css || '');
      const instance = editorInstanceRef.current || ckeditorInstance;
      if (instance?.setData) {
        instance.setData(createdTemplate.gjs_html || '');
      }
      setLastSavedAt(createdTemplate.updated_at ? new Date(createdTemplate.updated_at) : null);
      setSaveMessage(null);
      setSaveError(null);
    } catch (createErr) {
      console.error('Failed to create template:', createErr);
      const duplicateName =
        createErr && typeof createErr === 'object' && 'code' in createErr && (createErr as { code?: string }).code === '23505';
      setSaveError(
        duplicateName
          ? 'A template with the same name already exists. Please rename the existing template or try again.'
          : 'Unable to create a new template right now. Please try again later.'
      );
    }
  }, [ckeditorInstance, labId, templates]);

  const handleSave = useCallback(async () => {
    if (!templateMeta) {
      return;
    }

    if (!labId) {
      setSaveError('Lab context missing. Please reload and try again.');
      return;
    }

    const instance = editorInstanceRef.current || ckeditorInstance;
    const currentHtml = instance?.getData?.() ?? htmlContent;
    const currentCss = cssContent;

    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const { data, error: saveErrorResponse } = await database.labTemplates.saveProject({
        templateId: templateMeta.id,
        labId,
        project: null,
        html: currentHtml,
        css: currentCss,
        components: null,
        styles: null,
        userId: identityId ?? null,
      });

      if (saveErrorResponse || !data) {
        throw saveErrorResponse || new Error('Save failed');
      }

      const savedTemplate = data as LabTemplateRecord;
      setTemplateMeta(savedTemplate);
      setTemplates((prev) => prev.map((tpl) => (tpl.id === savedTemplate.id ? savedTemplate : tpl)));
      setLastSavedAt(savedTemplate.updated_at ? new Date(savedTemplate.updated_at) : new Date());
      setSaveMessage('Template saved successfully.');
      setSaveError(null);
    } catch (err) {
      console.error('Failed to save template:', err);
      setSaveError('Unable to save the template. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [ckeditorInstance, cssContent, htmlContent, identityId, labId, templateMeta]);

  const handleMetadataSave = useCallback(async () => {
    if (!templateMeta) {
      return;
    }

    setMetadataSaving(true);
    setMetadataError(null);
    setMetadataMessage(null);

    try {
      const { data, error: updateError } = await database.labTemplates.updateMetadata({
        templateId: templateMeta.id,
        labId,
        name: metadataDraft.name,
        description: metadataDraft.description,
        category: metadataDraft.category,
        testGroupId: metadataDraft.testGroupId || null,
        userId: identityId ?? null,
      });

      if (updateError || !data) {
        throw updateError || new Error('Metadata update failed');
      }

      const updatedTemplate = data as LabTemplateRecord;
      setTemplateMeta(updatedTemplate);
      setTemplates((prev) => prev.map((tpl) => (tpl.id === updatedTemplate.id ? updatedTemplate : tpl)));
      setMetadataMessage('Template details updated.');
    } catch (err) {
      console.error('Failed to update template metadata:', err);
      setMetadataError('Unable to update template details. Please try again.');
    } finally {
      setMetadataSaving(false);
    }
  }, [identityId, labId, metadataDraft, templateMeta]);

  const handleRunAudit = useCallback(async () => {
    if (auditLoading) {
      return;
    }

    if (!labId) {
      setAuditError('Lab context missing. Please reload and try again.');
      setIsAuditModalOpen(true);
      return;
    }

    if (!templateMeta) {
      setAuditError('Template is not ready. Select a template and try again.');
      setIsAuditModalOpen(true);
      return;
    }

    const instance = editorInstanceRef.current || ckeditorInstance;
    const html = instance?.getData?.() ?? htmlContent;
    const css = cssContent;

    if (!html.trim()) {
      setAuditError('Template is empty. Add content before running the audit.');
      setIsAuditModalOpen(true);
      return;
    }

    setIsAuditModalOpen(true);
    setAuditLoading(true);
    setAuditError(null);
    setAuditSuccessMessage(null);

    const placeholders = extractPlaceholders(html);

    let availablePlaceholderCatalog = placeholderOptions;
    if (!availablePlaceholderCatalog.length) {
      try {
        availablePlaceholderCatalog = await fetchAvailablePlaceholderOptions();
      } catch (catalogError) {
        console.warn('Placeholder catalog fetch for audit failed:', catalogError);
        availablePlaceholderCatalog = DEFAULT_PLACEHOLDER_OPTIONS;
      }
    }

    const auditPlaceholderCatalog = Array.from(
      new Map(
        availablePlaceholderCatalog.map((option) => [
          option.placeholder,
          {
            placeholder: option.placeholder,
            label: option.label,
            group: option.group ?? 'lab',
            unit: option.unit ?? null,
            referenceRange: option.referenceRange ?? null,
          },
        ])
      ).values()
    );

    let normalizedTestGroup: AuditTestGroup | null = null;

    if (templateMeta.test_group_id) {
      const { data: testGroupData, error: testGroupError } = await database.testGroups.getById(templateMeta.test_group_id);
      if (testGroupError) {
        console.warn('Failed to load linked test group for audit:', testGroupError);
      } else if (testGroupData) {
        const raw = testGroupData as {
          id: string;
          name: string;
          test_group_analytes?: RawTestGroupAnalyte[];
        };
        const analytes = Array.isArray(raw.test_group_analytes) ? raw.test_group_analytes : [];
        normalizedTestGroup = {
          id: raw.id,
          name: raw.name,
          analytes: analytes.map((entry) => ({
            id: entry.analytes?.id ?? entry.analyte_id ?? '',
            name: entry.analytes?.name ?? '',
            unit: entry.analytes?.unit ?? null,
            reference_range: entry.analytes?.reference_range ?? null,
          })),
        };
      }
    }

    try {
      const endpoint = import.meta.env.VITE_TEMPLATE_AUDIT_ENDPOINT || '/.netlify/functions/template-audit';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateName: templateMeta.template_name || 'Template',
          labId,
          html,
          css,
          placeholders,
          availablePlaceholders: auditPlaceholderCatalog,
          requiredPlaceholders: REQUIRED_PLACEHOLDERS,
          testGroup: normalizedTestGroup,
        }),
      });

      const rawText = await response.text();

      if (!response.ok) {
        let errorMessage = 'Audit request failed.';
        try {
          const parsed = rawText ? JSON.parse(rawText) : null;
          errorMessage = parsed?.error || errorMessage;
        } catch (parseErr) {
          console.warn('Failed to parse audit error payload:', parseErr);
        }
        throw new Error(errorMessage);
      }

      let payload: unknown = {};
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch (error) {
        console.error('Audit response parse error:', error);
        throw new Error('Audit response was not valid JSON.');
      }

      const payloadWithAudit = payload as { audit?: TemplateAuditResult };
      const auditPayload: TemplateAuditResult = payloadWithAudit.audit || (payload as TemplateAuditResult);
      setAuditResult(auditPayload);

      try {
        const verificationStatus = mapAuditStatusToVerification(auditPayload.status);
        const { data: updatedTemplate, error: verificationError } = await database.labTemplates.updateVerification({
          templateId: templateMeta.id,
          labId,
          status: verificationStatus,
          summary: auditPayload.summary,
          details: auditPayload,
          checkedAt: new Date().toISOString(),
          userId: identityId ?? null,
        });

        if (verificationError) {
          throw verificationError;
        }

        if (updatedTemplate) {
          setTemplateMeta(updatedTemplate as LabTemplateRecord);
          setTemplates((prev) => prev.map((tpl) => (tpl.id === templateMeta.id ? (updatedTemplate as LabTemplateRecord) : tpl)));
        }
      } catch (verificationErr) {
        console.error('Audit completed but failed to save verification status:', verificationErr);
        setAuditError('Audit completed but storing the verification status failed. Please try again.');
      }
    } catch (err) {
      console.error('AI audit failed:', err);
      const message = err instanceof Error ? err.message : 'Unexpected error during audit. Please try again.';
      setAuditError(message);
    } finally {
      setAuditLoading(false);
    }
  }, [
    DEFAULT_PLACEHOLDER_OPTIONS,
    auditLoading,
    ckeditorInstance,
    fetchAvailablePlaceholderOptions,
    htmlContent,
    cssContent,
    identityId,
    labId,
    placeholderOptions,
    templateMeta,
  ]);

  const handleImplementAudit = useCallback(async () => {
    if (auditImplementing) {
      return;
    }

    if (!auditResult) {
      setAuditError('Run an audit before implementing changes.');
      setIsAuditModalOpen(true);
      return;
    }

    const instance = editorInstanceRef.current || ckeditorInstance;
    const currentHtml = instance?.getData?.() ?? htmlContent;
    const currentCss = cssContent;

    if (!currentHtml.trim()) {
      setAuditError('Template is empty. Add content before implementing fixes.');
      setIsAuditModalOpen(true);
      return;
    }

    setAuditImplementing(true);
    setAuditError(null);
    setAuditSuccessMessage(null);

    const instruction = buildInstructionFromAudit(auditResult);

    try {
      const endpoint = import.meta.env.VITE_TEMPLATE_AI_ENDPOINT || '/.netlify/functions/template-editor';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateName: templateMeta?.template_name || 'Template',
          instruction,
          prompt: instruction,
          html: currentHtml,
          css: currentCss,
          labId: labId ?? '',
          labContext: labId ?? '',
          history: [
            {
              role: 'user',
              content: 'System generated instructions based on audit findings. Apply these updates precisely.',
            },
          ],
        }),
      });

      const rawText = await response.text();
      let payload: unknown = {};

      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch (error) {
        console.error('AI implementation response parse error:', error);
        throw new Error('AI implementation response was not valid JSON.');
      }

      if (!response.ok) {
        const payloadWithError = payload as { error?: string };
        const errorMessage = payloadWithError.error || rawText || 'AI implementation request failed.';
        throw new Error(errorMessage);
      }

      const payloadWithContent = payload as { html?: unknown; css?: unknown };
      const nextHtml = typeof payloadWithContent.html === 'string' ? payloadWithContent.html : '';
      const nextCss = typeof payloadWithContent.css === 'string' ? payloadWithContent.css : '';

      if (!nextHtml.trim()) {
        throw new Error('AI response did not include HTML to apply.');
      }

      if (hasRiskyMarkup(nextHtml)) {
        throw new Error('AI response blocked due to unsafe markup (scripts or inline handlers).');
      }

      const allowedRemovals = [
        ...(auditResult.analyteCoverage?.referencedButUnknown || []),
        ...(auditResult.placeholders?.unknownPlaceholders || []),
      ];
      const protectedPlaceholders = Array.from(new Set(Object.values(REQUIRED_PLACEHOLDERS)));
      const missingPlaceholders = findMissingPlaceholders(currentHtml, nextHtml, allowedRemovals, protectedPlaceholders);
      if (missingPlaceholders.length) {
        throw new Error(`AI response removed required placeholders: ${missingPlaceholders.join(', ')}`);
      }

      setAuditRevertSnapshot({ html: currentHtml, css: currentCss });
      setHtmlContent(nextHtml);
      setCssContent(nextCss || '');
      if (instance?.setData) {
        instance.setData(nextHtml);
      }

      setSaveMessage('AI changes applied in the editor. Remember to save the template.');

      await handleRunAudit();

      setAuditSuccessMessage('AI changes applied. The audit was rerun with the updated template.');
    } catch (err) {
      console.error('Failed to implement audit recommendations:', err);
      setAuditError(err instanceof Error ? err.message : 'Unable to implement audit recommendations.');
    } finally {
      setAuditImplementing(false);
    }
  }, [
    auditImplementing,
    auditResult,
    ckeditorInstance,
    cssContent,
    handleRunAudit,
    htmlContent,
    labId,
    templateMeta?.template_name,
  ]);

  const handleRevertAuditImplementation = useCallback(() => {
    if (!auditRevertSnapshot) {
      return;
    }

    setHtmlContent(auditRevertSnapshot.html || '');
    setCssContent(auditRevertSnapshot.css || '');
    const instance = editorInstanceRef.current || ckeditorInstance;
    if (instance?.setData) {
      instance.setData(auditRevertSnapshot.html || '');
    }
    setAuditSuccessMessage('Reverted the last AI implementation.');
    setAuditError(null);
    setAuditRevertSnapshot(null);
  }, [auditRevertSnapshot, ckeditorInstance]);

  const handleDeleteTemplate = useCallback(async () => {
    if (!selectedTemplateId || !labId) {
      return;
    }

    setIsDeleting(true);
    try {
      const { error } = await database.labTemplates.delete(selectedTemplateId);
      
      if (error) {
        console.error('Failed to delete template:', error);
        alert('Failed to delete template. Please try again.');
        return;
      }

      // Refresh templates list
      const { data: updatedTemplates } = await database.labTemplates.list(labId);
      setTemplates(updatedTemplates || []);
      
      // Clear current template if it was deleted
      if (updatedTemplates && updatedTemplates.length > 0) {
        const firstTemplate = updatedTemplates[0];
        setSelectedTemplateId(firstTemplate.id);
        await handleTemplateSelect(firstTemplate.id);
      } else {
        // No templates left, clear everything
        setSelectedTemplateId(null);
        setTemplateMeta(null);
        setHtmlContent('');
        setCssContent('');
        setMetadataDraft({ name: '', description: '', category: '', testGroupId: '' });
      }
      
      setIsDeleteConfirmOpen(false);
    } catch (err) {
      console.error('Unexpected error deleting template:', err);
      alert('An unexpected error occurred. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedTemplateId, labId, handleTemplateSelect]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading CKEditor Template Studio…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl rounded-md border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
        {error}
      </div>
    );
  }

  const attachedTestGroupName = templateMeta?.test_group_id
    ? testGroups.find((group) => group.id === templateMeta.test_group_id)?.name || null
    : null;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Template Studio · CKEditor</h1>
          <p className="text-xs text-gray-500">Rich text editor with AI assistance and placeholder catalog.</p>
          {verificationStatusBadge ? (
            <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] ${verificationStatusBadge.classes}`}>
              <CheckCircle2 className="h-3 w-3" />
              {verificationStatusBadge.label}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            title={sidebarCollapsed ? 'Show Template Details' : 'Hide Template Details'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
            {sidebarCollapsed ? 'Show Details' : 'Hide Details'}
          </button>
          <button
            type="button"
            onClick={() => setIsSourcePreviewOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <FileCode className="h-3.5 w-3.5" /> Source
          </button>
          <button
            type="button"
            onClick={() => setPlaceholderPickerOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Placeholders
          </button>
          <button
            type="button"
            onClick={handleConvertToWatermark}
            title="Select an image and click to send it to background as watermark"
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            Send to Background
          </button>
          <button
            type="button"
            onClick={handleAddImageOverlay}
            title="Select an image and add text overlay on top of it"
            className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 transition hover:bg-teal-100"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Add Text Overlay
          </button>
          <button
            type="button"
            onClick={() => setIsA4PreviewOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 transition hover:bg-orange-100"
          >
            <Eye className="h-3.5 w-3.5" /> A4 Full View
          </button>
          <button
            type="button"
            onClick={() => setIsAiConsoleOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
          >
            <Sparkles className="h-3.5 w-3.5" /> Assistant
          </button>
          <button
            type="button"
            onClick={handleRunAudit}
            className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-100"
          >
            <Wand2 className="h-3.5 w-3.5" /> Audit
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? 'Saving…' : 'Save' }
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-visible">
        {!sidebarCollapsed && (
        <aside className="w-full max-w-xs shrink-0 border-r border-gray-200 bg-gray-50 px-4 py-4">
          <div className="space-y-4 text-sm">
            <section>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Templates</h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsDeleteConfirmOpen(true)}
                    disabled={!selectedTemplateId || templates.length <= 1}
                    className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    title={templates.length <= 1 ? "Cannot delete the only template" : "Delete current template"}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateTemplate}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-white"
                  >
                    <FilePlus2 className="h-3 w-3" /> New
                  </button>
                </div>
              </div>
              <select
                value={selectedTemplateId || ''}
                onChange={(event) => handleTemplateSelect(event.target.value)}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-0"
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.template_name || 'Untitled Template'}
                  </option>
                ))}
              </select>
              {lastSavedAt ? (
                <p className="mt-2 text-[11px] text-gray-500">Last saved {lastSavedAt.toLocaleString()}</p>
              ) : null}
              {saveMessage ? (
                <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-700">
                  {saveMessage}
                </p>
              ) : null}
              {saveError ? (
                <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1 text-[11px] text-red-700">
                  {saveError}
                </p>
              ) : null}
            </section>

            <section className="rounded-lg border border-gray-200 bg-white px-3 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Template Details</h3>
              <div className="mt-2 space-y-3 text-sm">
                <div>
                  <label className="text-[11px] font-medium text-gray-600">Name</label>
                  <input
                    type="text"
                    value={metadataDraft.name}
                    onChange={(event) =>
                      setMetadataDraft((prev) => ({ ...prev, name: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-0"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-600">Description</label>
                  <textarea
                    value={metadataDraft.description}
                    onChange={(event) =>
                      setMetadataDraft((prev) => ({ ...prev, description: event.target.value }))
                    }
                    className="mt-1 h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-0"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-600">Category</label>
                  <input
                    type="text"
                    value={metadataDraft.category}
                    onChange={(event) =>
                      setMetadataDraft((prev) => ({ ...prev, category: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-0"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-600">Linked Test Group</label>
                  <select
                    value={metadataDraft.testGroupId}
                    onChange={(event) =>
                      setMetadataDraft((prev) => ({ ...prev, testGroupId: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-0"
                  >
                    <option value="">Not linked</option>
                    {testGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  {testGroupsLoading ? (
                    <p className="mt-1 text-[11px] text-gray-500">Loading test groups…</p>
                  ) : null}
                  {testGroupsError ? (
                    <p className="mt-1 text-[11px] text-red-600">{testGroupsError}</p>
                  ) : null}
                  {attachedTestGroupName ? (
                    <p className="mt-1 text-[11px] text-gray-500">Linked to {attachedTestGroupName}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={handleMetadataSave}
                  disabled={metadataSaving}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {metadataSaving ? 'Saving…' : 'Save Details'}
                </button>
                {metadataMessage ? (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-700">
                    {metadataMessage}
                  </p>
                ) : null}
                {metadataError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1 text-[11px] text-red-700">
                    {metadataError}
                  </p>
                ) : null}
              </div>
            </section>

            {auditResult ? (
              <section className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last Audit</h3>
                <p className="mt-2 text-sm text-gray-700">{auditResult.summary}</p>
                <button
                  type="button"
                  onClick={() => setIsAuditModalOpen(true)}
                  className="mt-3 inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-3 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100"
                >
                  Review audit
                </button>
              </section>
            ) : null}
          </div>
        </aside>
        )}

        <main className="flex-1 overflow-y-auto px-6 py-6">
          {saveError ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {saveError}
            </div>
          ) : null}

          <div className="relative rounded-lg border border-gray-200 bg-white">
            {editorBooting ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Initialising editor…
                </div>
              </div>
            ) : null}
            <div key={selectedTemplateId || 'new-template'} ref={editorContainerRef} className="min-h-[560px]" />
          </div>

          <div className="mt-6">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Custom CSS (optional)</label>
            <textarea
              value={cssContent}
              onChange={(event) => setCssContent(event.target.value)}
              className="mt-2 h-40 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-0"
              placeholder="/* Add template-specific styles here */"
            />
          </div>

          {saveMessage ? (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {saveMessage}
            </p>
          ) : null}
        </main>
      </div>

      {placeholderPickerOpen ? (
        <PlaceholderPicker
          options={placeholderOptions}
          onInsert={handleInsertPlaceholder}
          onClose={() => setPlaceholderPickerOpen(false)}
          loading={placeholderLoading}
          errorMessage={placeholderError}
        />
      ) : null}

      {isSourcePreviewOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-4xl rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Template Source Preview</h2>
                <p className="text-[11px] text-gray-500">Copy HTML or CSS directly without leaving the editor.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSourcePreviewOpen(false);
                  setSourceCopyState(null);
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
              <section className="flex flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">HTML</h3>
                  <button
                    type="button"
                    onClick={() => handleCopySource('html')}
                    className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
                  >
                    {sourceCopyState === 'html' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <textarea
                  value={htmlContent}
                  readOnly
                  spellCheck={false}
                  className="h-64 resize-none rounded-md border border-gray-300 bg-gray-50 p-3 text-xs font-mono text-gray-800 focus:outline-none"
                />
              </section>
              <section className="flex flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">CSS</h3>
                  <button
                    type="button"
                    onClick={() => handleCopySource('css')}
                    className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
                  >
                    {sourceCopyState === 'css' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <textarea
                  value={cssContent}
                  readOnly
                  spellCheck={false}
                  className="h-64 resize-none rounded-md border border-gray-300 bg-gray-50 p-3 text-xs font-mono text-gray-800 focus:outline-none"
                  placeholder="/* No custom CSS yet */"
                />
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {isA4PreviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="h-[90vh] w-full max-w-6xl rounded-lg border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">A4 Full View Preview</h2>
                <p className="text-sm text-gray-500">Complete A4 document preview with actual dimensions</p>
              </div>
              <button
                type="button"
                onClick={() => setIsA4PreviewOpen(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
            
            <div className="flex h-[calc(90vh-80px)] overflow-hidden">
              {/* A4 Preview Container */}
              <div className="flex-1 overflow-auto bg-gray-100 p-8">
                <div className="mx-auto bg-white shadow-lg" style={{ 
                  width: '210mm', 
                  minHeight: '297mm',
                  padding: '20mm',
                  position: 'relative'
                }}>
                  {/* Template Content with proper CSS injection */}
                  <div 
                    dangerouslySetInnerHTML={{ 
                      __html: `
                        <style>
                          /* Reset and base styles for A4 preview */
                          * {
                            box-sizing: border-box;
                          }
                          
                          body, div, p, h1, h2, h3, h4, h5, h6, table, tr, td, th {
                            margin: 0;
                            padding: 0;
                          }
                          
                          /* Typography */
                          body {
                            font-family: 'Arial', 'Helvetica', sans-serif;
                            font-size: 12px;
                            line-height: 1.4;
                            color: #000;
                            background: transparent;
                          }
                          
                          /* Headings */
                          h1 { font-size: 18px; font-weight: bold; margin-bottom: 12px; }
                          h2 { font-size: 16px; font-weight: bold; margin-bottom: 10px; }
                          h3 { font-size: 14px; font-weight: bold; margin-bottom: 8px; }
                          h4 { font-size: 12px; font-weight: bold; margin-bottom: 6px; }
                          h5, h6 { font-size: 11px; font-weight: bold; margin-bottom: 4px; }
                          
                          /* Paragraphs */
                          p {
                            margin-bottom: 8px;
                            text-align: left;
                          }
                          
                          /* Tables */
                          table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-bottom: 16px;
                            font-size: 11px;
                          }
                          
                          table, th, td {
                            border: 1px solid #000;
                          }
                          
                          th, td {
                            padding: 6px 8px;
                            text-align: left;
                            vertical-align: top;
                          }
                          
                          th {
                            background-color: #f5f5f5;
                            font-weight: bold;
                          }
                          
                          /* Lists */
                          ul, ol {
                            margin: 8px 0;
                            padding-left: 20px;
                          }
                          
                          li {
                            margin-bottom: 4px;
                          }
                          
                          /* Images */
                          img {
                            max-width: 100%;
                            height: auto;
                            display: block;
                            margin: 8px 0;
                          }
                          
                          /* Divs and containers */
                          div {
                            margin-bottom: 4px;
                          }
                          
                          /* Text formatting */
                          strong, b {
                            font-weight: bold;
                          }
                          
                          em, i {
                            font-style: italic;
                          }
                          
                          /* Links */
                          a {
                            color: #0066cc;
                            text-decoration: underline;
                          }
                          
                          /* Horizontal rules */
                          hr {
                            border: none;
                            border-top: 1px solid #000;
                            margin: 16px 0;
                          }
                          
                          /* Blockquotes */
                          blockquote {
                            margin: 8px 0;
                            padding-left: 16px;
                            border-left: 3px solid #ccc;
                            font-style: italic;
                          }
                          
                          /* Code blocks */
                          pre, code {
                            font-family: 'Courier New', monospace;
                            font-size: 10px;
                            background-color: #f8f8f8;
                            padding: 4px;
                            border: 1px solid #ddd;
                          }
                          
                          pre {
                            white-space: pre-wrap;
                            margin: 8px 0;
                            padding: 8px;
                          }
                          
                          /* Custom CSS from template */
                          ${cssContent || ''}
                        </style>
                        ${htmlContent || '<p>No content available</p>'}
                      `
                    }}
                  />
                </div>
              </div>
              
              {/* Information Panel */}
              <div className="w-80 border-l border-gray-200 bg-gray-50 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">A4 Document Info</h3>
                
                <div className="space-y-3 text-sm">
                  <div>
                    <dt className="font-medium text-gray-700">Paper Size</dt>
                    <dd className="text-gray-600">A4 (210 × 297 mm)</dd>
                  </div>
                  
                  <div>
                    <dt className="font-medium text-gray-700">Margins</dt>
                    <dd className="text-gray-600">20mm all sides</dd>
                  </div>
                  
                  <div>
                    <dt className="font-medium text-gray-700">Content Area</dt>
                    <dd className="text-gray-600">170 × 257 mm</dd>
                  </div>
                  
                  <div>
                    <dt className="font-medium text-gray-700">Template</dt>
                    <dd className="text-gray-600">{templateMeta?.template_name || 'Untitled'}</dd>
                  </div>
                  
                  {templateMeta?.template_description && (
                    <div>
                      <dt className="font-medium text-gray-700">Description</dt>
                      <dd className="text-gray-600">{templateMeta.template_description}</dd>
                    </div>
                  )}
                  
                  <div className="pt-4 border-t border-gray-200">
                    <dt className="font-medium text-gray-700 mb-2">CSS Applied</dt>
                    <dd className="text-xs text-gray-500 font-mono bg-gray-100 p-2 rounded">
                      {cssContent ? 'Custom CSS active' : 'No custom CSS'}
                    </dd>
                  </div>
                  
                  <div className="pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        const printWindow = window.open('', '_blank');
                        if (printWindow) {
                          printWindow.document.write(`
                            <html>
                              <head>
                                <title>A4 Template Preview - ${templateMeta?.template_name || 'Untitled'}</title>
                                <style>
                                  @page { 
                                    size: A4; 
                                    margin: 20mm; 
                                  }
                                  
                                  /* Reset and base styles */
                                  * {
                                    box-sizing: border-box;
                                  }
                                  
                                  body, div, p, h1, h2, h3, h4, h5, h6, table, tr, td, th {
                                    margin: 0;
                                    padding: 0;
                                  }
                                  
                                  body {
                                    font-family: 'Arial', 'Helvetica', sans-serif;
                                    font-size: 12px;
                                    line-height: 1.4;
                                    color: #000;
                                    background: white;
                                  }
                                  
                                  /* Typography */
                                  h1 { font-size: 18px; font-weight: bold; margin-bottom: 12px; }
                                  h2 { font-size: 16px; font-weight: bold; margin-bottom: 10px; }
                                  h3 { font-size: 14px; font-weight: bold; margin-bottom: 8px; }
                                  h4 { font-size: 12px; font-weight: bold; margin-bottom: 6px; }
                                  h5, h6 { font-size: 11px; font-weight: bold; margin-bottom: 4px; }
                                  
                                  p {
                                    margin-bottom: 8px;
                                    text-align: left;
                                  }
                                  
                                  /* Tables */
                                  table {
                                    width: 100%;
                                    border-collapse: collapse;
                                    margin-bottom: 16px;
                                    font-size: 11px;
                                  }
                                  
                                  table, th, td {
                                    border: 1px solid #000;
                                  }
                                  
                                  th, td {
                                    padding: 6px 8px;
                                    text-align: left;
                                    vertical-align: top;
                                  }
                                  
                                  th {
                                    background-color: #f5f5f5;
                                    font-weight: bold;
                                  }
                                  
                                  /* Lists */
                                  ul, ol {
                                    margin: 8px 0;
                                    padding-left: 20px;
                                  }
                                  
                                  li {
                                    margin-bottom: 4px;
                                  }
                                  
                                  /* Images */
                                  img {
                                    max-width: 100%;
                                    height: auto;
                                    display: block;
                                    margin: 8px 0;
                                  }
                                  
                                  /* Text formatting */
                                  strong, b { font-weight: bold; }
                                  em, i { font-style: italic; }
                                  
                                  /* Links */
                                  a {
                                    color: #0066cc;
                                    text-decoration: underline;
                                  }
                                  
                                  /* Horizontal rules */
                                  hr {
                                    border: none;
                                    border-top: 1px solid #000;
                                    margin: 16px 0;
                                  }
                                  
                                  /* Blockquotes */
                                  blockquote {
                                    margin: 8px 0;
                                    padding-left: 16px;
                                    border-left: 3px solid #ccc;
                                    font-style: italic;
                                  }
                                  
                                  /* Code blocks */
                                  pre, code {
                                    font-family: 'Courier New', monospace;
                                    font-size: 10px;
                                    background-color: #f8f8f8;
                                    padding: 4px;
                                    border: 1px solid #ddd;
                                  }
                                  
                                  pre {
                                    white-space: pre-wrap;
                                    margin: 8px 0;
                                    padding: 8px;
                                  }
                                  
                                  /* Custom CSS from template */
                                  ${cssContent || ''}
                                </style>
                              </head>
                              <body>
                                ${htmlContent || '<p>No content available</p>'}
                              </body>
                            </html>
                          `);
                          printWindow.document.close();
                          printWindow.print();
                        }
                      }}
                      className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Print Preview
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isDeleteConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Delete Template</h2>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            
            <div className="px-6 py-4">
              <p className="text-sm text-gray-700 mb-4">
                Are you sure you want to delete the template <strong>"{templateMeta?.template_name || 'Untitled Template'}"</strong>? 
                This will permanently remove the template and all its versions.
              </p>
              
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  disabled={isDeleting}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTemplate}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-400"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      Delete Template
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <TemplateAIConsole
        open={isAiConsoleOpen}
        onClose={() => setIsAiConsoleOpen(false)}
        editor={editorAdapter}
        templateName={templateMeta?.template_name || 'Template'}
        labId={labId || ''}
        onApplied={() => setSaveMessage('AI changes applied in the editor. Review and save when ready.')}
      />

      <TemplateAIAuditModal
        open={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        loading={auditLoading}
        result={auditResult}
        error={auditError}
        lastCheckedAt={templateMeta?.ai_verification_checked_at || null}
        onImplement={handleImplementAudit}
        implementing={auditImplementing}
        disableImplement={!labId || !templateMeta}
        onRevert={handleRevertAuditImplementation}
        canRevert={!!auditRevertSnapshot}
        successMessage={auditSuccessMessage}
      />
    </div>
  );
};

export default TemplateStudioCKE;

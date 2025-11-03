import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';
import '@ckeditor/ckeditor5-theme-lark/theme/theme.css';
import type { Editor } from '@ckeditor/ckeditor5-core';
import type { DowncastWriter, Writer } from '@ckeditor/ckeditor5-engine';

import {
  CheckCircle2,
  FileCode,
  FilePlus2,
  Loader2,
  Save,
  Sparkles,
  Wand2,
} from 'lucide-react';

import TemplateAIConsole from '../components/TemplateStudio/TemplateAIConsole';
import TemplateAIAuditModal, { TemplateAuditResult } from '../components/TemplateStudio/TemplateAIAuditModal';
import PlaceholderPicker, { PlaceholderOption } from '../components/TemplateStudio/PlaceholderPicker';
import { useAuth } from '../contexts/AuthContext';
import { database, LabBrandingAsset, LabUserSignature } from '../utils/supabase';

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
  const [htmlContent, setHtmlContent] = useState('');
  const [cssContent, setCssContent] = useState('');
  const [ckeditorInstance, setCkeditorInstance] = useState<Editor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
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
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<TemplateAuditResult | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditImplementing, setAuditImplementing] = useState(false);
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

  const htmlRef = useRef(htmlContent);
  const cssRef = useRef(cssContent);

  useEffect(() => {
    htmlRef.current = htmlContent;
  }, [htmlContent]);

  useEffect(() => {
    cssRef.current = cssContent;
  }, [cssContent]);

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
            aggregated.push({
              id: `branding-${asset.id}-original`,
              label: `${baseLabel} (Original)`,
              placeholder: asset.file_url,
              group: 'branding',
            });

            const variantMap = parseVariantMap(asset.variants);

            Object.entries(variantMap).forEach(([variantKey, url]) => {
              aggregated.push({
                id: `branding-${asset.id}-${variantKey}`,
                label: `${baseLabel} (${formatVariantLabel(variantKey)})`,
                placeholder: url,
                group: 'branding',
              });
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
              aggregated.push({
                id: `signature-${defaultSignature.id}-original`,
                label: `${baseLabel} (Original)`,
                placeholder: defaultSignature.file_url,
                group: 'signature',
              });

              const variants = parseVariantMap(defaultSignature.variants);
              Object.entries(variants).forEach(([variantKey, url]) => {
                aggregated.push({
                  id: `signature-${defaultSignature.id}-${variantKey}`,
                  label: `${baseLabel} (${formatVariantLabel(variantKey)})`,
                  placeholder: url,
                  group: 'signature',
                });
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

  const handleInsertPlaceholder = useCallback(
    (option: PlaceholderOption) => {
      if (!ckeditorInstance) {
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
        ckeditorInstance.model.change((writer: Writer) => {
          const selection = ckeditorInstance.model.document.selection;

          if (isImagePlaceholder) {
            const imageElement = writer.createElement('imageBlock', {
              src: token,
              alt: option.label || 'Lab asset',
            });
            ckeditorInstance.model.insertContent(imageElement, selection);
            return;
          }

          const insertPosition = selection.getFirstPosition();
          if (insertPosition) {
            writer.insertText(token, insertPosition);
          } else {
            const textNode = writer.createText(token);
            ckeditorInstance.model.insertContent(textNode, selection);
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
        if (templatesError) {
          throw templatesError;
        }

        const normalizedTemplates = (templateRows || []) as LabTemplateRecord[];
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
      getHtml: () => (ckeditorInstance?.getData?.() ?? htmlRef.current),
      getCss: () => cssRef.current,
      setComponents: (value: string) => {
        setHtmlContent(value);
        if (ckeditorInstance) {
          ckeditorInstance.setData(value);
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
      const template = templates.find((tpl) => tpl.id === templateId);
      if (!template) {
        return;
      }

      setSelectedTemplateId(templateId);
      setTemplateMeta(template);
      setHtmlContent(template.gjs_html || '');
      setCssContent(template.gjs_css || '');
      if (ckeditorInstance) {
        ckeditorInstance.setData(template.gjs_html || '');
      }
      setLastSavedAt(template?.updated_at ? new Date(template.updated_at) : null);
      setSaveMessage(null);
      setSaveError(null);
      setAuditSuccessMessage(null);
      setAuditRevertSnapshot(null);
    },
    [ckeditorInstance, templates]
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
      if (ckeditorInstance) {
        ckeditorInstance.setData(createdTemplate.gjs_html || '');
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

    const currentHtml = ckeditorInstance?.getData?.() ?? htmlContent;
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

    const html = ckeditorInstance?.getData?.() ?? htmlContent;
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

    const currentHtml = ckeditorInstance?.getData?.() ?? htmlContent;
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
          currentHtml,
          css: currentCss,
          currentCss,
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
      if (ckeditorInstance) {
        ckeditorInstance.setData(nextHtml);
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
    if (ckeditorInstance) {
      ckeditorInstance.setData(auditRevertSnapshot.html || '');
    }
    setAuditSuccessMessage('Reverted the last AI implementation.');
    setAuditError(null);
    setAuditRevertSnapshot(null);
  }, [auditRevertSnapshot, ckeditorInstance]);

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

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-full max-w-xs shrink-0 border-r border-gray-200 bg-gray-50 px-4 py-4">
          <div className="space-y-4 text-sm">
            <section>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Templates</h2>
                <button
                  type="button"
                  onClick={handleCreateTemplate}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-white"
                >
                  <FilePlus2 className="h-3 w-3" /> New
                </button>
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

        <main className="flex-1 overflow-y-auto px-6 py-6">
          {saveError ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {saveError}
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-white">
            <CKEditor
              key={selectedTemplateId || 'default'}
              editor={ClassicEditor}
              data={htmlContent}
              onReady={(editor) => {
                setCkeditorInstance(editor);
                editor.editing.view.change((writer: DowncastWriter) => {
                  writer.setStyle('min-height', '560px', editor.editing.view.document.getRoot());
                });
              }}
              onChange={(_, editor) => {
                const data = editor.getData();
                setHtmlContent(data);
              }}
            />
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
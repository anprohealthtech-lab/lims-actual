import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StudioEditor from '@grapesjs/studio-sdk/react';
import '@grapesjs/studio-sdk/style';

import { useAuth } from '../contexts/AuthContext';
import { database, LabBrandingAsset, LabUserSignature } from '../utils/supabase';
import TemplateAIConsole from '../components/TemplateStudio/TemplateAIConsole';
import TemplateAIAuditModal, { TemplateAuditResult } from '../components/TemplateStudio/TemplateAIAuditModal';
import PlaceholderPicker, { PlaceholderOption } from '../components/TemplateStudio/PlaceholderPicker';
import { ensureReportRegions } from '../utils/reportTemplateRegions';
import '../styles/report-baseline.css';
import reportBaselineCss from '../styles/reportBaselineString';

const LICENSE_KEY = '0e8c208f003842abbfd1135201cd3ceff655e84267c8453b8b9435b9889c96ec';
const BASELINE_STYLE_ELEMENT_ID = 'lims-report-baseline';

interface LabTemplateRecord {
  id: string;
  template_name: string;
  template_description?: string | null;
  gjs_project?: any;
  gjs_html?: string | null;
  gjs_css?: string | null;
  gjs_components?: any;
  gjs_styles?: any;
  updated_at?: string | null;
  is_default?: boolean | null;
  category?: string | null;
  test_group_id?: string | null;
  ai_verification_status?: string | null;
  ai_verification_summary?: string | null;
  ai_verification_details?: any;
  ai_verification_checked_at?: string | null;
}

interface TestGroupOption {
  id: string;
  name: string;
  category?: string | null;
}

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
  const protectedSet = protectedPlaceholders
    ? new Set(protectedPlaceholders)
    : beforeSet;

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

const TemplateStudio: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [labId, setLabId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportHtml, setExportHtml] = useState('');
  const [exportCss, setExportCss] = useState('');
  const [copyIndicator, setCopyIndicator] = useState<'html' | 'css' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<LabTemplateRecord[]>([]);
  const [templateMeta, setTemplateMeta] = useState<LabTemplateRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [pendingFallback, setPendingFallback] = useState<{ html: string; css: string } | null>(null);
  const fallbackHydrationRef = useRef<{ templateId: string; version: number | null } | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [editorInstance, setEditorInstance] = useState<any | null>(null);
  const [isAiConsoleOpen, setIsAiConsoleOpen] = useState(false);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
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
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<TemplateAuditResult | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditImplementing, setAuditImplementing] = useState(false);
  const [auditSuccessMessage, setAuditSuccessMessage] = useState<string | null>(null);
  const [auditRevertSnapshot, setAuditRevertSnapshot] = useState<{ html: string; css: string } | null>(null);
  const [placeholderPickerOpen, setPlaceholderPickerOpen] = useState(false);
  const [placeholderOptions, setPlaceholderOptions] = useState<PlaceholderOption[]>([]);
  const [placeholderLoading, setPlaceholderLoading] = useState(false);
  const [placeholderError, setPlaceholderError] = useState<string | null>(null);
  const applyBaselineToCanvas = useCallback(
    (editor: any) => {
      if (!editor?.Canvas?.getDocument) {
        return;
      }

      try {
        const canvasDocument = editor.Canvas.getDocument();
        if (!canvasDocument) {
          return;
        }

        const { head, body } = canvasDocument;
        if (body && !body.classList.contains('limsv2-report')) {
          body.classList.add('limsv2-report');
        }

        if (head) {
          const existing = head.querySelector(`#${BASELINE_STYLE_ELEMENT_ID}`);
          if (existing) {
            existing.textContent = reportBaselineCss;
          } else {
            const styleEl = canvasDocument.createElement('style');
            styleEl.id = BASELINE_STYLE_ELEMENT_ID;
            styleEl.textContent = reportBaselineCss;
            head.appendChild(styleEl);
          }
        }
      } catch (baselineErr) {
        console.warn('Failed to inject baseline styles into GrapesJS canvas:', baselineErr);
      }
    },
    [reportBaselineCss]
  );
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

  const handleInsertPlaceholder = useCallback(
    (option: PlaceholderOption) => {
      if (!editorInstance) {
        setPlaceholderError('Editor is not ready yet. Try again in a moment.');
        return;
      }

      const token = option.placeholder;
      if (!token || typeof token !== 'string') {
        setPlaceholderError('Selected placeholder did not include any content to insert.');
        return;
      }

      const isImagePlaceholder = option.group === 'branding' || option.group === 'signature';

      const buildImageAttributes = () => {
        const attributes: Record<string, any> = {
          src: token,
          alt: option.label || 'Lab branding',
        };

        const styleSegments: string[] = [];

        if (option.preferredWidth) {
          const widthValue = Math.max(option.preferredWidth, 1);
          attributes.width = widthValue;
          styleSegments.push(`width:${widthValue}px`, `max-width:${widthValue}px`);
          if (!option.preferredHeight) {
            styleSegments.push('height:auto');
          }
        }

        if (option.preferredHeight) {
          const heightValue = Math.max(option.preferredHeight, 1);
          attributes.height = heightValue;
          styleSegments.push(`height:${heightValue}px`);
        }

        if (option.preferredWidth || option.preferredHeight) {
          styleSegments.push('object-fit:contain');
        }

        if (option.removeBackground) {
          styleSegments.push('background:none transparent', 'background-image:none');
        }

        if (!option.preferredWidth && !option.preferredHeight) {
          styleSegments.push('max-width:100%', 'height:auto');
        }

        const styleString = Array.from(new Set(styleSegments)).join(';');
        if (styleString) {
          attributes.style = styleString;
        }

        if (!attributes.style) {
          attributes.style = 'max-width:100%;height:auto;';
        }

        return attributes;
      };

      const imageAttributes = isImagePlaceholder ? buildImageAttributes() : null;
      let fallbackHtml = token;
      if (isImagePlaceholder) {
        const styleValue = imageAttributes?.style || 'max-width:100%;height:auto;';
        const sanitizedAlt = (imageAttributes?.alt || 'Lab branding').replace(/"/g, '&quot;');
        fallbackHtml = `<img src="${token}" alt="${sanitizedAlt}" style="${styleValue}" />`;
      }

      try {
        const rte = editorInstance.RichTextEditor;
        const hasFocusedRte = Boolean(rte?.getFocused?.());

        if (hasFocusedRte && typeof rte.insertHTML === 'function') {
          rte.insertHTML(fallbackHtml);
        } else {
          const selected = editorInstance.getSelected?.();

          if (selected && typeof selected.append === 'function') {
            if (isImagePlaceholder) {
              selected.append({
                type: 'image',
                attributes: imageAttributes || {
                  src: token,
                  alt: option.label || 'Lab branding',
                  style: 'max-width:100%;height:auto;',
                },
              });
            } else if (selected.is?.('text') || selected.is?.('textnode')) {
              const existing = selected.get?.('content') || '';
              selected.set?.('content', `${existing}${token}`);
            } else {
              selected.append({ type: 'text', content: token });
            }
          } else {
            const wrapper = editorInstance.getWrapper?.();
            if (isImagePlaceholder) {
              wrapper?.append?.({
                type: 'image',
                attributes: imageAttributes || {
                  src: token,
                  alt: option.label || 'Lab branding',
                  style: 'max-width:100%;height:auto;',
                },
              });
            } else {
              wrapper?.append?.({ type: 'text', content: token });
            }
          }
        }

        setPlaceholderPickerOpen(false);
        setPlaceholderError(null);
      } catch (err) {
        console.error('Failed to insert placeholder:', err);
        setPlaceholderError('Unable to insert placeholder. Select a text area and try again.');
      }
    },
    [editorInstance]
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
        let templateRecord = (normalizedTemplates.find((tpl) => tpl.is_default) || normalizedTemplates[0]) as LabTemplateRecord | undefined;

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
        setLastSavedAt(templateRecord?.updated_at ? new Date(templateRecord.updated_at) : null);
        setSaveErrorMessage(null);
      } catch (err) {
        console.error('Failed to initialize Template Studio:', err);
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
    if (!templateMeta) {
      return;
    }

    setMetadataDraft({
      name: templateMeta.template_name || '',
      description: templateMeta.template_description || '',
      category: templateMeta.category || 'reports',
      testGroupId: templateMeta.test_group_id || '',
    });
  }, [templateMeta]);

  useEffect(() => {
    if (!metadataMessage) {
      return;
    }

    const timer = window.setTimeout(() => setMetadataMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [metadataMessage]);

  useEffect(() => {
    if (!labId) {
      setTestGroups([]);
      return;
    }

    let isActive = true;

    const fetchTestGroups = async () => {
      setTestGroupsLoading(true);
      setTestGroupsError(null);

      const { data, error } = await database.testGroups.listByLab(labId);

      if (!isActive) {
        return;
      }

      if (error) {
        console.error('Failed to load test groups for Template Studio:', error);
        setTestGroupsError('Unable to load test groups. Linking is temporarily unavailable.');
        setTestGroups([]);
      } else {
        const mapped = (data || []).map((group: any) => ({
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

  useEffect(() => {
    const details = templateMeta?.ai_verification_details;
    if (!details) {
      setAuditResult(null);
      return;
    }

    if (typeof details === 'string') {
      try {
        const parsed = JSON.parse(details) as TemplateAuditResult;
        setAuditResult(parsed);
        return;
      } catch (err) {
        console.warn('Failed to parse stored AI verification details:', err);
        setAuditResult(null);
        return;
      }
    }

    setAuditResult(details as TemplateAuditResult);
  }, [templateMeta?.ai_verification_details]);

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

  const projectId = useMemo(() => {
    if (templateMeta?.id) {
      return templateMeta.id;
    }
    if (labId) {
      return `lab-${labId}-web-project`;
    }
    if (identityId) {
      return `user-${identityId}-web-project`;
    }
    return 'shared-web-project';
  }, [identityId, labId, templateMeta?.id]);

  const attachedTestGroupName = useMemo(() => {
    if (!templateMeta?.test_group_id) {
      return null;
    }

    const match = testGroups.find((group) => group.id === templateMeta.test_group_id);
    return match?.name || null;
  }, [templateMeta?.test_group_id, testGroups]);

  const handleLoadProject = useCallback(async () => {
    if (!templateMeta || !selectedTemplateId || templateMeta.id !== selectedTemplateId) {
      return { project: {} };
    }

    const hasSerializedProject = templateMeta.gjs_project && Object.keys(templateMeta.gjs_project).length > 0;

    if (hasSerializedProject) {
      setPendingFallback(null);
      fallbackHydrationRef.current = null;
      return {
        id: templateMeta.id,
        project: templateMeta.gjs_project,
      };
    }

  const fallbackHtml = ensureReportRegions(templateMeta.gjs_html ?? '');
    const fallbackCss = templateMeta.gjs_css ?? '';
    setPendingFallback({ html: fallbackHtml, css: fallbackCss });

    return {
      id: templateMeta.id,
      project: {
        pages: [
          {
            id: 'page-default',
            name: 'Main',
            frames: [
              {
                id: 'frame-default',
                component: {
                  type: 'wrapper',
                  components: [],
                },
              },
            ],
          },
        ],
        css: fallbackCss,
      },
    };
  }, [selectedTemplateId, templateMeta]);

  const handleSaveProject = useCallback(
    async ({ project, editor }: { project: any; editor: any }) => {
      if (!labId || !templateMeta?.id) {
        throw new Error('Template is not ready for saving');
      }

      try {
        setIsSaving(true);
        setSaveErrorMessage(null);

  const html = ensureReportRegions(editor?.getHtml?.() ?? '');
        const css = editor?.getCss?.() ?? '';
        let components: any = null;

        try {
          const rawComponents = editor?.getComponents?.();
          components = typeof rawComponents?.toJSON === 'function' ? rawComponents.toJSON() : rawComponents ?? null;
        } catch (componentErr) {
          console.warn('Unable to serialise components payload:', componentErr);
        }

  const rawStyles = editor?.getStyle?.();
  const styles = typeof rawStyles?.toJSON === 'function' ? rawStyles.toJSON() : rawStyles ?? null;

        const { data, error: saveError } = await database.labTemplates.saveProject({
          templateId: templateMeta.id,
          labId,
          project,
          html,
          css,
          components,
          styles,
        });

        if (saveError || !data) {
          throw saveError || new Error('Template save failed');
        }

        setTemplateMeta(data as LabTemplateRecord);
        const updatedAt = (data as LabTemplateRecord).updated_at;
        setLastSavedAt(updatedAt ? new Date(updatedAt) : new Date());
        setSaveMessage('Saved just now');
      } catch (saveErr) {
        console.error('Failed to save GrapesJS project:', saveErr);
        setSaveErrorMessage('Autosave failed. Your latest changes might not be stored yet.');
        throw saveErr;
      } finally {
        setIsSaving(false);
      }
    },
    [labId, templateMeta]
  );

  const storageConfig = useMemo(
    () => ({
      type: 'self' as const,
      autosaveChanges: 30,
      autosaveIntervalMs: 10000,
      onLoad: handleLoadProject,
      onSave: handleSaveProject,
    }),
    [handleLoadProject, handleSaveProject]
  );

  const handleEditorReady = useCallback(
    (editor: any) => {
      setEditorInstance(editor);
      applyBaselineToCanvas(editor);

      if (typeof editor?.on === 'function') {
        editor.on('load', () => applyBaselineToCanvas(editor));
      }

      if (!pendingFallback) {
        return;
      }

      try {
        const applyFallback = () => {
          if (pendingFallback?.html) {
            console.debug('TemplateStudio: injecting fallback HTML for template', templateMeta?.id);
            editor.setComponents(pendingFallback.html);
          } else {
            console.debug('TemplateStudio: clearing components for template', templateMeta?.id);
            editor.setComponents('');
          }

          if (typeof editor.setStyle === 'function') {
            editor.setStyle(pendingFallback?.css || '');
          }
        };

        // Delay slightly to ensure GrapesJS completed its internal ready lifecycle.
        if (typeof window !== 'undefined') {
          window.setTimeout(applyFallback, 0);
        } else {
          applyFallback();
        }
      } catch (fallbackErr) {
        console.warn('Failed to inject fallback HTML/CSS into editor:', fallbackErr);
      } finally {
        setPendingFallback(null);
      }
    },
    [applyBaselineToCanvas, pendingFallback, templateMeta?.id]
  );

  const templateId = templateMeta?.id || null;
  const serializedProjectRef = templateMeta?.gjs_project || null;
  const fallbackHtmlContent = templateMeta?.gjs_html ?? '';
  const fallbackCssContent = templateMeta?.gjs_css ?? '';
  const templateVersion = templateMeta?.template_version ?? null;

  useEffect(() => {
    if (!editorInstance || !templateId) {
      return;
    }

    applyBaselineToCanvas(editorInstance);

    const hasSerializedProject = serializedProjectRef && Object.keys(serializedProjectRef).length > 0;
    if (hasSerializedProject) {
      const hydrated = fallbackHydrationRef.current;
      if (hydrated && hydrated.templateId === templateId) {
        fallbackHydrationRef.current = null;
      }
      return;
    }

    if (!fallbackHtmlContent.trim()) {
      return;
    }

    const alreadyHydrated =
      fallbackHydrationRef.current?.templateId === templateId &&
      fallbackHydrationRef.current?.version === templateVersion;

    if (alreadyHydrated) {
      return;
    }

    try {
      editorInstance.setComponents(fallbackHtmlContent);
      if (typeof editorInstance.setStyle === 'function') {
        editorInstance.setStyle(fallbackCssContent ?? '');
      }
      fallbackHydrationRef.current = {
        templateId,
        version: templateVersion,
      };
    } catch (err) {
      console.warn('Failed to hydrate GrapesJS editor from fallback HTML:', err);
    }
  }, [applyBaselineToCanvas, editorInstance, fallbackCssContent, fallbackHtmlContent, serializedProjectRef, templateId, templateVersion]);

  const toggleAiConsole = useCallback(() => {
    setIsAiConsoleOpen((prev) => !prev);
  }, []);

  const toggleDetailsPanel = useCallback(() => {
    setIsDetailsPanelOpen((prev) => !prev);
  }, []);

  const handleMetadataInputChange = useCallback(
    (field: 'name' | 'description' | 'category' | 'testGroupId', value: string) => {
      setMetadataDraft((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  const resetMetadataDraft = useCallback(() => {
    if (!templateMeta) {
      return;
    }

    setMetadataDraft({
      name: templateMeta.template_name || '',
      description: templateMeta.template_description || '',
      category: templateMeta.category || 'reports',
      testGroupId: templateMeta.test_group_id || '',
    });
    setMetadataError(null);
    setMetadataMessage(null);
  }, [templateMeta]);

  const handleMetadataSave = useCallback(async () => {
    if (!labId || !templateMeta?.id) {
      return;
    }

    try {
      setMetadataSaving(true);
      setMetadataError(null);

      const normalizedName = metadataDraft.name.trim() || 'Untitled Template';
      const normalizedDescription = metadataDraft.description.trim();
      const normalizedCategory = metadataDraft.category.trim();

      const { data, error } = await database.labTemplates.updateMetadata({
        templateId: templateMeta.id,
        labId,
        name: normalizedName,
        description: normalizedDescription ? normalizedDescription : null,
        category: normalizedCategory ? normalizedCategory : null,
        testGroupId: metadataDraft.testGroupId ? metadataDraft.testGroupId : null,
        userId: identityId ?? null,
      });

      if (error || !data) {
        throw error || new Error('Update failed');
      }

      setTemplateMeta(data as LabTemplateRecord);
      setMetadataMessage('Template details updated.');
    } catch (err) {
      console.error('Failed to update template metadata:', err);
      setMetadataError('Unable to update template details. Please try again.');
    } finally {
      setMetadataSaving(false);
    }
  }, [identityId, labId, metadataDraft.category, metadataDraft.description, metadataDraft.name, metadataDraft.testGroupId, templateMeta]);

  const handleOpenExport = useCallback((editor: any) => {
    try {
      const html = editor.getHtml?.() || '';
      const css = editor.getCss?.() || '';
      setExportHtml(html);
      setExportCss(css);
      setExportError(null);
      setExportModalOpen(true);
    } catch (err) {
      console.error('Failed to export template HTML:', err);
      setExportError('Unable to export the template right now. Please try again.');
    }
  }, []);

  const handleCopy = useCallback(async (value: string, type: 'html' | 'css') => {
    try {
      if (!navigator?.clipboard) {
        throw new Error('Clipboard API not available');
      }
      await navigator.clipboard.writeText(value);
      setCopyIndicator(type);
      setTimeout(() => setCopyIndicator((current) => (current === type ? null : current)), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
      setExportError('Copy action failed. Please copy manually.');
    }
  }, []);

  const handleRunAudit = useCallback(async () => {
    if (auditLoading) {
      return;
    }

    if (!labId) {
      setAuditError('Lab context missing. Please reload and try again.');
      setIsAuditModalOpen(true);
      return;
    }

    if (!templateMeta || !editorInstance) {
      setAuditError('Editor is not ready yet. Please wait a moment and try again.');
      setIsAuditModalOpen(true);
      return;
    }

    const html = editorInstance.getHtml?.() ?? templateMeta.gjs_html ?? '';
    const css = editorInstance.getCss?.() ?? templateMeta.gjs_css ?? '';

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

    let normalizedTestGroup: any = null;

    if (templateMeta.test_group_id) {
      const { data: testGroupData, error: testGroupError } = await database.testGroups.getById(templateMeta.test_group_id);
      if (testGroupError) {
        console.warn('Failed to load linked test group for audit:', testGroupError);
      } else if (testGroupData) {
        normalizedTestGroup = {
          id: testGroupData.id,
          name: testGroupData.name,
          analytes: (testGroupData.test_group_analytes || []).map((entry: any) => ({
            id: entry?.analytes?.id || entry?.analyte_id,
            name: entry?.analytes?.name || '',
            unit: entry?.analytes?.unit || null,
            reference_range: entry?.analytes?.reference_range || null,
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

      let payload: any = {};
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch (parseErr) {
        throw new Error('Audit response was not valid JSON.');
      }

      const auditPayload: TemplateAuditResult = payload.audit || payload;
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
    auditLoading,
    DEFAULT_PLACEHOLDER_OPTIONS,
    editorInstance,
    fetchAvailablePlaceholderOptions,
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

    if (!editorInstance) {
      setAuditError('Editor is not ready yet. Please try again in a moment.');
      setIsAuditModalOpen(true);
      return;
    }

    const currentHtml = editorInstance.getHtml?.() ?? templateMeta?.gjs_html ?? '';
    const currentCss = editorInstance.getCss?.() ?? templateMeta?.gjs_css ?? '';

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
      let payload: any = {};

      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch (parseErr) {
        throw new Error('AI implementation response was not valid JSON.');
      }

      if (!response.ok) {
        const errorMessage = (payload && payload.error) || rawText || 'AI implementation request failed.';
        throw new Error(errorMessage);
      }

      const nextHtml = typeof payload.html === 'string' ? payload.html : '';
      const nextCss = typeof payload.css === 'string' ? payload.css : '';

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
      const missingPlaceholders = findMissingPlaceholders(
        currentHtml,
        nextHtml,
        allowedRemovals,
        protectedPlaceholders
      );
      if (missingPlaceholders.length) {
        throw new Error(`AI response removed required placeholders: ${missingPlaceholders.join(', ')}`);
      }

      editorInstance.setComponents(nextHtml);
      if (typeof editorInstance.setStyle === 'function') {
        editorInstance.setStyle(nextCss || '');
      }

      setAuditRevertSnapshot({ html: currentHtml, css: currentCss });

      if (typeof editorInstance.store === 'function') {
        try {
          await editorInstance.store();
          setSaveMessage('AI changes applied and saved.');
          setSaveErrorMessage(null);
        } catch (storeErr) {
          console.warn('Automatic store after AI implementation failed:', storeErr);
          setSaveErrorMessage('AI changes applied but automatic save failed. Please save manually.');
        }
      }

    await handleRunAudit();

    setAuditSuccessMessage('AI changes applied. The audit was rerun with the updated template.');
    } catch (err) {
      console.error('Failed to implement audit recommendations:', err);
      setAuditError(err instanceof Error ? err.message : 'Unable to implement audit recommendations.');
    } finally {
      setAuditImplementing(false);
    }
  }, [auditImplementing, auditResult, editorInstance, handleRunAudit, labId, templateMeta?.gjs_css, templateMeta?.gjs_html, templateMeta?.template_name]);

  const handleRevertAuditImplementation = useCallback(() => {
    if (!editorInstance || !auditRevertSnapshot) {
      return;
    }

    try {
      editorInstance.setComponents(auditRevertSnapshot.html || '');
      if (typeof editorInstance.setStyle === 'function') {
        editorInstance.setStyle(auditRevertSnapshot.css || '');
      }
      if (typeof editorInstance.store === 'function') {
        editorInstance.store().then(() => {
          setSaveMessage('Reverted AI changes and saved the previous version.');
          setSaveErrorMessage(null);
        }).catch((err: unknown) => {
          console.warn('Automatic store after reverting AI changes failed:', err);
          setSaveErrorMessage('Reverted in the editor but failed to save automatically. Please save manually.');
        });
      }
      setAuditSuccessMessage('Reverted the last AI implementation.');
      setAuditError(null);
      setAuditRevertSnapshot(null);
    } catch (err) {
      console.error('Failed to revert AI implementation:', err);
      setAuditError('Unable to revert the AI implementation.');
    }
  }, [auditRevertSnapshot, editorInstance]);

  const actionsConfig = useCallback(
    ({ actions }: { actions: any[]; editor: any }) => {
      const exportAction = {
        id: 'lims-export-html',
        tooltip: 'View HTML/CSS',
        label: 'Export',
        onClick: ({ editor }: { editor: any }) => handleOpenExport(editor),
      };
      const alreadyPresent = actions.some((action) => action?.id === exportAction.id);
      return alreadyPresent ? actions : [...actions, exportAction];
    },
    [handleOpenExport]
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      const template = templates.find((tpl) => tpl.id === templateId);
      if (!template) {
        return;
      }

      setSelectedTemplateId(templateId);
      setTemplateMeta(template);
      setLastSavedAt(template?.updated_at ? new Date(template.updated_at) : null);
      setSaveMessage(null);
      setSaveErrorMessage(null);
      setPendingFallback(null);
      setIsDetailsPanelOpen(false);
      setMetadataMessage(null);
      setMetadataError(null);
      setAuditSuccessMessage(null);
      setAuditRevertSnapshot(null);
    },
    [templates]
  );

  const handleBackToTemplates = useCallback(() => {
    setSelectedTemplateId(null);
    setSaveMessage(null);
    setSaveErrorMessage(null);
    setPendingFallback(null);
    setIsDetailsPanelOpen(false);
    setMetadataMessage(null);
    setMetadataError(null);
    setAuditSuccessMessage(null);
    setAuditRevertSnapshot(null);
  }, []);

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
        description: 'New template created from Template Studio',
        category: 'reports',
      });

      if (createError || !data) {
        throw createError || new Error('Unable to create template');
      }

      const createdTemplate = data as LabTemplateRecord;
      setTemplates((prev) => [...prev, createdTemplate]);
      setSelectedTemplateId(createdTemplate.id);
      setTemplateMeta(createdTemplate);
      setLastSavedAt(createdTemplate.updated_at ? new Date(createdTemplate.updated_at) : null);
      setSaveMessage(null);
      setSaveErrorMessage(null);
      setPendingFallback(null);
    } catch (createErr) {
      console.error('Failed to create template:', createErr);
      const duplicateName =
        createErr && typeof createErr === 'object' && 'code' in createErr && (createErr as { code?: string }).code === '23505';
      setSaveErrorMessage(
        duplicateName
          ? 'A template with the same name already exists. Please rename the existing template or try again.'
          : 'Unable to create a new template right now. Please try again later.'
      );
    }
  }, [labId, templates]);

  useEffect(() => {
    if (!templateMeta) {
      return;
    }

    setTemplates((prev) => {
      if (!prev.length) {
        return prev;
      }
      const index = prev.findIndex((tpl) => tpl.id === templateMeta.id);
      if (index === -1) {
        return prev;
      }
      const cloned = [...prev];
      cloned[index] = templateMeta;
      return cloned;
    });
  }, [templateMeta]);

  if (isLoading || authLoading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-600">
        Loading template editor...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!identityId) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
        User session missing. Please sign in again to access the Template Studio.
      </div>
    );
  }

  if (!selectedTemplateId) {
    return (
      <div className="h-[calc(100vh-7rem)] overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900">
          Select a template to edit
        </div>
        <div className="px-4 py-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {templates.length
                ? 'Choose an existing template to open it in the editor.'
                : 'No templates found for this lab.'}
            </div>
            <button
              onClick={handleCreateTemplate}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Create Template
            </button>
          </div>
          {saveErrorMessage && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {saveErrorMessage}
            </div>
          )}
          {templates.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => handleTemplateSelect(tpl.id)}
                  className="flex h-full flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-gray-900">{tpl.template_name || 'Untitled Template'}</h3>
                      {tpl.is_default && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-blue-600">
                          Default
                        </span>
                      )}
                    </div>
                    {tpl.template_description && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-3">{tpl.template_description}</p>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                    <span>{tpl.category || 'Uncategorized'}</span>
                    <span>
                      Updated{' '}
                      {tpl.updated_at
                        ? new Date(tpl.updated_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Recently'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center text-sm text-gray-600">
              A default template is being prepared. Please try again in a moment.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-700 sm:text-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            Editing template:
            <span className="ml-1 font-medium text-gray-900">
              {templateMeta?.template_name || 'Untitled Template'}
            </span>
            {templateMeta?.category && (
              <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-gray-700">
                {templateMeta.category}
              </span>
            )}
            <div className="mt-1 text-[0.65rem] text-gray-500 sm:text-xs">
              Linked Test Group:{' '}
              {templateMeta?.test_group_id
                ? attachedTestGroupName || `ID ${templateMeta.test_group_id}`
                : 'None' }
            </div>
          </div>
          <div className="flex items-center gap-3 text-gray-600">
            {verificationStatusBadge ? (
              <button
                type="button"
                onClick={() => {
                  setIsAuditModalOpen(true);
                  setAuditError(null);
                }}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition ${verificationStatusBadge.classes}`}
              >
                {verificationStatusBadge.label}
                {templateMeta?.ai_verification_checked_at ? (
                  <span className="text-[0.65rem] font-normal text-gray-600">
                    {new Date(templateMeta.ai_verification_checked_at).toLocaleDateString()}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              onClick={handleRunAudit}
              disabled={auditLoading || !editorInstance}
              className="rounded-md bg-purple-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-400"
            >
              {auditLoading ? 'Auditing…' : 'Run AI Audit'}
            </button>
            <button
              onClick={handleBackToTemplates}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Change Template
            </button>
            <button
              onClick={toggleDetailsPanel}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              {isDetailsPanelOpen ? 'Hide Details' : 'Template Details'}
            </button>
            <button
              onClick={() => {
                setPlaceholderOptions(DEFAULT_PLACEHOLDER_OPTIONS);
                setPlaceholderError(null);
                setPlaceholderLoading(true);
                setPlaceholderPickerOpen(true);
              }}
              className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              Insert Placeholder
            </button>
            <button
              onClick={toggleAiConsole}
              className="rounded-md border border-blue-300 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              {isAiConsoleOpen ? 'Hide AI' : 'AI Assist'}
            </button>
            {isSaving ? (
              <span className="text-blue-600">Saving…</span>
            ) : lastSavedAt ? (
              <span>
                Saved at {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : (
              <span>Not saved yet</span>
            )}
          </div>
        </div>
      </div>
        {placeholderError && !placeholderPickerOpen && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            {placeholderError}
          </div>
        )}
      {saveMessage && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
          {saveMessage}
        </div>
      )}
      {saveErrorMessage && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {saveErrorMessage}
        </div>
      )}
      {isDetailsPanelOpen && (
        <div className="border-b border-gray-200 bg-white px-4 py-3 text-xs text-gray-700 sm:text-sm">
          {metadataError && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {metadataError}
            </div>
          )}
          {metadataMessage && (
            <div className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {metadataMessage}
            </div>
          )}
          {testGroupsError && (
            <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {testGroupsError}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-gray-800">Template Name</span>
              <input
                type="text"
                value={metadataDraft.name}
                onChange={(event) => handleMetadataInputChange('name', event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-0 sm:text-sm"
                placeholder="Enter template name"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-gray-800">Category</span>
              <input
                type="text"
                value={metadataDraft.category}
                onChange={(event) => handleMetadataInputChange('category', event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-0 sm:text-sm"
                placeholder="e.g. reports"
              />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="font-medium text-gray-800">Description</span>
              <textarea
                value={metadataDraft.description}
                onChange={(event) => handleMetadataInputChange('description', event.target.value)}
                rows={3}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-0 sm:text-sm"
                placeholder="Optional summary about how this template is used"
              />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="font-medium text-gray-800">Linked Test Group</span>
              <select
                value={metadataDraft.testGroupId}
                onChange={(event) => handleMetadataInputChange('testGroupId', event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-0 sm:text-sm"
              >
                <option value="">No linked test group</option>
                {testGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.category ? ` (${group.category})` : ''}
                  </option>
                ))}
              </select>
              {testGroupsLoading && (
                <span className="text-[0.65rem] text-gray-500">Loading available test groups…</span>
              )}
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="text-[0.65rem] text-gray-500 sm:mr-auto sm:text-xs">
              Attach a test group to auto-suggest this template when that group is ordered.
            </div>
            <button
              type="button"
              onClick={resetMetadataDraft}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              disabled={metadataSaving}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleMetadataSave}
              disabled={metadataSaving}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {metadataSaving ? 'Saving…' : 'Save Details'}
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <StudioEditor
          options={{
            licenseKey: LICENSE_KEY,
            project: {
              type: 'web',
              id: projectId,
            },
            identity: {
              id: identityId,
            },
            assets: {
              storageType: 'cloud',
            },
            storage: storageConfig,
            actions: actionsConfig,
            onReady: handleEditorReady,
          }}
        />
      </div>
      <TemplateAIConsole
        open={isAiConsoleOpen}
        onClose={() => setIsAiConsoleOpen(false)}
        editor={editorInstance}
        templateName={templateMeta?.template_name || 'Template'}
        labId={labId ?? ''}
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
  disableImplement={!auditResult || auditLoading || auditResult.status === 'pass'}
        onRevert={auditRevertSnapshot ? handleRevertAuditImplementation : undefined}
        canRevert={!!auditRevertSnapshot}
        successMessage={auditSuccessMessage}
      />
      {placeholderPickerOpen ? (
        <PlaceholderPicker
          options={placeholderOptions}
          onInsert={handleInsertPlaceholder}
          onClose={() => setPlaceholderPickerOpen(false)}
          loading={placeholderLoading}
          errorMessage={placeholderError}
        />
      ) : null}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-5xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">Export Template</h3>
              <button
                onClick={() => {
                  setExportModalOpen(false);
                  setCopyIndicator(null);
                      setExportError(null);
                }}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
            <div className="grid gap-6 px-6 py-6 lg:grid-cols-2">
              {exportError && (
                <div className="lg:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  {exportError}
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">HTML</span>
                  <button
                    onClick={() => handleCopy(exportHtml, 'html')}
                    className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Copy HTML
                  </button>
                </div>
                <textarea
                  readOnly
                  value={exportHtml}
                  className="h-64 w-full resize-none rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-800"
                />
                {copyIndicator === 'html' && (
                  <div className="mt-2 text-xs font-medium text-green-600">HTML copied to clipboard</div>
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">CSS</span>
                  <button
                    onClick={() => handleCopy(exportCss, 'css')}
                    className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Copy CSS
                  </button>
                </div>
                <textarea
                  readOnly
                  value={exportCss}
                  className="h-64 w-full resize-none rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-800"
                />
                {copyIndicator === 'css' && (
                  <div className="mt-2 text-xs font-medium text-green-600">CSS copied to clipboard</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateStudio;
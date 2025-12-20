import React from 'react';
import clsx from 'clsx';

export interface TemplateAuditResult {
  status: 'pass' | 'attention' | 'fail';
  summary: string;
  patientMetadata?: {
    tablePresent?: boolean;
    missingColumns?: string[];
  };
  headerFooter?: {
    headerImage?: boolean;
    footerImage?: boolean;
    signatureBlock?: boolean;
  };
  placeholders?: {
    requiredMissing?: string[];
    unknownPlaceholders?: string[];
    invalidAnalytePlaceholders?: string[];
    duplicates?: string[];
    deprecatedPlaceholders?: string[];
  };
  resultsLoop?: {
    hasResultsLoop?: boolean;
    hasAnalyteName?: boolean;
    hasValue?: boolean;
    hasUnit?: boolean;
    hasReferenceRange?: boolean;
    hasFlag?: boolean;
    missingLoopPlaceholders?: string[];
  };
  analyteCoverage?: {
    invalidIndividualPlaceholders?: string[];
    recommendation?: string;
    referencedButUnknown?: string[];
    missingFromTemplate?: string[];
  };
  sectionContent?: {
    hasAnySectionPlaceholder?: boolean;
    foundSectionPlaceholders?: string[];
    deprecatedSectionPlaceholders?: string[];
    recommendedSectionPlaceholders?: string[];
  };
  approvalSignature?: {
    hasSignatoryName?: boolean;
    hasSignatoryDesignation?: boolean;
    hasSignatoryImage?: boolean;
    missingSignaturePlaceholders?: string[];
  };
  recommendations?: string[];
}

interface TemplateAIAuditModalProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  result: TemplateAuditResult | null;
  error: string | null;
  lastCheckedAt?: string | null;
  onImplement?: () => void;
  implementing?: boolean;
  disableImplement?: boolean;
  onRevert?: () => void;
  canRevert?: boolean;
  successMessage?: string | null;
}

const statusBadges: Record<string, { label: string; classes: string }> = {
  pass: {
    label: 'Pass',
    classes: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  },
  attention: {
    label: 'Needs Attention',
    classes: 'bg-amber-100 text-amber-700 border border-amber-200',
  },
  fail: {
    label: 'Failed',
    classes: 'bg-red-100 text-red-700 border border-red-200',
  },
};

const TemplateAIAuditModal: React.FC<TemplateAIAuditModalProps> = ({
  open,
  onClose,
  loading,
  result,
  error,
  lastCheckedAt,
  onImplement,
  implementing = false,
  disableImplement,
  onRevert,
  canRevert,
  successMessage,
}) => {
  if (!open) {
    return null;
  }

  const statusBadge = result ? statusBadges[result.status] : null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 py-8">
      <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">AI Template Audit</h2>
            {lastCheckedAt ? (
              <p className="text-xs text-gray-500">Last checked {new Date(lastCheckedAt).toLocaleString()}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4 text-sm text-gray-700">
          {successMessage ? (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {successMessage}
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-600">
              Running AI audit…
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : result ? (
            <div className="space-y-4">
              {onImplement ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-800">
                  <p className="font-medium">Generate a patch to fix these findings automatically.</p>
                  <div className="flex items-center gap-2">
                    {onRevert && canRevert ? (
                      <button
                        type="button"
                        onClick={onRevert}
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Revert AI Changes
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={onImplement}
                      disabled={implementing || disableImplement}
                      className="rounded-md bg-purple-600 px-3 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-400"
                    >
                      {implementing ? 'Applying…' : 'Implement Changes'}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                {statusBadge ? (
                  <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', statusBadge.classes)}>
                    {statusBadge.label}
                  </span>
                ) : null}
                <p className="text-sm text-gray-800">{result.summary}</p>
              </div>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Patient Metadata</h3>
                <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  <p>
                    Table detected:{' '}
                    <span className={result.patientMetadata?.tablePresent ? 'text-emerald-600' : 'text-red-600'}>
                      {result.patientMetadata?.tablePresent ? 'Yes' : 'No'}
                    </span>
                  </p>
                  {result.patientMetadata?.missingColumns?.length ? (
                    <p className="mt-1 text-sm text-amber-700">
                      Missing columns: {result.patientMetadata.missingColumns.join(', ')}
                    </p>
                  ) : null}
                </div>
              </section>

              {/* Header & Footer (optional, only show if audit includes it) */}
              {result.headerFooter && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Header &amp; Footer</h3>
                  <div className="mt-1 grid gap-2 sm:grid-cols-3">
                    <AuditCheckCard label="Header image" active={!!result.headerFooter?.headerImage} />
                    <AuditCheckCard label="Footer image" active={!!result.headerFooter?.footerImage} />
                    <AuditCheckCard label="Signature block" active={!!result.headerFooter?.signatureBlock} />
                  </div>
                </section>
              )}

              {/* Section Content Validation */}
              {result.sectionContent && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Section Content (Doctor Notes)</h3>
                  <div className="mt-1 space-y-2 text-sm">
                    {result.sectionContent.hasAnySectionPlaceholder ? (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                        <strong>✓ Section placeholders found:</strong>{' '}
                        {result.sectionContent.foundSectionPlaceholders?.join(', ') || 'Yes'}
                      </div>
                    ) : (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                        <strong>⚠ No section placeholders found.</strong> Consider adding {{impression}}, {{findings}}, or {{conclusion}} for doctor's notes.
                      </div>
                    )}
                    {result.sectionContent.deprecatedSectionPlaceholders && result.sectionContent.deprecatedSectionPlaceholders.length > 0 && (
                      <AuditList
                        title="Deprecated section placeholders (replace immediately)"
                        items={result.sectionContent.deprecatedSectionPlaceholders.map((p) => 
                          `${p} → Use ${result.sectionContent?.recommendedSectionPlaceholders?.join(' or ') || '{{impression}}'} instead`
                        )}
                        tone="danger"
                      />
                    )}
                  </div>
                </section>
              )}

              {/* Approval/Signature Validation */}
              {result.approvalSignature && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Approval & Signature</h3>
                  <div className="mt-1 space-y-2 text-sm">
                    <div className={clsx(
                      'rounded-md border px-3 py-2',
                      result.approvalSignature.hasSignatoryName 
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                    )}>
                      <strong>Signatory Name:</strong> {result.approvalSignature.hasSignatoryName ? '✓ Present' : '✗ Missing (add {{signatoryName}})'}
                    </div>
                    <div className={clsx(
                      'rounded-md border px-3 py-2',
                      result.approvalSignature.hasSignatoryDesignation 
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    )}>
                      <strong>Signatory Designation:</strong> {result.approvalSignature.hasSignatoryDesignation ? '✓ Present' : '⚠ Optional (add {{signatoryDesignation}} for title)'}
                    </div>
                    <div className={clsx(
                      'rounded-md border px-3 py-2',
                      result.approvalSignature.hasSignatoryImage 
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    )}>
                      <strong>Signature Image:</strong> {result.approvalSignature.hasSignatoryImage ? '✓ Present' : '⚠ Optional (add {{signatoryImageUrl}} for signature image)'}
                    </div>
                    {result.approvalSignature.missingSignaturePlaceholders && result.approvalSignature.missingSignaturePlaceholders.length > 0 && (
                      <AuditList
                        title="Missing signature placeholders"
                        items={result.approvalSignature.missingSignaturePlaceholders}
                        tone="warning"
                      />
                    )}
                  </div>
                </section>
              )}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Placeholders</h3>
                <div className="mt-1 space-y-2 text-sm">
                  {result.placeholders?.invalidAnalytePlaceholders?.length ? (
                    <AuditList 
                      title="Invalid analyte placeholders (CRITICAL - these will NOT render)" 
                      items={result.placeholders.invalidAnalytePlaceholders.map(p => `${p} → Use {{#results}}...{{/results}} loop instead`)} 
                      tone="danger" 
                    />
                  ) : null}
                  {result.placeholders?.deprecatedPlaceholders?.length ? (
                    <AuditList title="Deprecated placeholders" items={result.placeholders.deprecatedPlaceholders} tone="danger" />
                  ) : null}
                  {result.placeholders?.requiredMissing?.length ? (
                    <AuditList title="Missing required" items={result.placeholders.requiredMissing} tone="warning" />
                  ) : null}
                  {result.placeholders?.unknownPlaceholders?.length ? (
                    <AuditList title="Unknown placeholders" items={result.placeholders.unknownPlaceholders} tone="info" />
                  ) : null}
                  {result.placeholders?.duplicates?.length ? (
                    <AuditList title="Duplicates" items={result.placeholders.duplicates} tone="info" />
                  ) : null}
                  {!result.placeholders?.invalidAnalytePlaceholders?.length &&
                  !result.placeholders?.requiredMissing?.length &&
                  !result.placeholders?.unknownPlaceholders?.length &&
                  !result.placeholders?.duplicates?.length ? (
                    <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-700">
                      All placeholders look good.
                    </p>
                  ) : null}
                </div>
              </section>

              {/* Results Loop Validation */}
              {result.resultsLoop && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Results Loop Structure</h3>
                  <div className="mt-1 space-y-2 text-sm">
                    <div className={clsx(
                      'rounded-md border px-3 py-2',
                      result.resultsLoop.hasResultsLoop 
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                    )}>
                      <strong>Loop Markers:</strong> {result.resultsLoop.hasResultsLoop ? '✓ {{#results}}...{{/results}} present' : '✗ Missing {{#results}}...{{/results}} loop'}
                    </div>
                    {result.resultsLoop.hasResultsLoop && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div className={clsx(
                            'rounded-md border px-2 py-1 text-xs',
                            result.resultsLoop.hasAnalyteName ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                          )}>
                            {result.resultsLoop.hasAnalyteName ? '✓' : '⚠'} analyteName
                          </div>
                          <div className={clsx(
                            'rounded-md border px-2 py-1 text-xs',
                            result.resultsLoop.hasValue ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                          )}>
                            {result.resultsLoop.hasValue ? '✓' : '⚠'} value
                          </div>
                          <div className={clsx(
                            'rounded-md border px-2 py-1 text-xs',
                            result.resultsLoop.hasUnit ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                          )}>
                            {result.resultsLoop.hasUnit ? '✓' : '⚠'} unit
                          </div>
                          <div className={clsx(
                            'rounded-md border px-2 py-1 text-xs',
                            result.resultsLoop.hasReferenceRange ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                          )}>
                            {result.resultsLoop.hasReferenceRange ? '✓' : '⚠'} referenceRange
                          </div>
                          <div className={clsx(
                            'rounded-md border px-2 py-1 text-xs',
                            result.resultsLoop.hasFlag ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                          )}>
                            {result.resultsLoop.hasFlag ? '✓' : '⚠'} flag
                          </div>
                        </div>
                        {result.resultsLoop.missingLoopPlaceholders && result.resultsLoop.missingLoopPlaceholders.length > 0 && (
                          <AuditList
                            title="Missing loop placeholders"
                            items={result.resultsLoop.missingLoopPlaceholders}
                            tone="warning"
                          />
                        )}
                      </>
                    )}
                  </div>
                </section>
              )}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Analyte Coverage</h3>
                <div className="mt-1 space-y-2 text-sm">
                  {result.analyteCoverage?.invalidIndividualPlaceholders?.length ? (
                    <div className="space-y-2">
                      <AuditList
                        title="Invalid individual analyte placeholders (CRITICAL)"
                        items={result.analyteCoverage.invalidIndividualPlaceholders.map(p => `${p} will NOT render any data`)}
                        tone="danger"
                      />
                      {result.analyteCoverage.recommendation && (
                        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
                          <strong>Recommendation:</strong> {result.analyteCoverage.recommendation}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {result.analyteCoverage?.referencedButUnknown?.length ? (
                    <AuditList
                      title="Referenced but not in test group"
                      items={result.analyteCoverage.referencedButUnknown}
                      tone="danger"
                    />
                  ) : null}
                  {result.analyteCoverage?.missingFromTemplate?.length ? (
                    <AuditList
                      title="Test group analytes missing in template"
                      items={result.analyteCoverage.missingFromTemplate}
                      tone="warning"
                    />
                  ) : null}
                  {!result.analyteCoverage?.invalidIndividualPlaceholders?.length &&
                  !result.analyteCoverage?.referencedButUnknown?.length &&
                  !result.analyteCoverage?.missingFromTemplate?.length ? (
                    <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-700">
                      Template and test group are aligned.
                    </p>
                  ) : null}
                </div>
              </section>

              {result.recommendations?.length ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recommendations</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                    {result.recommendations.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-gray-600">No audit has been executed yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};

const AuditCheckCard: React.FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <div
    className={clsx(
      'rounded-md border px-3 py-2 text-sm',
      active
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-red-200 bg-red-50 text-red-700'
    )}
  >
    {label}: {active ? 'Present' : 'Missing'}
  </div>
);

const AuditList: React.FC<{ title: string; items: string[]; tone: 'warning' | 'info' | 'danger' }> = ({
  title,
  items,
  tone,
}) => {
  const toneClasses = {
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
    danger: 'border-red-200 bg-red-50 text-red-700',
  };

  return (
    <div className={clsx('rounded-md border px-3 py-2', toneClasses[tone])}>
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
        {items.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </div>
  );
};

export default TemplateAIAuditModal;

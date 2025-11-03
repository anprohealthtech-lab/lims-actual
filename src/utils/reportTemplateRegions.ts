export interface ReportTemplateRegions {
  headerHtml: string;
  bodyHtml: string;
  footerHtml: string;
}

const HEADER_PLACEHOLDER = '<div class="report-region-placeholder">Place header content here</div>';
const FOOTER_PLACEHOLDER = '<div class="report-region-placeholder">Place footer content here</div>';

const createDefaultStructure = (bodyHtml: string) => `
<section data-report-region="header" class="report-region report-region--header">
  ${HEADER_PLACEHOLDER}
</section>
<section data-report-region="body" class="report-region report-region--body">
  ${bodyHtml || '<p></p>'}
</section>
<section data-report-region="footer" class="report-region report-region--footer">
  ${FOOTER_PLACEHOLDER}
</section>
`;

const ensureRegion = (html: string, region: 'header' | 'body' | 'footer'): string => {
  if (html.includes(`data-report-region="${region}"`)) {
    return html;
  }

  if (region === 'header') {
    return `<section data-report-region="header" class="report-region report-region--header">${HEADER_PLACEHOLDER}</section>${html}`;
  }

  if (region === 'footer') {
    return `${html}<section data-report-region="footer" class="report-region report-region--footer">${FOOTER_PLACEHOLDER}</section>`;
  }

  return html;
};

export const ensureReportRegions = (html: string): string => {
  const trimmed = (html || '').trim();

  if (!trimmed) {
    return createDefaultStructure('<p></p>');
  }

  if (!trimmed.includes('data-report-region=')) {
    return createDefaultStructure(trimmed);
  }

  let working = trimmed;
  working = ensureRegion(working, 'header');
  working = ensureRegion(working, 'body');
  working = ensureRegion(working, 'footer');
  return working;
};

const parseWithDom = (html: string) => {
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return null;
  }

  try {
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    return doc;
  } catch (error) {
    console.warn('Failed to parse template regions with DOMParser:', error);
    return null;
  }
};

export const extractReportRegions = (html: string): ReportTemplateRegions => {
  const cleaned = ensureReportRegions(html);
  const doc = parseWithDom(cleaned);

  if (doc) {
    const headerEl = doc.querySelector('[data-report-region="header"]');
    const bodyEl = doc.querySelector('[data-report-region="body"]');
    const footerEl = doc.querySelector('[data-report-region="footer"]');

    return {
      headerHtml: headerEl ? headerEl.innerHTML.trim() : '',
      bodyHtml: bodyEl ? bodyEl.innerHTML.trim() : '',
      footerHtml: footerEl ? footerEl.innerHTML.trim() : '',
    };
  }

  // Regex fallback for non-browser contexts
  const regionRegex = (region: 'header' | 'body' | 'footer') =>
    new RegExp(`<([a-z0-9]+)([^>]*data-report-region=["']${region}["'][^>]*)>([\\s\\S]*?)</\\1>`, 'i');

  const matchRegion = (region: 'header' | 'body' | 'footer') => {
    const match = cleaned.match(regionRegex(region));
    return match ? match[3].trim() : '';
  };

  return {
    headerHtml: matchRegion('header'),
    bodyHtml: matchRegion('body'),
    footerHtml: matchRegion('footer'),
  };
};

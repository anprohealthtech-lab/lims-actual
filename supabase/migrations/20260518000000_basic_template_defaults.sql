-- Make newly-created labs start with the basic report template defaults.
-- Existing labs keep their saved settings unless their insert path explicitly changes them.

ALTER TABLE public.labs
  ALTER COLUMN default_template_style SET DEFAULT 'basic',
  ALTER COLUMN show_methodology SET DEFAULT true,
  ALTER COLUMN show_interpretation SET DEFAULT false,
  ALTER COLUMN pdf_layout_settings SET DEFAULT '{
    "scale": 1.0,
    "margins": { "top": 180, "left": 20, "right": 20, "bottom": 150 },
    "mediaType": "screen",
    "paperSize": "A4",
    "orientation": "portrait",
    "footerHeight": 80,
    "headerHeight": 90,
    "printBackground": true,
    "displayHeaderFooter": true,
    "headerTextColor": "white",
    "printOptions": {
      "baseFontSize": 14,
      "flagSymbol": "before",
      "showFlagLegend": false,
      "flagAsterisk": false,
      "flagAsteriskCritical": false,
      "testNameBold": false,
      "testNameAlignment": "left",
      "boldAllValues": false,
      "boldAbnormalValues": true,
      "calcMarker": "cal",
      "sectionHeaderInline": true,
      "testGroupTitlePosition": "above_headers_center",
      "qrHorizontalOffset": 0,
      "qrPosition": "bottom_left",
      "basicColumnWidths": {
        "standard": [36, 24, 12, 28],
        "sibling": [30, 14, 8, 16, 16, 16]
      }
    },
    "resultColors": {
      "enabled": true,
      "high": "#dc2626",
      "low": "#000000",
      "normal": "#16a34a"
    }
  }'::jsonb;

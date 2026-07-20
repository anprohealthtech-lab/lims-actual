# Infographic API Quick Reference Card

## 1. Claude Haiku 4.5 - PDF Parsing

```bash
POST https://api.anthropic.com/v1/messages
```

**Headers:**
```
Content-Type: application/json
x-api-key: YOUR_ANTHROPIC_KEY
anthropic-version: 2023-06-01
```

**Request Body:**
```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 8192,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": "BASE64_ENCODED_PDF"
          }
        },
        {
          "type": "text",
          "text": "Extract patient info and test results as JSON..."
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "id": "msg_xxx",
  "content": [{"type": "text", "text": "{\"patient\": {...}, \"test_sections\": [...]}"}],
  "usage": {"input_tokens": 1500, "output_tokens": 800}
}
```

---

## 2. Gamma AI - Report Generation

### Initiate Generation

```bash
POST https://public-api.gamma.app/v1.0/generations
```

**Headers:**
```
Content-Type: application/json
X-API-KEY: YOUR_GAMMA_KEY
accept: application/json
```

**Request Body:**
```json
{
  "textMode": "generate",
  "inputText": "# Report Title\n\n## Section 1\n...",
  "format": "document",
  "themeId": "wbpgwj9c0ty5wbo",
  "cardSplit": "auto",
  "additionalInstructions": "Create clean medical infographic...",
  "exportAs": "pdf",
  "sharingOptions": {
    "workspaceAccess": "edit",
    "externalAccess": "view"
  },
  "imageOptions": {
    "source": "noImages"
  }
}
```

**Response:**
```json
{
  "generationId": "gen_xxxxx"
}
```

### Poll Status

```bash
GET https://public-api.gamma.app/v1.0/generations/{generationId}
```

**Response (completed):**
```json
{
  "generationId": "gen_xxxxx",
  "status": "completed",
  "exportUrl": "https://gamma.app/export/xxx.pdf",
  "url": "https://gamma.app/docs/xxx"
}
```

---

## 3. PDF.co - Branding Overlay

```bash
POST https://api.pdf.co/v1/pdf/edit/add
```

**Headers:**
```
Content-Type: application/json
x-api-key: YOUR_PDFCO_KEY
```

**Request Body:**
```json
{
  "url": "https://source-pdf-url.pdf",
  "images": [
    {
      "url": "https://header-image.png",
      "x": 0,
      "y": 0,
      "width": 595,
      "height": 100,
      "pages": "0-"
    },
    {
      "url": "https://footer-image.png",
      "x": 0,
      "y": 742,
      "width": 595,
      "height": 100,
      "pages": "0-"
    }
  ],
  "name": "branded_report.pdf"
}
```

**Response:**
```json
{
  "url": "https://pdf.co/output/branded_report.pdf",
  "pageCount": 3,
  "error": false
}
```

---

## 4. Extracted Data Schema

```typescript
interface ExtractedPathologyReport {
  patient: {
    name: string;
    age: string;
    sex: "Male" | "Female";
    report_date: string;  // YYYY-MM-DD
    doctor_name: string | null;
  };
  
  lab_info: {
    name: string;
    address: string | null;
    phone: string | null;
  };
  
  test_sections: Array<{
    section_name: string;      // "Complete Blood Count"
    category: string;          // "Hematology"
    tests: Array<{
      test_name: string;       // "Hemoglobin"
      value: string;           // "12.5"
      unit: string;            // "g/dL"
      reference_range: string; // "13.0 - 17.0"
      is_abnormal: boolean;
      abnormal_direction: "high" | "low" | null;
    }>;
  }>;
  
  abnormal_summary: Array<{
    section: string;
    test_name: string;
    value: string;
    reference_range: string;
    direction: "high" | "low";
  }>;
}
```

---

## 5. Layout Prompt Template

```markdown
# INFOGRAPHIC REPORT LAYOUT

## Page Header (Reserve 15% top space)
Patient: John Doe
Age/Sex: 45 / Male
Report Date: 2026-07-01
Referring Doctor: Dr. Smith

---

## ABNORMAL VALUES SUMMARY (Highlight with red/amber)

Layout: Alert Card with Icons

### Liver Function
- **SGPT**: 125 U/L ↑ (Ref: 16-63)
- **SGOT**: 85 U/L ↑ (Ref: 15-37)

### CBC
- **Hemoglobin**: 11.2 g/dL ↓ (Ref: 13-17)

---

## Complete Blood Count

Layout Type: gauge_chart
Category: Hematology

- Hemoglobin: 11.2 g/dL **[LOW]**
  Reference: 13.0 - 17.0
- RBC Count: 4.5 million/μL
  Reference: 4.5 - 5.5
- WBC Count: 7500 /μL
  Reference: 4000 - 11000

**Abnormal in this section:** Hemoglobin: 11.2 g/dL

---
```

---

## 6. Longevity Domain Keywords

| Domain | Keywords |
|--------|----------|
| Metabolic | glucose, hba1c, triglycerides, cholesterol, insulin, uric acid |
| Cardiovascular | ldl, hdl, hscrp, homocysteine, lipoprotein, bnp |
| Cognitive | b12, folate, tsh, vitamin d, ferritin |
| Inflammatory | crp, esr, interleukin, tnf, wbc |
| Hormonal | testosterone, estrogen, lh, fsh, cortisol, dhea |
| Nutritional | vitamin d, iron, calcium, magnesium, zinc |
| Renal | creatinine, bun, egfr, cystatin c |
| Hepatic | alt, ast, alp, ggt, bilirubin, albumin |

---

## 7. Trend Calculation

```typescript
function calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
  if (values.length < 2) return 'stable';
  
  const recent = values.slice(-3);
  const older = values.slice(-6, -3);
  
  if (older.length === 0) return 'stable';
  
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  
  const percentChange = ((recentAvg - olderAvg) / olderAvg) * 100;
  
  if (Math.abs(percentChange) < 5) return 'stable';
  return percentChange > 0 ? 'increasing' : 'decreasing';
}
```

---

## 8. Cost Calculator

```
PDF Parsing (Haiku):
  Input:  pages × 1500 tokens × $0.80/MTok
  Output: ~800 tokens × $4.00/MTok
  
Example (5 pages):
  Input:  7,500 × 0.0008 = $0.006
  Output: 800 × 0.004   = $0.0032
  Total: ~$0.01

Gamma Generation: ~$0.10/report
PDF.co Overlay:    ~$0.01/operation

TOTAL per report: ~$0.12
```

---

## 9. Error Codes

| API | Code | Meaning |
|-----|------|---------|
| Anthropic | 400 | Invalid request (check base64 encoding) |
| Anthropic | 429 | Rate limited (implement backoff) |
| Gamma | failed | Generation error (check input text) |
| PDF.co | 401 | Invalid API key |
| PDF.co | 422 | Invalid PDF URL |

---

## 10. Quick Start Checklist

- [ ] Get Anthropic API key (claude.ai/settings)
- [ ] Get Gamma API key (gamma.app/developer)
- [ ] Get PDF.co API key (pdf.co/account)
- [ ] Set environment variables
- [ ] Deploy edge functions
- [ ] Test with sample PDF
- [ ] Configure lab branding assets
- [ ] Enable storage bucket policies

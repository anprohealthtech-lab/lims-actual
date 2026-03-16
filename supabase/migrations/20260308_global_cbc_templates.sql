-- ============================================================
-- MIGRATION: Global CBC Templates — 3-Part & 5-Part
-- Date: 2026-03-08
-- ============================================================
-- Inserts two templates into global_template_catalog:
--   1. CBC_5PART_TEMPLATE  — 5-part differential layout matching the
--      image (Parameter | Results | Unit | Biological Ref. Interval),
--      with separate "Blood Indices" and "Differential WBC Count"
--      sections, dual % + Abs columns for differential, and ESR row.
--   2. CBC_3PART_TEMPLATE  — simplified 4-column layout without
--      differential WBC section.
--
-- Then links each template to its global_test_catalog entry.
--
-- Variable format: {{SlugFromName}} for value, {{SlugFromName_flag}} for flag
-- These match the generateAnalytePlaceholders() output in the edge function.
-- ============================================================

BEGIN;

-- ── INSERT 5-Part CBC Template ────────────────────────────────

INSERT INTO public.global_template_catalog (
  id,
  name,
  type,
  html_content,
  css_content,
  is_default
) VALUES (
  'c1cbc000-0000-0000-0000-000000000001'::uuid,
  'CBC 5-Part Differential Report',
  'report_body',
$$<section class="report-region report-region--body" data-report-region="body">

<figure><p><img src="{{headerImageUrl}}"></p></figure>

<figure class="table">
  <table>
    <tbody>
      <tr><th>Patient Name:</th><td>{{patientName}}</td><td>Patient ID:</td><td>{{patientId}}</td></tr>
      <tr><th>Age / Gender:</th><td>{{patientAge}} / {{patientGender}}</td><td>Ref. Doctor:</td><td>{{referringDoctorName}}</td></tr>
      <tr><th>Sample Collected:</th><td>{{sampleCollectedAt}}</td><td>Approved At:</td><td>{{approvedAt}}</td></tr>
      <tr><th>Collection Centre:</th><td>{{locationName}}</td><td>Report Date:</td><td>{{reportDate}}</td></tr>
      <tr><th>Order ID:</th><td colspan="3">{{orderId}}</td></tr>
    </tbody>
  </table>
</figure>

<p>&nbsp;</p>

<!-- ── MAIN RESULTS TABLE ──────────────────────────────────── -->
<figure class="table">
  <table class="tbl-results">
    <thead>
      <tr>
        <th style="width:40%">Parameter</th>
        <th style="width:12%;text-align:right">Results</th>
        <th style="width:10%">Unit</th>
        <th style="width:30%">Biological Ref. Interval</th>
        <th style="width:8%;text-align:center">Flag</th>
      </tr>
    </thead>
    <tbody>

      <!-- ── Complete Blood Count ──────────────────────────── -->
      <tr class="section-header-row">
        <td colspan="5" style="text-align:center;font-weight:bold;text-decoration:underline">Complete Blood Count</td>
      </tr>
      <tr>
        <td>Hemoglobin (SLS Method)</td>
        <td class="val {{Hemoglobin_flag}}">{{Hemoglobin}}</td>
        <td>g/dL</td>
        <td>M: 13.5 - 18.0 &nbsp;|&nbsp; F: 12.0 - 16.0</td>
        <td class="flag-cell {{Hemoglobin_flag}}">{{Hemoglobin_flag}}</td>
      </tr>
      <tr>
        <td>Total Leukocyte Count (Impedance)</td>
        <td class="val {{TotalLeukocyteCount_flag}}">{{TotalLeukocyteCount}}</td>
        <td>/cmm</td>
        <td>4000 - 10500</td>
        <td class="flag-cell {{TotalLeukocyteCount_flag}}">{{TotalLeukocyteCount_flag}}</td>
      </tr>
      <tr>
        <td>Platelet Count (Impedance)</td>
        <td class="val {{PlateletCount_flag}}">{{PlateletCount}}</td>
        <td>/cmm</td>
        <td>150000 - 450000</td>
        <td class="flag-cell {{PlateletCount_flag}}">{{PlateletCount_flag}}</td>
      </tr>

      <!-- ── Blood Indices ─────────────────────────────────── -->
      <tr class="section-header-row">
        <td colspan="5" style="font-weight:bold;text-decoration:underline">Blood Indices</td>
      </tr>
      <tr>
        <td>Hematocrit (Direct)</td>
        <td class="val {{Hematocrit_flag}}">{{Hematocrit}}</td>
        <td>%</td>
        <td>M: 42 - 52 &nbsp;|&nbsp; F: 36 - 46</td>
        <td class="flag-cell {{Hematocrit_flag}}">{{Hematocrit_flag}}</td>
      </tr>
      <tr>
        <td>RBC Count (Electrical Impedance)</td>
        <td class="val {{RedBloodCellCount_flag}}">{{RedBloodCellCount}}</td>
        <td>10⁶/µL</td>
        <td>M: 4.5 - 5.9 &nbsp;|&nbsp; F: 4.2 - 5.4</td>
        <td class="flag-cell {{RedBloodCellCount_flag}}">{{RedBloodCellCount_flag}}</td>
      </tr>
      <tr>
        <td>MCV (Calculated)</td>
        <td class="val {{MeanCorpuscularVolumeMCV_flag}}">{{MeanCorpuscularVolumeMCV}}</td>
        <td>fL</td>
        <td>78 - 100</td>
        <td class="flag-cell {{MeanCorpuscularVolumeMCV_flag}}">{{MeanCorpuscularVolumeMCV_flag}}</td>
      </tr>
      <tr>
        <td>MCH (Calculated)</td>
        <td class="val {{MeanCorpuscularHemoglobinMCH_flag}}">{{MeanCorpuscularHemoglobinMCH}}</td>
        <td>pg</td>
        <td>27 - 31</td>
        <td class="flag-cell {{MeanCorpuscularHemoglobinMCH_flag}}">{{MeanCorpuscularHemoglobinMCH_flag}}</td>
      </tr>
      <tr>
        <td>MCHC (Calculated)</td>
        <td class="val {{MeanCorpuscularHemoglobinConcentrationMCHC_flag}}">{{MeanCorpuscularHemoglobinConcentrationMCHC}}</td>
        <td>g/dL</td>
        <td>32 - 36</td>
        <td class="flag-cell {{MeanCorpuscularHemoglobinConcentrationMCHC_flag}}">{{MeanCorpuscularHemoglobinConcentrationMCHC_flag}}</td>
      </tr>
      <tr>
        <td>RDW (Calculated)</td>
        <td class="val {{RedCellDistributionWidthRDW_flag}}">{{RedCellDistributionWidthRDW}}</td>
        <td>%</td>
        <td>11.5 - 14.0</td>
        <td class="flag-cell {{RedCellDistributionWidthRDW_flag}}">{{RedCellDistributionWidthRDW_flag}}</td>
      </tr>

    </tbody>
  </table>
</figure>

<p>&nbsp;</p>

<!-- ── DIFFERENTIAL WBC COUNT TABLE ────────────────────────── -->
<figure class="table">
  <table class="tbl-results tbl-differential">
    <thead>
      <tr>
        <th style="width:28%">Differential WBC Count</th>
        <th style="width:8%;text-align:right">[%]</th>
        <th style="width:5%;text-align:center">Flag</th>
        <th style="width:18%">Expected Values [%]</th>
        <th style="width:10%;text-align:right">[Abs]</th>
        <th style="width:5%;text-align:center">Flag</th>
        <th style="width:8%">Unit</th>
        <th style="width:18%">Expected Values [Abs]</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Neutrophils</td>
        <td class="val {{Neutrophils_flag}}">{{Neutrophils}}</td>
        <td class="flag-cell {{Neutrophils_flag}}">{{Neutrophils_flag}}</td>
        <td>50 - 80</td>
        <td class="val {{NeutrophilsAbs_flag}}">{{NeutrophilsAbs}}</td>
        <td class="flag-cell {{NeutrophilsAbs_flag}}">{{NeutrophilsAbs_flag}}</td>
        <td>/cmm</td>
        <td>1500 - 6600</td>
      </tr>
      <tr>
        <td>Lymphocytes</td>
        <td class="val {{Lymphocytes_flag}}">{{Lymphocytes}}</td>
        <td class="flag-cell {{Lymphocytes_flag}}">{{Lymphocytes_flag}}</td>
        <td>25 - 50</td>
        <td class="val {{LymphocytesAbs_flag}}">{{LymphocytesAbs}}</td>
        <td class="flag-cell {{LymphocytesAbs_flag}}">{{LymphocytesAbs_flag}}</td>
        <td>/cmm</td>
        <td>1500 - 3500</td>
      </tr>
      <tr>
        <td>Monocytes</td>
        <td class="val {{Monocytes_flag}}">{{Monocytes}}</td>
        <td class="flag-cell {{Monocytes_flag}}">{{Monocytes_flag}}</td>
        <td>2 - 10</td>
        <td class="val {{MonocytesAbs_flag}}">{{MonocytesAbs}}</td>
        <td class="flag-cell {{MonocytesAbs_flag}}">{{MonocytesAbs_flag}}</td>
        <td>/cmm</td>
        <td>Less than 1000</td>
      </tr>
      <tr>
        <td>Eosinophils</td>
        <td class="val {{Eosinophils_flag}}">{{Eosinophils}}</td>
        <td class="flag-cell {{Eosinophils_flag}}">{{Eosinophils_flag}}</td>
        <td>0.0 - 5.0</td>
        <td class="val {{EosinophilsAbs_flag}}">{{EosinophilsAbs}}</td>
        <td class="flag-cell {{EosinophilsAbs_flag}}">{{EosinophilsAbs_flag}}</td>
        <td>/cmm</td>
        <td>Less than 700</td>
      </tr>
      <tr>
        <td>Basophils</td>
        <td class="val {{Basophils_flag}}">{{Basophils}}</td>
        <td class="flag-cell {{Basophils_flag}}">{{Basophils_flag}}</td>
        <td>0 - 2</td>
        <td class="val {{BasophilsAbs_flag}}">{{BasophilsAbs}}</td>
        <td class="flag-cell {{BasophilsAbs_flag}}">{{BasophilsAbs_flag}}</td>
        <td>/cmm</td>
        <td>Less than 100</td>
      </tr>
    </tbody>
  </table>
</figure>

<p>&nbsp;</p>

<!-- ── ESR + COMMENT ─────────────────────────────────────────── -->
<figure class="table">
  <table class="tbl-results">
    <tbody>
      <tr>
        <td style="width:40%">ESR (After 1 hour)</td>
        <td class="val {{ESRAfter1hour_flag}}" style="width:12%;text-align:right">{{ESRAfter1hour}}</td>
        <td style="width:10%">mm/hr</td>
        <td style="width:30%">M: 0 - 13 &nbsp;|&nbsp; F: 0 - 20</td>
        <td class="flag-cell {{ESRAfter1hour_flag}}" style="width:8%;text-align:center">{{ESRAfter1hour_flag}}</td>
      </tr>
      <tr>
        <td>Comment</td>
        <td colspan="4">{{impression}}</td>
      </tr>
    </tbody>
  </table>
</figure>

<p>&nbsp;</p>

<div class="note">
  <strong>Note:</strong> All abnormal hemograms are reviewed and confirmed microscopically.
  Peripheral blood smear and malarial parasite examination are not part of the CBC report.
</div>

<p>&nbsp;</p>
<p>{{approverName}}</p>
<p>{{approverRole}}</p>
<p>&nbsp;</p>

</section>$$,

$$
:root {
  --primary-blue: #0b4aa2;
  --light-blue: #eaf2ff;
  --danger-red: #d92d20;
  --warning-amber: #f79009;
  --text-dark: #1f2937;
  --text-muted: #64748b;
  --border-light: #e5ecf6;
  --row-alt: #f7faff;
}

html, body { margin: 0; padding: 0; width: 100%; font-family: Inter, system-ui, Arial, sans-serif; color: var(--text-dark); }

figure.table { margin: 8px 0; width: 100% !important; }
figure.table table, .tbl-results, .tbl-differential {
  width: 100% !important; border-collapse: collapse; box-sizing: border-box;
}

/* Header row styling */
.tbl-results thead th, .tbl-differential thead th {
  background: var(--primary-blue) !important; color: #fff !important;
  font-weight: 700; padding: 8px 10px; text-align: left; font-size: 12px;
}

/* Data cells */
.tbl-results td, .tbl-differential td {
  border: 1px solid var(--border-light); padding: 7px 10px; font-size: 12px;
}

/* Alternating rows */
.tbl-results tbody tr:nth-child(even), .tbl-differential tbody tr:nth-child(even) {
  background: var(--row-alt);
}

/* Section header rows */
.section-header-row td {
  background: #f0f4ff; font-weight: 600; padding: 6px 10px !important;
}

/* Value alignment */
.val { text-align: right !important; font-weight: 600; }

/* Flag cells — show as L / H badge */
.flag-cell { text-align: center !important; font-weight: 700; font-size: 11px; text-transform: uppercase; }
.flag-cell.low, .flag-cell.l  { color: var(--danger-red); }
.flag-cell.high, .flag-cell.h { color: var(--danger-red); }
.flag-cell.normal              { color: transparent; }

/* Value color by flag */
.val.low, .val.l   { color: var(--danger-red); }
.val.high, .val.h  { color: var(--danger-red); }

/* Note block */
.note {
  margin-top: 10px; padding: 10px 14px;
  border-left: 4px solid var(--primary-blue);
  background: #f8fafc; font-size: 12px; font-style: italic;
}

/* Patient info table */
figure.table:first-of-type td, figure.table:first-of-type th {
  border: 1px solid var(--border-light); padding: 6px 10px; font-size: 12px;
}

@media print {
  .tbl-results, .tbl-differential { break-inside: auto !important; }
  .tbl-results thead, .tbl-differential thead { display: table-header-group; }
  .tbl-results tr, .tbl-differential tr { break-inside: avoid !important; }
}
$$,

  false
)
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  html_content = EXCLUDED.html_content,
  css_content  = EXCLUDED.css_content,
  updated_at   = now();

-- ── INSERT 3-Part CBC Template ────────────────────────────────

INSERT INTO public.global_template_catalog (
  id,
  name,
  type,
  html_content,
  css_content,
  is_default
) VALUES (
  'c1cbc000-0000-0000-0000-000000000002'::uuid,
  'CBC 3-Part Basic Report',
  'report_body',
$$<section class="report-region report-region--body" data-report-region="body">

<figure><p><img src="{{headerImageUrl}}"></p></figure>

<figure class="table">
  <table>
    <tbody>
      <tr><th>Patient Name:</th><td>{{patientName}}</td><td>Patient ID:</td><td>{{patientId}}</td></tr>
      <tr><th>Age / Gender:</th><td>{{patientAge}} / {{patientGender}}</td><td>Ref. Doctor:</td><td>{{referringDoctorName}}</td></tr>
      <tr><th>Sample Collected:</th><td>{{sampleCollectedAt}}</td><td>Approved At:</td><td>{{approvedAt}}</td></tr>
      <tr><th>Collection Centre:</th><td>{{locationName}}</td><td>Report Date:</td><td>{{reportDate}}</td></tr>
      <tr><th>Order ID:</th><td colspan="3">{{orderId}}</td></tr>
    </tbody>
  </table>
</figure>

<p>&nbsp;</p>

<figure class="table">
  <table class="tbl-results">
    <thead>
      <tr>
        <th style="width:40%">Parameter</th>
        <th style="width:14%;text-align:right">Results</th>
        <th style="width:10%">Unit</th>
        <th style="width:28%">Biological Ref. Interval</th>
        <th style="width:8%;text-align:center">Flag</th>
      </tr>
    </thead>
    <tbody>
      <tr class="section-header-row">
        <td colspan="5" style="text-align:center;font-weight:bold;text-decoration:underline">Complete Blood Count</td>
      </tr>
      <tr>
        <td>Hemoglobin</td>
        <td class="val {{Hemoglobin_flag}}">{{Hemoglobin}}</td>
        <td>g/dL</td>
        <td>M: 13.5–18.0 | F: 12.0–16.0</td>
        <td class="flag-cell {{Hemoglobin_flag}}">{{Hemoglobin_flag}}</td>
      </tr>
      <tr>
        <td>Total Leukocyte Count</td>
        <td class="val {{TotalLeukocyteCount_flag}}">{{TotalLeukocyteCount}}</td>
        <td>/cmm</td>
        <td>4000 - 10500</td>
        <td class="flag-cell {{TotalLeukocyteCount_flag}}">{{TotalLeukocyteCount_flag}}</td>
      </tr>
      <tr>
        <td>Platelet Count</td>
        <td class="val {{PlateletCount_flag}}">{{PlateletCount}}</td>
        <td>/cmm</td>
        <td>150000 - 450000</td>
        <td class="flag-cell {{PlateletCount_flag}}">{{PlateletCount_flag}}</td>
      </tr>

      <tr class="section-header-row">
        <td colspan="5" style="font-weight:bold;text-decoration:underline">Blood Indices</td>
      </tr>
      <tr>
        <td>Hematocrit</td>
        <td class="val {{Hematocrit_flag}}">{{Hematocrit}}</td>
        <td>%</td>
        <td>M: 42–52 | F: 36–46</td>
        <td class="flag-cell {{Hematocrit_flag}}">{{Hematocrit_flag}}</td>
      </tr>
      <tr>
        <td>RBC Count</td>
        <td class="val {{RedBloodCellCount_flag}}">{{RedBloodCellCount}}</td>
        <td>10⁶/µL</td>
        <td>M: 4.5–5.9 | F: 4.2–5.4</td>
        <td class="flag-cell {{RedBloodCellCount_flag}}">{{RedBloodCellCount_flag}}</td>
      </tr>
      <tr>
        <td>Mean Corpuscular Volume (MCV)</td>
        <td class="val {{MeanCorpuscularVolumeMCV_flag}}">{{MeanCorpuscularVolumeMCV}}</td>
        <td>fL</td>
        <td>78 - 100</td>
        <td class="flag-cell {{MeanCorpuscularVolumeMCV_flag}}">{{MeanCorpuscularVolumeMCV_flag}}</td>
      </tr>
      <tr>
        <td>Mean Corpuscular Hemoglobin (MCH)</td>
        <td class="val {{MeanCorpuscularHemoglobinMCH_flag}}">{{MeanCorpuscularHemoglobinMCH}}</td>
        <td>pg</td>
        <td>27 - 31</td>
        <td class="flag-cell {{MeanCorpuscularHemoglobinMCH_flag}}">{{MeanCorpuscularHemoglobinMCH_flag}}</td>
      </tr>
      <tr>
        <td>MCHC</td>
        <td class="val {{MeanCorpuscularHemoglobinConcentrationMCHC_flag}}">{{MeanCorpuscularHemoglobinConcentrationMCHC}}</td>
        <td>g/dL</td>
        <td>32 - 36</td>
        <td class="flag-cell {{MeanCorpuscularHemoglobinConcentrationMCHC_flag}}">{{MeanCorpuscularHemoglobinConcentrationMCHC_flag}}</td>
      </tr>
      <tr>
        <td>Red Cell Distribution Width (RDW)</td>
        <td class="val {{RedCellDistributionWidthRDW_flag}}">{{RedCellDistributionWidthRDW}}</td>
        <td>%</td>
        <td>11.5 - 14.0</td>
        <td class="flag-cell {{RedCellDistributionWidthRDW_flag}}">{{RedCellDistributionWidthRDW_flag}}</td>
      </tr>

      <tr>
        <td>Comment</td>
        <td colspan="4">{{impression}}</td>
      </tr>
    </tbody>
  </table>
</figure>

<p>&nbsp;</p>
<p>{{approverName}}</p>
<p>{{approverRole}}</p>
<p>&nbsp;</p>

</section>$$,

$$
:root { --primary-blue:#0b4aa2; --danger-red:#d92d20; --border-light:#e5ecf6; --row-alt:#f7faff; }
html,body{margin:0;padding:0;width:100%;font-family:Inter,system-ui,Arial,sans-serif;color:#1f2937;}
figure.table{margin:8px 0;width:100%!important;}
figure.table table,.tbl-results{width:100%!important;border-collapse:collapse;}
.tbl-results thead th{background:var(--primary-blue)!important;color:#fff!important;font-weight:700;padding:8px 10px;text-align:left;font-size:12px;}
.tbl-results td{border:1px solid var(--border-light);padding:7px 10px;font-size:12px;}
.tbl-results tbody tr:nth-child(even){background:var(--row-alt);}
.section-header-row td{background:#f0f4ff;font-weight:600;padding:6px 10px!important;}
.val{text-align:right!important;font-weight:600;}
.flag-cell{text-align:center!important;font-weight:700;font-size:11px;text-transform:uppercase;}
.flag-cell.low,.flag-cell.l,.flag-cell.high,.flag-cell.h{color:var(--danger-red);}
.flag-cell.normal{color:transparent;}
.val.low,.val.l,.val.high,.val.h{color:var(--danger-red);}
figure.table:first-of-type td,figure.table:first-of-type th{border:1px solid var(--border-light);padding:6px 10px;font-size:12px;}
@media print{.tbl-results{break-inside:auto!important;}.tbl-results thead{display:table-header-group;}.tbl-results tr{break-inside:avoid!important;}}
$$,

  false
)
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  html_content = EXCLUDED.html_content,
  css_content  = EXCLUDED.css_content,
  updated_at   = now();

-- ── Link templates to global_test_catalog entries ─────────────

UPDATE public.global_test_catalog
SET default_template_id = 'c1cbc000-0000-0000-0000-000000000001'::uuid,
    updated_at = now()
WHERE code = 'CBC_5PART';

UPDATE public.global_test_catalog
SET default_template_id = 'c1cbc000-0000-0000-0000-000000000002'::uuid,
    updated_at = now()
WHERE code = 'CBC_3PART';

-- Verify
SELECT gtc.code, gtc.name, gtc.default_template_id, gtc_t.name AS template_name
FROM global_test_catalog gtc
LEFT JOIN global_template_catalog gtc_t ON gtc_t.id = gtc.default_template_id
WHERE gtc.code IN ('CBC_3PART', 'CBC_5PART');

COMMIT;

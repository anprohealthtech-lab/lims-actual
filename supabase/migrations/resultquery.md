for a 

[
  {
    "column_name": "id",
    "data_type": "uuid",
    "is_nullable": "NO",
    "column_default": "gen_random_uuid()"
  },
  {
    "column_name": "name",
    "data_type": "character varying",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "column_name": "unit",
    "data_type": "character varying",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "column_name": "reference_range",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "low_critical",
    "data_type": "character varying",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "high_critical",
    "data_type": "character varying",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "interpretation_low",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "interpretation_normal",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "interpretation_high",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "category",
    "data_type": "character varying",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "column_name": "is_active",
    "data_type": "boolean",
    "is_nullable": "YES",
    "column_default": "true"
  },
  {
    "column_name": "created_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": "now()"
  },
  {
    "column_name": "updated_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES",
    "column_default": "now()"
  },
  {
    "column_name": "ai_processing_type",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": "'ocr_report'::text"
  },
  {
    "column_name": "ai_prompt_override",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "group_ai_mode",
    "data_type": "USER-DEFINED",
    "is_nullable": "YES",
    "column_default": "'individual'::group_ai_mode"
  },
  {
    "column_name": "is_global",
    "data_type": "boolean",
    "is_nullable": "YES",
    "column_default": "true"
  },
  {
    "column_name": "to_be_copied",
    "data_type": "boolean",
    "is_nullable": "YES",
    "column_default": "false"
  },
  {
    "column_name": "reference_range_male",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "reference_range_female",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "test_kind",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "is_calculated",
    "data_type": "boolean",
    "is_nullable": "YES",
    "column_default": "false"
  },
  {
    "column_name": "formula",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "formula_variables",
    "data_type": "jsonb",
    "is_nullable": "YES",
    "column_default": "'[]'::jsonb"
  },
  {
    "column_name": "formula_description",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "value_type",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": "'numeric'::text"
  },
  {
    "column_name": "expected_normal_values",
    "data_type": "jsonb",
    "is_nullable": "YES",
    "column_default": "'[]'::jsonb"
  },
  {
    "column_name": "flag_rules",
    "data_type": "jsonb",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "code",
    "data_type": "character varying",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "description",
    "data_type": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "column_name": "ref_range_knowledge",
    "data_type": "jsonb",
    "is_nullable": "YES",
    "column_default": "'{}'::jsonb"
  },
  {
    "column_name": "expected_value_flag_map",
    "data_type": "jsonb",
    "is_nullable": "YES",
    "column_default": "'{}'::jsonb"
  }
]

for b one sample 

[{"idx":8,"id":"96b65442-b5e1-40e1-a804-08b2e071d04d","name":"CBC Report Template","type":"report_body","html_content":"<section class=\"report-region report-region--body\" data-report-region=\"body\"><figure><p><img src=\"{{headerImageUrl}}\"></p></figure><p>&nbsp;</p><h2 id=\"e0efb43cc46c613fc414de713c29a011d\"><strong>Complete Blood Count (CBC) Report -&nbsp;</strong></h2><figure class=\"table\"><table><tbody><tr><th>Patient Name:</th><td>{{patientName}}</td><td>Patient ID:</td><td>{{patientId}}</td></tr><tr><th>Patient Age:</th><td>{{patientAge}}</td><td>Patient Gender:</td><td>{{patientGender}}</td></tr><tr><th>Registration Date:</th><td>{{registrationDate}}</td><td>Location/Collection Centre:</td><td>{{locationName}}</td></tr><tr><th>Sample Collected At:</th><td>{{sampleCollectedAt}}</td><td>Approved/Verified At:</td><td>{{approvedAt}}</td></tr><tr><th>Referring Doctor:</th><td colspan=\"3\">{{referringDoctorName}}</td></tr><tr><th>Order ID:</th><td>{{orderId}}</td><td>Report Date:</td><td>{{reportDate}}</td></tr></tbody></table></figure><p>&nbsp;</p><p>&nbsp;</p><figure class=\"table\" style=\"width:88.9%;\"><table class=\"ck-table-resized\"><colgroup><col style=\"width:4.23%;\"><col style=\"width:34.24%;\"><col style=\"width:11.63%;\"><col style=\"width:11.28%;\"><col style=\"width:30.31%;\"><col style=\"width:8.31%;\"></colgroup><thead><tr><th>#</th><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead><tbody><tr><td>1</td><td>Hemoglobin</td><td>{{Hemoglobin}}</td><td>g/dL</td><td>M: 13.5–17.5, F: 12.0–16.0</td><td>{{Hemoglobin_flag}}</td></tr><tr><td>2</td><td>Hematocrit</td><td>{{Hematocrit}}</td><td>%</td><td>36 – 46</td><td>{{Hematocrit_flag}}</td></tr><tr><td>3</td><td>Red Blood Cell Count (RBC)</td><td>{{RedBloodCellCount}}</td><td>M/µL</td><td>4.5 – 5.5</td><td>{{RedBloodCellCount_flag}}</td></tr><tr><td>4</td><td>White Blood Cell Count (WBC)</td><td>{{WhiteBloodCellCount}}</td><td>K/µL</td><td>4 – 11</td><td>{{WhiteBloodCellCount_flag}}</td></tr><tr><td>5</td><td>Platelet Count</td><td>{{PlateletCount}}</td><td>/µL</td><td>150,000 – 450,000</td><td>{{PlateletCount_flag}}</td></tr><tr><td>6</td><td>Mean Corpuscular Volume (MCV)</td><td>{{MeanCorpuscularVolumeMCV}}</td><td>fL</td><td>80 – 100</td><td>{{MeanCorpuscularVolumeMCV_flag}}</td></tr><tr><td>7</td><td>Mean Corpuscular Hemoglobin (MCH)</td><td>{{MeanCorpuscularHemoglobinMCH}}</td><td>pg</td><td>27 – 31</td><td>{{MeanCorpuscularHemoglobinMCH_flag}}</td></tr><tr><td>8</td><td>Mean Corpuscular Hemoglobin Concentration (MCHC)</td><td>{{MeanCorpuscularHemoglobinConcentrationMCHC}}</td><td>g/dL</td><td>32 – 36</td><td>{{MeanCorpuscularHemoglobinConcentrationMCHC_flag}}</td></tr><tr><td>9</td><td>Red Cell Distribution Width (RDW)</td><td>{{RedCellDistributionWidthRDW}}</td><td>%</td><td>11.5 – 14.5</td><td>{{RedCellDistributionWidthRDW_flag}}</td></tr><tr><td>10</td><td>Neutrophils</td><td>{{Neutrophils}}</td><td>%</td><td>40 – 70</td><td>{{Neutrophils_flag}}</td></tr><tr><td>11</td><td>Lymphocytes</td><td>{{Lymphocytes}}</td><td>%</td><td>20 – 40</td><td>{{Lymphocytes_flag}}</td></tr><tr><td>12</td><td>Monocytes</td><td>{{Monocytes}}</td><td>%</td><td>2 – 8</td><td>{{Monocytes_flag}}</td></tr><tr><td>13</td><td>Eosinophils</td><td>{{Eosinophils}}</td><td>%</td><td>0 – 5</td><td>{{Eosinophils_flag}}</td></tr><tr><td>14</td><td>Basophils</td><td>{{Basophils}}</td><td>%</td><td>0 – 2</td><td>{{Basophils_flag}}</td></tr></tbody></table></figure><h3 id=\"e6d54d91454a103b6250c989331714c8b\">Interpretation Summary:</h3><p><span style=\"background-color:hsl(0,0%,100%);color:hsl(0,0%,0%);font-family:Consolas, &quot;Courier New&quot;, monospace;font-size:11.999px;\"><span style=\"-webkit-text-stroke-width:0px;display:inline !important;float:none;font-style:normal;font-variant-caps:normal;font-variant-ligatures:normal;font-weight:400;letter-spacing:normal;orphans:2;text-align:start;text-decoration-color:initial;text-decoration-style:initial;text-decoration-thickness:initial;text-indent:0px;text-transform:none;white-space:pre-wrap;widows:2;word-spacing:0px;\">{{impression}}</span></span></p><p>&nbsp;</p><p>&nbsp;</p><p><a target=\"_blank\" rel=\"noopener noreferrer\" href=\"https://vscode-file://vscode-app/c:/Users/Lenovo/AppData/Local/Programs/Microsoft%20VS%20Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html\"><span style=\"background-color:hsl(0,0%,100%);color:hsl(0,0%,0%);font-family:Consolas, &quot;Courier New&quot;, monospace;font-size:11.999px;\"><span style=\"-webkit-text-stroke-width:0px;display:inline !important;float:none;font-style:normal;font-variant-caps:normal;font-variant-ligatures:normal;font-weight:400;letter-spacing:normal;orphans:2;text-align:start;text-decoration-color:initial;text-decoration-style:initial;text-decoration-thickness:initial;text-indent:0px;text-transform:none;white-space:pre-wrap;widows:2;word-spacing:0px;\">{{approverName}}</span></span></a></p><p><a target=\"_blank\" rel=\"noopener noreferrer\" href=\"https://vscode-file://vscode-app/c:/Users/Lenovo/AppData/Local/Programs/Microsoft%20VS%20Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html\"><span style=\"background-color:hsl(0,0%,100%);color:hsl(0,0%,0%);font-family:Consolas, &quot;Courier New&quot;, monospace;font-size:11.999px;\"><span style=\"-webkit-text-stroke-width:0px;display:inline !important;float:none;font-style:normal;font-variant-caps:normal;font-variant-ligatures:normal;font-weight:400;letter-spacing:normal;orphans:2;text-align:start;text-decoration-color:initial;text-decoration-style:initial;text-decoration-thickness:initial;text-indent:0px;text-transform:none;white-space:pre-wrap;widows:2;word-spacing:0px;\">{{approverRole}}</span></span></a></p><p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p></section>\n\n<div class=\"section-header\">Clinical Interpretation</div>\n<figure class=\"table\">\n  <table class=\"tbl-interpretation\">\n    <thead>\n      <tr>\n        <th>Level</th>\n        <th>Meaning & Potential Causes</th>\n      </tr>\n    </thead>\n    <tbody>\n      <tr>\n        <td>High</td>\n        <td>Elevated white blood cell, red blood cell, or platelet counts may suggest infection, inflammation, blood disorders, or physiological stress. Each parameter's specific elevation requires clinical correlation and further investigation.</td>\n      </tr>\n      <tr>\n        <td>Low</td>\n        <td>Decreased blood cell counts may indicate anemia, bone marrow suppression, nutritional deficiencies, chronic diseases, or immune system disorders. Specific low counts require comprehensive clinical assessment.</td>\n      </tr>\n      <tr>\n        <td>Normal</td>\n        <td>Results within reference ranges suggest typical hematological status. Routine monitoring recommended as part of comprehensive health assessment. Individual variations may occur based on age, sex, and overall health.</td>\n      </tr>\n    </tbody>\n  </table>\n</figure>\n\n<div class=\"note\">\n  <strong>Note on Reference Ranges:</strong> CBC reference ranges vary by age, sex, and individual laboratory standards. Always use the specific reference ranges provided with your test results.\n  <br><br>\n  <strong>Additional Note:</strong> CBC results can be influenced by multiple factors including recent infections, medications, nutritional status, stress, pregnancy, and underlying medical conditions. Serial testing may help establish baseline and track changes over time.\n</div>\n\n<div class=\"section-header\">Clinical Interpretation</div>\n<figure class=\"table\">\n  <table class=\"tbl-interpretation\">\n    <thead>\n      <tr>\n        <th>Level</th>\n        <th>Meaning & Potential Causes</th>\n      </tr>\n    </thead>\n    <tbody>\n      <tr>\n        <td>High</td>\n        <td>Elevated white blood cell count may suggest active infection, inflammation, blood disorders, or stress response. Elevated red blood cell count could indicate dehydration, lung disease, or bone marrow disorders. Correlate clinically with patient symptoms.</td>\n      </tr>\n      <tr>\n        <td>Low</td>\n        <td>Decreased white blood cell count may indicate immune suppression, bone marrow issues, viral infections, or certain medications. Low red blood cell count suggests potential anemia, nutritional deficiencies, chronic diseases, or blood loss. Comprehensive clinical evaluation recommended.</td>\n      </tr>\n      <tr>\n        <td>Normal</td>\n        <td>Results within reference ranges generally indicate stable hematological status. No immediate clinical intervention required, but routine monitoring is advised based on individual patient risk factors.</td>\n      </tr>\n    </tbody>\n  </table>\n</figure>\n\n<div class=\"note\">\n  <strong>Note on Reference Ranges:</strong> CBC reference ranges vary by age, sex, altitude, and individual laboratory standards. Always use the specific reference ranges provided with the test report.\n  <br><br>\n  <strong>Additional Note:</strong> Factors affecting CBC results include recent infections, medications, pregnancy, hydration status, and underlying chronic conditions. Serial testing can help establish individual baseline and track changes over time.\n</div>","css_content":"\r\n:root{\r\n  --primary-blue:#0b4aa2;\r\n  --light-blue:#eaf2ff;\r\n  --success-green:#12b76a;\r\n  --warning-amber:#f79009;\r\n  --danger-red:#d92d20;\r\n  --text-dark:#1f2937;\r\n  --text-muted:#64748b;\r\n  --border-light:#e5ecf6;\r\n  --row-alt:#f7faff;\r\n  --page-bg:#ffffff;\r\n  --card-bg:#ffffff;\r\n}\r\n\r\nhtml,body{\r\n  margin:0;\r\n  padding:0;\r\n  width:100%;\r\n  font-family:Inter,system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif;\r\n  color:var(--text-dark);\r\n  background:var(--page-bg);\r\n}\r\n\r\n/* TABLE WRAPPERS */\r\nfigure.table{\r\n  margin:12px 0;\r\n  width:100%!important;\r\n  max-width:100%!important;\r\n}\r\n\r\nfigure.table table,\r\n.patient-info,\r\n.report-table,\r\n.tbl-meta,\r\n.tbl-results,\r\n.tbl-interpretation{\r\n  width:100%!important;\r\n  max-width:100%!important;\r\n  border-collapse:collapse;\r\n  box-sizing:border-box;\r\n}\r\n\r\n/* TABLE CONTAINERS */\r\n.patient-info,\r\n.report-table,\r\n.tbl-meta,\r\n.tbl-results,\r\n.tbl-interpretation{\r\n  border:1px solid var(--border-light);\r\n  border-radius:10px;\r\n  overflow:hidden;\r\n  background:#fff;\r\n}\r\n\r\n/* TABLE CELLS */\r\n.patient-info td,\r\n.report-table td,\r\n.tbl-meta td,\r\n.tbl-results td,\r\n.tbl-interpretation td{\r\n  border:1px solid var(--border-light);\r\n  padding:10px 12px;\r\n  font-size:13px;\r\n  word-break:break-word;\r\n}\r\n\r\n/* TABLE HEADERS */\r\n.report-table thead th,\r\n.tbl-results thead th,\r\n.tbl-interpretation thead th{\r\n  background:var(--primary-blue)!important;\r\n  color:#fff!important;\r\n  font-weight:900;\r\n  padding:10px 12px;\r\n  text-align:left;\r\n}\r\n\r\n/* NOTE BLOCK */\r\n.note{\r\n  margin-top:14px;\r\n  padding:12px 14px;\r\n  border-left:4px solid var(--primary-blue);\r\n  background:#f8fafc;\r\n  font-size:13px;\r\n  font-style:italic;\r\n}\r\n\r\n/* PRINT RULES */\r\n@media print {\r\n\r\n  .report-table,\r\n  .tbl-results,\r\n  .tbl-interpretation{\r\n    break-inside:auto !important;\r\n    page-break-inside:auto !important;\r\n  }\r\n\r\n  .report-table thead,\r\n  .tbl-results thead,\r\n  .tbl-interpretation thead{\r\n    display:table-header-group;\r\n  }\r\n\r\n  .report-table tr,\r\n  .tbl-results tr,\r\n  .tbl-interpretation tr{\r\n    break-inside:avoid !important;\r\n    page-break-inside:avoid !important;\r\n  }\r\n\r\n  .page-break{\r\n    page-break-before:always;\r\n    break-before:page;\r\n  }\r\n}\r\n","is_default":false,"created_at":"2025-12-21 04:53:26.506073+00","updated_at":"2025-12-21 04:53:26.506073+00"}]

for c  

[
  {
    "name": "Absolute Basophil Count",
    "code": "BASO",
    "is_global": true,
    "same_code_count": 5,
    "id": "da3d08ac-13af-4faf-9be8-342ae8936ee9"
  },
  {
    "name": "Basophils",
    "code": "BASO",
    "is_global": true,
    "same_code_count": 5,
    "id": "ef0060e5-65a1-4ea4-8a81-efbe621bb84b"
  },
  {
    "name": "Basophils",
    "code": "BASO",
    "is_global": true,
    "same_code_count": 5,
    "id": "9154123c-a855-47ca-be0d-97555743f0f2"
  },
  {
    "name": "Basophils",
    "code": "BASO",
    "is_global": true,
    "same_code_count": 5,
    "id": "29ee2f86-db4a-4beb-b061-c640b3291a85"
  },
  {
    "name": "Basophils (%)",
    "code": "BASO",
    "is_global": true,
    "same_code_count": 5,
    "id": "8e0740f4-e35f-40bf-be65-3c8264db0700"
  },
  {
    "name": "Absolute Eosinophil Count",
    "code": "EOS",
    "is_global": true,
    "same_code_count": 6,
    "id": "e4d312cc-12ed-4a91-b183-04c5dcfe5a8b"
  },
  {
    "name": "Absolute Eosinophil Count (AEC)",
    "code": "EOS",
    "is_global": true,
    "same_code_count": 6,
    "id": "b4a1a014-bb1e-4c25-935e-27ef58dcc6b1"
  },
  {
    "name": "Eosinophils",
    "code": "EOS",
    "is_global": true,
    "same_code_count": 6,
    "id": "f4c9135a-36bf-4357-841d-1d9fbded5444"
  },
  {
    "name": "Eosinophils",
    "code": "EOS",
    "is_global": true,
    "same_code_count": 6,
    "id": "1579291b-40e1-4add-b379-7c77226ade32"
  },
  {
    "name": "Eosinophils",
    "code": "EOS",
    "is_global": true,
    "same_code_count": 6,
    "id": "18ac7139-2120-44b6-9d39-11d3b9a3eb2b"
  },
  {
    "name": "Eosinophils (%)",
    "code": "EOS",
    "is_global": true,
    "same_code_count": 6,
    "id": "e6f1e1be-b956-4f36-bed2-41574a6b1138"
  },
  {
    "name": "Erythrocyte Sedimentation Rate (ESR)",
    "code": "ERYTHR",
    "is_global": true,
    "same_code_count": 4,
    "id": "7abe6fcc-ba37-4020-8f72-21f315ca0b79"
  },
  {
    "name": "Erythrocyte Sedimentation Rate (ESR)",
    "code": "ERYTHR",
    "is_global": true,
    "same_code_count": 4,
    "id": "d33b3e7d-a7c9-4bf3-b6e0-aa5a75e4b66f"
  },
  {
    "name": "Erythrocyte Sedimentation Rate (ESR)",
    "code": "ERYTHR",
    "is_global": true,
    "same_code_count": 4,
    "id": "a60c3fb7-5fff-4287-97f2-8cc4b125136e"
  },
  {
    "name": "Erythrocyte Sedimentation Rate (ESR)",
    "code": "ERYTHR",
    "is_global": true,
    "same_code_count": 4,
    "id": "5eafd30b-5f7c-451b-a6de-cce14abc5e37"
  },
  {
    "name": "Haemoglobin (Hb)",
    "code": "HAEMOG",
    "is_global": true,
    "same_code_count": 1,
    "id": "351d7424-2df3-45d0-ba24-0deafbddd720"
  },
  {
    "name": "Hb (Hemoglobin)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "0b3eeefa-552e-4fe9-8466-f90785397a8c"
  },
  {
    "name": "HbA (Hemoglobin A)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "4672507b-beee-4a66-a729-96b08ee4c915"
  },
  {
    "name": "HbA (Hemoglobin A)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "f3c7e08b-39bd-47f6-b379-a6974d762a9a"
  },
  {
    "name": "HbA2 (Hemoglobin A2)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "8a006fc3-af4c-4a5d-8f85-1010e43673ff"
  },
  {
    "name": "HbA2 (Hemoglobin A2)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "d3671185-fc84-42cd-8b9d-256626ff9e25"
  },
  {
    "name": "HbC (Hemoglobin C)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "841eb610-ce7e-4bcf-a824-d5a439c5ffb4"
  },
  {
    "name": "HbC (Hemoglobin C)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "47c98b5c-525a-4b6f-8fea-3027663405fc"
  },
  {
    "name": "HbF (Hemoglobin F)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "bdb81756-10a5-49f2-bfac-38ffd266db93"
  },
  {
    "name": "HbF (Hemoglobin F)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "58c4bd96-2a38-4a58-8536-dd2a7429e912"
  },
  {
    "name": "HbS (Hemoglobin S)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "7a35bf4c-907d-44cf-a16f-75e52c1f52c9"
  },
  {
    "name": "HbS (Hemoglobin S)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "ceacc9d4-e667-47c8-8f85-0a411428a7d3"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "55faa37f-034a-4cb2-a13f-164321c33ecf"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "250aafd1-28ce-4ce2-931e-b66b89174ceb"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "94c37748-9632-48b4-bd54-64de8cb95d47"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "dcf5f5b3-f1c9-4c42-8a69-b1653b69aab2"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "7e481381-3969-4285-9d90-6231bce066c9"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "283851fd-b236-4e2b-90df-c6d546f96dd7"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": false,
    "same_code_count": 22,
    "id": "c57d200e-b55a-4d39-8559-2f1e0ce9111a"
  },
  {
    "name": "Hemoglobin",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "606782d8-2d64-47de-b73f-32d12ad98a0f"
  },
  {
    "name": "Hemoglobin (HGB)",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "8c4fa759-0e47-41de-9548-45c9491ed16e"
  },
  {
    "name": "Other Hemoglobins",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "e8340d68-9f01-41de-9280-e3fceb01fd8a"
  },
  {
    "name": "Other Hemoglobins",
    "code": "HB",
    "is_global": true,
    "same_code_count": 22,
    "id": "ffbae208-3cc9-42e5-8180-821d064bebc5"
  },
  {
    "name": "Hematocrit",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "8739fa59-1936-4fb0-b8bd-5b375fb43b83"
  },
  {
    "name": "Hematocrit",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "c8347f57-05a9-469f-b6ca-94850c5436d6"
  },
  {
    "name": "Hematocrit",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "b0160255-7750-49cf-99d2-2ea25f9a3ff0"
  },
  {
    "name": "Hematocrit",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "012c6c4d-5a15-44c0-bc8b-ae1ad549eb94"
  },
  {
    "name": "Hematocrit",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "87707885-f6ed-4cd6-88f8-a9db68c8fb5c"
  },
  {
    "name": "Hematocrit",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "ef12723d-6229-4d9e-8070-e434031e14d3"
  },
  {
    "name": "Hematocrit (Hct)",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "7063beb2-7603-43fc-bc8c-b706ce918d40"
  },
  {
    "name": "Hematocrit (HCT)",
    "code": "HCT",
    "is_global": true,
    "same_code_count": 8,
    "id": "f8e2c73f-0ab1-4f82-80e4-1ad8e69e9d22"
  },
  {
    "name": "Hemoglobin",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "80a74a54-f801-410d-85a1-7246876e4b5e"
  },
  {
    "name": "Hemoglobin",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "33c6d01c-e786-4666-ba48-7d9157483bb8"
  },
  {
    "name": "Hemoglobin",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "41c681f1-d511-439c-b0b5-ee0301dd8f0b"
  },
  {
    "name": "Hemoglobin",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "b73007d5-275b-4f63-b1d0-bb761afe24fe"
  },
  {
    "name": "Hemoglobin",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "2528147d-27eb-46cf-b56f-47efa6dc7920"
  },
  {
    "name": "Hemoglobin",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "44432dc6-e8f5-4067-b5e1-ee710acb0867"
  },
  {
    "name": "Hemoglobin (Hgb)",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "8d14adef-cb72-44e8-ae4f-08de97b0125b"
  },
  {
    "name": "Hemoglobin (HGB)",
    "code": "HGB",
    "is_global": true,
    "same_code_count": 8,
    "id": "f507e2ec-e5cb-4a4d-89b8-27acb49a3dbc"
  },
  {
    "name": "Absolute Lymphocyte Count",
    "code": "LYMPH",
    "is_global": true,
    "same_code_count": 5,
    "id": "92d7c898-03b8-41a7-9511-56f91c91b60f"
  },
  {
    "name": "Lymphocytes",
    "code": "LYMPH",
    "is_global": true,
    "same_code_count": 5,
    "id": "34009c9c-4999-48e9-aab6-39f229f1dc86"
  },
  {
    "name": "Lymphocytes",
    "code": "LYMPH",
    "is_global": true,
    "same_code_count": 5,
    "id": "2e71c9b9-bc75-4eed-870c-fa5d0aa22f17"
  },
  {
    "name": "Lymphocytes",
    "code": "LYMPH",
    "is_global": true,
    "same_code_count": 5,
    "id": "3163c64f-ace9-459f-b218-708de684b53b"
  },
  {
    "name": "Lymphocytes (%)",
    "code": "LYMPH",
    "is_global": true,
    "same_code_count": 5,
    "id": "bdadc7a2-27b6-4bf4-8d80-7b9367d74e88"
  },
  {
    "name": "MCH",
    "code": "MCH",
    "is_global": true,
    "same_code_count": 4,
    "id": "62121e9c-5820-4f1f-8d52-f3c56746cfa7"
  },
  {
    "name": "Mean Corpuscular Hemoglobin (MCH)",
    "code": "MCH",
    "is_global": true,
    "same_code_count": 4,
    "id": "c9821e72-9091-4ebb-9c87-b8f9995e71eb"
  },
  {
    "name": "Mean Corpuscular Hemoglobin (MCH)",
    "code": "MCH",
    "is_global": true,
    "same_code_count": 4,
    "id": "1d1ea395-33bf-4d88-bb11-e79dac4f9c38"
  },
  {
    "name": "Mean Corpuscular Hemoglobin (MCH)",
    "code": "MCH",
    "is_global": true,
    "same_code_count": 4,
    "id": "5c3b0434-79a9-4242-9f0a-8537db873615"
  },
  {
    "name": "MCHC",
    "code": "MCHC",
    "is_global": true,
    "same_code_count": 4,
    "id": "5455a160-7769-44c2-b744-1b9a84e80da3"
  },
  {
    "name": "Mean Corpuscular Hemoglobin Concentration (MCHC)",
    "code": "MCHC",
    "is_global": true,
    "same_code_count": 4,
    "id": "336bea51-d856-401f-ac8d-eb153190d6d2"
  },
  {
    "name": "Mean Corpuscular Hemoglobin Concentration (MCHC)",
    "code": "MCHC",
    "is_global": true,
    "same_code_count": 4,
    "id": "4350a391-1768-46a4-a8ad-5b58fd0484fc"
  },
  {
    "name": "Mean Corpuscular Hemoglobin Concentration (MCHC)",
    "code": "MCHC",
    "is_global": true,
    "same_code_count": 4,
    "id": "9ef882be-6b4b-42ff-8fa3-ef4d65392242"
  },
  {
    "name": "MCV",
    "code": "MCV",
    "is_global": true,
    "same_code_count": 6,
    "id": "20f8321b-3c4f-41bd-8bf5-5b2656badda0"
  },
  {
    "name": "Mean Corpuscular Volume (MCV)",
    "code": "MCV",
    "is_global": true,
    "same_code_count": 6,
    "id": "91a16767-9c00-434c-b894-b16b4d35f504"
  },
  {
    "name": "Mean Corpuscular Volume (MCV)",
    "code": "MCV",
    "is_global": true,
    "same_code_count": 6,
    "id": "b9491f98-0a1f-4968-85a7-050b7525019f"
  },
  {
    "name": "Mean Corpuscular Volume (MCV)",
    "code": "MCV",
    "is_global": true,
    "same_code_count": 6,
    "id": "ef9c4414-540b-4102-9d08-12d3b26e74d8"
  },
  {
    "name": "Mean Corpuscular Volume (MCV)",
    "code": "MCV",
    "is_global": true,
    "same_code_count": 6,
    "id": "f8ae8c20-65ed-4575-a77d-37fc02512b34"
  },
  {
    "name": "Mean Corpuscular Volume (MCV)",
    "code": "MCV",
    "is_global": true,
    "same_code_count": 6,
    "id": "fa1ab39f-1194-410f-ad13-364040388379"
  },
  {
    "name": "Absolute Monocyte Count",
    "code": "MONO",
    "is_global": true,
    "same_code_count": 5,
    "id": "b552f4fe-42dd-4efa-8834-2abb2d827562"
  },
  {
    "name": "Monocytes",
    "code": "MONO",
    "is_global": true,
    "same_code_count": 5,
    "id": "585096ec-d817-46d2-9286-6e4afd727828"
  },
  {
    "name": "Monocytes",
    "code": "MONO",
    "is_global": true,
    "same_code_count": 5,
    "id": "9221b6c6-ab40-4947-8b50-0359e1a07554"
  },
  {
    "name": "Monocytes",
    "code": "MONO",
    "is_global": true,
    "same_code_count": 5,
    "id": "7bedb7e1-f2da-4e5f-8e1c-28b7162b47a6"
  },
  {
    "name": "Monocytes (%)",
    "code": "MONO",
    "is_global": true,
    "same_code_count": 5,
    "id": "be532e0d-c8d5-45cd-9089-5edb77a2e305"
  },
  {
    "name": "Absolute Neutrophil Count",
    "code": "NEUT",
    "is_global": true,
    "same_code_count": 5,
    "id": "7d61ca41-240d-4c0a-bb01-e9b347014146"
  },
  {
    "name": "Granulocyte (GR)",
    "code": "NEUT",
    "is_global": true,
    "same_code_count": 5,
    "id": "cc3930da-8536-4e64-883f-a86abec983a9"
  },
  {
    "name": "Neutrophils",
    "code": "NEUT",
    "is_global": true,
    "same_code_count": 5,
    "id": "adde10e3-e801-4ac9-8bc5-16f82e2e3480"
  },
  {
    "name": "Neutrophils",
    "code": "NEUT",
    "is_global": true,
    "same_code_count": 5,
    "id": "c1a0bbbe-c151-45a7-85a6-107a17b24868"
  },
  {
    "name": "Neutrophils (%)",
    "code": "NEUT",
    "is_global": true,
    "same_code_count": 5,
    "id": "1ab93aaf-e76b-47be-8671-131814396c6f"
  },
  {
    "name": "Immature Platelet Fraction (IPF)",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "3c9c2f9d-c0c7-4c8a-8636-9459664369d2"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "1c146119-c0d5-40e9-842d-2c37c13b8c79"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "0c8a3cde-05f4-4862-a5eb-fd9fbf18a775"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "00b2a017-692e-4c85-a92c-b8bc6f4fc5d5"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "fb6a981a-ec6c-4975-86c3-1251a6f3af04"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": false,
    "same_code_count": 18,
    "id": "ec96106d-ca5b-45ef-a52f-be8c780c7322"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "037353c4-63aa-4238-a0a8-2c54bd1653f8"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "1d8279b6-4e0b-4cde-a0ad-644547cbe1c6"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "5acfa902-7b6d-42c0-83d5-d904cda837e3"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "0c4fcb75-646c-42f1-b0ac-59cf9bf32db4"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "bfa30a74-53ab-493c-8481-9871e370dd4b"
  },
  {
    "name": "Platelet Count",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "652ab9d8-1898-47dc-9305-b974603d2b5b"
  },
  {
    "name": "Platelet Count (PLT)",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "e9aa93b9-a03a-4910-bb8b-dae2ea0af2ee"
  },
  {
    "name": "Platelet Estimate",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "bdcbb9c6-8596-4728-ac94-55baa34e226b"
  },
  {
    "name": "Platelet Estimate",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "4121fc60-c0a1-401d-893b-8ac0d5d5dbc3"
  },
  {
    "name": "Platelet Morphology",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "32453125-b548-4398-94d0-77dc0fc18fc7"
  },
  {
    "name": "Platelet Morphology",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "5873b7d8-535e-4dd6-9867-e68e9eded21f"
  },
  {
    "name": "Platelets",
    "code": "PLT",
    "is_global": true,
    "same_code_count": 18,
    "id": "95da24d0-6584-45a6-87f9-e6cdc09a710f"
  },
  {
    "name": "Red Blood Cell Count",
    "code": "RBC",
    "is_global": true,
    "same_code_count": 4,
    "id": "84268b1c-8e42-4242-8500-6b59060d1732"
  },
  {
    "name": "Red Blood Cell Count (RBC)",
    "code": "RBC",
    "is_global": true,
    "same_code_count": 4,
    "id": "1312010e-2d46-4375-8a3f-745ddfe7d57f"
  },
  {
    "name": "Red Blood Cell Count (RBC)",
    "code": "RBC",
    "is_global": true,
    "same_code_count": 4,
    "id": "48f8b020-2b55-406a-9945-7c62eb0164a9"
  },
  {
    "name": "Red Blood Cell Count (RBC)",
    "code": "RBC",
    "is_global": true,
    "same_code_count": 4,
    "id": "52b91f66-497e-40c4-b7ae-3f13d1084e27"
  },
  {
    "name": "RDW-CV",
    "code": "RDW",
    "is_global": true,
    "same_code_count": 4,
    "id": "ad9c681c-3585-44d9-9d12-9a263ac3be78"
  },
  {
    "name": "Red Cell Distribution Width (RDW-CV)",
    "code": "RDW",
    "is_global": true,
    "same_code_count": 4,
    "id": "33dceaf3-8676-4925-a85e-61566ca6dae4"
  },
  {
    "name": "Red Cell Distribution Width (RDW)",
    "code": "RDW",
    "is_global": true,
    "same_code_count": 4,
    "id": "abb56e79-c698-4e9a-8ca1-388d7a7c085a"
  },
  {
    "name": "Red Cell Distribution Width (RDW)",
    "code": "RDW",
    "is_global": true,
    "same_code_count": 4,
    "id": "c32dec44-689d-4ce8-afb6-8e8b36e8fc64"
  },
  {
    "name": "Total White Blood Cell Count",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "bbf253cd-59a3-48a9-9dec-a4cd866cb596"
  },
  {
    "name": "Total White Cell Count",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "2b9caacb-8663-4245-a268-a21f004e05c3"
  },
  {
    "name": "White Blood Cell Count",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "48e37b99-3677-403b-aa07-ec9a33ef1c58"
  },
  {
    "name": "White Blood Cell Count (WBC)",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "d6248abc-a2f4-4ba7-b57d-968724e6f410"
  },
  {
    "name": "White Blood Cell Count (WBC)",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "593161b1-ef85-4f71-9683-15c878f55355"
  },
  {
    "name": "White Blood Cell Count (WBC)",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "4ede9243-db24-4f42-9f9b-c8aa7f527fd6"
  },
  {
    "name": "White Blood Cell Morphology",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "d0cbbe29-bb49-4f82-9658-ac3b486814cc"
  },
  {
    "name": "White Blood Cell Morphology",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "1154057b-ce4c-4713-991b-f4bd6e22742e"
  },
  {
    "name": "White Blood Cells",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "102d95e1-fa77-49b4-9887-28615234f489"
  },
  {
    "name": "White Blood Cells (WBC)",
    "code": "WBC",
    "is_global": true,
    "same_code_count": 10,
    "id": "bd9586d3-2c54-4d21-9bd6-b259c101b061"
  }
]


for d 

[
  {
    "column_name": "is_active"
  },
  {
    "column_name": "is_global"
  }
]

for E 

[
  {
    "id": "764fd994-9dc9-498f-a3d6-252f9d06f602",
    "value": "15.1",
    "unit": "g/dL",
    "flag": "normal",
    "analyte_name": "Hemoglobin",
    "code": "HB",
    "lab_analyte_name": null
  },
  {
    "id": "23c6b2b0-f18a-4b5b-ae2b-f4413df00f95",
    "value": "15.1",
    "unit": "g/dL",
    "flag": "normal",
    "analyte_name": "Hemoglobin",
    "code": "HB",
    "lab_analyte_name": null
  },
  {
    "id": "1a8e1c7b-c00b-4047-9322-765ce9b00664",
    "value": "15.1",
    "unit": "g/dL",
    "flag": "normal",
    "analyte_name": "Hemoglobin",
    "code": "HB",
    "lab_analyte_name": null
  },
  {
    "id": "db440a28-1711-4a25-8b37-3dd045423dcb",
    "value": "9.9",
    "unit": "g/dL",
    "flag": "low",
    "analyte_name": "Hemoglobin",
    "code": "HB",
    "lab_analyte_name": null
  },
  {
    "id": "b604b78d-569e-4b01-8fd5-91057b3897c2",
    "value": "15.1",
    "unit": "g/dL",
    "flag": "Normal",
    "analyte_name": "Hemoglobin",
    "code": "HB",
    "lab_analyte_name": null
  },
  {
    "id": "069e636c-58c2-4467-be57-440ceffda2e2",
    "value": "8.3",
    "unit": "g/dL",
    "flag": "low",
    "analyte_name": "Hemoglobin",
    "code": "HB",
    "lab_analyte_name": null
  },
  {
    "id": "a7a4947b-f1a9-4a72-851d-ddb0347e166e",
    "value": "8.4",
    "unit": "g/dL",
    "flag": "low",
    "analyte_name": "Hemoglobin",
    "code": "HB",
    "lab_analyte_name": null
  },
  {
    "id": "ac16ccb1-7122-4f3a-b139-462a3bc62a48",
    "value": "8",
    "unit": "g/dL",
    "flag": "low",
    "analyte_name": "Hemoglobin (HGB)",
    "code": "HB",
    "lab_analyte_name": "Hemoglobin (HGB)"
  },
  {
    "id": "7d9e8ffd-39ab-42d2-be4f-79385bcb6d86",
    "value": "15.1",
    "unit": "g/dL",
    "flag": "Normal",
    "analyte_name": "Hemoglobin (HGB)",
    "code": "HB",
    "lab_analyte_name": "Hemoglobin (HGB)"
  },
  {
    "id": "12a7b4ae-96a7-4ad9-b66a-43950bdaa5ef",
    "value": "15.1",
    "unit": "g/dL",
    "flag": "Normal",
    "analyte_name": "Hemoglobin (HGB)",
    "code": "HB",
    "lab_analyte_name": "Hemoglobin (HGB)"
  }
]

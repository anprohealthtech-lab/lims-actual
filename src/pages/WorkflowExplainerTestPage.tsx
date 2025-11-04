import React from 'react';
import WorkflowExplainer from '../components/Workflow/WorkflowConfigurator/WorkflowExplainer';

const testWorkflow = {
  "ui": {
    "engine": "surveyjs",
    "template": {
      "title": "Urine Test Strip Procedure",
      "description": "Workflow for performing urine test strip analysis.",
      "pages": [
        {
          "name": "page_sample_prep",
          "title": "Sample Preparation",
          "elements": [
            {
              "type": "html",
              "name": "sample_prep_instructions",
              "html": "<h3>Sample Preparation Instructions</h3><ol><li>Collect urine sample in a clean, dry container.</li><li>Ensure the sample is well-mixed before testing.</li></ol>"
            },
            {
              "type": "text",
              "name": "sample_id",
              "title": "Sample ID",
              "isRequired": true
            },
            {
              "type": "file",
              "name": "sample_photo",
              "title": "Take sample photo",
              "isRequired": true,
              "acceptedTypes": "image/*"
            }
          ]
        },
        {
          "name": "page_results",
          "title": "Enter Results",
          "elements": [
            {
              "type": "text",
              "name": "ph",
              "title": "pH",
              "inputType": "number",
              "isRequired": true
            },
            {
              "type": "text",
              "name": "glucose",
              "title": "Glucose (mg/dL)",
              "inputType": "number",
              "isRequired": true
            }
          ]
        }
      ]
    }
  }
};

const testAiSpec = {
  "steps": [
    {
      "step_type": "extract_values",
      "parameters": {
        "target_fields": ["ph", "glucose"]
      },
      "description": "Extract pH and glucose values from the test strip image using AI vision."
    },
    {
      "step_type": "validate_range",
      "parameters": {
        "target_fields": ["ph"],
        "reference_ranges": {"ph": "4.5-8"}
      },
      "description": "Validate that the entered pH is within the physiological range."
    },
    {
      "step_type": "flag_abnormal",
      "parameters": {
        "target_fields": ["glucose"],
        "reference_ranges": {"glucose": ">100 mg/dL"}
      },
      "description": "Flag abnormal glucose results based on predefined thresholds."
    }
  ]
};

const WorkflowExplainerTestPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Workflow Explainer Test Page
          </h1>
          <p className="text-gray-600">
            Testing the AI-powered workflow explanation component with sample data
          </p>
        </div>
        
        <WorkflowExplainer
          technicianWorkflow={testWorkflow}
          aiSpec={testAiSpec}
          onStepClick={(stepIndex, stepData) => {
            console.log('Step clicked:', stepIndex, stepData);
          }}
        />
      </div>
    </div>
  );
};

export default WorkflowExplainerTestPage;
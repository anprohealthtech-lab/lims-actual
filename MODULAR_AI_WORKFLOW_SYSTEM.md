# Modular AI Image Analysis System

This document describes the fully modular AI image analysis workflow system implemented for the LIMS v2 project.

## Overview

The modular system allows creating AI-powered test workflows where **all AI logic is defined in JSON configuration**, without requiring code changes. This enables infinite flexibility in creating different test types by simply configuring the workflow's `ai_spec` section.

## System Architecture

### Core Components

1. **Edge Functions (Supabase)**
   - `image-analyzer-v2` - Generic image analyzer driven by workflow specs
   - `agent-1-manual-builder-v2` - Generates modular workflows from manuals

2. **React Components**
   - `ModularWorkflowExecutor` - Executes workflows with AI analysis
   - `WorkflowExplainerDemo` - Demo/testing interface

3. **Database Integration**
   - Workflows stored in `workflow_versions` table
   - AI specifications embedded in workflow definitions

## Workflow Structure

Each workflow follows this modular format:

```json
{
  "ui": {
    "engine": "surveyjs",
    "template": {
      "title": "Test Name",
      "showTimerPanel": "top",
      "showTimerPanelMode": "page",
      "pages": [
        {
          "name": "page_name",
          "maxTimeToFinish": 60,
          "elements": [
            {
              "type": "file",
              "name": "image_field",
              "acceptedTypes": "image/*",
              "capture": "camera"
            }
          ]
        }
      ]
    }
  },
  "ai_spec": {
    "version": "2.0",
    "steps": [
      {
        "id": "unique_step_id",
        "name": "Step Name",
        "type": "image_analysis",
        "trigger": {
          "page": "page_name",
          "element": "image_field",
          "event": "file_uploaded"
        },
        "model": "gemini-2.0-flash-exp",
        "custom_prompt": "Detailed analysis prompt with {{variables}}",
        "expected_output_schema": {
          "field_name": {
            "type": "string|number|boolean",
            "required": true,
            "range": {"min": 0, "max": 100}
          }
        },
        "post_processing": [
          {
            "type": "apply_reference_ranges|flag_abnormal",
            "config": {}
          }
        ],
        "review_criteria": {
          "min_confidence": 0.85,
          "abnormal_values": true
        }
      }
    ]
  },
  "meta": {
    "test_code": "TEST_CODE",
    "ai_enhanced": true,
    "modular": true
  }
}
```

## Key Features

### 1. **Three-Phase Image Analysis**
- **Pre-Analytical**: Sample quality verification
- **Process**: Time-controlled test execution monitoring
- **Result Analysis**: Multi-image consensus-based extraction

### 2. **Configurable AI Logic**
- **Custom Prompts**: Each step has its own AI prompt with variable interpolation
- **Output Validation**: Schema-based validation of AI responses
- **Post-Processing**: Configurable rules for reference ranges, abnormal flagging
- **Consensus Methods**: Multiple image analysis with voting/averaging

### 3. **Automatic Timing**
- SurveyJS `maxTimeToFinish` property for time-critical steps
- Visual countdown timers with automatic page advancement
- Context-aware timing based on test requirements

### 4. **Manual Review Integration**
- Confidence-based review triggers
- Abnormal value detection
- Quality issue flagging
- Customizable review criteria per step

## Usage Guide

### Creating New Test Types

1. **Define UI Structure** in `ui.template` (SurveyJS format)
2. **Configure AI Steps** in `ai_spec.steps` array
3. **Set Triggers** to connect UI elements with AI analysis
4. **Customize Prompts** with test-specific instructions
5. **Define Validation** schemas and post-processing rules

### Example: Urine Strip Test

```json
{
  "ai_spec": {
    "steps": [
      {
        "id": "pre_analytical_qc",
        "custom_prompt": "Analyze urine sample container for:\n1. Volume (min 10ml)\n2. Color classification\n3. Turbidity assessment\n4. Container condition\nReturn JSON: {\"volume_ml\": number, \"color\": string, \"quality_passed\": boolean}",
        "trigger": {
          "element": "sample_image",
          "event": "file_uploaded"
        }
      },
      {
        "id": "extract_results",
        "custom_prompt": "Extract urine strip results comparing colors to reference chart:\n- Glucose, Protein, pH, Blood, Ketone\nReturn: {\"results\": {\"glucose\": \"value\", ...}, \"confidence\": 0-1}",
        "image_fields": ["front_view", "angled_view", "reference_chart"],
        "consensus_method": {"type": "weighted", "config": {"min_agreement": 0.75}}
      }
    ]
  }
}
```

## API Integration

### Image Analysis Endpoint
```typescript
POST /functions/v1/image-analyzer-v2
{
  "images": ["base64_image_1", "base64_image_2"],
  "workflow_ai_spec": {...},
  "step_id": "extract_results",
  "context": {
    "test_type": "urine_strip",
    "time_elapsed": 60
  }
}
```

### Workflow Generation Endpoint
```typescript
POST /functions/v1/agent-1-manual-builder-v2
{
  "file_content": "Test manual content...",
  "test_metadata": {
    "test_type": "urine_strip",
    "expected_analytes": ["glucose", "protein"]
  }
}
```

## Demo Interface

Access the demo at `/workflow-explainer-demo`:

### 🔍 Workflow Explainer Mode
- View workflow structure and AI specifications
- Analyze step-by-step processing logic
- Modify AI prompts and parameters
- Chat with AI to understand workflow behavior

### ▶️ Workflow Executor Mode
- Execute workflows with real image capture
- AI analysis triggered automatically
- Real-time confidence scoring
- Manual review alerts

## Configuration Examples

### Timer Configuration
```json
{
  "name": "timed_reading",
  "maxTimeToFinish": 60,
  "elements": [
    {
      "type": "html",
      "html": "<div class='timer-alert'>⏱️ 60-second timer active</div>"
    }
  ]
}
```

### Multi-Image Analysis
```json
{
  "id": "multi_angle_analysis",
  "image_fields": ["front", "side", "reference"],
  "consensus_method": {
    "type": "weighted",
    "config": {
      "weights": {"front": 0.5, "side": 0.3, "reference": 0.2}
    }
  }
}
```

### Reference Range Application
```json
{
  "post_processing": [
    {
      "type": "apply_reference_ranges",
      "config": {
        "ranges": {
          "ph": {"min": 5.0, "max": 8.0, "normal": [6.0, 7.0]},
          "glucose": {"abnormal": ["1+", "2+", "3+", "4+"]}
        }
      }
    }
  ]
}
```

## Development Workflow

1. **Design Test Protocol**
   - Identify image capture points
   - Define timing requirements
   - Specify AI analysis needs

2. **Create Workflow JSON**
   - Use demo interface or manual creation
   - Test with sample images
   - Refine AI prompts and validation

3. **Deploy and Test**
   - Save to workflow_versions table
   - Execute in demo mode
   - Validate AI accuracy and timing

4. **Production Use**
   - Associate with test groups
   - Enable for live orders
   - Monitor performance and accuracy

## Troubleshooting

### Common Issues

1. **Workflow Not Displaying**
   - Check JSON format is valid
   - Ensure `ui.template` structure exists
   - Verify SurveyJS compatibility

2. **AI Analysis Failing**
   - Validate `ai_spec.steps` configuration
   - Check custom prompts for syntax
   - Ensure expected_output_schema matches

3. **Timer Not Working**
   - Verify `maxTimeToFinish` is numeric (seconds)
   - Check `showTimerPanel` configuration
   - Ensure page structure is correct

### Debugging Tools

- Use `/workflow-explainer-demo` for testing
- Check browser console for detailed errors
- Monitor Supabase function logs
- Validate JSON schemas before deployment

## Future Enhancements

- Visual workflow builder interface
- Template library for common test types
- Advanced consensus algorithms
- Integration with lab instruments
- Real-time collaboration features

This modular system provides unlimited flexibility for creating AI-powered test workflows while maintaining consistency and reliability across all test types.
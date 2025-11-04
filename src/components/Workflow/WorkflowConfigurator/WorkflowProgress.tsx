import React from 'react';

interface WorkflowProgressProps {
  currentStage: 'upload' | 'review' | 'approve';
}

const STAGES: Array<{ id: WorkflowProgressProps['currentStage']; label: string }> = [
  { id: 'upload', label: '1 · Upload Manual' },
  { id: 'review', label: '2 · Review & Finalize' },
  { id: 'approve', label: '3 · Approve & Publish' },
];

const WorkflowProgress: React.FC<WorkflowProgressProps> = ({ currentStage }) => {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between">
        {STAGES.map((stage, index) => {
          const isActive = stage.id === currentStage;
          const isCompleted = STAGES.findIndex((s) => s.id === currentStage) > index;

          return (
            <div key={stage.id} className="flex-1 flex items-center">
              <div
                className={`flex items-center justify-center h-10 w-10 rounded-full border text-sm font-semibold transition-colors ${
                  isActive
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : isCompleted
                    ? 'border-green-500 bg-green-500 text-white'
                    : 'border-gray-300 text-gray-500 bg-white'
                }`}
              >
                {stage.label.split('·')[0].trim()}
              </div>
              <div className="ml-3">
                <p className={`text-sm font-medium ${isActive ? 'text-blue-700' : 'text-gray-700'}`}>
                  {stage.label}
                </p>
              </div>
              {index < STAGES.length - 1 && (
                <div className="flex-1 mx-4 h-px bg-gray-200" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowProgress;

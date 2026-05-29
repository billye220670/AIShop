import type { Model } from '../../types';

interface ModelSelectorProps {
  models: Model[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export default function ModelSelector({ models, selectedModel, onModelChange }: ModelSelectorProps) {
  return (
    <select
      value={selectedModel}
      onChange={(e) => onModelChange(e.target.value)}
      className="bg-gray-700 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-600 focus:outline-none focus:border-blue-500 cursor-pointer"
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.provider} - {model.name}
        </option>
      ))}
    </select>
  );
}

import React, { useState } from 'react';
import { KeyframeDefinition } from '../types';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { generateId } from '../constants';

interface Props {
  keyframes: KeyframeDefinition[];
  onUpdate: (keyframes: KeyframeDefinition[]) => void;
}

const KeyframeEditor: React.FC<Props> = ({ keyframes, onUpdate }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', keyframes: '', description: '' });

  const handleAdd = () => {
    const newKeyframe: KeyframeDefinition = {
      id: generateId(),
      name: 'kf-custom',
      keyframes: '0% { transform: scale(1); }\n  100% { transform: scale(1.2); }',
      description: 'New animation',
    };
    onUpdate([...keyframes, newKeyframe]);
    startEdit(newKeyframe);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this keyframe?')) {
      onUpdate(keyframes.filter(kf => kf.id !== id));
    }
  };

  const startEdit = (kf: KeyframeDefinition) => {
    setEditingId(kf.id);
    setEditForm({
      name: kf.name,
      keyframes: kf.keyframes,
      description: kf.description || '',
    });
  };

  const saveEdit = () => {
    if (!editingId) return;

    onUpdate(
      keyframes.map(kf =>
        kf.id === editingId
          ? { ...kf, ...editForm }
          : kf
      )
    );
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Animation Keyframes</h2>
          <p className="text-sm text-gray-500 mt-1">
            Define CSS @keyframes animations for your pictograms
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors shadow-md"
        >
          <Plus size={16} /> New Keyframe
        </button>
      </div>

      <div className="space-y-4">
        {keyframes.map(kf => (
          <div
            key={kf.id}
            className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
          >
            {editingId === kf.id ? (
              // Edit Mode
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Keyframe Name
                    </label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full p-3 border border-gray-200 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="kf-custom-name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Description
                    </label>
                    <input
                      type="text"
                      value={editForm.description}
                      onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                      className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Animation description"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Keyframes CSS
                  </label>
                  <textarea
                    value={editForm.keyframes}
                    onChange={e => setEditForm({ ...editForm, keyframes: e.target.value })}
                    className="w-full p-4 border border-gray-200 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    rows={6}
                    placeholder="0% { transform: scale(1); }&#10;100% { transform: scale(1.2); }"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Define the animation steps. Don't include @keyframes {'{'}name{'}'} wrapper.
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X size={16} /> Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    <Check size={16} /> Save
                  </button>
                </div>
              </div>
            ) : (
              // View Mode
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold font-mono text-gray-900">{kf.name}</h3>
                    {kf.description && (
                      <p className="text-sm text-gray-500 mt-1">{kf.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(kf)}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(kf.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-lg p-4">
                  <pre className="text-sm font-mono text-gray-300 overflow-x-auto">
                    <span className="text-blue-400">@keyframes</span>{' '}
                    <span className="text-yellow-400">{kf.name}</span>{' '}
                    <span className="text-gray-300">{'{'}</span>
                    {'\n  '}
                    {kf.keyframes.split('\n').join('\n  ')}
                    {'\n'}
                    <span className="text-gray-300">{'}'}</span>
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}

        {keyframes.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
            <p className="text-gray-500 mb-4">No keyframes defined yet</p>
            <button
              onClick={handleAdd}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Plus size={16} /> Create First Keyframe
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KeyframeEditor;

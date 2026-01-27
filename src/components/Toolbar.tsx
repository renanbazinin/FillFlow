import React from 'react';
import { usePdf } from '../context/PdfContext';
import { Type, Check, X, Move, Download, Save } from 'lucide-react';
import { savePdf } from '../lib/pdf-utils';

export const Toolbar: React.FC = () => {
    const { selectedTool, setSelectedTool, setFile, file, annotations, refreshCheckpoints } = usePdf();

    const tools = [
        { id: 'move', icon: Move, label: 'Move' },
        { id: 'text', icon: Type, label: 'Text' },
        { id: 'check', icon: Check, label: 'Check' },
        { id: 'x', icon: X, label: 'X' },
    ] as const;

    const handleDownload = () => {
        if (file) {
            savePdf(file, annotations);
        }
    };

    const handleSaveCheckpoint = () => {
        const timestamp = new Date().toISOString();
        // Filter out circular ref or huge data if any, but annotations are simple JSON.
        const checkpoint = {
            fileName: file?.name,
            annotations,
            date: timestamp
        };

        const historyStr = localStorage.getItem('pdf-history');
        const history = historyStr ? JSON.parse(historyStr) : [];
        history.push(checkpoint);
        localStorage.setItem('pdf-history', JSON.stringify(history));
        alert(`Checkpoint saved! Total saved: ${history.length}`);
        refreshCheckpoints();
    };

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg px-6 py-3 flex items-center gap-4 z-50 border border-gray-200">
            <div className="flex items-center gap-2 border-r pr-4 border-gray-200">
                {tools.map((tool) => (
                    <button
                        key={tool.id}
                        onClick={() => setSelectedTool(tool.id)}
                        className={`p-2 rounded-full transition-colors ${selectedTool === tool.id
                            ? 'bg-blue-100 text-blue-600'
                            : 'hover:bg-gray-100 text-gray-600'
                            }`}
                        title={tool.label}
                    >
                        <tool.icon size={20} />
                    </button>
                ))}
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={handleSaveCheckpoint}
                    className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                    title="Save Checkpoint"
                >
                    <Save size={20} />
                </button>
                <button
                    onClick={handleDownload}
                    className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                    title="Download PDF"
                >
                    <Download size={20} />
                </button>
                <button
                    onClick={() => setFile(null)}
                    className="text-xs text-red-500 hover:text-red-700 ml-2"
                >
                    Reset
                </button>
            </div>
        </div>
    );
};

import React from 'react';
import { usePdf } from '../context/PdfContext';
import { Type, Check, X, Move, Download, Save } from 'lucide-react';
import { savePdf } from '../lib/pdf-utils';
import { SignatureModal } from './SignatureModal';

export const Toolbar: React.FC = () => {
    const [showSigModal, setShowSigModal] = React.useState(false);
    const { addAnnotation, file, selectedTool, setSelectedTool, setFile, annotations, refreshCheckpoints } = usePdf();

    const tools = [
        { id: 'move', icon: Move, label: 'Move' },
        { id: 'text', icon: Type, label: 'Text' },
        { id: 'check', icon: Check, label: 'Check' },
        { id: 'x', icon: X, label: 'X' },
    ] as const;

    const handleToolSelect = (id: string) => {
        if (id === 'signature') {
            setShowSigModal(true);
        } else {
            setSelectedTool(id as any);
        }
    };

    const handleAddSignature = (dataUrl: string) => {
        // Add signature annotation effectively immediately
        // We'll place it at center of current view or top-left of page 1
        // Ideally we enter "place" mode, but user asked for "white canvas then draw".
        // Let's add it to page 1 for now or find current visible page.
        // Simplifying: Add to page 1, center. User can move it.
        const id = crypto.randomUUID();
        const annotation = {
            id,
            type: 'image',
            x: 100,
            y: 100,
            width: 200,
            height: 100,
            page: 1,
            imageString: dataUrl,
        };
        addAnnotation(annotation as any);
        setSelectedTool('move'); // Switch to move tool so user can position it
    };

    const handleDownload = () => {
        if (file) {
            savePdf(file, annotations);
        }
    };

    const handleSaveCheckpoint = () => {
        const timestamp = new Date().toISOString();
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
        <>
            <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg px-6 py-3 flex items-center gap-4 z-50 border border-gray-200">
                <div className="flex items-center gap-2 border-r pr-4 border-gray-200">
                    {tools.map((tool) => (
                        <button
                            key={tool.id}
                            onClick={() => handleToolSelect(tool.id)}
                            className={`p-2 rounded-full transition-colors ${selectedTool === tool.id
                                ? 'bg-blue-100 text-blue-600'
                                : 'hover:bg-gray-100 text-gray-600'
                                }`}
                            title={tool.label}
                        >
                            <tool.icon size={20} />
                        </button>
                    ))}
                    {/* Signature Tool */}
                    <button
                        onClick={() => handleToolSelect('signature')}
                        className={`p-2 rounded-full transition-colors hover:bg-gray-100 text-gray-600`}
                        title="Signature"
                    >
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-serif italic font-bold">Sig</span>
                        </div>
                    </button>
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

            {showSigModal && (
                <SignatureModal
                    isOpen={showSigModal}
                    onClose={() => setShowSigModal(false)}
                    onSave={handleAddSignature}
                />
            )}
        </>
    );
};

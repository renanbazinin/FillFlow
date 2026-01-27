import React, { useState } from 'react';
import { usePdf } from '../context/PdfContext';
import { ChevronRight, ChevronLeft, Trash2, Edit3, CheckSquare, XSquare, Type, History, Layers, Clock, RotateCcw } from 'lucide-react';

export const Sidebar: React.FC = () => {
    const { annotations, removeAnnotation, selectedAnnotationId, setSelectedAnnotationId, checkpoints, restoreCheckpoint } = usePdf();
    const [isOpen, setIsOpen] = useState(true);
    const [activeTab, setActiveTab] = useState<'fields' | 'history'>('fields');

    const getIcon = (type: string) => {
        switch (type) {
            case 'text': return <Type size={16} />;
            case 'check': return <CheckSquare size={16} />;
            case 'x': return <XSquare size={16} />;
            default: return <Edit3 size={16} />;
        }
    };

    const getLabel = (ann: any) => {
        if (ann.type === 'text') return ann.content || 'Empty Text';
        return `${ann.type.toUpperCase()} (Page ${ann.page})`;
    };

    const formatDate = (isoString: string) => {
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString();
        } catch (e) {
            return isoString;
        }
    };

    return (
        <div
            className={`fixed top-0 right-0 h-full bg-white shadow-2xl transition-all duration-300 z-50 flex flex-col border-l border-gray-100 ${isOpen ? 'w-80 translate-x-0' : 'w-80 translate-x-full'}`}
        >
            {/* Toggle Button (Visible when closed too, but attached to sidebar) */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="absolute top-20 -left-10 bg-white p-2 rounded-l-md shadow-md border border-gray-200 border-r-0 hover:bg-gray-50 text-gray-600"
                title={isOpen ? "Close Sidebar" : "Open Sidebar"}
            >
                {isOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            </button>

            {/* Header */}
            <div className="p-5 border-b border-gray-100 bg-white">
                <h2 className="text-xl font-bold text-gray-800 tracking-tight">Tools & History</h2>
            </div>

            {/* Tabs */}
            <div className="flex p-2 bg-gray-50/50 gap-1">
                <button
                    className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-all duration-200 flex items-center justify-center gap-2 ${activeTab === 'fields'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
                    onClick={() => setActiveTab('fields')}
                >
                    <Layers size={16} /> Fields
                </button>
                <button
                    className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-all duration-200 flex items-center justify-center gap-2 ${activeTab === 'history'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
                    onClick={() => setActiveTab('history')}
                >
                    <History size={16} /> History
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/30">
                {activeTab === 'fields' ? (
                    annotations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                            <Layers size={48} className="mb-3 opacity-20" />
                            <p className="font-medium">No fields yet</p>
                            <p className="text-sm mt-1">Add text or marks to get started</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {annotations.map((ann) => (
                                <div
                                    key={ann.id}
                                    onClick={() => setSelectedAnnotationId(ann.id)}
                                    className={`group flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all duration-200 ${selectedAnnotationId === ann.id
                                        ? 'bg-blue-50/50 border-blue-500 shadow-sm ring-1 ring-blue-500/20'
                                        : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm'
                                        }`}
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className={`p-2 rounded-lg ${selectedAnnotationId === ann.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 group-hover:bg-blue-50 group-hover:text-blue-500'} transition-colors`}>
                                            {getIcon(ann.type)}
                                        </div>
                                        <div className="flex flex-col truncate">
                                            <span className="font-medium text-sm text-gray-700 truncate">{getLabel(ann)}</span>
                                            <span className="text-xs text-gray-400">Page {ann.page}</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeAnnotation(ann.id);
                                        }}
                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Delete"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )
                ) : (
                    // History Tab
                    checkpoints.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                            <History size={48} className="mb-3 opacity-20" />
                            <p className="font-medium">No history</p>
                            <p className="text-sm mt-1">Save changes to create a checkpoint</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {checkpoints.map((cp, idx) => (
                                <div key={idx} className="bg-white p-4 rounded-xl border border-gray-200 hover:border-blue-300 transition-all hover:shadow-md group">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-2 text-gray-600">
                                            <Clock size={14} />
                                            <span className="text-xs font-semibold">{formatDate(cp.date)}</span>
                                        </div>
                                        <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                            {cp.annotations?.length || 0} ITEMS
                                        </span>
                                    </div>

                                    <button
                                        onClick={() => {
                                            if (window.confirm('Restore this version? Unsaved changes will be lost.')) {
                                                restoreCheckpoint(cp);
                                            }
                                        }}
                                        className="w-full py-2 px-3 bg-blue-50 text-blue-600 text-xs font-bold rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-2 group-hover:scale-[1.02] active:scale-100"
                                    >
                                        <RotateCcw size={14} /> Restore Version
                                    </button>
                                </div>
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

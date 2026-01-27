import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Annotation, ToolType } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface PdfContextType {
    file: File | null;
    setFile: (file: File | null) => void;
    numPages: number;
    setNumPages: (num: number) => void;
    scale: number;
    setScale: (scale: number) => void;
    annotations: Annotation[];
    addAnnotation: (annotation: Omit<Annotation, 'id'>) => void;
    updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
    removeAnnotation: (id: string) => void;
    selectedTool: ToolType;
    setSelectedTool: (tool: ToolType) => void;
    selectedAnnotationId: string | null;
    setSelectedAnnotationId: (id: string | null) => void;
    checkpoints: any[];
    restoreCheckpoint: (checkpoint: any) => void;
    refreshCheckpoints: () => void;
}

const PdfContext = createContext<PdfContextType | undefined>(undefined);

export const PdfProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [file, setFile] = useState<File | null>(null);
    const [numPages, setNumPages] = useState<number>(0);
    const [scale, setScale] = useState<number>(1.0); // Viewer scale
    const [annotations, setAnnotations] = useState<Annotation[]>(() => {
        // Load from local storage on init
        const saved = localStorage.getItem('pdf-annotations');
        return saved ? JSON.parse(saved) : [];
    });
    const [selectedTool, setSelectedTool] = useState<ToolType>('move');
    const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
    const [checkpoints, setCheckpoints] = useState<any[]>([]);

    const refreshCheckpoints = useCallback(() => {
        if (!file) {
            setCheckpoints([]);
            return;
        }
        const historyStr = localStorage.getItem('pdf-history');
        const history = historyStr ? JSON.parse(historyStr) : [];
        // Filter by current file name and sort by date desc
        const filtered = history.filter((cp: any) => cp.fileName === file.name);
        setCheckpoints(filtered.reverse());
    }, [file]);

    React.useEffect(() => {
        refreshCheckpoints();
    }, [refreshCheckpoints]);

    const restoreCheckpoint = (checkpoint: any) => {
        if (checkpoint.annotations) {
            setAnnotations(checkpoint.annotations);
        }
    };

    // Save to local storage whenever annotations change
    React.useEffect(() => {
        localStorage.setItem('pdf-annotations', JSON.stringify(annotations));
    }, [annotations]);

    const addAnnotation = (annotation: Omit<Annotation, 'id'>) => {
        const newAnnotation = { ...annotation, id: uuidv4() };
        setAnnotations((prev) => [...prev, newAnnotation]);
    };

    const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
        setAnnotations((prev) =>
            prev.map((ann) => (ann.id === id ? { ...ann, ...updates } : ann))
        );
    };

    const removeAnnotation = (id: string) => {
        setAnnotations((prev) => prev.filter((ann) => ann.id !== id));
    };

    return (
        <PdfContext.Provider
            value={{
                file,
                setFile,
                numPages,
                setNumPages,
                scale,
                setScale,
                annotations,
                addAnnotation,
                updateAnnotation,
                removeAnnotation,
                selectedTool,
                setSelectedTool,
                selectedAnnotationId,
                setSelectedAnnotationId,
                checkpoints,
                restoreCheckpoint,
                refreshCheckpoints,
            }}
        >
            {children}
        </PdfContext.Provider>
    );
};

export const usePdf = () => {
    const context = useContext(PdfContext);
    if (!context) {
        throw new Error('usePdf must be used within a PdfProvider');
    }
    return context;
};

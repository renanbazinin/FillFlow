import React, { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { usePdf } from '../context/PdfContext';
import { PdfPage } from './PdfPage';

export const PdfViewer: React.FC = () => {
    const { file, setNumPages } = usePdf();
    const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [pages, setPages] = useState<pdfjsLib.PDFPageProxy[]>([]);
    const [loading, setLoading] = useState(false);
    const { setScale } = usePdf();

    useEffect(() => {
        const loadPdf = async () => {
            if (!file) return;

            setLoading(true);
            try {
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const doc = await loadingTask.promise;
                setPdfDocument(doc);
                setNumPages(doc.numPages);

                const loadedPages = [];
                for (let i = 1; i <= doc.numPages; i++) {
                    const page = await doc.getPage(i);
                    loadedPages.push(page);
                }
                setPages(loadedPages);

                // Auto-scale to fit width
                if (loadedPages.length > 0) {
                    const viewport = loadedPages[0].getViewport({ scale: 1.0 });
                    const availableWidth = window.innerWidth - 32; // -32 for padding
                    if (viewport.width > availableWidth) {
                        // setScale(availableWidth / viewport.width); // Need to access setScale from context, but usePdf is used inside component.
                        // We need to use setScale from wrapper or this component.
                        // usePdf provides setScale.
                    }
                }

            } catch (error) {
                console.error('Error loading PDF:', error);
                alert('Error loading PDF. Please try another file.');
            } finally {
                setLoading(false);
            }
        };

        loadPdf();
    }, [file, setNumPages]); // Warning: setScale missing dependent

    // Use another effect for scaling to avoid dependency cycle or just do it inside loadPdf if I can access setScale
    // I can access setScale from usePdf()
    // Auto-scale to fit width
    useEffect(() => {
        if (pages.length > 0) {
            const viewport = pages[0].getViewport({ scale: 1.0 });
            // Calculate available width. If fullscreen, use window.innerWidth.
            // Subtract padding (e.g. 32px or 40px)
            const availableWidth = window.innerWidth;

            // Set scale to fit width exactly (minus small padding)
            // But don't zoom out too much? No, user wants invalid fit.
            const newScale = (availableWidth - 32) / viewport.width;

            // Only update if significantly different to avoid infinite loops or jitter
            setScale(newScale);
        }
    }, [pages, setScale]);


    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                <span className="ml-4 text-xl">Loading PDF...</span>
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen bg-gray-100 pt-20 pb-10 overflow-auto">
            <div className="max-w-4xl mx-auto px-4">
                {pages.map((page, index) => (
                    <PdfPage key={index} page={page} pageNumber={index + 1} />
                ))}
            </div>
        </div>
    );
};

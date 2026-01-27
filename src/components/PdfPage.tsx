import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { AnnotationLayer } from './AnnotationLayer';
import { usePdf } from '../context/PdfContext';

// Set worker source
// Note: In Vite, we might need to copy the worker to public or import it.
// Trying dynamic import url first.
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PdfPageProps {
    page: pdfjsLib.PDFPageProxy;
    pageNumber: number;
}

export const PdfPage: React.FC<PdfPageProps> = ({ page, pageNumber }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { scale } = usePdf();
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

    useEffect(() => {
        let isCancelled = false;

        const renderPage = async () => {
            if (!canvasRef.current) return;

            // Cancel previous render
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }

            const viewport = page.getViewport({ scale: scale * 1.5 });
            setDimensions({ width: viewport.width / (scale * 1.5), height: viewport.height / (scale * 1.5) });

            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');

            if (!context) return;

            // Handle High DPI
            const pixelRatio = window.devicePixelRatio || 1;
            const actualScale = scale * pixelRatio;
            const renderViewport = page.getViewport({ scale: actualScale });

            canvas.width = renderViewport.width;
            canvas.height = renderViewport.height;

            // CSS size matches the scale
            canvas.style.width = `${renderViewport.width / pixelRatio}px`;
            canvas.style.height = `${renderViewport.height / pixelRatio}px`;

            const renderContext = {
                canvasContext: context,
                viewport: renderViewport,
            };

            try {
                // @ts-ignore - pdfjs types might be mismatching regarding 'canvas' property
                const renderTask = page.render(renderContext);
                renderTaskRef.current = renderTask;
                await renderTask.promise;
            } catch (error: any) {
                if (error.name !== 'RenderingCancelledException') {
                    console.error('Error rendering page:', error);
                }
            }

            if (isCancelled) return;

            const baseViewport = page.getViewport({ scale: 1.0 });
            setDimensions({ width: baseViewport.width, height: baseViewport.height });
        };

        renderPage();

        return () => {
            isCancelled = true;
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, [page, scale]);

    return (
        <div className="relative mb-8 shadow-md bg-white mx-auto" style={{ width: dimensions.width * scale, height: dimensions.height * scale }}>
            <canvas ref={canvasRef} className="block pointer-events-none" />
            <AnnotationLayer pageNumber={pageNumber} width={dimensions.width} height={dimensions.height} />
        </div>
    );
};

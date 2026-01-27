import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { Annotation } from '../types';

export const savePdf = async (file: File, annotations: Annotation[]) => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (const annotation of annotations) {
            const pageIndex = annotation.page - 1;
            if (pageIndex < 0 || pageIndex >= pages.length) continue;

            const page = pages[pageIndex];
            const { height } = page.getSize();

            // Coordinate conversion
            // PDF-lib uses (0,0) at bottom-left. 
            // Our UI uses (0,0) at top-left.
            // So y = height - annotation.y is close, but we need to account for annotation height too for text?
            // Actually, user click (x,y) is top-left of the annotation div.

            if (annotation.type === 'text' && annotation.content) {
                // Text needs font size
                const fontSize = 16; // matched UI roughly
                // const textHeight = fontSize; // verify - unused
                // pdf-lib drawText y is the baseline usually? No, it's bottom-left of text box.

                page.drawText(annotation.content, {
                    x: annotation.x,
                    y: height - annotation.y - (fontSize * 0.8), // adjustment for top-left vs bottom-left interaction
                    size: fontSize,
                    font: helveticaFont,
                    color: rgb(0, 0, 0),
                    maxWidth: annotation.width, // simplistic wrapping support if pdf-lib updates, or just clip
                });
            } else if (annotation.type === 'check') {
                // Draw a V shape or load an image? Drawing lines is easier/lighter than embedding SVG image for now.
                // Or just use a text "✓" with a font that supports it? Helvetica might not.
                // Let's draw 2 lines.
                const x = annotation.x;
                const y = height - annotation.y; // Top-left of the icon box (approx)

                // A check mark usually goes down then up-right. 
                // Let's assume 24x24 box.
                // Center is x+12, y-12.

                page.drawLine({
                    start: { x: x + 4, y: y - 14 },
                    end: { x: x + 10, y: y - 20 },
                    thickness: 3,
                    color: rgb(0, 0.6, 0.2), // Green
                });
                page.drawLine({
                    start: { x: x + 10, y: y - 20 },
                    end: { x: x + 20, y: y - 6 },
                    thickness: 3,
                    color: rgb(0, 0.6, 0.2), // Green
                });

            } else if (annotation.type === 'image' && annotation.imageString) {
                try {
                    const pngImage = await pdfDoc.embedPng(annotation.imageString);
                    const x = annotation.x;
                    const y = height - annotation.y - (annotation.height || 50); // Bottom-left of image

                    page.drawImage(pngImage, {
                        x: x,
                        y: y,
                        width: annotation.width || 200,
                        height: annotation.height || 100,
                    });
                } catch (e) {
                    console.error("Failed to embed image", e);
                }
            } else if (annotation.type === 'x') {
                const x = annotation.x;
                const y = height - annotation.y;

                // Draw X
                // 24x24 box

                page.drawLine({
                    start: { x: x + 4, y: y - 4 },
                    end: { x: x + 20, y: y - 20 },
                    thickness: 3,
                    color: rgb(0.8, 0, 0), // Red
                });
                page.drawLine({
                    start: { x: x + 4, y: y - 20 },
                    end: { x: x + 20, y: y - 4 },
                    thickness: 3,
                    color: rgb(0.8, 0, 0), // Red
                });
            }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `filled_${file.name}`;
        link.click();

    } catch (error) {
        console.error('Error saving PDF:', error);
        alert('Failed to save PDF.');
    }
};

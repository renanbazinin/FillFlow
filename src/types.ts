export type ToolType = 'text' | 'check' | 'x' | 'move' | 'image';

export interface Annotation {
    id: string;
    type: ToolType;
    x: number;
    y: number;
    width?: number; // for text or image
    height?: number; // for text or image
    content?: string; // for text
    imageString?: string; // for signature/image (Data URL)
    color?: string;
    page: number; // 1-based index
    scale?: number; // scale factor at creation time
}

export interface PdfState {
    file: File | null;
    numPages: number;
    scale: number;
    annotations: Annotation[];
    selectedTool: ToolType;
    isDragging: boolean;
}

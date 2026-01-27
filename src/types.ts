export type ToolType = 'text' | 'check' | 'x' | 'move';

export interface Annotation {
    id: string;
    type: ToolType;
    x: number;
    y: number;
    width?: number; // for text
    height?: number; // for text
    content?: string; // for text
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

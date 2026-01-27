import React, { useRef, useState } from 'react';
import { usePdf } from '../context/PdfContext';
import { Check, X, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface AnnotationLayerProps {
    pageNumber: number;
    width: number;
    height: number;
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
    pageNumber,
    width,
    height,
}) => {
    const {
        annotations,
        addAnnotation,
        updateAnnotation,
        removeAnnotation,
        selectedTool,
        scale,
        selectedAnnotationId,
        setSelectedAnnotationId,
    } = usePdf();

    const containerRef = useRef<HTMLDivElement>(null);
    // Lifted state: selectedId is now selectedAnnotationId from context
    const [resizeState, setResizeState] = useState<{ id: string, handle: string, startX: number, startY: number, startWidth: number, startHeight: number } | null>(null);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    const pageAnnotations = annotations.filter((a) => a.page === pageNumber);

    const handleMouseDown = (e: React.MouseEvent, id: string, x: number, y: number) => {
        e.stopPropagation();
        setSelectedAnnotationId(id);
        setDraggedId(id);
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) / scale;
            const mouseY = (e.clientY - rect.top) / scale;
            setDragOffset({ x: mouseX - x, y: mouseY - y });
        }
    };

    const handleResizeMouseDown = (e: React.MouseEvent, id: string, handle: string, width: number, height: number) => {
        e.stopPropagation();
        setSelectedAnnotationId(id);
        const startX = e.clientX;
        const startY = e.clientY;
        setResizeState({ id, handle, startX, startY, startWidth: width, startHeight: height });
    };

    const handleContainerClick = (e: React.MouseEvent) => {
        if (draggedId || resizeState) {
            setDraggedId(null);
            setResizeState(null);
            return;
        }

        // Deselect if clicking empty space
        setSelectedAnnotationId(null);

        if (selectedTool === 'move') return;

        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left) / scale;
            const y = (e.clientY - rect.top) / scale;

            if (selectedTool === 'text') {
                const id = uuidv4(); // Generate ID here to select it immediately
                addAnnotation({
                    id, // Need to allow passing ID or change addAnnotation signature. 
                    // Actually addAnnotation in context generates ID.
                    // Let's modify addAnnotation to return ID or accept it?
                    // For now, I'll let context generate it, and we might not auto-select immediately unless we change context.
                    // Simplest fix: Just allow addAnnotation as is, user clicks to select.
                    type: 'text',
                    x,
                    y,
                    page: pageNumber,
                    content: 'Text',
                    width: 200,
                    height: 50,
                } as any); // Type assertion because addAnnotation expects Omit<Annotation, 'id'>, but I want to control it? 
                // Context implementation says: const newAnnotation = { ...annotation, id: uuidv4() };
                // So I cannot pass ID. I will rely on context.
                // If I want to auto-select, I need context to return the new ID or update selection.
                // Let's ignore auto-select for now or fix context later.
            } else if (selectedTool === 'check' || selectedTool === 'x') {
                addAnnotation({
                    type: selectedTool,
                    x,
                    y,
                    page: pageNumber,
                    width: 24,
                    height: 24,
                });
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (resizeState) {
            const dx = (e.clientX - resizeState.startX) / scale;
            const dy = (e.clientY - resizeState.startY) / scale;

            if (resizeState.handle === 'se') {
                updateAnnotation(resizeState.id, {
                    width: Math.max(20, resizeState.startWidth + dx),
                    height: Math.max(20, resizeState.startHeight + dy)
                });
            }
            return;
        }

        if (draggedId && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left) / scale - dragOffset.x;
            const y = (e.clientY - rect.top) / scale - dragOffset.y;
            updateAnnotation(draggedId, { x, y });
        }
    };

    const handleMouseUp = () => {
        setDraggedId(null);
        setResizeState(null);
    };

    return (
        <div
            ref={containerRef}
            className="absolute top-0 left-0 z-10"
            style={{ width: width * scale, height: height * scale }}
            onClick={handleContainerClick}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {pageAnnotations.map((ann) => {
                const isSelected = selectedAnnotationId === ann.id;
                return (
                    <div
                        key={ann.id}
                        className={`absolute flex items-start group`}
                        style={{
                            left: ann.x * scale,
                            top: ann.y * scale,
                            transform: 'translate(-50%, -50%)',
                            zIndex: isSelected ? 30 : 20,
                            cursor: 'move',
                        }}
                        onMouseDown={(e) => handleMouseDown(e, ann.id, ann.x, ann.y)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            if (window.confirm('Delete this field?')) {
                                removeAnnotation(ann.id);
                            }
                        }}
                    >
                        <div className={`relative border-2 ${isSelected ? 'border-blue-500' : 'border-transparent group-hover:border-blue-300'} transition-colors`}>
                            {ann.type === 'text' && (
                                <textarea
                                    className="bg-transparent resize-none outline-none overflow-hidden font-sans"
                                    style={{
                                        fontSize: `${16 * scale}px`,
                                        width: ann.width ? ann.width * scale : 'auto',
                                        height: ann.height ? ann.height * scale : 'auto',
                                        minWidth: '50px',
                                        cursor: 'text',
                                    }}
                                    value={ann.content}
                                    onChange={(e) => updateAnnotation(ann.id, { content: e.target.value })}
                                />
                            )}
                            {ann.type === 'check' && <Check size={32 * scale} className="text-green-600" />}
                            {ann.type === 'x' && <X size={32 * scale} className="text-red-600" />}

                            {isSelected && ann.type === 'text' && (
                                <div
                                    className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-500 border border-white cursor-se-resize"
                                    onMouseDown={(e) => handleResizeMouseDown(e, ann.id, 'se', ann.width || 200, ann.height || 50)}
                                />
                            )}

                            {isSelected && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); removeAnnotation(ann.id); }}
                                    className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1 shadow-sm hover:scale-110 transition-transform"
                                >
                                    <Trash2 size={12} />
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

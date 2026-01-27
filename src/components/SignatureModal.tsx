import React, { useRef, useState, useEffect } from 'react';
import { X, Eraser, Save, Pen } from 'lucide-react';

interface SignatureModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (dataUrl: string) => void;
}

export const SignatureModal: React.FC<SignatureModalProps> = ({ isOpen, onClose, onSave }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [remember, setRemember] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    // Animation: delay visibility for smooth entrance
    useEffect(() => {
        if (isOpen) {
            // Small delay for animation
            requestAnimationFrame(() => setIsVisible(true));
        } else {
            setIsVisible(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Set canvas size
                canvas.width = 600;
                canvas.height = 300;

                // Set drawing styles
                ctx.strokeStyle = '#1e293b'; // Dark slate color
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // Clear with transparent background (don't fill white)
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }

            // Load saved signature if any
            const saved = localStorage.getItem('saved-signature');
            if (saved) {
                setRemember(true);
                const img = new Image();
                img.onload = () => {
                    ctx?.drawImage(img, 0, 0);
                };
                img.src = saved;
            }
        }
    }, [isOpen]);

    const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        setIsDrawing(true);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const pos = getPos(e, canvas);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const pos = getPos(e, canvas);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
    };

    const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let clientX, clientY;

        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // Clear to transparent
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const handleSave = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Export as PNG with transparent background
        const dataUrl = canvas.toDataURL('image/png');

        if (remember) {
            localStorage.setItem('saved-signature', dataUrl);
        } else {
            localStorage.removeItem('saved-signature');
        }

        onSave(dataUrl);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                backgroundColor: isVisible ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                transition: 'background-color 0.3s ease'
            }}
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div
                style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '16px',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                    maxWidth: '680px',
                    width: '100%',
                    transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)',
                    opacity: isVisible ? 1 : 0,
                    transition: 'transform 0.3s ease, opacity 0.3s ease'
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <Pen size={20} color="#fff" />
                        </div>
                        <h3 style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            color: '#1f2937',
                            margin: 0
                        }}>Add Signature</h3>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        <X size={24} color="#6b7280" />
                    </button>
                </div>

                {/* Canvas Area */}
                <div style={{
                    padding: '24px',
                    backgroundColor: '#f9fafb',
                    display: 'flex',
                    justifyContent: 'center'
                }}>
                    <div style={{
                        position: 'relative',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)'
                    }}>
                        {/* Checkered background to show transparency */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundImage: `
                                linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
                                linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
                                linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
                                linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)
                            `,
                            backgroundSize: '20px 20px',
                            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                            opacity: 0.5
                        }} />
                        <canvas
                            ref={canvasRef}
                            style={{
                                position: 'relative',
                                maxWidth: '100%',
                                height: 'auto',
                                cursor: 'crosshair',
                                touchAction: 'none',
                                display: 'block'
                            }}
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid #e5e7eb',
                    backgroundColor: '#ffffff',
                    borderRadius: '0 0 16px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        userSelect: 'none'
                    }}>
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                            style={{
                                width: '18px',
                                height: '18px',
                                accentColor: '#3b82f6'
                            }}
                        />
                        <span style={{ fontSize: '14px', color: '#4b5563', fontWeight: 500 }}>
                            Remember my signature
                        </span>
                    </label>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={clearCanvas}
                            style={{
                                padding: '10px 16px',
                                backgroundColor: '#f3f4f6',
                                color: '#374151',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 600,
                                fontSize: '14px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                        >
                            <Eraser size={18} /> Clear
                        </button>
                        <button
                            onClick={handleSave}
                            style={{
                                padding: '10px 20px',
                                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 600,
                                fontSize: '14px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                                transition: 'transform 0.2s, box-shadow 0.2s'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.4)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
                            }}
                        >
                            <Save size={18} /> Add Signature
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

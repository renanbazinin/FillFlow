import React from 'react';
import { usePdf } from '../context/PdfContext';
import { Upload } from 'lucide-react';

export const PdfUploader: React.FC = () => {
    const { setFile } = usePdf();

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
            <div className="p-10 border-2 border-dashed border-gray-300 rounded-lg bg-white shadow-sm hover:border-blue-500 transition-colors">
                <label className="flex flex-col items-center cursor-pointer">
                    <Upload className="w-12 h-12 text-gray-400 mb-4" />
                    <span className="text-xl font-medium text-gray-700">Upload PDF to Fill</span>
                    <span className="text-sm text-gray-500 mt-2">Drag & drop or click to browse</span>
                    <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                </label>
            </div>
        </div>
    );
};

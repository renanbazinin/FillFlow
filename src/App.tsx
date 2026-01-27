import React from 'react';
import { PdfProvider, usePdf } from './context/PdfContext';
import { PdfUploader } from './components/PdfUploader';
import { PdfViewer } from './components/PdfViewer';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';

const AppContent: React.FC = () => {
  const { file } = usePdf();

  return (
    <>
      {!file ? (
        <PdfUploader />
      ) : (
        <>
          <Toolbar />
          <Sidebar />
          <PdfViewer />
        </>
      )}
    </>
  );
};

function App() {
  return (
    <PdfProvider>
      <AppContent />
    </PdfProvider>
  );
}

export default App;

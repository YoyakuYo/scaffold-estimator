'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import Cookies from 'js-cookie';

// Dynamically import PDFViewer with SSR disabled to avoid DOMMatrix errors
const PDFViewer = dynamic(() => import('./pdf-viewer').then((mod) => mod.PDFViewer), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  ),
});

interface CADViewerProps {
  fileUrl: string;
  fileFormat: 'pdf' | 'dxf' | 'dwg' | 'jpg' | 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp';
}

export function CADViewer({ fileUrl, fileFormat }: CADViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const imageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const imageFormats = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    if (fileFormat === 'pdf') {
      setLoading(true);
      setError(null);
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      setImageUrl(null);
    } else if (imageFormats.includes(fileFormat)) {
      // For images, fetch with authentication and create blob URL
      setLoading(true);
      setError(null);
      
      const fetchImage = async () => {
        try {
          const token = Cookies.get('access_token');
          
          const response = await fetch(fileUrl, {
            headers: token ? {
              'Authorization': `Bearer ${token}`,
            } : {},
          });
          
          if (!response.ok) {
            throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
          }
          
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          
          // Cleanup old blob URL if exists
          if (imageUrlRef.current) {
            URL.revokeObjectURL(imageUrlRef.current);
          }
          
          imageUrlRef.current = blobUrl;
          setImageUrl(blobUrl);
          setLoading(false);
        } catch (err: any) {
          console.error('Error fetching image:', err);
          setError(`Failed to load image: ${err.message}`);
          setLoading(false);
        }
      };
      
      fetchImage();
    } else {
      // DXF/DWG viewing would require additional libraries
      setError('DXF/DWG形式の表示は現在準備中です。');
      setLoading(false);
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      setImageUrl(null);
    }
    
    // Cleanup blob URL on unmount or when URL changes
    return () => {
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
    };
  }, [fileUrl, fileFormat]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
  };

  const onDocumentLoadError = (error: Error) => {
    setError('PDFの読み込みに失敗しました。');
    setLoading(false);
    console.error(error);
  };

  const zoomIn = () => setScale((prev) => Math.min(prev + 0.2, 3.0));
  const zoomOut = () => setScale((prev) => Math.max(prev - 0.2, 0.5));
  const rotate = () => setRotation((prev) => (prev + 90) % 360);

  const imageFormats = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
  const isImage = imageFormats.includes(fileFormat);

  if (fileFormat !== 'pdf' && !isImage) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-lg">
        <div className="text-center">
          <p className="text-gray-600 mb-2">
            {fileFormat.toUpperCase()}形式の表示は準備中です
          </p>
          <p className="text-sm text-gray-500">
            現在はPDF形式と画像形式のみ対応しています
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-lg">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-gray-100 rounded-lg overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={zoomOut}
            className="p-2 hover:bg-gray-100 rounded"
            title="縮小"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">{Math.round(scale * 100)}%</span>
          <button
            onClick={zoomIn}
            className="p-2 hover:bg-gray-100 rounded"
            title="拡大"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={rotate}
            className="p-2 hover:bg-gray-100 rounded ml-2"
            title="回転"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        </div>
        {!isImage && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPageNumber((prev) => Math.max(prev - 1, 1))}
              disabled={pageNumber <= 1}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              前
            </button>
            <span className="text-sm">
              {pageNumber} / {numPages}
            </span>
            <button
              onClick={() => setPageNumber((prev) => Math.min(prev + 1, numPages))}
              disabled={pageNumber >= numPages}
              className="px-3 py-1 border rounded disabled:opacity-50"
            >
              次
            </button>
          </div>
        )}
      </div>

      {/* PDF or Image Viewer */}
      <div className="flex-1 overflow-auto p-4 flex justify-center">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        )}
        {isImage ? (
          <div className="flex items-center justify-center h-full relative">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Drawing"
                style={{
                  transform: `rotate(${rotation}deg) scale(${scale})`,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
                className="shadow-lg"
                onLoad={() => {
                  setLoading(false);
                  setError(null);
                }}
                onError={(e) => {
                  console.error('Image render error:', e);
                  setError('Failed to display image.');
                  setLoading(false);
                }}
              />
            ) : loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : null}
          </div>
        ) : (
          <PDFViewer
            fileUrl={fileUrl}
            scale={scale}
            rotation={rotation}
            pageNumber={pageNumber}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
          />
        )}
      </div>
    </div>
  );
}

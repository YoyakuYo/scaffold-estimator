'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, File, X, Loader2 } from 'lucide-react';
import { drawingsApi, ExtractedDimensions, ExtractionWarning, CadExtractionData } from '@/lib/api/drawings';

interface DrawingUploaderProps {
  projectId: string;
  onUploadSuccess?: (drawingId: string, fileName: string, extractedDimensions?: ExtractedDimensions | null, cadData?: CadExtractionData | null) => void;
  onUploadError?: (error: string) => void;
  /** Called with the raw File as soon as it's selected (before upload completes) */
  onRawFile?: (file: File) => void;
}

export function DrawingUploader({
  projectId,
  onUploadSuccess,
  onUploadError,
  onRawFile,
}: DrawingUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [extractedDims, setExtractedDims] = useState<ExtractedDimensions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      // Clear previous errors
      setError(null);

      // Validate file type
      const ext = file.name.split('.').pop()?.toLowerCase();
      const allowedFormats = ['pdf', 'dxf', 'dwg', 'jww', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'];
      if (!allowedFormats.includes(ext || '')) {
        const errorMsg = 'Unsupported file format. Accepted formats: PDF, DXF, DWG, JWW, JPG, PNG, GIF, WEBP, BMP, SVG, TIFF.';
        setError(errorMsg);
        onUploadError?.(errorMsg);
        return;
      }

      // Validate file size (100MB max)
      if (file.size > 100 * 1024 * 1024) {
        const errorMsg = 'File size too large. Maximum 100MB is supported.';
        setError(errorMsg);
        onUploadError?.(errorMsg);
        return;
      }

      setUploadedFile(file);
      setUploading(true);
      setError(null);

      // Notify parent with raw file immediately (for client-side parsing)
      onRawFile?.(file);

      try {
        const result = await drawingsApi.upload(file, projectId);
        setUploadComplete(true);
        setUploadedFileName(file.name);
        setExtractedDims(result.extractedDimensions || null);
        onUploadSuccess?.(result.id, file.name, result.extractedDimensions, result.cadData);
        // Keep the file visible to show success state
      } catch (error: any) {
        console.error('Upload error:', error);
        console.error('Error details:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          code: error.code,
        });
        
        // Extract detailed error message (in English)
        let errorMessage = 'Upload failed.';
        
        if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
          errorMessage = 'Cannot connect to server. Please check if the backend is running on port 3000.';
        } else if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        } else if (error.message) {
          errorMessage = error.message;
        } else if (error.response?.status === 400) {
          errorMessage = 'Invalid request. Please check file format or size (max 100MB).';
        } else if (error.response?.status === 401) {
          errorMessage = 'Authentication failed. Please log in again.';
        } else if (error.response?.status === 500) {
          errorMessage = 'Server error. Please check database configuration.';
        } else if (!error.response) {
          errorMessage = 'Cannot connect to server. Please check if the backend is running on port 3000.';
        }
        
        setError(errorMessage);
        onUploadError?.(errorMessage);
        setUploadedFile(null);
      } finally {
        setUploading(false);
      }
    },
    [projectId, onUploadSuccess, onUploadError, onRawFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/vnd.dxf': ['.dxf'],
      'application/dxf': ['.dxf'],
      'application/vnd.dwg': ['.dwg'],
      'application/x-dwg': ['.dwg'],
      'application/octet-stream': ['.jww', '.dwg', '.dxf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'image/bmp': ['.bmp'],
      'image/svg+xml': ['.svg'],
      'image/tiff': ['.tif', '.tiff'],
    },
    maxFiles: 1,
    disabled: uploading,
  });

  const removeFile = () => {
    setUploadedFile(null);
    setUploadComplete(false);
    setUploadedFileName(null);
    setExtractedDims(null);
  };

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Upload complete — show success state */}
      {uploadComplete && uploadedFileName ? (
        <div className={`border-2 rounded-lg p-4 ${
          extractedDims?.warnings?.some(w => w.level === 'error')
            ? 'border-amber-300 bg-amber-50'
            : 'border-green-300 bg-green-50'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                extractedDims?.warnings?.some(w => w.level === 'error')
                  ? 'bg-amber-100'
                  : 'bg-green-100'
              }`}>
                {extractedDims?.warnings?.some(w => w.level === 'error') ? (
                  <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div>
                <p className={`font-medium ${
                  extractedDims?.warnings?.some(w => w.level === 'error')
                    ? 'text-amber-900'
                    : 'text-green-900'
                }`}>
                  {extractedDims?.warnings?.some(w => w.level === 'error')
                    ? 'アップロード完了（低品質画像） / Upload Complete (Low Quality Image)'
                    : 'アップロード完了 / Upload Complete'}
                </p>
                <p className={`text-sm ${
                  extractedDims?.warnings?.some(w => w.level === 'error')
                    ? 'text-amber-700'
                    : 'text-green-700'
                }`}>{uploadedFileName}</p>
              </div>
            </div>
            <button
              onClick={removeFile}
              className="text-green-500 hover:text-green-700 text-sm underline"
            >
              別のファイル / Change
            </button>
          </div>
          {/* ── Quality Warnings ────────────────────────────── */}
          {extractedDims?.warnings && extractedDims.warnings.length > 0 && (
            <div className="mt-3 space-y-2">
              {extractedDims.warnings.map((warning, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-lg border ${
                    warning.level === 'error'
                      ? 'bg-red-50 border-red-300'
                      : warning.level === 'warning'
                      ? 'bg-amber-50 border-amber-300'
                      : 'bg-blue-50 border-blue-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5">
                      {warning.level === 'error' ? '🚫' : warning.level === 'warning' ? '⚠️' : 'ℹ️'}
                    </span>
                    <div className="flex-1">
                      <p className={`text-xs font-medium ${
                        warning.level === 'error' ? 'text-red-800' : warning.level === 'warning' ? 'text-amber-800' : 'text-blue-800'
                      }`}>
                        {warning.messageJa}
                      </p>
                      <p className={`text-xs mt-0.5 ${
                        warning.level === 'error' ? 'text-red-600' : warning.level === 'warning' ? 'text-amber-600' : 'text-blue-600'
                      }`}>
                        {warning.message}
                      </p>
                    </div>
                  </div>
                  {/* Resolution-specific guidance */}
                  {(warning.code === 'VERY_LOW_RESOLUTION' || warning.code === 'LOW_RESOLUTION') && (
                    <div className={`mt-2 pt-2 border-t text-xs ${
                      warning.level === 'error' ? 'border-red-200 text-red-700' : 'border-amber-200 text-amber-700'
                    }`}>
                      <p className="font-medium mb-1">📷 推奨アップロード条件 / Recommended Upload:</p>
                      <ul className="list-disc list-inside space-y-0.5 ml-1">
                        <li>画像の長辺: 2000px以上 / Long side: 2000px+</li>
                        <li>鮮明なスキャンまたは写真 / Clear scan or photo</li>
                        <li>寸法注記が読み取り可能 / Dimension annotations readable</li>
                      </ul>
                      {extractedDims.imageResolution && (
                        <p className="mt-1 font-medium">
                          現在の画像: {extractedDims.imageResolution.width}×{extractedDims.imageResolution.height}px
                          / Current: {extractedDims.imageResolution.width}×{extractedDims.imageResolution.height}px
                        </p>
                      )}
                    </div>
                  )}
                  {/* Low confidence guidance */}
                  {warning.code === 'LOW_OCR_CONFIDENCE' && (
                    <div className={`mt-2 pt-2 border-t text-xs ${
                      warning.level === 'error' ? 'border-red-200 text-red-700' : 'border-amber-200 text-amber-700'
                    }`}>
                      <p className="font-medium mb-1">💡 改善方法 / How to improve:</p>
                      <ul className="list-disc list-inside space-y-0.5 ml-1">
                        <li>高解像度の元ファイルをアップロード / Upload original high-res file</li>
                        <li>スキャン時にコントラストを上げる / Increase contrast when scanning</li>
                        <li>A3/A1図面は2000px以上で撮影 / Photograph A3/A1 drawings at 2000px+</li>
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Extraction Results (only show if no critical errors) ── */}
          {extractedDims && extractedDims.parsedDimensionsMm.length > 0 && !(extractedDims.warnings?.some(w => w.level === 'error')) ? (
            <div className="mt-3 p-3 bg-green-100 rounded-lg space-y-2">
              {/* Detection summary badges */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="inline-flex items-center px-2 py-0.5 bg-blue-100 border border-blue-300 rounded text-xs font-medium text-blue-800">
                  📄 {extractedDims.drawingType === 'section' ? '断面図 / Section' :
                       extractedDims.drawingType === 'elevation' ? '立面図 / Elevation' :
                       '平面図 / Floor Plan'}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 bg-purple-100 border border-purple-300 rounded text-xs font-medium text-purple-800">
                  📏 {extractedDims.detectedUnit === 'ft_in' ? 'フィート / Feet-Inches' :
                       extractedDims.detectedUnit === 'cm' ? 'センチ / Centimeters' :
                       extractedDims.detectedUnit === 'm' ? 'メートル / Meters' :
                       'ミリ / Millimeters'}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                  extractedDims.confidence >= 0.6
                    ? 'bg-green-100 border border-green-300 text-green-800'
                    : extractedDims.confidence >= 0.4
                    ? 'bg-yellow-100 border border-yellow-300 text-yellow-800'
                    : 'bg-red-100 border border-red-300 text-red-800'
                }`}>
                  🎯 {(extractedDims.confidence * 100).toFixed(0)}% OCR
                </span>
                {extractedDims.imageResolution && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs text-gray-700">
                    🖼️ {extractedDims.imageResolution.width}×{extractedDims.imageResolution.height}px
                  </span>
                )}
                {(extractedDims.viewCount ?? 1) > 1 && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-yellow-100 border border-yellow-300 rounded text-xs text-yellow-800">
                    📋 {extractedDims.viewCount} views detected
                  </span>
                )}
              </div>

              {/* Detected dimensions list */}
              <div>
                <p className="text-xs font-medium text-green-800 mb-1">
                  📐 検出された寸法 / Detected Dimensions ({extractedDims.parsedDimensionsMm.length}):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {extractedDims.rawDimensionTexts.slice(0, 12).map((dim, i) => (
                    <span key={i} className="inline-flex items-center px-2 py-0.5 bg-white border border-green-300 rounded text-xs text-green-900">
                      {dim} → {extractedDims.parsedDimensionsMm[i]?.toLocaleString()}mm
                    </span>
                  ))}
                  {extractedDims.rawDimensionTexts.length > 12 && (
                    <span className="inline-flex items-center px-2 py-0.5 bg-green-200 rounded text-xs text-green-800">
                      +{extractedDims.rawDimensionTexts.length - 12} more
                    </span>
                  )}
                </div>
              </div>

              {/* Wall assignment summary */}
              {extractedDims.walls.north && (
                <div className="p-2 bg-white rounded border border-green-200">
                  <p className="text-xs font-medium text-green-800 mb-1">✅ 自動入力 / Auto-populated:</p>
                  <div className="grid grid-cols-2 gap-1 text-xs text-green-700">
                    {extractedDims.walls.north && (
                      <span>
                        北/南 N/S: {extractedDims.walls.north.lengthMm.toLocaleString()}mm
                        {extractedDims.parsedDimensionsMm.length > 2 && (
                          <span className="text-green-600 ml-1">(複数セグメント検出 / multi-segment)</span>
                        )}
                      </span>
                    )}
                    {extractedDims.walls.east && (
                      <span>
                        東/西 E/W: {extractedDims.walls.east.lengthMm.toLocaleString()}mm
                        {extractedDims.parsedDimensionsMm.length > 2 && (
                          <span className="text-green-600 ml-1">(複数セグメント検出 / multi-segment)</span>
                        )}
                      </span>
                    )}
                  </div>
                  {extractedDims.parsedDimensionsMm.length > 4 && (
                    <p className="text-xs text-green-600 mt-1">
                      💡 複数の壁セグメントを検出し、合計長を計算しました / Multiple wall segments detected and summed
                    </p>
                  )}
                </div>
              )}

              {/* Building height from section */}
              {extractedDims.buildingHeightMm ? (
                <div className="p-2 bg-green-50 border border-green-300 rounded">
                  <p className="text-xs font-medium text-green-800">
                    🏗️ 建物高さ検出（実測値） / Building height (measured): {extractedDims.buildingHeightMm.toLocaleString()}mm
                  </p>
                  <p className="text-xs text-green-700 mt-0.5">
                    ✓ 断面図/立面図から実際の寸法を検出しました / Actual dimension extracted from section/elevation view
                  </p>
                  <p className="text-xs text-green-600 mt-0.5">
                    壁高に自動入力済み / Auto-filled to wall heights
                  </p>
                </div>
              ) : extractedDims.estimatedBuildingHeightMm ? (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded">
                  <p className="text-xs font-medium text-amber-800">
                    🏢 推定 {extractedDims.estimatedFloorCount || 1}階建て → 推定高さ: {extractedDims.estimatedBuildingHeightMm.toLocaleString()}mm
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    ⚠️ 平面図から階数を推定しました（実測値ではありません）/ Estimated from floor count (not actual measurement)
                  </p>
                  <p className="text-xs text-amber-500 mt-0.5">
                    Est. {extractedDims.estimatedFloorCount || 1}F → {extractedDims.estimatedBuildingHeightMm.toLocaleString()}mm — 壁高に自動入力済み（下の設定で調整可能）
                  </p>
                </div>
              ) : (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded">
                  <p className="text-xs font-medium text-amber-800">
                    ⚠️ 高さは平面図から取得できません / Height not available in floor plan
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    下の壁面設定で各壁の高さを入力してください。目安: 1階=3,900mm, 2階=6,900mm, 3階=9,900mm
                  </p>
                  <p className="text-xs text-amber-500 mt-0.5">
                    Enter wall height below. Guide: 1F=3,900mm, 2F=6,900mm, 3F=9,900mm
                  </p>
                </div>
              )}
            </div>
          ) : extractedDims?.warnings?.some(w => w.level === 'error') ? (
            /* Error state: critical warnings present — show manual input prompt */
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs font-medium text-red-800">
                🚫 自動検出に失敗しました / Automatic detection failed
              </p>
              <p className="text-xs text-red-600 mt-1">
                寸法を検出できませんでした。下記の方法をお試しください:
              </p>
              <ul className="text-xs text-red-600 mt-1 list-disc list-inside ml-1 space-y-0.5">
                <li>正しいCADファイル（DXF/DWG/JWW）を再アップロード</li>
                <li>外周線が含まれるレイヤーを確認</li>
                <li>下記のフォームに手動で壁の寸法を入力</li>
              </ul>
              <p className="text-xs text-red-500 mt-1.5">
                Could not detect dimensions. Try: re-upload a valid CAD file (DXF/DWG/JWW), verify the outer perimeter layer is present, or enter wall dimensions manually below.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-green-600">
              ※ 寸法が検出されませんでした。下記のフォームに手動で値を入力してください。
              <br />Dimensions not detected. Please enter values manually below.
            </p>
          )}
        </div>
      ) : !uploadedFile ? (
        /* No file selected — show dropzone */
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-colors
            ${
              isDragActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }
            ${uploading ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input {...getInputProps()} />
          <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <p className="text-lg font-medium text-gray-700 mb-2">
            {isDragActive
              ? 'ファイルをここにドロップ'
              : '図面ファイルをアップロード'}
          </p>
          <p className="text-sm text-gray-500">
            対応形式：PDF、DXF、DWG、JWW、JPG、PNG、GIF、WEBP、BMP、SVG、TIFF（最大100MB）
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Accepted formats: PDF, DXF, DWG, JWW, JPG, PNG, GIF, WEBP, BMP, SVG, TIFF (max 100MB)
          </p>
          <p className="text-xs text-gray-400 mt-2">
            クリックまたはドラッグ＆ドロップでファイルを選択
          </p>
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-400 font-medium">
              📐 ファイルのヒント / File Tips:
            </p>
            <p className="text-xs text-gray-400 mt-1">
              DWG・JWWはDXFに自動変換。PDFは寸法テキストを解析します / DWG & JWW auto-convert to DXF. PDF dimensions are parsed from text.
            </p>
          </div>
        </div>
      ) : (
        /* File selected, uploading in progress */
        <div className="border rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <File className="h-8 w-8 text-blue-500" />
              <div>
                <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                <p className="text-sm text-gray-500">
                  {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            ) : (
              <button
                onClick={removeFile}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
          {uploading && (
            <div className="mt-4">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-[progress_90s_ease-in-out_forwards]" style={{ width: '0%' }}></div>
              </div>
              <p className="text-sm text-gray-600 mt-2 text-center">
                処理中... CADファイルを解析しています
              </p>
              <p className="text-xs text-gray-400 mt-1 text-center">
                Processing... Parsing CAD geometry and extracting wall segments (may take 1-2 minutes)
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

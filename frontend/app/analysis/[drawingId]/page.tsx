'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * Legacy analysis page — redirects to the new scaffold calculator.
 * The old drawing-based analysis flow has been replaced by the
 * unified scaffold page at /scaffold (manual or auto mode).
 */
export default function AnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const drawingId = params.drawingId as string;

  useEffect(() => {
    // Redirect to new scaffold page
    router.replace('/scaffold');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-500 mb-4">新しい足場積算ページへ移動します...</p>
        <button
          onClick={() => router.push('/scaffold')}
          className="text-blue-600 hover:underline"
        >
          足場積算ページへ
        </button>
      </div>
    </div>
  );
}

import { Suspense } from 'react';
import { ResetPasswordClient } from './reset-password-client';
import { Loader2 } from 'lucide-react';

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        }
      >
        <ResetPasswordClient />
      </Suspense>
    </div>
  );
}

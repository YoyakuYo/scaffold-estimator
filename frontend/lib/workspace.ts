'use client';

import { usePathname } from 'next/navigation';
import type { ProductCode } from '@/lib/api/access';

export function parseWorkspaceFromPathname(pathname: string): ProductCode | null {
  const m = pathname.match(/^\/w\/(scaffold|bim|construction_plan)(?:\/|$)/);
  if (!m) return null;
  return m[1] as ProductCode;
}

export function workspaceBasePath(workspace: ProductCode | null): string {
  return workspace ? `/w/${workspace}` : '';
}

/** Client hook: returns active workspace (from /w/<workspace>/...) and base path prefix. */
export function useWorkspacePath() {
  const pathname = usePathname();
  const workspace = parseWorkspaceFromPathname(pathname);
  const base = workspaceBasePath(workspace);
  return { workspace, base, pathname };
}


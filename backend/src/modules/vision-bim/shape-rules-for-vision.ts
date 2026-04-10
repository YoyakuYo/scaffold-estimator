/**
 * Loads {@link ../../../docs/SHAPE_RULES_AND_AI_EXTRACTION.md} for Claude vision prompts
 * (footprint shape classification, anti-hallucination, vertex/wall rules).
 * Falls back to an embedded summary if the file is missing in the deployed bundle.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Cap appended prompt size (tokens/cost); full doc is ~15–25k chars. */
const MAX_CHARS = 22_000;

const FALLBACK_SHAPE_RULES = `SHAPE_RULES (fallback — add docs/SHAPE_RULES_AND_AI_EXTRACTION.md to deployment for full text):
- Rectangle: 4 vertices, 4 walls, opposite sides equal.
- L-shape: 6 vertices, 6 walls, 1 reflex (270°) corner — never simplify to 4 vertices.
- U-shape: 8 vertices, 8 walls, 2 reflex corners (courtyard).
- T-shape: 8 vertices, 8 walls, 2 reflex corners (stem meets bar).
- Cross/plus: 12 vertices, 4 reflex corners.
- Irangled: extract actual vertices; no bogus regularization.
- Vertex count = wall count for a closed polygon. One wall per straight edge; height changes use wallHeightsMm / massingTiers, not extra vertices.
- Orthogonal closure: sum(rightward edges)=sum(leftward); sum(downward)=sum(upward).
- Reflex corners for orthogonal N-gon: (N-4)/2 expected.
- Terraces/balconies without structural outer wall: EXCLUDE from polygon; use obstacle balcony if needed.
- Doors on exterior: obstacles type door. Interior doors: ignore.
- 3D view: perspective silhouette ≠ footprint; infer top-down; stepped massing → massingTiers.
- Common errors: tracing perspective as polygon; interior walls; grid lines as vertices; splitting height into extra corners.
`;

function tryLoadFromDisk(): string | null {
  const candidates = [
    join(process.cwd(), 'docs', 'SHAPE_RULES_AND_AI_EXTRACTION.md'),
    join(process.cwd(), '..', 'docs', 'SHAPE_RULES_AND_AI_EXTRACTION.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

let cached: string | null = null;

/**
 * Markdown from the repo doc (truncated), or fallback summary.
 * Call once at module load; result is cached.
 */
export function getShapeRulesForVisionPrompt(): string {
  if (cached !== null) return cached;
  const raw = tryLoadFromDisk();
  let text = raw ?? FALLBACK_SHAPE_RULES;
  if (text.length > MAX_CHARS) {
    text =
      text.slice(0, MAX_CHARS) +
      '\n\n[SHAPE_RULES truncated for API size — see docs/SHAPE_RULES_AND_AI_EXTRACTION.md in repository for full text.]';
  }
  cached = text;
  return cached;
}

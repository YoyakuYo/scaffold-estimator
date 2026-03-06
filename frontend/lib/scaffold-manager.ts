/**
 * ScaffoldManager — State handler for AI BIM Mode and level-based visualization.
 * Operates independently and feeds results into the existing estimator core.
 * Does not replace or refactor the current calculation engine.
 */

import type {
  BuildingGraphData,
  FootprintVertex,
} from './building-graph';
import { buildGraphFromFootprint, graphToWallInputs } from './building-graph';
import type { WallInput } from '@/lib/api/scaffold-configs';

export interface ScaffoldManagerState {
  /** Source: 'manual' | 'upload' | 'ai_bim' */
  inputSource: 'manual' | 'upload' | 'ai_bim';
  /** When inputSource === 'ai_bim', the graph from vision/footprint */
  buildingGraph: BuildingGraphData | null;
  /** Building height (mm) */
  buildingHeightMm: number;
  /** Number of levels to display (1 = Level 1 only, 2 = L1+L2, etc.) */
  visibleLevels: number;
  /** Max levels from last calculation (so we can cap visibleLevels) */
  maxLevels: number;
}

const initialState: ScaffoldManagerState = {
  inputSource: 'manual',
  buildingGraph: null,
  buildingHeightMm: 0,
  visibleLevels: 1,
  maxLevels: 1,
};

export class ScaffoldManager {
  private state: ScaffoldManagerState = { ...initialState };

  getState(): Readonly<ScaffoldManagerState> {
    return this.state;
  }

  setInputSource(source: 'manual' | 'upload' | 'ai_bim'): void {
    this.state = { ...this.state, inputSource: source };
  }

  setBuildingGraph(graph: BuildingGraphData | null): void {
    this.state = { ...this.state, buildingGraph: graph };
  }

  setBuildingHeightMm(mm: number): void {
    this.state = { ...this.state, buildingHeightMm: mm };
  }

  setVisibleLevels(levels: number): void {
    this.state = {
      ...this.state,
      visibleLevels: Math.max(1, Math.min(levels, this.state.maxLevels)),
    };
  }

  setMaxLevels(max: number): void {
    this.state = { ...this.state, maxLevels: Math.max(1, max) };
  }

  /** Add one level to visible (e.g. "+ Add Level" button). */
  addVisibleLevel(): void {
    this.setVisibleLevels(this.state.visibleLevels + 1);
  }

  /**
   * Inject footprint from vision/BIM pipeline and build graph.
   * Returns wall inputs suitable for createAndCalculate (existing API).
   */
  injectFootprintAndGetWalls(
    vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
    buildingHeightMm: number,
    refLengthMm?: number,
  ): { walls: WallInput[]; buildingOutline: FootprintVertex[] } {
    const graph = buildGraphFromFootprint(vertices, refLengthMm);
    this.state = {
      ...this.state,
      buildingGraph: graph,
      buildingHeightMm,
      inputSource: 'ai_bim',
    };
    const walls: WallInput[] = graphToWallInputs(graph, buildingHeightMm).map(
      (w) => ({
        side: w.side,
        wallLengthMm: w.wallLengthMm,
        wallHeightMm: w.wallHeightMm,
        stairAccessCount: w.stairAccessCount,
      }),
    );
    const buildingOutline = graph.polygonVertices ?? [];
    return { walls, buildingOutline };
  }

  reset(): void {
    this.state = { ...initialState };
  }
}

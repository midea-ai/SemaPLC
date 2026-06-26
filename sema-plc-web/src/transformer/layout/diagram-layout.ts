/**
 * Diagram Layout Algorithm
 *
 * Positions all rungs in a complete ladder diagram.
 * Rungs are stacked vertically with appropriate spacing.
 */

import type { LadderIR } from '../ladder-ir';
import {
  layoutRung,
  resetLayoutIdCounter,
  RUNG_VERTICAL_GAP,
  type LayoutNode,
  type LayoutEdge,
  type RungLayout,
} from './rung-layout';

// ============================================================================
// Layout Result Types
// ============================================================================

export interface DiagramLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  rungLayouts: RungLayout[];
  totalWidth: number;
  totalHeight: number;
}

// ============================================================================
// Main Layout Function
// ============================================================================

export function layoutDiagram(ir: LadderIR): DiagramLayout {
  // Reset the ID counter for consistent IDs
  resetLayoutIdCounter();

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const rungLayouts: RungLayout[] = [];

  let currentY = 0;
  let maxWidth = 0;

  for (const rung of ir.rungs) {
    const rungLayout = layoutRung(rung, currentY);

    // Collect all nodes and edges
    nodes.push(...rungLayout.nodes);
    edges.push(...rungLayout.edges);
    rungLayouts.push(rungLayout);

    // Update tracking variables
    maxWidth = Math.max(maxWidth, rungLayout.width);
    currentY += rungLayout.height + RUNG_VERTICAL_GAP;
  }

  return {
    nodes,
    edges,
    rungLayouts,
    totalWidth: maxWidth,
    totalHeight: currentY - RUNG_VERTICAL_GAP, // Remove last gap
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the nodes for a specific rung by index
 */
export function getNodesForRung(layout: DiagramLayout, rungIndex: number): LayoutNode[] {
  return layout.nodes.filter(node => {
    const data = node.data as { rungIndex?: number };
    return data.rungIndex === rungIndex;
  });
}

/**
 * Get the edges for a specific rung by rung ID prefix
 */
export function getEdgesForRung(layout: DiagramLayout, rungId: string): LayoutEdge[] {
  return layout.edges.filter(edge => edge.id.startsWith(rungId));
}

/**
 * Calculate the bounding box for the entire diagram
 */
export function getDiagramBounds(layout: DiagramLayout): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (layout.nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of layout.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Center the diagram around origin
 */
export function centerDiagram(layout: DiagramLayout): DiagramLayout {
  const bounds = getDiagramBounds(layout);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const centeredNodes = layout.nodes.map(node => ({
    ...node,
    x: node.x - centerX,
    y: node.y - centerY,
  }));

  return {
    ...layout,
    nodes: centeredNodes,
  };
}

/**
 * Apply padding to the diagram
 */
export function addPadding(layout: DiagramLayout, padding: number): DiagramLayout {
  const paddedNodes = layout.nodes.map(node => ({
    ...node,
    x: node.x + padding,
    y: node.y + padding,
  }));

  return {
    ...layout,
    nodes: paddedNodes,
    totalWidth: layout.totalWidth + padding * 2,
    totalHeight: layout.totalHeight + padding * 2,
  };
}

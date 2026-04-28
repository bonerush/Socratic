import type { SessionState, ConceptState } from '../types';

export interface ConceptGraphReport {
  /** Concepts with no dependencies and no dependents */
  isolatedConcepts: string[];
  /** Dependencies that point to non-existent concept IDs */
  missingDependencies: { conceptId: string; missingId: string }[];
  /** Maximum depth of the dependency tree */
  maxDependencyDepth: number;
  /** Depth of each concept (0 = root) */
  conceptDepths: Map<string, number>;
  /** Concepts ordered by dependency depth (topological-ish) */
  learningOrderSuggestion: string[];
  /** Mermaid diagram source for the dependency graph */
  mermaidDiagram: string;
}

/**
 * Analyzes concept dependencies within a session.
 * Detects structural issues like isolated concepts, missing dependencies,
 * and dependency cycles (complementing SessionDebugger's cycle detection).
 */
export class ConceptGraphBuilder {
  build(state: SessionState): ConceptGraphReport {
    const concepts = state.concepts;
    const conceptMap = new Map(concepts.map((c) => [c.id, c]));

    const isolatedConcepts = this.findIsolatedConcepts(concepts);
    const missingDependencies = this.findMissingDependencies(concepts, conceptMap);
    const conceptDepths = this.computeDepths(concepts);
    const maxDependencyDepth = Math.max(0, ...conceptDepths.values());
    const learningOrderSuggestion = this.suggestLearningOrder(concepts, conceptDepths);
    const mermaidDiagram = this.generateMermaidDiagram(concepts, state.currentConceptId);

    return {
      isolatedConcepts,
      missingDependencies,
      maxDependencyDepth,
      conceptDepths,
      learningOrderSuggestion,
      mermaidDiagram,
    };
  }

  private findIsolatedConcepts(concepts: ConceptState[]): string[] {
    const dependents = new Set<string>();
    for (const c of concepts) {
      for (const dep of c.dependencies) {
        dependents.add(dep);
      }
    }
    return concepts
      .filter((c) => c.dependencies.length === 0 && !dependents.has(c.id))
      .map((c) => c.name);
  }

  private findMissingDependencies(
    concepts: ConceptState[],
    conceptMap: Map<string, ConceptState>,
  ): { conceptId: string; missingId: string }[] {
    const missing: { conceptId: string; missingId: string }[] = [];
    for (const c of concepts) {
      for (const dep of c.dependencies) {
        if (!conceptMap.has(dep)) {
          missing.push({ conceptId: c.id, missingId: dep });
        }
      }
    }
    return missing;
  }

  private computeDepths(concepts: ConceptState[]): Map<string, number> {
    const depths = new Map<string, number>();
    const conceptMap = new Map(concepts.map((c) => [c.id, c]));

    const getDepth = (id: string, visited: Set<string>): number => {
      if (depths.has(id)) return depths.get(id)!;
      if (visited.has(id)) return 0; // Cycle guard
      visited.add(id);

      const concept = conceptMap.get(id);
      if (!concept || concept.dependencies.length === 0) {
        depths.set(id, 0);
        visited.delete(id);
        return 0;
      }

      const maxParentDepth = Math.max(
        ...concept.dependencies.map((dep) => getDepth(dep, visited)),
      );
      const depth = maxParentDepth + 1;
      depths.set(id, depth);
      visited.delete(id);
      return depth;
    };

    for (const c of concepts) {
      if (!depths.has(c.id)) {
        getDepth(c.id, new Set());
      }
    }

    return depths;
  }

  private suggestLearningOrder(
    concepts: ConceptState[],
    depths: Map<string, number>,
  ): string[] {
    return [...concepts]
      .sort((a, b) => {
        const depthDiff = (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0);
        if (depthDiff !== 0) return depthDiff;
        return a.name.localeCompare(b.name);
      })
      .map((c) => c.name);
  }

  private generateMermaidDiagram(concepts: ConceptState[], currentId: string | null): string {
    const lines: string[] = ['graph TD'];
    const statusStyle: Record<string, string> = {
      pending: '#9ca3af',
      learning: '#3b82f6',
      mastered: '#22c55e',
      skipped: '#ef4444',
    };

    for (const c of concepts) {
      const color = statusStyle[c.status] ?? '#9ca3af';
      const isCurrent = c.id === currentId;
      const label = isCurrent ? `${c.name} ★` : c.name;
      const style = isCurrent ? 'stroke-width:2px,stroke:#f59e0b' : `fill:${color},color:#fff`;
      lines.push(`    ${c.id}["${label}"]:::${c.status}`);
      lines.push(`    style ${c.id} ${style}`);
    }

    for (const c of concepts) {
      for (const dep of c.dependencies) {
        lines.push(`    ${dep} --> ${c.id}`);
      }
    }

    lines.push('    classDef pending fill:#9ca3af,color:#fff');
    lines.push('    classDef learning fill:#3b82f6,color:#fff');
    lines.push('    classDef mastered fill:#22c55e,color:#fff');
    lines.push('    classDef skipped fill:#ef4444,color:#fff');

    return lines.join('\n');
  }
}

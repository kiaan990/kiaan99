// Grade computation logic for Phase 4 — Grade Intelligence

export const GRADE_THRESHOLDS: [number, string][] = [
  [97, "A+"],
  [93, "A"],
  [90, "A-"],
  [87, "B+"],
  [83, "B"],
  [80, "B-"],
  [77, "C+"],
  [73, "C"],
  [70, "C-"],
  [67, "D+"],
  [63, "D"],
  [60, "D-"],
  [0, "F"],
];

export const LETTER_GRADE_POINTS: Record<string, number> = {
  "A+": 4.0, A: 4.0, "A-": 3.7,
  "B+": 3.3, B: 3.0, "B-": 2.7,
  "C+": 2.3, C: 2.0, "C-": 1.7,
  "D+": 1.3, D: 1.0, "D-": 0.7,
  F: 0.0,
};

export function percentToLetter(pct: number): string {
  for (const [threshold, letter] of GRADE_THRESHOLDS) {
    if (pct >= threshold) return letter;
  }
  return "F";
}

export interface ItemData {
  id: string;
  title: string;
  type: string;
  dueDate: Date | null;
  weight: number | null;
  earnedPoints: number | null;
  maxPoints: number | null;
}

export interface ComponentData {
  id: string;
  name: string;
  weight: number;
  items: ItemData[];
}

export interface CourseGradeResult {
  courseId: string;
  courseName: string;
  courseCode: string | null;
  currentGrade: number | null;
  currentLetter: string | null;
  projectedFinal: number | null;
  projectedLetter: string | null;
  neededForTarget: Record<string, number | null>;
  gradedWeightFraction: number;
  components: ComponentGradeResult[];
  swingItems: SwingItem[];
}

export interface ComponentGradeResult {
  name: string;
  weight: number;
  earnedFraction: number | null;
  items: ItemGradeResult[];
}

export interface ItemGradeResult {
  id: string;
  title: string;
  type: string;
  dueDate: string | null;
  weight: number;
  earnedPoints: number | null;
  maxPoints: number | null;
  percentage: number | null;
  isGraded: boolean;
}

export interface SwingItem {
  id: string;
  title: string;
  weight: number;
  currentProjected: string;
  projectedIf100: string;
  projectedIf0: string;
  canSwingLetter: boolean;
}

const DEFAULT_TYPE_WEIGHT: Record<string, number> = {
  exam: 0.20,
  project: 0.15,
  assignment: 0.10,
  quiz: 0.05,
  reading: 0.04,
  other: 0.08,
};

function resolveItemWeights(components: ComponentData[]): Map<string, number> {
  const weights = new Map<string, number>();

  for (const comp of components) {
    if (comp.items.length === 0) continue;

    // Count items that have an explicit weight
    const explicitItems = comp.items.filter((i) => i.weight != null);
    const implicitItems = comp.items.filter((i) => i.weight == null);

    // Sum of explicit weights — remaining goes to implicit items equally
    const explicitSum = explicitItems.reduce((s, i) => s + (i.weight ?? 0), 0);
    const implicitEach =
      implicitItems.length > 0
        ? Math.max(0, comp.weight - explicitSum) / implicitItems.length
        : 0;

    for (const item of comp.items) {
      weights.set(item.id, item.weight ?? implicitEach);
    }
  }

  return weights;
}

function matchItemToComponent(
  item: ItemData,
  components: ComponentData[]
): ComponentData | null {
  const titleLower = item.title.toLowerCase();
  let best: { comp: ComponentData; score: number } | null = null;

  for (const comp of components) {
    const words = comp.name.toLowerCase().split(/\s+/);
    const score = words.filter((w) => w.length > 3 && titleLower.includes(w)).length;
    // Also match by type keyword
    const typeScore =
      (item.type !== "other" && comp.name.toLowerCase().includes(item.type)) ? 1 : 0;
    const total = score + typeScore;
    if (total > 0 && (!best || total > best.score)) {
      best = { comp, score: total };
    }
  }

  return best?.comp ?? null;
}

export function computeCourseGrade(
  courseId: string,
  courseName: string,
  courseCode: string | null,
  gradingComponents: ComponentData[],
  syllabusItems: ItemData[]
): CourseGradeResult {
  const now = new Date();

  // Build component → items mapping
  const compItems = new Map<string, ItemData[]>(
    gradingComponents.map((c) => [c.id, []])
  );
  const unmatched: ItemData[] = [];

  for (const item of syllabusItems) {
    const matched = matchItemToComponent(item, gradingComponents);
    if (matched) {
      compItems.get(matched.id)?.push(item);
    } else {
      unmatched.push(item);
    }
  }

  // Build ComponentData with actual items for weight resolution
  const resolvedComponents: ComponentData[] = gradingComponents.map((comp) => ({
    ...comp,
    items: compItems.get(comp.id) ?? [],
  }));

  // Infer weights for unmatched items using defaults
  const unmatchedComponent: ComponentData = {
    id: "__unmatched__",
    name: "Other",
    weight: unmatched.reduce(
      (s, i) => s + (i.weight ?? DEFAULT_TYPE_WEIGHT[i.type] ?? 0.08),
      0
    ),
    items: unmatched,
  };

  const allComponents =
    unmatched.length > 0
      ? [...resolvedComponents, unmatchedComponent]
      : resolvedComponents;

  const itemWeights = resolveItemWeights(allComponents);

  // If no grading components at all, fall back to item.weight or defaults
  if (gradingComponents.length === 0) {
    for (const item of syllabusItems) {
      if (!itemWeights.has(item.id)) {
        itemWeights.set(item.id, item.weight ?? DEFAULT_TYPE_WEIGHT[item.type] ?? 0.08);
      }
    }
  }

  // Compute grade statistics
  let weightedScore = 0;
  let gradedWeight = 0;
  let totalWeight = 0;

  const componentResults: ComponentGradeResult[] = [];

  for (const comp of allComponents) {
    if (comp.id === "__unmatched__" && comp.items.length === 0) continue;

    const itemResults: ItemGradeResult[] = [];
    let compGradedScore = 0;
    let compGradedWeight = 0;

    for (const item of comp.items) {
      const w = itemWeights.get(item.id) ?? 0;
      totalWeight += w;
      const isGraded = item.earnedPoints != null && item.maxPoints != null && item.maxPoints > 0;
      let percentage: number | null = null;

      if (isGraded) {
        percentage = (item.earnedPoints! / item.maxPoints!) * 100;
        weightedScore += percentage * w;
        gradedWeight += w;
        compGradedScore += percentage * w;
        compGradedWeight += w;
      }

      itemResults.push({
        id: item.id,
        title: item.title,
        type: item.type,
        dueDate: item.dueDate?.toISOString() ?? null,
        weight: w,
        earnedPoints: item.earnedPoints,
        maxPoints: item.maxPoints,
        percentage,
        isGraded,
      });
    }

    componentResults.push({
      name: comp.name,
      weight: comp.weight,
      earnedFraction: compGradedWeight > 0 ? compGradedScore / compGradedWeight : null,
      items: itemResults,
    });
  }

  const currentGrade = gradedWeight > 0 ? weightedScore / gradedWeight : null;
  const currentLetter = currentGrade != null ? percentToLetter(currentGrade) : null;

  // Projected final: assume ungraded items score at current rate
  let projectedFinal: number | null = null;
  if (currentGrade != null && totalWeight > 0) {
    const ungradedWeight = totalWeight - gradedWeight;
    projectedFinal =
      (weightedScore + currentGrade * ungradedWeight) / totalWeight;
  }
  const projectedLetter = projectedFinal != null ? percentToLetter(projectedFinal) : null;

  // "What do I need" for target grades
  const targets: Record<string, number> = { "A": 93, "A-": 90, "B+": 87, "B": 83 };
  const neededForTarget: Record<string, number | null> = {};
  const ungradedWeight = totalWeight - gradedWeight;

  for (const [label, targetPct] of Object.entries(targets)) {
    if (ungradedWeight <= 0) {
      neededForTarget[label] = null;
    } else {
      const needed = (targetPct * totalWeight - weightedScore) / ungradedWeight;
      neededForTarget[label] = Math.round(needed * 10) / 10;
    }
  }

  // Swing detection — ungraded upcoming items
  const swingItems: SwingItem[] = [];
  const upcomingUngraded = syllabusItems.filter(
    (i) =>
      i.earnedPoints == null &&
      i.dueDate != null &&
      i.dueDate >= now
  );

  for (const item of upcomingUngraded) {
    const w = itemWeights.get(item.id) ?? 0;
    if (w === 0 || currentGrade == null || totalWeight === 0) continue;

    const remainingWithout = ungradedWeight - w;

    const scoreIf100 =
      (weightedScore + 100 * w + currentGrade * remainingWithout) / totalWeight;
    const scoreIf0 =
      (weightedScore + 0 * w + currentGrade * remainingWithout) / totalWeight;

    const letterIf100 = percentToLetter(scoreIf100);
    const letterIf0 = percentToLetter(scoreIf0);
    const canSwingLetter = letterIf100 !== letterIf0;

    if (canSwingLetter || w >= 0.15) {
      swingItems.push({
        id: item.id,
        title: item.title,
        weight: w,
        currentProjected: projectedLetter ?? "—",
        projectedIf100: letterIf100,
        projectedIf0: letterIf0,
        canSwingLetter,
      });
    }
  }

  return {
    courseId,
    courseName,
    courseCode,
    currentGrade,
    currentLetter,
    projectedFinal,
    projectedLetter,
    neededForTarget,
    gradedWeightFraction: totalWeight > 0 ? gradedWeight / totalWeight : 0,
    components: componentResults,
    swingItems,
  };
}

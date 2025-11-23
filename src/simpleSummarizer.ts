import type { CommitGroup } from './types';

/**
 * Simple text-based summarizer (no AI required)
 * Provides basic but functional standup summaries
 */
export function generateSimpleSummary(
  commitGroups: CommitGroup[],
  totalCommits: number,
  context?: {
    dayOfWeek?: string;
    isWeekend?: boolean;
    hour?: number;
  }
): {
  mood: string;
  accomplishments: string[];
  blockers: string[];
  todaysPlan: string[];
  gitSummary: string;
} {
  // Analyze commits
  const analysis = analyzeCommits(commitGroups);

  // Generate mood based on simple heuristics
  const mood = generateMood(analysis, context);

  // Transform commits to accomplishments
  const accomplishments = generateAccomplishments(commitGroups);

  // Generate blockers
  const blockers = generateBlockers(analysis);

  // Generate today's plan
  const todaysPlan = generateTodaysPlan(analysis);

  // Generate git summary
  const gitSummary = generateGitSummary(commitGroups, totalCommits);

  return {
    mood,
    accomplishments,
    blockers,
    todaysPlan,
    gitSummary,
  };
}

/**
 * Analyze commit patterns
 */
function analyzeCommits(groups: CommitGroup[]) {
  let fixes = 0;
  let features = 0;
  let refactors = 0;
  let wip = 0;
  let docs = 0;
  let tests = 0;

  for (const group of groups) {
    for (const commit of group.commits) {
      const msg = commit.message.toLowerCase();

      if (msg.match(/^(fix|bugfix|hotfix):/)) fixes++;
      else if (msg.match(/^(feat|feature):/)) features++;
      else if (msg.match(/^(refactor|chore|style):/)) refactors++;
      else if (msg.match(/wip|work in progress/i)) wip++;
      else if (msg.match(/^(docs|doc):/)) docs++;
      else if (msg.match(/^(test|tests):/)) tests++;
    }
  }

  return { fixes, features, refactors, wip, docs, tests, total: fixes + features + refactors + wip + docs + tests };
}

/**
 * Generate mood based on commit patterns
 */
function generateMood(
  analysis: ReturnType<typeof analyzeCommits>,
  context?: { dayOfWeek?: string; isWeekend?: boolean; hour?: number }
): string {
  const { fixes, features, refactors, wip } = analysis;

  // Check if weekend work
  if (context?.isWeekend) {
    return '💪 Weekend warrior - pushing forward';
  }

  // Multiple repos = multi-tasking
  if (features > fixes && features > refactors) {
    return '🚀 Productive - shipping features';
  }

  if (fixes > features && fixes > 2) {
    return '🔧 Bug squashing mode';
  }

  if (refactors > 2) {
    return '🎨 Refactoring day - improving code quality';
  }

  if (wip > 1) {
    return '🔍 Exploration mode - trying things out';
  }

  if (analysis.total > 5) {
    return '⚡ High velocity - lots of progress';
  }

  return '✨ Steady progress';
}

/**
 * Generate accomplishments from commits
 */
function generateAccomplishments(groups: CommitGroup[]): string[] {
  const accomplishments: string[] = [];
  const seenMessages = new Set<string>();

  for (const group of groups) {
    for (const commit of group.commits) {
      // Clean up message
      let message = commit.message;

      // Remove conventional commit prefixes
      message = message.replace(/^(feat|fix|docs|style|refactor|test|chore|perf):\s*/i, '');

      // Capitalize first letter
      message = message.charAt(0).toUpperCase() + message.slice(1);

      // Skip if we've seen very similar message
      const normalized = message.toLowerCase().trim();
      if (seenMessages.has(normalized)) continue;
      seenMessages.add(normalized);

      // Add repo context if multiple repos
      const prefix = groups.length > 1 ? `[${group.repoName}] ` : '';
      accomplishments.push(`${prefix}${message}`);
    }
  }

  return accomplishments.length > 0 ? accomplishments : ['Worked on various tasks'];
}

/**
 * Generate blockers based on analysis
 */
function generateBlockers(analysis: ReturnType<typeof analyzeCommits>): string[] {
  if (analysis.wip > 2) {
    return ['Multiple WIP commits - may need to consolidate work'];
  }

  if (analysis.fixes > 5) {
    return ['High number of fixes - possible technical debt to address'];
  }

  return ['None'];
}

/**
 * Generate today's plan based on patterns
 */
function generateTodaysPlan(analysis: ReturnType<typeof analyzeCommits>): string[] {
  const plan: string[] = [];

  if (analysis.features > 0) {
    plan.push('Continue feature development and testing');
  }

  if (analysis.fixes > 0) {
    plan.push('Monitor for any related issues');
  }

  if (analysis.refactors > 0) {
    plan.push('Complete refactoring and update documentation');
  }

  if (analysis.wip > 0) {
    plan.push('Finalize work in progress and clean up branches');
  }

  if (plan.length === 0) {
    plan.push('Continue current work');
  }

  return plan.slice(0, 2); // Max 2 items
}

/**
 * Generate git summary
 */
function generateGitSummary(groups: CommitGroup[], totalCommits: number): string {
  if (groups.length === 1) {
    return `${totalCommits} commits in ${groups[0].repoName}`;
  }

  // Sort by commit count
  const sorted = [...groups].sort((a, b) => b.commits.length - a.commits.length);
  const top = sorted[0];
  const others = sorted.slice(1);

  if (others.length === 0) {
    return `${totalCommits} commits in ${top.repoName}`;
  }

  const otherNames = others.map(g => g.repoName).join(', ');
  return `Most active in ${top.repoName} (${top.commits.length} commits), also worked on ${otherNames}`;
}

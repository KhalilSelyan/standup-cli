import { existsSync } from 'fs';
import { join, basename } from 'path';
import type { Commit, CommitGroup, GitAggregationResult } from './types';
import { getConfig } from './config';

const TIMEOUT_MS = 5000;
const DEBUG = process.env.DEBUG === 'true';

/**
 * Find all git repositories in a directory
 */
export async function findGitRepositories(scanPath?: string): Promise<string[]> {
  // Use config if scanPath not provided
  const config = getConfig();
  if (!scanPath) {
    scanPath = config.gitScanPath;
  }

  try {
    if (DEBUG) console.log(`[DEBUG] Scanning for git repos in: ${scanPath}`);

    const proc = Bun.spawn(['find', scanPath, '-name', '.git', '-type', 'd', '-maxdepth', '3'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const errorOutput = await new Response(proc.stderr).text();
    await proc.exited;

    if (DEBUG && errorOutput) console.log(`[DEBUG] Find stderr: ${errorOutput}`);
    if (proc.exitCode !== 0) {
      if (DEBUG) console.log(`[DEBUG] Find command failed with exit code: ${proc.exitCode}`);
      return [];
    }

    // Convert .git paths to repo paths
    let repos = output
      .trim()
      .split('\n')
      .filter(line => line)
      .map(gitDir => gitDir.replace('/.git', ''));

    // Filter out excluded repos
    if (config.excludeRepos && config.excludeRepos.length > 0) {
      repos = repos.filter(repoPath => {
        const repoName = getRepositoryName(repoPath);
        return !config.excludeRepos!.includes(repoName);
      });
      if (DEBUG) console.log(`[DEBUG] After exclusions: ${repos.length} repos`);
    }

    if (DEBUG) console.log(`[DEBUG] Found ${repos.length} repos:`, repos);
    return repos;
  } catch (error) {
    if (DEBUG) console.log(`[DEBUG] Error finding repos:`, error);
    return [];
  }
}

/**
 * Get repository name from path
 */
export function getRepositoryName(repoPath: string): string {
  return basename(repoPath);
}

/**
 * Extract branch name from git refNames string
 * Examples: "(HEAD -> main, origin/main)" -> "main"
 *           "(feature-branch)" -> "feature-branch"
 *           "" -> null
 */
export function extractBranchName(refNames: string): string | null {
  if (!refNames) return null;

  // Remove parentheses and split by comma
  const cleaned = refNames.replace(/[()]/g, '').trim();
  if (!cleaned) return null;

  const refs = cleaned.split(',').map(r => r.trim());

  // Look for "HEAD -> branchname" pattern first
  for (const ref of refs) {
    const headMatch = ref.match(/HEAD -> (.+)/);
    if (headMatch) {
      return headMatch[1];
    }
  }

  // Otherwise, take the first non-origin ref
  for (const ref of refs) {
    if (!ref.startsWith('origin/') && !ref.startsWith('tag:')) {
      return ref;
    }
  }

  // Fallback to first origin ref without the prefix
  for (const ref of refs) {
    if (ref.startsWith('origin/')) {
      return ref.replace('origin/', '');
    }
  }

  return null;
}

/**
 * Get commits since a specific date for a repository
 */
export async function getCommitsSince(
  repoPath: string,
  since: Date
): Promise<Commit[]> {
  const repoName = getRepositoryName(repoPath);
  const commits: Commit[] = [];

  try {
    // Calculate hours ago for git's relative time format (more reliable than ISO)
    const hoursAgo = Math.ceil((Date.now() - since.getTime()) / (1000 * 60 * 60));
    const sinceStr = `${hoursAgo} hours ago`;

    const config = getConfig();
    const authorFilter = config.authorFilter;

    if (DEBUG) {
      console.log(`[DEBUG] Getting commits from ${repoName} since ${sinceStr}`);
      if (authorFilter) {
        console.log(`[DEBUG] Filtering by author: ${authorFilter}`);
      }
    }

    // Build git log command with optional author filter
    const gitArgs = [
      'git',
      '-C',
      repoPath,
      'log',
      '--all',
      `--since=${sinceStr}`,
      '--pretty=format:%H|%aI|%an|%d|%s',
    ];

    // Add author filter if configured
    if (authorFilter) {
      gitArgs.push(`--author=${authorFilter}`);
    }

    // Skip merge commits if configured
    if (config.skipMergeCommits) {
      gitArgs.push('--no-merges');
    }

    const proc = Bun.spawn(gitArgs, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const output = await new Response(proc.stdout).text();
    const errorOutput = await new Response(proc.stderr).text();
    clearTimeout(timeout);

    await proc.exited;

    if (DEBUG && errorOutput) console.log(`[DEBUG] Git log stderr for ${repoName}:`, errorOutput);

    if (proc.exitCode !== 0) {
      if (DEBUG) console.log(`[DEBUG] Git log failed for ${repoName}, exit code: ${proc.exitCode}`);
      return [];
    }

    if (DEBUG) {
      console.log(`[DEBUG] Raw git output for ${repoName}:`);
      console.log(output || '(empty)');
      console.log(`[DEBUG] Output length: ${output.length} bytes`);
    }

    if (!output.trim()) {
      if (DEBUG) console.log(`[DEBUG] No commits found in ${repoName} (empty output)`);
      return [];
    }

    const lines = output.trim().split('\n');
    if (DEBUG) console.log(`[DEBUG] Found ${lines.length} commits in ${repoName}`);

    for (const line of lines) {
      if (!line) continue;

      const [hash, timestamp, author, refNames, ...messageParts] = line.split('|');
      const message = messageParts.join('|'); // Handle pipes in commit message
      const branch = extractBranchName(refNames.trim());

      commits.push({
        hash,
        author,
        timestamp: new Date(timestamp),
        message: message.trim(),
        refNames: refNames.trim(),
        isUnpushed: false, // Will be set later
        repoName,
        branch: branch || undefined,
      });
    }
  } catch (error) {
    if (DEBUG) console.log(`[DEBUG] Error getting commits from ${repoName}:`, error);
  }

  return commits;
}

/**
 * Get unpushed commits for a repository
 */
export async function getUnpushedCommits(repoPath: string): Promise<Set<string>> {
  const unpushedHashes = new Set<string>();

  try {
    // Get all local branches
    const branchesProc = Bun.spawn(
      ['git', '-C', repoPath, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'],
      {
        stdout: 'pipe',
        stderr: 'ignore',
      }
    );

    const branchesOutput = await new Response(branchesProc.stdout).text();
    await branchesProc.exited;

    if (branchesProc.exitCode !== 0) {
      return unpushedHashes;
    }

    const branches = branchesOutput
      .trim()
      .split('\n')
      .filter(b => b);

    // Check each branch for unpushed commits
    for (const branch of branches) {
      try {
        const proc = Bun.spawn(
          ['git', '-C', repoPath, 'log', `origin/${branch}..${branch}`, '--pretty=format:%H'],
          {
            stdout: 'pipe',
            stderr: 'ignore',
          }
        );

        const output = await new Response(proc.stdout).text();
        await proc.exited;

        if (proc.exitCode === 0 && output.trim()) {
          const hashes = output.trim().split('\n');
          hashes.forEach(hash => unpushedHashes.add(hash));
        }
      } catch {
        // Branch might not have remote tracking, skip
      }
    }
  } catch {
    // Failed to get unpushed commits, skip
  }

  return unpushedHashes;
}

/**
 * Aggregate commits from multiple repositories
 */
export async function aggregateCommits(
  repoPaths: string[],
  since: Date
): Promise<GitAggregationResult> {
  const until = new Date();
  const groups: CommitGroup[] = [];

  // Process repos in parallel with a limit
  const results = await Promise.all(
    repoPaths.map(async repoPath => {
      const commits = await getCommitsSince(repoPath, since);
      const unpushedHashes = await getUnpushedCommits(repoPath);

      // Mark unpushed commits
      commits.forEach(commit => {
        commit.isUnpushed = unpushedHashes.has(commit.hash);
      });

      return {
        repoName: getRepositoryName(repoPath),
        commits,
      };
    })
  );

  // Filter out repos with no commits and create groups
  let totalCommits = 0;

  for (const result of results) {
    if (result.commits.length > 0) {
      const pushedCount = result.commits.filter(c => !c.isUnpushed).length;
      const unpushedCount = result.commits.filter(c => c.isUnpushed).length;

      groups.push({
        repoName: result.repoName,
        commits: result.commits,
        pushedCount,
        unpushedCount,
      });

      totalCommits += result.commits.length;
    }
  }

  // Sort groups by repo name
  groups.sort((a, b) => a.repoName.localeCompare(b.repoName));

  return {
    groups,
    timeRange: { since, until },
    totalCommits,
  };
}

/**
 * Format commits grouped by repository
 */
export function formatCommitsGrouped(groups: CommitGroup[]): string[] {
  const lines: string[] = [];

  for (const group of groups) {
    const unpushedInfo =
      group.unpushedCount > 0 ? ` (${group.unpushedCount} unpushed)` : '';
    lines.push(`**${group.repoName}** (${group.commits.length} commits${unpushedInfo})`);
    lines.push(''); // Blank line after header

    for (const commit of group.commits) {
      const emoji = commit.isUnpushed ? '🚀' : '✅';
      const unpushedMark = commit.isUnpushed ? ' *unpushed*' : '';
      const branchTag = commit.branch ? `[${commit.branch}] ` : '';
      lines.push(`- ${emoji} ${branchTag}${commit.message}${unpushedMark}`);
    }

    lines.push(''); // Empty line between repos
  }

  return lines;
}

/**
 * Format commits as flat list with repo tags
 */
export function formatCommitsFlat(groups: CommitGroup[]): string[] {
  const lines: string[] = [];

  for (const group of groups) {
    for (const commit of group.commits) {
      const unpushedMark = commit.isUnpushed ? ' *unpushed' : '';
      const branchTag = commit.branch ? `[${commit.branch}] ` : '';
      lines.push(`[${group.repoName}] ${branchTag}${commit.message}${unpushedMark}`);
    }
  }

  return lines;
}

/**
 * Convert commits to accomplishment format (for pre-filling)
 */
export function commitsToAccomplishments(groups: CommitGroup[]): string[] {
  const accomplishments: string[] = [];

  for (const group of groups) {
    for (const commit of group.commits) {
      // Remove conventional commit prefixes for cleaner display
      let message = commit.message;
      message = message.replace(/^(feat|fix|docs|style|refactor|test|chore|perf):\s*/i, '');

      const unpushedMark = commit.isUnpushed ? ' (unpushed)' : '';
      const branchTag = commit.branch ? `[${commit.branch}] ` : '';
      accomplishments.push(`[${group.repoName}] ${branchTag}${message}${unpushedMark}`);
    }
  }

  return accomplishments;
}

import type { CommitGroup } from './types';

const DEBUG = process.env.DEBUG === 'true';
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b'; // Fast & smart. Can also use: llama3.2:8b, qwen2.5-coder:7b

/**
 * Check if Ollama is available and running
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Generate a standup summary using Ollama (local LLM)
 */
export async function generateStandupSummary(
  commitGroups: CommitGroup[],
  totalCommits: number,
  context?: {
    dayOfWeek?: string;
    isWeekend?: boolean;
    hour?: number;
  }
): Promise<{
  mood: string;
  accomplishments: string[];
  blockers: string[];
  todaysPlan: string[];
  gitSummary: string;
}> {
  // Format commits for the prompt
  const commitsText = formatCommitsForPrompt(commitGroups);

  // Analyze commit patterns
  const analysis = analyzeCommitPatterns(commitGroups);

  // Build context string
  const contextStr = context ? `
Context:
- Day: ${context.dayOfWeek}${context.isWeekend ? ' (weekend)' : ''}
- Time: ${context.hour ? (context.hour < 12 ? 'morning' : context.hour < 17 ? 'afternoon' : 'evening') : 'unknown'}
- Total commits: ${totalCommits}
- Commit types: ${analysis.types.join(', ')}
- Repositories: ${commitGroups.map(g => g.repoName).join(', ')}
` : '';

  const prompt = `You are helping generate a daily standup message. Analyze the git commits and create a natural, personalized standup summary.

${contextStr}

Git commits:
${commitsText}

Generate a standup with these sections:

1. **Mood**: Infer the developer's mood/mode based on commits. Examples:
   - "🚀 Productive - shipping features" (lots of features)
   - "🔧 Bug squashing mode" (lots of fixes)
   - "🎨 Refactoring day" (cleanup/refactor)
   - "🔍 Exploration mode" (experimental commits)
   - "⚡ Multi-tasking across projects" (multiple repos)
   Be creative but professional. One emoji + short phrase.

2. **Accomplishments**: Transform commits into natural, conversational accomplishments.
   - Combine related commits
   - Explain WHY and WHAT, not just technical details
   - Use past tense, active voice
   - Be specific about impact
   Example: Instead of "Added timestamps", say "Added human-readable timestamps to git commits so team can see when work was done"

3. **Blockers**: Analyze commits for potential issues:
   - Lots of fixes = might be dealing with technical debt
   - WIP commits = work in progress
   - Reverts = hit a roadblock
   - Otherwise "None"

4. **Today's Plan**: Based on patterns, suggest logical next steps:
   - If features: "Continue development" or "Test and deploy"
   - If fixes: "Monitor for issues" or "Add tests"
   - If refactor: "Document changes" or "Complete refactoring"
   Be specific and actionable.

5. **Git Summary**: One-line summary of git activity.
   Example: "Most active in db-migrations (4 commits), also worked on standup (2 commits)"

Format as JSON ONLY:
{
  "mood": "emoji + short phrase",
  "accomplishments": ["item1", "item2"],
  "blockers": ["item1"] or ["None"],
  "todaysPlan": ["item1"],
  "gitSummary": "one-line summary"
}

IMPORTANT: Return ONLY the JSON object. Be conversational but professional.`;

  if (DEBUG) {
    console.log('[DEBUG] Ollama API URL:', OLLAMA_API_URL);
    console.log('[DEBUG] Ollama Model:', OLLAMA_MODEL);
    console.log('[DEBUG] AI Prompt:', prompt);
  }

  try {
    // Call Ollama API
    const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 512,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (DEBUG) {
      console.log('[DEBUG] Ollama Response:', JSON.stringify(data, null, 2));
    }

    // Parse JSON response
    const responseText = data.response;

    // Try to extract JSON from the response (in case it's wrapped in markdown code blocks)
    let jsonText = responseText.trim();
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    // Sometimes the model adds extra text, try to find the JSON object
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonText = jsonObjectMatch[0];
    }

    const result = JSON.parse(jsonText);

    return {
      mood: result.mood || 'Generated automatically',
      accomplishments: result.accomplishments || [],
      blockers: result.blockers || ['None'],
      todaysPlan: result.todaysPlan || [],
      gitSummary: result.gitSummary || `${totalCommits} commits across ${commitGroups.length} repositories`,
    };
  } catch (error) {
    if (DEBUG) {
      console.error('[DEBUG] AI Error:', error);
    }

    // Check if Ollama is running
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(
        `Cannot connect to Ollama. Make sure Ollama is running:\n  ollama serve\n\nOr install it from: https://ollama.com`
      );
    }

    throw new Error(`Failed to generate AI summary: ${error}`);
  }
}

/**
 * Analyze commit patterns to understand work type
 */
function analyzeCommitPatterns(groups: CommitGroup[]): {
  types: string[];
  hasFixes: boolean;
  hasFeatures: boolean;
  hasRefactors: boolean;
  hasWIP: boolean;
} {
  const types = new Set<string>();
  let hasFixes = false;
  let hasFeatures = false;
  let hasRefactors = false;
  let hasWIP = false;

  for (const group of groups) {
    for (const commit of group.commits) {
      const msg = commit.message.toLowerCase();

      if (msg.match(/^(fix|bugfix|hotfix):/)) {
        types.add('fixes');
        hasFixes = true;
      } else if (msg.match(/^(feat|feature):/)) {
        types.add('features');
        hasFeatures = true;
      } else if (msg.match(/^(refactor|chore|style):/)) {
        types.add('refactoring');
        hasRefactors = true;
      } else if (msg.match(/wip|work in progress/i)) {
        types.add('WIP');
        hasWIP = true;
      } else if (msg.match(/^(docs|doc):/)) {
        types.add('documentation');
      } else if (msg.match(/^(test|tests):/)) {
        types.add('testing');
      } else {
        types.add('general');
      }
    }
  }

  return {
    types: Array.from(types),
    hasFixes,
    hasFeatures,
    hasRefactors,
    hasWIP,
  };
}

/**
 * Format commit groups into a readable text for the AI prompt
 */
function formatCommitsForPrompt(groups: CommitGroup[]): string {
  const lines: string[] = [];

  for (const group of groups) {
    lines.push(`\n**${group.repoName}** (${group.commits.length} commits):`);
    for (const commit of group.commits) {
      const unpushedMark = commit.isUnpushed ? ' [unpushed]' : '';
      const branchTag = commit.branch ? `[${commit.branch}] ` : '';
      lines.push(`  - ${branchTag}${commit.message}${unpushedMark}`);
    }
  }

  return lines.join('\n');
}

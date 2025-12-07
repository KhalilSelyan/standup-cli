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

2. **Accomplishments**: Transform commits into detailed, impressive accomplishments that showcase the breadth and depth of work.
   - Generate 5-10 accomplishment items (more items for more commits)
   - Group by logical feature/area but DON'T over-consolidate - show the variety of work
   - Be specific about technical details and what was actually changed
   - Explain WHAT was done, WHY it matters, and the IMPACT
   - Use past tense, active voice
   - Include repository names when working across multiple repos
   - Make the developer look productive and skilled
   Example: Instead of "Fixed TypeScript errors", say "Fixed several TypeScript errors across multiple repositories to improve code quality and type safety"

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
  "accomplishments": ["item1", "item2", "item3", "item4", "item5", ...],
  "blockers": ["item1"] or ["None"],
  "todaysPlan": ["item1", "item2"],
  "gitSummary": "one-line summary"
}

IMPORTANT:
- Return ONLY the JSON object
- Generate 5-10 accomplishments to showcase the full scope of work
- Be conversational but professional
- Don't over-consolidate - show the variety and volume of contributions`;

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
          num_predict: 1024,
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

/**
 * Suggest mood based on git commits using AI
 */
export async function suggestMood(
  commitGroups: CommitGroup[],
  totalCommits: number
): Promise<string | null> {
  const commitsText = formatCommitsForPrompt(commitGroups);
  const analysis = analyzeCommitPatterns(commitGroups);

  const prompt = `You are helping a developer express their mood for their daily standup based on their git activity.

Git commits:
${commitsText}

Commit analysis:
- Total commits: ${totalCommits}
- Types: ${analysis.types.join(', ')}
- Repositories: ${commitGroups.map(g => g.repoName).join(', ')}

Based on this activity, suggest a mood. Examples:
- "🚀 Productive - shipping features" (lots of features)
- "🔧 Bug squashing mode" (lots of fixes)
- "🎨 Refactoring day" (cleanup/refactor)
- "🔍 Exploration mode" (experimental commits)
- "⚡ Multi-tasking across projects" (multiple repos)
- "💪 Power through - high commit count" (many commits)

Be creative but professional. One emoji + short phrase (under 40 chars).

Return ONLY the mood string, nothing else.`;

  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.8, num_predict: 50 },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.response.trim();
  } catch {
    return null;
  }
}

/**
 * Improve accomplishments using AI
 */
export async function improveAccomplishments(
  accomplishments: string[],
  commitGroups?: CommitGroup[]
): Promise<string[] | null> {
  const commitsContext = commitGroups ? `\nGit commits for context:\n${formatCommitsForPrompt(commitGroups)}` : '';

  const prompt = `You are helping improve accomplishment descriptions for a daily standup.

Current accomplishments:
${accomplishments.map((a, i) => `${i + 1}. ${a}`).join('\n')}
${commitsContext}

Improve these accomplishments to be:
- Natural and conversational (past tense, active voice)
- Specific about WHAT was done and WHY it matters
- Focused on impact and value
- Combined if related (but keep separate if distinct)
- Professional but not overly formal
- Keep any [repo-name] prefixes as plain text, NOT as array syntax

IMPORTANT: If an accomplishment starts with [repo-name], keep it as a simple string prefix, like:
"[db-migrations] Updated setup script to use new command for better consistency"

Example transformations:
- "[repo] Added timestamps" → "[repo] Added human-readable timestamps to git commits so team can see when work was done"
- "Fixed bug" → "Fixed authentication bug that was preventing users from logging in"
- "Updated docs" → "Updated API documentation with new endpoint examples for easier integration"

Return as JSON array of strings (NOT nested arrays):
["improved item 1", "improved item 2", ...]

Return ONLY a valid JSON array. Do not use nested arrays or any markdown formatting.`;

  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 400 },
      }),
    });

    if (!response.ok) {
      if (DEBUG) console.error('[DEBUG] Ollama response not OK:', response.status, response.statusText);
      return null;
    }
    const data = await response.json();

    if (DEBUG) {
      console.log('[DEBUG] Ollama raw response for improveAccomplishments:', data.response);
    }

    // Extract JSON array from response
    let jsonText = data.response.trim();
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    if (DEBUG) {
      console.log('[DEBUG] Extracted JSON text:', jsonText);
    }

    // Fix common issue: AI outputs ["[repo]" text"] instead of "[[repo] text"
    // Pattern: "["  at start of string becomes "[
    // Pattern: "]"  followed by space becomes "]
    jsonText = jsonText.replace(/"\["/g, '"[').replace(/"\]\s/g, '] ');

    if (DEBUG) {
      console.log('[DEBUG] After bracket fix:', jsonText);
    }

    const parsed = JSON.parse(jsonText);

    if (DEBUG) {
      console.log('[DEBUG] Parsed accomplishments:', parsed);
    }

    // Ensure result is an array of strings
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item));
    }

    return parsed;
  } catch (error) {
    if (DEBUG) {
      console.error('[DEBUG] Error in improveAccomplishments:', error);
    }
    return null;
  }
}

/**
 * Suggest potential blockers based on commit patterns
 */
export async function suggestBlockers(
  commitGroups: CommitGroup[]
): Promise<string[] | null> {
  const commitsText = formatCommitsForPrompt(commitGroups);
  const analysis = analyzeCommitPatterns(commitGroups);

  const prompt = `You are analyzing git commits to identify potential blockers or challenges.

Git commits:
${commitsText}

Patterns detected:
- Has fixes: ${analysis.hasFixes}
- Has WIP commits: ${analysis.hasWIP}
- Commit types: ${analysis.types.join(', ')}

Analyze for potential blockers:
- Lots of fixes → dealing with technical debt or bugs
- WIP commits → work is incomplete or exploratory
- Multiple attempts at same thing → stuck on something
- Reverts → hit a roadblock
- Otherwise → "None"

Return potential blockers as JSON array. If no blockers, return ["None"].
Be specific but concise (under 60 chars each).

Examples:
["Dealing with flaky tests in authentication module"]
["API rate limiting causing integration issues"]
["None"]

Return ONLY the JSON array, nothing else.`;

  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.6, num_predict: 200 },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();

    let jsonText = data.response.trim();
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

/**
 * Suggest today's plan based on recent work
 */
export async function suggestTodaysPlan(
  commitGroups: CommitGroup[],
  accomplishments?: string[]
): Promise<string[] | null> {
  const commitsText = formatCommitsForPrompt(commitGroups);
  const analysis = analyzeCommitPatterns(commitGroups);
  const accompContext = accomplishments ? `\nAccomplishments:\n${accomplishments.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : '';

  const prompt = `You are suggesting logical next steps for a developer's work plan based on their recent activity.

Git commits:
${commitsText}${accompContext}

Patterns:
- Commit types: ${analysis.types.join(', ')}
- Has unpushed work: ${commitGroups.some(g => g.commits.some(c => c.isUnpushed))}

Based on recent work, suggest 2-3 specific, actionable next steps:
- If features: "Continue development on X" or "Test and deploy Y"
- If fixes: "Monitor for related issues" or "Add regression tests"
- If refactor: "Document changes" or "Complete refactoring in Z"
- If WIP: "Finish X implementation" or "Review and clean up Y"
- Be specific to what was actually worked on

Return as JSON array of 2-3 items (each under 60 chars):
["specific task 1", "specific task 2", "specific task 3"]

Return ONLY the JSON array, nothing else.`;

  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 250 },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();

    let jsonText = data.response.trim();
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

import { format, parseISO, startOfWeek, endOfWeek, isWithinInterval, getDay } from 'date-fns';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { loadConfig } from './config';
import { isOllamaAvailable } from './aiSummarizer';

const DEBUG = process.env.DEBUG === 'true';
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

export interface ParsedStandup {
  date: string;
  dayOfWeek: string;
  mood: string;
  accomplishments: string[];
  blockers: string[];
  todaysPlan: string[];
  gitSummary?: string;
}

export interface WeeklyRetroData {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  year: number;
  standups: ParsedStandup[];
  summary: {
    totalDays: number;
    moods: string[];
    allAccomplishments: string[];
    allBlockers: string[];
    themes: string[];
    highlights: string[];
    challenges: string[];
    lessonsLearned: string[];
    nextWeekFocus: string[];
  };
}

/**
 * Parse a standup markdown file into structured data
 */
export function parseStandupFile(content: string, filename: string): ParsedStandup {
  const dateStr = filename.replace('.md', '');
  const date = parseISO(dateStr);

  // Extract mood
  const moodMatch = content.match(/## (?:😊 )?Mood\n\n?(.+?)(?:\n\n|\n##)/s);
  const mood = moodMatch ? moodMatch[1].trim() : 'Unknown';

  // Extract accomplishments
  const accomplishmentsMatch = content.match(/## (?:✅ )?(?:Accomplishments|What did you accomplish\?)\n\n?([\s\S]+?)(?:\n\n##|\n---)/);
  const accomplishments = accomplishmentsMatch
    ? accomplishmentsMatch[1].trim().split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim())
    : [];

  // Extract blockers
  const blockersMatch = content.match(/## (?:🚧 )?(?:Blockers|Any blockers or help needed\?)\n\n?([\s\S]+?)(?:\n\n##|\n---)/);
  let blockers: string[] = [];
  if (blockersMatch) {
    const blockersText = blockersMatch[1].trim();
    if (blockersText !== 'None') {
      blockers = blockersText.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
    }
  }

  // Extract today's plan
  const planMatch = content.match(/## (?:📋 )?(?:Today's Plan|What will you focus on today\?)\n\n?([\s\S]+?)(?:\n\n##|\n---)/);
  const todaysPlan = planMatch
    ? planMatch[1].trim().split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim())
    : [];

  // Extract git summary if present
  const gitSummaryMatch = content.match(/## 📊 Git Summary\n\n?(.+?)(?:\n\n|$)/);
  const gitSummary = gitSummaryMatch ? gitSummaryMatch[1].trim() : undefined;

  return {
    date: dateStr,
    dayOfWeek: format(date, 'EEEE'),
    mood,
    accomplishments,
    blockers,
    todaysPlan,
    gitSummary,
  };
}

/**
 * Get standups for a specific week (Monday-Friday)
 */
export async function getWeekStandups(weekOffset: number = 0): Promise<ParsedStandup[]> {
  const config = await loadConfig();
  const standupDir = config.standupDir;

  if (!existsSync(standupDir)) {
    return [];
  }

  // Calculate week boundaries
  const now = new Date();
  const targetDate = new Date(now.getTime() - weekOffset * 7 * 24 * 60 * 60 * 1000);
  const weekStart = startOfWeek(targetDate, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(targetDate, { weekStartsOn: 1 }); // Sunday

  // Get all standup files for this week
  const files = readdirSync(standupDir)
    .filter(f => f.endsWith('.md'))
    .filter(f => {
      const dateStr = f.replace('.md', '');
      try {
        const fileDate = parseISO(dateStr);
        // Only include weekdays (Mon-Fri)
        const dayOfWeek = getDay(fileDate);
        return isWithinInterval(fileDate, { start: weekStart, end: weekEnd }) && dayOfWeek >= 1 && dayOfWeek <= 5;
      } catch {
        return false;
      }
    })
    .sort();

  const standups: ParsedStandup[] = [];

  for (const file of files) {
    const content = await Bun.file(join(standupDir, file)).text();
    standups.push(parseStandupFile(content, file));
  }

  return standups;
}

/**
 * Generate a weekly retrospective using AI
 */
export async function generateWeeklyRetro(standups: ParsedStandup[]): Promise<WeeklyRetroData['summary'] | null> {
  if (standups.length === 0) {
    return null;
  }

  // Aggregate all data
  const allAccomplishments = standups.flatMap(s => s.accomplishments);
  const allBlockers = standups.flatMap(s => s.blockers).filter(b => b !== 'None');
  const moods = standups.map(s => s.mood);

  const prompt = `You are helping generate a weekly retrospective summary for a developer. Analyze their week's standups and create a thoughtful reflection.

Week's Data:
${standups.map(s => `
**${s.dayOfWeek} (${s.date})**
- Mood: ${s.mood}
- Accomplishments: ${s.accomplishments.join('; ') || 'None listed'}
- Blockers: ${s.blockers.length > 0 ? s.blockers.join('; ') : 'None'}
${s.gitSummary ? `- Git Activity: ${s.gitSummary}` : ''}`).join('\n')}

Generate a weekly retrospective with these sections:

1. **Themes**: 2-3 main themes or areas of work this week (e.g., "Authentication system overhaul", "Bug fixes and stability")

2. **Highlights**: 3-5 key wins or accomplishments that stand out. Be specific and highlight impact.

3. **Challenges**: Any blockers, struggles, or difficult areas. If none, note what made the week smooth.

4. **Lessons Learned**: 1-3 insights or takeaways from this week's work.

5. **Next Week Focus**: 2-3 suggested areas to focus on based on patterns (unfinished work, recurring blockers, etc.)

Also analyze the mood trend:
- Were moods consistent or did they shift?
- Any correlation between mood and type of work?

Format as JSON ONLY:
{
  "themes": ["theme1", "theme2"],
  "highlights": ["highlight1", "highlight2", "highlight3"],
  "challenges": ["challenge1"] or ["None - smooth week"],
  "lessonsLearned": ["lesson1", "lesson2"],
  "nextWeekFocus": ["focus1", "focus2"],
  "moodAnalysis": "Brief analysis of mood patterns"
}

Return ONLY the JSON object. Be insightful but concise.`;

  if (DEBUG) {
    console.log('[DEBUG] Weekly Retro Prompt:', prompt);
  }

  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 1024,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    let jsonText = data.response.trim();

    // Extract JSON from markdown code blocks if present
    const jsonMatch = jsonText.match(/```json\n([\s\S]*?)\n```/) || jsonText.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    // Find JSON object
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonText = jsonObjectMatch[0];
    }

    const result = JSON.parse(jsonText);

    return {
      totalDays: standups.length,
      moods,
      allAccomplishments,
      allBlockers,
      themes: result.themes || [],
      highlights: result.highlights || [],
      challenges: result.challenges || [],
      lessonsLearned: result.lessonsLearned || [],
      nextWeekFocus: result.nextWeekFocus || [],
    };
  } catch (error) {
    if (DEBUG) {
      console.error('[DEBUG] Weekly retro AI error:', error);
    }
    return null;
  }
}

/**
 * Generate a simple (non-AI) weekly summary
 */
export function generateSimpleRetro(standups: ParsedStandup[]): WeeklyRetroData['summary'] {
  const allAccomplishments = standups.flatMap(s => s.accomplishments);
  const allBlockers = standups.flatMap(s => s.blockers).filter(b => b !== 'None');
  const moods = standups.map(s => s.mood);

  return {
    totalDays: standups.length,
    moods,
    allAccomplishments,
    allBlockers,
    themes: ['See accomplishments for details'],
    highlights: allAccomplishments.slice(0, 5),
    challenges: allBlockers.length > 0 ? allBlockers : ['None reported this week'],
    lessonsLearned: ['Review standups for insights'],
    nextWeekFocus: ['Continue momentum from this week'],
  };
}

/**
 * Check if today is the configured retro day (default: Friday)
 */
export async function isRetroDay(): Promise<boolean> {
  const config = await loadConfig();
  const retroDay = (config as any).retroDay ?? 5; // Default to Friday (5)
  const today = getDay(new Date());
  return today === retroDay;
}

/**
 * Check if a retro already exists for this week
 */
export async function retroExistsForWeek(weekOffset: number = 0): Promise<boolean> {
  const config = await loadConfig();
  const retroDir = (config as any).retroDir || join(config.standupDir, '..', 'retros');

  if (!existsSync(retroDir)) {
    return false;
  }

  const now = new Date();
  const targetDate = new Date(now.getTime() - weekOffset * 7 * 24 * 60 * 60 * 1000);
  const weekStart = startOfWeek(targetDate, { weekStartsOn: 1 });
  const year = weekStart.getFullYear();
  const weekNum = getWeekNumber(weekStart);

  const filename = `${year}-W${String(weekNum).padStart(2, '0')}.md`;
  return existsSync(join(retroDir, filename));
}

/**
 * Get ISO week number
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Save weekly retrospective to file
 */
export async function saveWeeklyRetro(standups: ParsedStandup[], summary: WeeklyRetroData['summary']): Promise<string> {
  const config = await loadConfig();
  const retroDir = (config as any).retroDir || join(config.standupDir, '..', 'retros');

  // Ensure retro directory exists
  if (!existsSync(retroDir)) {
    mkdirSync(retroDir, { recursive: true });
  }

  // Calculate week info
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const year = weekStart.getFullYear();
  const weekNum = getWeekNumber(weekStart);

  const filename = `${year}-W${String(weekNum).padStart(2, '0')}.md`;
  const filepath = join(retroDir, filename);

  const formatList = (items: string[]) => {
    if (items.length === 0) return 'None';
    return items.map(item => `- ${item}`).join('\n');
  };

  const markdown = `# Weekly Retrospective - Week ${weekNum}, ${year}

📅 **${format(weekStart, 'MMMM do')} - ${format(weekEnd, 'MMMM do, yyyy')}**

---

## 📊 Week Overview

- **Days with standups:** ${summary.totalDays}/5
- **Moods:** ${summary.moods.join(' → ')}

## 🎯 Key Themes

${formatList(summary.themes)}

## 🌟 Highlights

${formatList(summary.highlights)}

## 🚧 Challenges

${formatList(summary.challenges)}

## 💡 Lessons Learned

${formatList(summary.lessonsLearned)}

## 🔮 Next Week Focus

${formatList(summary.nextWeekFocus)}

---

## 📝 Daily Breakdown

${standups.map(s => `### ${s.dayOfWeek} (${s.date})

**Mood:** ${s.mood}

**Accomplished:**
${s.accomplishments.length > 0 ? s.accomplishments.map(a => `- ${a}`).join('\n') : 'None listed'}

**Blockers:** ${s.blockers.length > 0 ? s.blockers.join(', ') : 'None'}
`).join('\n')}

---

*Generated automatically at ${format(new Date(), "HH:mm:ss 'on' EEEE, MMMM do, yyyy")}*
`;

  await Bun.write(filepath, markdown);
  return filepath;
}

/**
 * Run the automatic weekly retrospective generation
 */
export async function runAutoRetro(): Promise<{ success: boolean; filepath?: string; message: string }> {
  const config = await loadConfig();

  // Check if it's retro day
  if (!await isRetroDay()) {
    return { success: false, message: 'Not retro day' };
  }

  // Check if retro already exists
  if (await retroExistsForWeek()) {
    return { success: false, message: 'Retro already exists for this week' };
  }

  // Get week's standups
  const standups = await getWeekStandups();

  if (standups.length === 0) {
    return { success: false, message: 'No standups found for this week' };
  }

  // Generate summary (AI if enabled and available)
  let summary: WeeklyRetroData['summary'] | null = null;
  let usedAI = false;

  if (config.enableAI) {
    const ollamaReady = await isOllamaAvailable();
    if (ollamaReady) {
      console.log(pc.cyan('🤖 Generating AI-powered weekly retrospective...'));
      summary = await generateWeeklyRetro(standups);
      if (summary) {
        usedAI = true;
      }
    }
  }

  // Fallback to simple summary
  if (!summary) {
    console.log(pc.cyan('📊 Generating weekly retrospective...'));
    summary = generateSimpleRetro(standups);
  }

  // Save retro
  const filepath = await saveWeeklyRetro(standups, summary);

  const aiStatus = usedAI ? ' (AI-powered)' : '';
  return {
    success: true,
    filepath,
    message: `Weekly retrospective generated${aiStatus}`
  };
}

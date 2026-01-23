#!/usr/bin/env bun

import * as p from '@clack/prompts';
import { format, parseISO, startOfWeek, endOfWeek, isWithinInterval, differenceInDays } from 'date-fns';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import {
  findGitRepositories,
  aggregateCommits,
  formatCommitsGrouped,
  formatCommitsFlat,
  commitsToAccomplishments,
} from './gitUtils';
import type { GitAggregationResult } from './types';
import { loadConfig, wasConfigFileCreated } from './config';
import { migrate, promptMigrationIfNeeded } from './migrate';
import {
  checkGitInstalled,
  getGitInstallMessage,
  getNoReposFoundMessage,
  checkClipboardAvailable,
  getClipboardToolsMessage,
} from './errorHandling';
import {
  generateStandupSummary,
  isOllamaAvailable,
  suggestMood,
  improveAccomplishments,
  suggestBlockers,
  suggestTodaysPlan
} from './aiSummarizer';
import { generateSimpleSummary } from './simpleSummarizer';
import {
  runAutoRetro,
  isRetroDay,
  retroExistsForWeek,
  getWeekStandups,
  generateWeeklyRetro,
  generateSimpleRetro,
  saveWeeklyRetro,
} from './weeklyRetro';

// Load config at startup
const config = await loadConfig();

const STANDUP_DIR = config.standupDir;
const STREAK_FILE = config.streakFile;

// Ensure standup directory exists - moved after config loads
function ensureStandupDirExists() {
  if (!existsSync(STANDUP_DIR)) {
    mkdirSync(STANDUP_DIR, { recursive: true });
  }
}

// Helper to wait for user input before closing
async function pressAnyKey(message: string = 'Press Enter to continue...') {
  await p.text({
    message,
    placeholder: '',
    defaultValue: '',
  });
}

interface StandupData {
  date: string;
  mood: string;
  accomplishments: string[];
  blockers: string[];
  todaysPlan: string[];
}

interface StreakData {
  current: number;
  longest: number;
  lastStandup: string;
}

async function getStreakData(): Promise<StreakData> {
  if (!existsSync(STREAK_FILE)) {
    return { current: 0, longest: 0, lastStandup: '' };
  }
  const text = await Bun.file(STREAK_FILE).text();
  return JSON.parse(text);
}

async function updateStreak() {
  const streak = await getStreakData();
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');

  if (streak.lastStandup === today) {
    // Already did standup today
    return streak;
  } else if (streak.lastStandup === yesterday) {
    // Continuing streak
    streak.current++;
  } else if (streak.lastStandup === '') {
    // First standup
    streak.current = 1;
  } else {
    // Streak broken
    streak.current = 1;
  }

  streak.longest = Math.max(streak.longest, streak.current);
  streak.lastStandup = today;

  await Bun.write(STREAK_FILE, JSON.stringify(streak, null, 2));
  return streak;
}

async function getLastStandup(): Promise<{ file: string; date: Date; data: Partial<StandupData> } | null> {
  const files = readdirSync(STANDUP_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const lastFile = files[0];
  const dateStr = lastFile.replace('.md', '');
  const date = parseISO(dateStr);
  const content = await Bun.file(join(STANDUP_DIR, lastFile)).text();

  return { file: lastFile, date, data: {} };
}

function getSmartDateMessage(lastStandupDate: Date | null): string {
  if (!lastStandupDate) {
    return 'What did you accomplish?';
  }

  const today = new Date();
  const daysDiff = differenceInDays(today, lastStandupDate);

  if (daysDiff === 1) {
    return 'What did you accomplish since yesterday?';
  } else if (daysDiff === 3 && format(today, 'EEEE') === 'Monday') {
    return 'What did you accomplish since Friday?';
  } else if (daysDiff > 1) {
    return `What did you accomplish since ${format(lastStandupDate, 'EEEE')} (${daysDiff} days ago)?`;
  }

  return 'What did you accomplish today so far?';
}

/**
 * Generate smart time range options based on current day of week
 */
function getSmartTimeRangeOptions() {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const options = [];

  // Helper to calculate hours since a specific day of week
  const hoursSinceDay = (targetDay: number): number => {
    let daysAgo = currentDay - targetDay;
    if (daysAgo <= 0) daysAgo += 7; // If target is in future this week, go back to last week
    return daysAgo * 24;
  };

  // Determine which option should be recommended based on current day
  const getRecommendedDay = (): number => {
    if (currentDay === 1) return 5; // Monday → Friday
    if (currentDay === 2 || currentDay === 3) return 1; // Tue/Wed → Monday
    if (currentDay === 4 || currentDay === 5) return 1; // Thu/Fri → Monday
    if (currentDay === 6 || currentDay === 0) return 5; // Weekend → Friday
    return -1; // No recommendation
  };

  const recommendedDay = getRecommendedDay();

  // Build all weekday options first
  const weekdays = [
    { day: 1, name: 'Monday' },
    { day: 2, name: 'Tuesday' },
    { day: 3, name: 'Wednesday' },
    { day: 4, name: 'Thursday' },
    { day: 5, name: 'Friday' },
  ];

  const weekdayOptions = [];
  let recommendedOption = null;

  for (const { day, name } of weekdays) {
    const hours = hoursSinceDay(day);
    // Only show if it's actually in the past (not today)
    if (hours > 0 && hours <= 168) {
      const option = {
        value: String(hours),
        label: `Since ${name}`,
        hint: day === recommendedDay ? 'Recommended' : '',
      };

      if (day === recommendedDay) {
        recommendedOption = option;
      } else {
        weekdayOptions.push(option);
      }
    }
  }

  // Add recommended option first if it exists
  if (recommendedOption) {
    options.push(recommendedOption);
  }

  // Add yesterday
  options.push({
    value: '24',
    label: 'Since yesterday',
  });

  // Add remaining weekday options
  options.push(...weekdayOptions);

  // Offer last week
  options.push({
    value: '168',
    label: 'Last week (7 days)',
  });

  // Custom option
  options.push({
    value: 'custom',
    label: 'Custom hours',
  });

  return options;
}

async function askMultiLineQuestion(message: string, placeholder: string): Promise<string[] | symbol> {
  const items: string[] = [];

  while (true) {
    const item = await p.text({
      message: items.length === 0 ? message : 'Add another?',
      placeholder: items.length === 0 ? placeholder : 'Press Enter to skip, or add another item...',
    });

    if (p.isCancel(item)) {
      return p.cancel();
    }

    const trimmedItem = String(item || '').trim();

    if (!trimmedItem && items.length > 0) {
      // Empty input and we have at least one item - done
      break;
    }

    if (!trimmedItem && items.length === 0) {
      // First input is empty - ask if they want to skip
      const skipConfirm = await p.confirm({
        message: 'Skip this section?',
        initialValue: true,
      });

      if (p.isCancel(skipConfirm)) {
        return p.cancel();
      }

      if (skipConfirm) {
        return ['None'];
      }
      // If they don't want to skip, loop continues
      continue;
    }

    if (trimmedItem) {
      items.push(trimmedItem);
    }

    if (items.length > 0) {
      const continueAdding = await p.confirm({
        message: 'Add another item?',
        initialValue: false,
      });

      if (p.isCancel(continueAdding) || !continueAdding) {
        break;
      }
    }
  }

  return items.length > 0 ? items : ['None'];
}

async function confirmAnswer(question: string, answer: string): Promise<'yes' | 'edit' | 'restart'> {
  const preview = answer.length > 100 ? answer.substring(0, 100) + '...' : answer;

  const choice = await p.select({
    message: `${question}\n✓ ${preview}`,
    options: [
      { value: 'yes', label: 'Correct, continue' },
      { value: 'edit', label: 'Edit this answer' },
      { value: 'restart', label: 'Start over from beginning' },
    ],
  });

  if (p.isCancel(choice)) {
    return 'restart';
  }

  return choice as 'yes' | 'edit' | 'restart';
}

async function runAutoStandup() {
  // Show helpful message if config was just created
  if (wasConfigFileCreated()) {
    const configPath = join(process.env.HOME || '~', '.standup-cli', 'config.json');
    console.log(pc.cyan('ℹ️  Created default config file'));
    console.log(pc.dim(`   Location: ${configPath}`));
    console.log(pc.dim(`   To enable AI: Set "enableAI": true and install Ollama`));
    console.log('');
  }

  // Check if standup for today already exists
  const today = format(new Date(), 'yyyy-MM-dd');
  const todayFile = join(STANDUP_DIR, `${today}.md`);

  if (existsSync(todayFile)) {
    console.log(pc.yellow('⚠️  Standup already exists for today'));
    console.log(pc.dim(`File: ${todayFile}`));

    const existingContent = await Bun.file(todayFile).text();
    console.log('\n' + pc.dim('--- Existing standup ---'));
    console.log(existingContent);
    console.log(pc.dim('--- End of standup ---\n'));

    const shouldOverwrite = await p.confirm({
      message: 'Do you want to overwrite this standup?',
      initialValue: false,
    });

    if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
      console.log(pc.cyan('Keeping existing standup.'));
      process.exit(0);
    }

    console.log(pc.yellow('Overwriting existing standup...\n'));
  }

  try {
    // Auto-detect time range based on day of week
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

    // If Monday, go back to Friday (72 hours). Otherwise, yesterday (24 hours)
    const hoursToGoBack = currentDay === 1 ? 72 : 24;
    const sinceDate = new Date(Date.now() - hoursToGoBack * 60 * 60 * 1000);

    // Check git installation
    const gitInstalled = await checkGitInstalled();
    if (!gitInstalled) {
      console.log(pc.red('✗ Git not found. Cannot scan commits.'));
      console.log(getGitInstallMessage());
      process.exit(1);
    }

    // Scan git repositories
    const repos = await findGitRepositories();
    if (repos.length === 0) {
      console.log(pc.yellow('⚠️  No git repositories found'));
      console.log(getNoReposFoundMessage(config.gitScanPath));
      process.exit(1);
    }

    const gitResult = await aggregateCommits(repos, sinceDate);

    if (gitResult.totalCommits === 0) {
      console.log(pc.yellow('⚠️  No commits found in the time range'));
      console.log(pc.dim(`Scanned since: ${format(sinceDate, 'EEEE d MMMM yyyy HH:mm')}`));
      process.exit(1);
    }

    // Generate summary (AI if enabled and available, otherwise simple)
    const date = new Date();
    const context = {
      dayOfWeek: format(date, 'EEEE'),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      hour: date.getHours(),
    };

    let summary;
    let usedAI = false;

    // Try AI if enabled in config
    if (config.enableAI) {
      const ollamaReady = await isOllamaAvailable();

      if (ollamaReady) {
        console.log(pc.cyan(`✓ Found ${gitResult.totalCommits} commits, generating AI summary...`));
        try {
          summary = await generateStandupSummary(gitResult.groups, gitResult.totalCommits, context);
          usedAI = true;
        } catch (error) {
          console.log(pc.yellow(`⚠️  AI summary failed, using simple summary`));
          if (process.env.DEBUG === 'true') {
            console.error(error);
          }
        }
      } else {
        console.log(pc.yellow(`⚠️  Ollama not available, using simple summary`));
        console.log(pc.dim(`   To enable AI: Install Ollama and run 'ollama pull qwen2.5:7b'`));
      }
    }

    // Fallback to simple summary
    if (!summary) {
      console.log(pc.cyan(`✓ Found ${gitResult.totalCommits} commits, generating summary...`));
      summary = generateSimpleSummary(gitResult.groups, gitResult.totalCommits, context);
    }

    // Build markdown file
    const filename = `${format(date, 'yyyy-MM-dd')}.md`;
    const filepath = join(STANDUP_DIR, filename);

    const formatList = (items: string[]) => {
      if (items.length === 1 && items[0] === 'None') return 'None';
      return items.map(item => `- ${item}`).join('\n');
    };

    // Add detailed git activity section (collapsed/optional)
    const formatted = formatCommitsGrouped(gitResult.groups);
    const gitActivitySection = `\n## 📊 Git Summary\n\n${summary.gitSummary}\n\n<details>
<summary>📦 Detailed Git Activity (${gitResult.totalCommits} commits)</summary>

${formatted.join('\n')}

</details>\n`;

    const markdown = `# Standup - ${format(date, 'EEEE, MMMM do, yyyy')}

## 😊 Mood

${summary.mood}

## ✅ Accomplishments

${formatList(summary.accomplishments)}

## 🚧 Blockers

${formatList(summary.blockers)}

## 📋 Today's Plan

${formatList(summary.todaysPlan)}
${gitActivitySection}
---

*Generated automatically at ${format(date, 'HH:mm:ss')}*
`;

    // Save to file
    await Bun.write(filepath, markdown);

    // Update streak
    const updatedStreak = await updateStreak();

    // Copy to clipboard
    let clipboardSuccess = false;
    const clipboardCheck = await checkClipboardAvailable();

    if (clipboardCheck.available) {
      try {
        const clipboardTools = [
          ['wl-copy'],
          ['xclip', '-selection', 'clipboard'],
          ['xsel', '--clipboard']
        ];

        for (const tool of clipboardTools) {
          try {
            const proc = Bun.spawn(tool, {
              stdin: 'pipe',
              stdout: 'ignore',
              stderr: 'ignore',
            });
            proc.stdin.write(markdown);
            proc.stdin.end();
            await proc.exited;
            if (proc.exitCode === 0) {
              clipboardSuccess = true;
              break;
            }
          } catch {
            continue;
          }
        }
      } catch {
        // Clipboard failed, that's ok
      }
    }

    // Show success message
    const streakEmoji = updatedStreak.current >= 7 ? '🔥' : updatedStreak.current >= 3 ? '⚡' : '✨';
    const aiStatus = usedAI ? pc.magenta(' (AI-powered)') : '';
    console.log(pc.green(`✓ Standup generated successfully${aiStatus}`));
    console.log(pc.green(`${streakEmoji} Streak: ${updatedStreak.current} days`) + pc.gray(` (Longest: ${updatedStreak.longest})`));

    if (clipboardSuccess) {
      console.log(pc.cyan('📋 Copied to clipboard'));
    }

    console.log(pc.dim(`Saved to: ${filepath}`));

    // Check if it's Friday and generate weekly retro
    if (await isRetroDay()) {
      console.log('');
      const retroResult = await runAutoRetro();
      if (retroResult.success) {
        console.log(pc.green(`✓ ${retroResult.message}`));
        console.log(pc.dim(`Saved to: ${retroResult.filepath}`));
      } else if (retroResult.message !== 'Not retro day') {
        console.log(pc.dim(`ℹ️  Weekly retro: ${retroResult.message}`));
      }
    }

  } catch (error) {
    console.error(pc.red('✗ Failed to generate standup'));
    console.error(pc.red(String(error)));
    process.exit(1);
  }
}

async function runStandup() {
  // Check if standup for today already exists
  const today = format(new Date(), 'yyyy-MM-dd');
  const todayFile = join(STANDUP_DIR, `${today}.md`);

  if (existsSync(todayFile)) {
    p.intro(pc.bgYellow(pc.black(' ⚠️  Standup Already Exists ')));

    const existingContent = await Bun.file(todayFile).text();
    p.note(existingContent, pc.yellow('Existing standup for today:'));

    const shouldOverwrite = await p.confirm({
      message: 'Do you want to overwrite this standup?',
      initialValue: false,
    });

    if (p.isCancel(shouldOverwrite)) {
      p.cancel('Standup cancelled');
      process.exit(0);
    }

    if (!shouldOverwrite) {
      p.outro('Keeping existing standup. Use search/review to view past standups.');
      process.exit(0);
    }
  }

  let restart = true;

  while (restart) {
    restart = false;
    console.clear();

    p.intro(pc.bgCyan(pc.black(' 📋 Daily Standup ')));

    const streak = await getStreakData();
    if (streak.current > 0) {
      const streakEmoji = streak.current >= 7 ? '🔥' : streak.current >= 3 ? '⚡' : '✨';
      p.note(
        pc.green(`${streakEmoji} Current: ${pc.bold(String(streak.current))} days`) +
        pc.gray(' | ') +
        pc.yellow(`🏆 Longest: ${pc.bold(String(streak.longest))} days`),
        pc.cyan('Streak')
      );
    }

    // Get last standup for smart date detection
    const lastStandup = await getLastStandup();
    const smartDateMessage = getSmartDateMessage(lastStandup?.date || null);

    // Scan git repositories for commits FIRST (so we can use AI suggestions)
    let gitResult: GitAggregationResult | null = null;
    let gitAccomplishments: string[] = [];

    const scanGit = await p.confirm({
      message: 'Scan git repos for recent commits?',
      initialValue: true,
    });

    if (p.isCancel(scanGit)) {
      p.cancel('Standup cancelled');
      process.exit(0);
    }

    if (scanGit) {
      // Check if git is installed
      const gitInstalled = await checkGitInstalled();
      if (!gitInstalled) {
        p.note(getGitInstallMessage(), pc.red('Git Not Found'));
        p.log.warn('Skipping git scan. You can still manually enter accomplishments.');
        // Continue without git scan
      } else {
        const spinner = p.spinner();
        spinner.start(pc.cyan('Scanning git repositories...'));

        try {
          const repos = await findGitRepositories();

          if (repos.length === 0) {
            spinner.stop(pc.yellow('No repositories found'));
            p.note(getNoReposFoundMessage(config.gitScanPath), pc.yellow('No Repos'));
            // Continue without git scan
          } else {

        // Ask user for time range with smart day-based options
        const timeRange = await p.select({
          message: 'How far back to scan for commits?',
          options: getSmartTimeRangeOptions(),
        });

        if (p.isCancel(timeRange)) {
          p.cancel('Standup cancelled');
          process.exit(0);
        }

        let hoursToGoBack: number;

        if (timeRange === 'custom') {
          const customHours = await p.text({
            message: 'How many hours back?',
            placeholder: 'e.g., 72, 168 (1 week)',
            validate: (value) => {
              const num = parseInt(value);
              if (isNaN(num) || num <= 0) {
                return 'Please enter a positive number';
              }
            },
          });

          if (p.isCancel(customHours)) {
            p.cancel('Standup cancelled');
            process.exit(0);
          }

          hoursToGoBack = parseInt(String(customHours));
        } else {
          hoursToGoBack = parseInt(String(timeRange));
        }

        const sinceDate = new Date(Date.now() - hoursToGoBack * 60 * 60 * 1000);
        gitResult = await aggregateCommits(repos, sinceDate);

        spinner.stop(
          pc.green(`Found ${pc.bold(String(gitResult.totalCommits))} commits in ${pc.bold(String(gitResult.groups.length))} repos`)
        );

        if (gitResult.totalCommits > 0) {
          // Ask for display format
          const displayFormat = await p.select({
            message: 'How to display commits?',
            options: [
              { value: 'grouped', label: pc.cyan('Grouped by repository'), hint: 'Organized view' },
              { value: 'flat', label: pc.yellow('Flat list with tags'), hint: 'Compact view' },
            ],
          });

          if (p.isCancel(displayFormat)) {
            p.cancel('Standup cancelled');
            process.exit(0);
          }

          console.log('');
          const formatted =
            displayFormat === 'grouped'
              ? formatCommitsGrouped(gitResult.groups)
              : formatCommitsFlat(gitResult.groups);

          p.note(formatted.join('\n'), pc.magenta('📦 Recent Git Activity'));
          console.log('');

          // Pre-fill accomplishments
          gitAccomplishments = commitsToAccomplishments(gitResult.groups);
        } else {
          p.log.info(pc.yellow('No commits found in the selected time range'));
        }
          } // end if repos.length > 0
        } catch (error) {
          spinner.stop(pc.red('Failed to scan git repos'));
          p.log.warn(pc.yellow('Could not scan git repositories, continuing without...'));
        }
      } // end if gitInstalled
    }

    // Question 1: Mood
    let mood: any;
    let moodLabel: string;
    const moodOptions = [
      { value: '🔥', label: 'Amazing - On fire!' },
      { value: '😊', label: 'Good - Feeling productive' },
      { value: '😐', label: 'Okay - Just another day' },
      { value: '😔', label: 'Struggling - Need support' },
      { value: '😫', label: 'Burnt out - Need a break' },
      { value: 'custom', label: '✏️  Custom mood', hint: 'Write your own' },
    ];

    // Try to suggest AI mood if we have git commits and AI is enabled
    let aiSuggestedMood: string | null = null;
    if (config.enableAI && gitResult && gitResult.totalCommits > 0) {
      const ollamaReady = await isOllamaAvailable();
      if (ollamaReady) {
        try {
          aiSuggestedMood = await suggestMood(gitResult.groups, gitResult.totalCommits);
          if (aiSuggestedMood) {
            // Add AI suggestion as first option
            moodOptions.unshift({
              value: 'ai-suggestion',
              label: aiSuggestedMood,
              hint: '🤖 AI suggested'
            });
          }
        } catch {
          // AI failed, continue without suggestion
        }
      }
    }

    while (true) {
      const moodChoice = await p.select({
        message: 'How are you feeling today?',
        options: moodOptions,
      });

      if (p.isCancel(moodChoice)) {
        p.cancel('Standup cancelled');
        process.exit(0);
      }

      if (moodChoice === 'ai-suggestion') {
        // User selected AI suggestion
        mood = '';
        moodLabel = aiSuggestedMood || 'AI suggested';
      } else if (moodChoice === 'custom') {
        // Custom mood input
        const customMood = await p.text({
          message: 'Describe your mood:',
          placeholder: 'e.g., Excited about new project, Tired but motivated...',
        });

        if (p.isCancel(customMood)) {
          p.cancel('Standup cancelled');
          process.exit(0);
        }

        mood = '';
        moodLabel = String(customMood || '').trim() || 'No mood specified';
      } else {
        mood = moodChoice;
        moodLabel = moodOptions.find(opt => opt.value === moodChoice)?.label || 'Unknown';
      }

      const displayMood = mood ? `${mood} ${moodLabel}` : moodLabel;
      const confirmation = await confirmAnswer('Mood:', displayMood);

      if (confirmation === 'restart') {
        restart = true;
        break;
      } else if (confirmation === 'yes') {
        break;
      }
      // If 'edit', loop continues
    }

    if (restart) continue;

    // Question 2: Accomplishments (multi-line)
    const customQuestions = config.customQuestions!;
    let accomplishments: string[];

    if (customQuestions.accomplishments?.enabled !== false) {
      while (true) {
        // If we have git commits, offer to use them
        if (gitAccomplishments.length > 0) {
        const useGitCommits = await p.confirm({
          message: 'Use git commits as accomplishments?',
          initialValue: true,
        });

        if (p.isCancel(useGitCommits)) {
          p.cancel('Standup cancelled');
          process.exit(0);
        }

        if (useGitCommits) {
          accomplishments = [...gitAccomplishments];

          // Inner loop for handling git commit options
          while (true) {
            // Show preview and allow editing
            const preview = accomplishments.join('\n- ');
            p.note(preview, 'Pre-filled from git commits');

            // Build options for what to do with git commits
            const gitCommitOptions = [
              { value: 'keep', label: 'Keep as is' },
              { value: 'add', label: 'Add more items' },
              { value: 'edit', label: 'Start over manually' },
            ];

            // Add AI improve option if AI is enabled
            if (config.enableAI) {
              const ollamaReady = await isOllamaAvailable();
              if (ollamaReady) {
                gitCommitOptions.splice(1, 0, {
                  value: 'ai-improve',
                  label: '🤖 AI improve descriptions',
                  hint: 'Make them more impactful'
                });
              }
            }

            const editChoice = await p.select({
              message: 'What would you like to do?',
              options: gitCommitOptions,
            });

            if (p.isCancel(editChoice)) {
              p.cancel('Standup cancelled');
              process.exit(0);
            }

            if (editChoice === 'keep') {
              break;
            } else if (editChoice === 'ai-improve') {
              // AI improve accomplishments
              const spinner = p.spinner();
              spinner.start(pc.cyan('AI is improving your accomplishments...'));

              try {
                const improved = await improveAccomplishments(accomplishments, gitResult?.groups);
                spinner.stop(pc.green('✓ AI suggestions ready'));

                if (improved && improved.length > 0) {
                  accomplishments = improved;
                  const improvedPreview = accomplishments.join('\n- ');
                  p.note(improvedPreview, pc.magenta('🤖 AI-improved accomplishments'));

                  const acceptImproved = await p.confirm({
                    message: 'Use these AI-improved descriptions?',
                    initialValue: true,
                  });

                  if (p.isCancel(acceptImproved)) {
                    p.cancel('Standup cancelled');
                    process.exit(0);
                  }

                  if (acceptImproved) {
                    break;
                  }
                  // If not accepted, loop continues to show options again
                } else {
                  spinner.stop(pc.yellow('⚠️  AI improvement failed'));
                  p.log.warn('Could not improve accomplishments, keeping originals');
                  // Loop back to show options menu again
                }
              } catch (error) {
                spinner.stop(pc.red('✗ AI failed'));
                p.log.warn('AI improvement failed, keeping originals');
                if (DEBUG) {
                  console.error('[DEBUG] AI improvement error:', error);
                }
                // Loop back to show options menu again
              }
            } else if (editChoice === 'add') {
            // Add more items to existing
            while (true) {
              const item = await p.text({
                message: 'Add another accomplishment?',
                placeholder: 'Press Enter to skip...',
              });

              if (p.isCancel(item)) {
                p.cancel('Standup cancelled');
                process.exit(0);
              }

              const trimmed = String(item || '').trim();
              if (!trimmed) break;

              accomplishments.push(trimmed);

              const continueAdding = await p.confirm({
                message: 'Add another?',
                initialValue: false,
              });

              if (p.isCancel(continueAdding) || !continueAdding) {
                break;
              }
            }
            break;
            } else if (editChoice === 'edit') {
              // Break out of both loops to go to manual entry
              break;
            }
          } // end inner while loop for git commit options

          // If user chose 'edit', break out to manual entry
          if (accomplishments.length > 0) {
            break; // Break outer loop, we have accomplishments
          }
        }
      }

      const result = await askMultiLineQuestion(
        customQuestions.accomplishments?.message || 'What did you accomplish?',
        'Describe what you accomplished...'
      );

      if (p.isCancel(result)) {
        p.cancel('Standup cancelled');
        process.exit(0);
      }

      accomplishments = result as string[];
      const preview = accomplishments.join('\n- ');
      const confirmation = await confirmAnswer('Accomplishments:', preview);

      if (confirmation === 'restart') {
        restart = true;
        break;
      } else if (confirmation === 'yes') {
        break;
      }
    }

    if (restart) continue;
    } else {
      accomplishments = [];
    }

    // Question 3: Blockers (multi-line)
    let blockers: string[];
    let blockersSet = false;
    if (customQuestions.blockers?.enabled !== false) {
      // Try to suggest blockers with AI if enabled and we have git data
      if (config.enableAI && gitResult && gitResult.totalCommits > 0) {
        const ollamaReady = await isOllamaAvailable();
        if (ollamaReady) {
          try {
            const spinner = p.spinner();
            spinner.start(pc.cyan('AI is analyzing for potential blockers...'));
            const aiSuggestedBlockers = await suggestBlockers(gitResult.groups);
            spinner.stop(pc.green('✓ Analysis complete'));

            if (aiSuggestedBlockers && aiSuggestedBlockers.length > 0 && aiSuggestedBlockers[0] !== 'None') {
              p.note(aiSuggestedBlockers.map(b => `- ${b}`).join('\n'), pc.yellow('🤖 AI detected potential blockers'));

              const useAiBlockers = await p.confirm({
                message: 'Use these AI-detected blockers?',
                initialValue: false,
              });

              if (p.isCancel(useAiBlockers)) {
                p.cancel('Standup cancelled');
                process.exit(0);
              }

              if (useAiBlockers) {
                blockers = aiSuggestedBlockers;
                const preview = blockers.join('\n- ');
                const confirmation = await confirmAnswer('Blockers:', preview);

                if (confirmation === 'restart') {
                  restart = true;
                } else if (confirmation === 'yes') {
                  blockersSet = true;
                }
                // If 'edit', continue to manual entry below
              }
            }
          } catch {
            // AI failed, continue to manual entry
          }
        }
      }

      if (restart) {
        continue;
      }

      if (!blockersSet) {
        while (true) {
        const result = await askMultiLineQuestion(
          customQuestions.blockers?.message || 'Any blockers or help needed?',
          'Describe blockers, or press Enter for none...'
        );

      if (p.isCancel(result)) {
        p.cancel('Standup cancelled');
        process.exit(0);
      }

      blockers = result as string[];
      const preview = blockers.join('\n- ');
      const confirmation = await confirmAnswer('Blockers:', preview);

      if (confirmation === 'restart') {
        restart = true;
        break;
      } else if (confirmation === 'yes') {
        break;
      }
    }
      }

    if (restart) continue;
    } else {
      blockers = [];
    }

    // Question 4: Today's plan (multi-line)
    let todaysPlan: string[];
    let planSet = false;
    if (customQuestions.todaysPlan?.enabled !== false) {
      // Try to suggest today's plan with AI if enabled and we have git data
      if (config.enableAI && gitResult && gitResult.totalCommits > 0) {
        const ollamaReady = await isOllamaAvailable();
        if (ollamaReady) {
          try {
            const spinner = p.spinner();
            spinner.start(pc.cyan('AI is suggesting next steps...'));
            const aiSuggestedPlan = await suggestTodaysPlan(gitResult.groups, accomplishments);
            spinner.stop(pc.green('✓ Suggestions ready'));

            if (aiSuggestedPlan && aiSuggestedPlan.length > 0) {
              p.note(aiSuggestedPlan.map(p => `- ${p}`).join('\n'), pc.blue('🤖 AI suggested plan'));

              const useAiPlan = await p.confirm({
                message: 'Use these AI suggestions for today\'s plan?',
                initialValue: true,
              });

              if (p.isCancel(useAiPlan)) {
                p.cancel('Standup cancelled');
                process.exit(0);
              }

              if (useAiPlan) {
                todaysPlan = aiSuggestedPlan;
                const preview = todaysPlan.join('\n- ');
                const confirmation = await confirmAnswer("Today's Plan:", preview);

                if (confirmation === 'restart') {
                  restart = true;
                } else if (confirmation === 'yes') {
                  planSet = true;
                }
                // If 'edit', continue to manual entry below
              }
            }
          } catch {
            // AI failed, continue to manual entry
          }
        }
      }

      if (restart) {
        continue;
      }

      if (!planSet) {
        while (true) {
        const result = await askMultiLineQuestion(
          customQuestions.todaysPlan?.message || 'What will you focus on today?',
          'Describe your priorities for today...'
        );

      if (p.isCancel(result)) {
        p.cancel('Standup cancelled');
        process.exit(0);
      }

      todaysPlan = result as string[];
      const preview = todaysPlan.join('\n- ');
      const confirmation = await confirmAnswer("Today's Plan:", preview);

      if (confirmation === 'restart') {
        restart = true;
        break;
      } else if (confirmation === 'yes') {
        break;
      }
    }
      }

    if (restart) continue;
    } else {
      todaysPlan = [];
    }

    // Additional custom fields
    const customFieldsData: Record<string, string | string[]> = {};
    if (customQuestions.additionalFields && customQuestions.additionalFields.length > 0) {
      for (const field of customQuestions.additionalFields) {
        while (true) {
          if (field.type === 'multiline') {
            const result = await askMultiLineQuestion(
              field.message,
              'Enter response, or press Enter to skip...'
            );

            if (p.isCancel(result)) {
              p.cancel('Standup cancelled');
              process.exit(0);
            }

            customFieldsData[field.id] = result as string[];
            const preview = (result as string[]).join('\n- ');
            const confirmation = await confirmAnswer(field.message, preview);

            if (confirmation === 'restart') {
              restart = true;
              break;
            } else if (confirmation === 'yes') {
              break;
            }
          } else {
            // text type
            const result = await p.text({
              message: field.message,
              placeholder: 'Press Enter to skip...',
            });

            if (p.isCancel(result)) {
              p.cancel('Standup cancelled');
              process.exit(0);
            }

            customFieldsData[field.id] = String(result || '').trim();
            break;
          }
        }

        if (restart) break;
      }
    }

    if (restart) continue;

    // Save the standup
    const spinner = p.spinner();
    spinner.start(pc.cyan('Saving standup...'));

    const date = new Date();
    const filename = `${format(date, 'yyyy-MM-dd')}.md`;
    const filepath = join(STANDUP_DIR, filename);

    const formatList = (items: string[]) => {
      if (items.length === 1 && items[0] === 'None') return 'None';
      return items.map(item => `- ${item}`).join('\n');
    };

    const moodDisplay = mood ? `${mood} ${moodLabel}` : moodLabel;

    // Add git activity section if available
    let gitActivitySection = '';
    if (gitResult && gitResult.totalCommits > 0) {
      const formatted = formatCommitsGrouped(gitResult.groups);
      gitActivitySection = `\n## 📦 Git Activity (${gitResult.totalCommits} commits)\n\n${formatted.join('\n')}\n`;
    }

    // Build custom fields markdown
    let customFieldsMarkdown = '';
    if (Object.keys(customFieldsData).length > 0) {
      for (const field of customQuestions.additionalFields || []) {
        const value = customFieldsData[field.id];
        if (value && (Array.isArray(value) ? value.length > 0 : value.trim())) {
          const label = field.message.replace(/\?$/, ''); // Remove trailing ?
          customFieldsMarkdown += `\n## ${label}\n\n`;
          if (Array.isArray(value)) {
            customFieldsMarkdown += formatList(value);
          } else {
            customFieldsMarkdown += `${value}\n`;
          }
        }
      }
    }

    const markdown = `# Standup - ${format(date, 'EEEE, MMMM do, yyyy')}

## 😊 Mood

${moodDisplay}
${customQuestions.accomplishments?.enabled !== false ? `
## ✅ ${customQuestions.accomplishments?.message || 'Accomplishments'}

${formatList(accomplishments)}
` : ''}${customQuestions.blockers?.enabled !== false ? `
## 🚧 ${customQuestions.blockers?.message || 'Blockers'}

${formatList(blockers)}
` : ''}${customQuestions.todaysPlan?.enabled !== false ? `
## 📋 ${customQuestions.todaysPlan?.message || "Today's Plan"}

${formatList(todaysPlan)}
` : ''}${customFieldsMarkdown}${gitActivitySection}
---

*Generated at ${format(date, 'HH:mm:ss')}*
`;

    await Bun.write(filepath, markdown);
    const updatedStreak = await updateStreak();

    spinner.stop(pc.green('✓ Standup saved!'));

    // Try to copy to clipboard
    let clipboardSuccess = false;
    const clipboardCheck = await checkClipboardAvailable();

    if (clipboardCheck.available) {
      try {
        // Try wl-copy (Wayland), xclip (X11), or xsel (X11)
        const clipboardTools = [
          ['wl-copy'],
          ['xclip', '-selection', 'clipboard'],
          ['xsel', '--clipboard']
        ];

        for (const tool of clipboardTools) {
          try {
            const proc = Bun.spawn(tool, {
              stdin: 'pipe',
              stdout: 'ignore',
              stderr: 'ignore',
            });
            proc.stdin.write(markdown);
            proc.stdin.end();
            await proc.exited;
            if (proc.exitCode === 0) {
              clipboardSuccess = true;
              break;
            }
          } catch {
            continue;
          }
        }
      } catch {
        // Clipboard failed, that's ok
      }
    } else {
      p.note(getClipboardToolsMessage(), pc.yellow('Clipboard Unavailable'));
    }

    console.log('');
    const streakEmoji = updatedStreak.current >= 7 ? '🔥' : updatedStreak.current >= 3 ? '⚡' : '✨';
    p.log.success(
      pc.green(`${streakEmoji} Streak: ${pc.bold(String(updatedStreak.current))} days `) +
      pc.gray(`(Longest: ${updatedStreak.longest})`)
    );

    if (clipboardSuccess) {
      p.log.success(pc.green('📋 Standup copied to clipboard! ') + pc.cyan('Ready to paste into Slack'));
    }

    console.log('');
    p.note(pc.dim(filepath), pc.cyan('📁 Saved to'));
    console.log('');

    p.outro(pc.bgGreen(pc.black(' Have a great day! 🚀 ')));

    await pressAnyKey('Press Enter to close...');
  }
}

async function showStats() {
  console.clear();
  p.intro(pc.bgMagenta(pc.black(' 📊 Standup Statistics ')));

  const files = readdirSync(STANDUP_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    p.note('No standups found yet!', 'Empty');
    p.outro('Run your first standup to see stats');
    return;
  }

  const moodCounts: Record<string, number> = {};
  let totalStandups = 0;
  let withBlockers = 0;

  for (const file of files) {
    const content = await Bun.file(join(STANDUP_DIR, file)).text();
    totalStandups++;

    const moodMatch = content.match(/## Mood\n(.+)/);
    if (moodMatch) {
      const mood = moodMatch[1].trim();
      moodCounts[mood] = (moodCounts[mood] || 0) + 1;
    }

    if (content.includes('## Blockers\n') && !content.match(/## Blockers\n(None|$)/)) {
      withBlockers++;
    }
  }

  const streak = await getStreakData();

  const moodStats = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([mood, count]) => `  ${mood} ${pc.cyan(String(count) + 'x')}`)
    .join('\n');

  p.note(
    pc.bold(pc.blue('📈 Overview\n')) +
    `  ${pc.yellow('Total Standups:')} ${pc.bold(String(totalStandups))}\n` +
    `  ${pc.green('Current Streak:')} ${pc.bold(String(streak.current))} days\n` +
    `  ${pc.magenta('Longest Streak:')} ${pc.bold(String(streak.longest))} days\n` +
    `  ${pc.red('Days with Blockers:')} ${pc.bold(String(withBlockers))}\n\n` +
    pc.bold(pc.blue('😊 Mood Distribution\n')) +
    moodStats,
    pc.magenta('Statistics')
  );

  p.outro(pc.bgYellow(pc.black(' Keep up the good work! 💪 ')));

  await pressAnyKey('Press Enter to close...');
}

async function searchStandups() {
  console.clear();
  p.intro(pc.bgBlue(pc.black(' 🔍 Search Standups ')));

  const query = await p.text({
    message: 'Search for:',
    placeholder: 'Enter keyword or date (YYYY-MM-DD)...',
  });

  if (p.isCancel(query)) {
    p.cancel('Search cancelled');
    return;
  }

  const files = readdirSync(STANDUP_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();

  const results: string[] = [];

  for (const file of files) {
    const content = await Bun.file(join(STANDUP_DIR, file)).text();
    if (content.toLowerCase().includes(String(query).toLowerCase()) || file.includes(String(query))) {
      results.push(file);
    }
  }

  if (results.length === 0) {
    p.note(pc.yellow('No standups found matching your search.'), pc.red('No Results'));
  } else {
    const selected = await p.select({
      message: pc.green(`Found ${pc.bold(String(results.length))} result(s). Select one to view:`),
      options: results.map(file => ({
        value: file,
        label: pc.cyan(file.replace('.md', '')),
      })),
    });

    if (!p.isCancel(selected)) {
      const content = await Bun.file(join(STANDUP_DIR, String(selected))).text();
      console.log('\n');
      p.note(content, pc.blue(String(selected)));
    }
  }

  p.outro(pc.bgBlue(pc.black(' Search complete ✨ ')));

  await pressAnyKey('Press Enter to close...');
}

async function runWeeklyRetro() {
  console.clear();
  p.intro(pc.bgMagenta(pc.black(' 🔄 Weekly Retrospective ')));

  // Check if retro already exists for this week
  if (await retroExistsForWeek()) {
    const overwrite = await p.confirm({
      message: 'A retrospective already exists for this week. Generate a new one?',
      initialValue: false,
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.outro('Keeping existing retrospective.');
      return;
    }
  }

  // Get this week's standups
  const spinner = p.spinner();
  spinner.start(pc.cyan('Gathering standups from this week...'));

  const standups = await getWeekStandups();

  if (standups.length === 0) {
    spinner.stop(pc.yellow('No standups found'));
    p.note('No standups found for this week (Mon-Fri).', pc.yellow('Empty Week'));
    p.outro('Complete some standups first to generate a retrospective.');
    await pressAnyKey('Press Enter to close...');
    return;
  }

  spinner.stop(pc.green(`Found ${standups.length} standup(s)`));

  // Show preview of what we found
  const preview = standups.map(s => `  ${pc.cyan(s.dayOfWeek)} (${s.date}): ${s.mood}`).join('\n');
  p.note(preview, pc.blue('This week\'s standups'));

  // Generate summary
  let summary;
  let usedAI = false;

  if (config.enableAI) {
    const ollamaReady = await isOllamaAvailable();
    if (ollamaReady) {
      spinner.start(pc.cyan('🤖 AI is analyzing your week...'));
      try {
        summary = await generateWeeklyRetro(standups);
        if (summary) {
          usedAI = true;
          spinner.stop(pc.green('✓ AI analysis complete'));
        } else {
          spinner.stop(pc.yellow('⚠️  AI analysis failed, using simple summary'));
        }
      } catch (error) {
        spinner.stop(pc.yellow('⚠️  AI failed, using simple summary'));
      }
    } else {
      p.log.warn(pc.yellow('Ollama not available, using simple summary'));
    }
  }

  if (!summary) {
    summary = generateSimpleRetro(standups);
  }

  // Save the retro
  spinner.start(pc.cyan('Saving retrospective...'));
  const filepath = await saveWeeklyRetro(standups, summary);
  spinner.stop(pc.green('✓ Retrospective saved!'));

  // Show summary
  const aiStatus = usedAI ? pc.magenta(' (AI-powered)') : '';
  console.log('');
  p.note(
    pc.bold(pc.blue('🎯 Key Themes\n')) +
    summary.themes.map(t => `  • ${t}`).join('\n') + '\n\n' +
    pc.bold(pc.green('🌟 Highlights\n')) +
    summary.highlights.slice(0, 3).map(h => `  • ${h}`).join('\n') + '\n\n' +
    pc.bold(pc.yellow('🚧 Challenges\n')) +
    summary.challenges.slice(0, 2).map(c => `  • ${c}`).join('\n') + '\n\n' +
    pc.bold(pc.cyan('🔮 Next Week Focus\n')) +
    summary.nextWeekFocus.map(f => `  • ${f}`).join('\n'),
    pc.magenta(`Weekly Retrospective Summary${aiStatus}`)
  );

  console.log('');
  p.note(pc.dim(filepath), pc.cyan('📁 Saved to'));
  console.log('');

  p.outro(pc.bgGreen(pc.black(' Great week! Time to reflect and grow 🌱 ')));

  await pressAnyKey('Press Enter to close...');
}

async function weeklyReview() {
  console.clear();
  p.intro(pc.bgGreen(pc.black(' 📅 Weekly Review ')));

  const now = new Date();
  const start = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const end = endOfWeek(now, { weekStartsOn: 1 }); // Sunday

  const files = readdirSync(STANDUP_DIR)
    .filter(f => f.endsWith('.md'))
    .filter(f => {
      const dateStr = f.replace('.md', '');
      try {
        const fileDate = parseISO(dateStr);
        return isWithinInterval(fileDate, { start, end });
      } catch {
        return false;
      }
    })
    .sort();

  if (files.length === 0) {
    p.note('No standups found for this week.', 'Empty');
    p.outro('Complete your standup to see weekly reviews');
    return;
  }

  let summary = pc.bold(pc.cyan(`Week of ${format(start, 'MMM do')} - ${format(end, 'MMM do')}`)) + '\n\n';

  for (const file of files) {
    const content = await Bun.file(join(STANDUP_DIR, file)).text();
    const date = file.replace('.md', '');
    summary += '\n' + pc.bold(pc.green(`📅 ${date}`)) + '\n';

    // Extract mood and today's plan sections
    const moodMatch = content.match(/## Mood\n(.+)/);
    const todayMatch = content.match(/## Today's Plan\n([\s\S]+?)(?=\n##|\n---)/);
    const accomplishmentsMatch = content.match(/## Accomplishments\n([\s\S]+?)(?=\n##|\n---)/);

    if (moodMatch) summary += pc.yellow(`  Mood: `) + `${moodMatch[1]}\n`;
    if (accomplishmentsMatch) summary += pc.green(`  Accomplished:\n`) + `${accomplishmentsMatch[1].trim()}\n`;
    if (todayMatch) summary += pc.blue(`  Plan:\n`) + `${todayMatch[1].trim()}\n`;
  }

  p.note(summary, pc.green('This Week'));
  p.outro(pc.bgMagenta(pc.black(' Keep crushing it! 🎯 ')));

  await pressAnyKey('Press Enter to close...');
}

function showHelp() {
  console.clear();
  p.intro(pc.bgCyan(pc.black(' 📋 Daily Standup CLI ')));

  console.log('');
  p.log.info(pc.bold('Usage: ') + pc.cyan('standup [command|flag]'));
  console.log('');

  p.log.step(pc.bold(pc.yellow('Commands:')));
  console.log(`  ${pc.cyan('•')} ${pc.bold('(no args)')}          ${pc.dim('AI-powered auto standup (non-interactive)')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('interactive, -i')}    ${pc.dim('Interactive standup with prompts')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('retro')}              ${pc.dim('Generate weekly retrospective')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('stats')}              ${pc.dim('View standup statistics and streaks')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('search')}             ${pc.dim('Search past standups by keyword or date')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('review')}             ${pc.dim('View weekly summary of standups')}`);
  console.log('');

  p.log.step(pc.bold(pc.blue('Flags:')));
  console.log(`  ${pc.cyan('•')} ${pc.bold('--help, -h')}      ${pc.dim('Show this help message')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('--version, -v')}   ${pc.dim('Show version information')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('--migrate, -m')}   ${pc.dim('Migrate data from old location')}`);
  console.log('');

  p.log.step(pc.bold(pc.green('Examples:')));
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup')}                ${pc.dim('→ AI auto mode (default)')}`);
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup interactive')}    ${pc.dim('→ Interactive prompts')}`);
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup retro')}          ${pc.dim('→ Generate weekly retro')}`);
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup stats')}          ${pc.dim('→ View statistics')}`);
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup --version')}      ${pc.dim('→ Show version')}`);
  console.log('');

  p.outro(pc.bgGreen(pc.black(' 🤖 AI auto mode is the default - perfect for automation! ')));
}

async function showMenu() {
  console.clear();
  p.intro(pc.bgCyan(pc.black(' 📋 Daily Standup CLI ')));

  const streak = await getStreakData();
  if (streak.current > 0) {
    console.log('');
    const streakEmoji = streak.current >= 7 ? '🔥' : streak.current >= 3 ? '⚡' : '✨';
    p.log.success(
      `${streakEmoji} ${pc.bold(pc.green(String(streak.current)))} ${pc.green('day streak!')} ` +
      pc.gray(`(Longest: ${streak.longest})`)
    );
    console.log('');
  }

  const choice = await p.select({
    message: pc.bold('What would you like to do?'),
    options: [
      { value: 'standup', label: pc.green('✍️  Run daily standup'), hint: 'Create a new standup entry' },
      { value: 'retro', label: pc.magenta('🔄 Weekly retrospective'), hint: 'Generate AI-powered week summary' },
      { value: 'review', label: pc.cyan('📅 Weekly review'), hint: 'See this week\'s standups' },
      { value: 'stats', label: pc.yellow('📊 View statistics'), hint: 'Streaks, mood distribution, etc.' },
      { value: 'search', label: pc.blue('🔍 Search standups'), hint: 'Find past entries' },
      { value: 'exit', label: pc.dim('👋 Exit'), hint: 'Close the CLI' },
    ],
  });

  if (p.isCancel(choice)) {
    p.cancel('Goodbye!');
    process.exit(0);
  }

  return choice;
}

// Ensure directory exists before running any commands
ensureStandupDirExists();

// Main CLI
const command = process.argv[2];

// Flags (use -- prefix with short options)
if (command === '--help' || command === '-h') {
  showHelp();
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  // Hardcode version to avoid path issues in compiled binary
  console.log(`standup-cli v2.0.0`);
  process.exit(0);
}

if (command === '--migrate' || command === '-m') {
  await migrate(false);
  process.exit(0);
}

// Check for migration on first run (before running any commands)
if (!command || command === 'interactive' || command === '-i') {
  await promptMigrationIfNeeded();
}

if (command) {
  // Direct command mode
  switch (command) {
    case 'interactive':
    case '-i':
      // Interactive mode (old default behavior)
      await runStandup();
      break;
    case 'retro':
      await runWeeklyRetro();
      break;
    case 'stats':
      await showStats();
      break;
    case 'search':
      await searchStandups();
      break;
    case 'review':
      await weeklyReview();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "standup --help" for usage information');
      process.exit(1);
  }
} else {
  // No command = auto mode (AI-powered non-interactive)
  await runAutoStandup();
}

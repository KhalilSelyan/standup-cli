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
import { loadConfig } from './config';
import { migrate, promptMigrationIfNeeded } from './migrate';
import {
  checkGitInstalled,
  getGitInstallMessage,
  getNoReposFoundMessage,
  checkClipboardAvailable,
  getClipboardToolsMessage,
} from './errorHandling';

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

    while (true) {
      const moodChoice = await p.select({
        message: 'How are you feeling today?',
        options: moodOptions,
      });

      if (p.isCancel(moodChoice)) {
        p.cancel('Standup cancelled');
        process.exit(0);
      }

      if (moodChoice === 'custom') {
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

    // Scan git repositories for commits
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

          // Show preview and allow editing
          const preview = accomplishments.join('\n- ');
          p.note(preview, 'Pre-filled from git commits');

          const editChoice = await p.select({
            message: 'What would you like to do?',
            options: [
              { value: 'keep', label: 'Keep as is' },
              { value: 'add', label: 'Add more items' },
              { value: 'edit', label: 'Start over manually' },
            ],
          });

          if (p.isCancel(editChoice)) {
            p.cancel('Standup cancelled');
            process.exit(0);
          }

          if (editChoice === 'keep') {
            break;
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
          }
          // If 'edit', fall through to manual entry
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
    if (customQuestions.blockers?.enabled !== false) {
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

    if (restart) continue;
    } else {
      blockers = [];
    }

    // Question 4: Today's plan (multi-line)
    let todaysPlan: string[];
    if (customQuestions.todaysPlan?.enabled !== false) {
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
  console.log(`  ${pc.cyan('•')} ${pc.bold('(no args)')}    ${pc.dim('Show interactive menu to choose action')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('standup')}      ${pc.dim('Run daily standup (create new entry)')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('stats')}        ${pc.dim('View standup statistics and streaks')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('search')}       ${pc.dim('Search past standups by keyword or date')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('review')}       ${pc.dim('View weekly summary of standups')}`);
  console.log('');

  p.log.step(pc.bold(pc.blue('Flags:')));
  console.log(`  ${pc.cyan('•')} ${pc.bold('--help, -h')}      ${pc.dim('Show this help message')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('--version, -v')}   ${pc.dim('Show version information')}`);
  console.log(`  ${pc.cyan('•')} ${pc.bold('--migrate, -m')}   ${pc.dim('Migrate data from old location')}`);
  console.log('');

  p.log.step(pc.bold(pc.green('Examples:')));
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup')}              ${pc.dim('→ Interactive menu')}`);
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup stats')}        ${pc.dim('→ View statistics')}`);
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup --version')}    ${pc.dim('→ Show version')}`);
  console.log(`  ${pc.gray('$')} ${pc.cyan('standup --migrate')}    ${pc.dim('→ Migrate old data')}`);
  console.log('');

  p.outro(pc.bgGreen(pc.black(' 🚀 Run without arguments for interactive menu! ')));
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
      { value: 'review', label: pc.cyan('📅 Weekly review'), hint: 'See this week\'s standups' },
      { value: 'stats', label: pc.magenta('📊 View statistics'), hint: 'Streaks, mood distribution, etc.' },
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
  console.log(`standup-cli v1.0.0`);
  process.exit(0);
}

if (command === '--migrate' || command === '-m') {
  await migrate(false);
  process.exit(0);
}

// Check for migration on first run (before running any commands)
if (!command || command === 'standup') {
  await promptMigrationIfNeeded();
}

if (command) {
  // Direct command mode
  switch (command) {
    case 'standup':
      await runStandup();
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
  // Interactive menu mode
  const choice = await showMenu();

  switch (choice) {
    case 'standup':
      await runStandup();
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
    case 'exit':
      p.outro('Goodbye! 👋');
      break;
  }
}

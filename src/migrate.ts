import { existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';

const OLD_LOCATION = join(process.env.HOME || '', 'dev/scripts/standup');
const NEW_LOCATION = join(process.env.HOME || '', '.standup-cli');

interface MigrationPlan {
  standups: string[];
  hasStreak: boolean;
  hasReminders: boolean;
  hasConfig: boolean;
}

/**
 * Check if old location has data
 */
export function hasOldData(): boolean {
  return existsSync(OLD_LOCATION);
}

/**
 * Analyze what needs to be migrated
 */
export function analyzeMigration(): MigrationPlan | null {
  if (!existsSync(OLD_LOCATION)) {
    return null;
  }

  const standupsDir = join(OLD_LOCATION, 'standups');
  const standups: string[] = [];

  if (existsSync(standupsDir)) {
    standups.push(
      ...readdirSync(standupsDir)
        .filter(f => f.endsWith('.md'))
        .sort()
    );
  }

  return {
    standups,
    hasStreak: existsSync(join(OLD_LOCATION, 'streak.json')),
    hasReminders: existsSync(join(OLD_LOCATION, 'reminders.json')),
    hasConfig: existsSync(join(OLD_LOCATION, 'config.json')),
  };
}

/**
 * Perform the migration
 */
export async function migrate(dryRun = false): Promise<boolean> {
  const plan = analyzeMigration();

  if (!plan) {
    p.log.error('No old data found to migrate');
    return false;
  }

  p.intro(pc.bgBlue(pc.white(' 📦 Data Migration ')));

  // Show what will be migrated
  const items: string[] = [];
  if (plan.standups.length > 0) {
    items.push(`${plan.standups.length} standup files`);
  }
  if (plan.hasStreak) {
    items.push('streak data');
  }
  if (plan.hasReminders) {
    items.push('reminder state');
  }
  if (plan.hasConfig) {
    items.push('configuration');
  }

  if (items.length === 0) {
    p.log.info('No data to migrate');
    return false;
  }

  p.note(
    pc.cyan('From: ') + pc.gray(OLD_LOCATION) + '\n' +
    pc.cyan('To:   ') + pc.gray(NEW_LOCATION) + '\n\n' +
    pc.yellow('Items to migrate:\n') +
    items.map(item => `  • ${item}`).join('\n'),
    'Migration Plan'
  );

  if (dryRun) {
    p.outro('Dry run complete - no files were moved');
    return true;
  }

  const shouldProceed = await p.confirm({
    message: 'Proceed with migration? (Original files will be kept as backup)',
    initialValue: true,
  });

  if (p.isCancel(shouldProceed) || !shouldProceed) {
    p.cancel('Migration cancelled');
    return false;
  }

  const s = p.spinner();
  s.start('Migrating data...');

  try {
    // Ensure new location exists
    if (!existsSync(NEW_LOCATION)) {
      mkdirSync(NEW_LOCATION, { recursive: true });
    }

    // Migrate standups
    if (plan.standups.length > 0) {
      const newStandupsDir = join(NEW_LOCATION, 'standups');
      if (!existsSync(newStandupsDir)) {
        mkdirSync(newStandupsDir, { recursive: true });
      }

      for (const file of plan.standups) {
        const oldPath = join(OLD_LOCATION, 'standups', file);
        const newPath = join(newStandupsDir, file);

        // Copy file
        const content = await Bun.file(oldPath).text();
        await Bun.write(newPath, content);
      }
    }

    // Migrate streak data
    if (plan.hasStreak) {
      const oldPath = join(OLD_LOCATION, 'streak.json');
      const newPath = join(NEW_LOCATION, 'streak.json');
      const content = await Bun.file(oldPath).text();
      await Bun.write(newPath, content);
    }

    // Migrate reminders
    if (plan.hasReminders) {
      const oldPath = join(OLD_LOCATION, 'reminders.json');
      const newPath = join(NEW_LOCATION, 'reminders.json');
      const content = await Bun.file(oldPath).text();
      await Bun.write(newPath, content);
    }

    // Migrate config
    if (plan.hasConfig) {
      const oldPath = join(OLD_LOCATION, 'config.json');
      const newPath = join(NEW_LOCATION, 'config.json');
      const content = await Bun.file(oldPath).text();
      await Bun.write(newPath, content);
    }

    s.stop('Migration complete!');

    p.note(
      pc.green('✓ All data has been copied to the new location\n') +
      pc.gray('Original files are still in: ') + OLD_LOCATION + '\n' +
      pc.gray('You can safely delete the old location when ready'),
      pc.green('Success')
    );

    return true;
  } catch (error) {
    s.stop('Migration failed');
    p.log.error(`Error during migration: ${error}`);
    return false;
  }
}

/**
 * Show migration prompt on first run
 */
export async function promptMigrationIfNeeded(): Promise<void> {
  if (!hasOldData()) {
    return;
  }

  // Check if new location already has data (migration already done)
  const newStandupsDir = join(NEW_LOCATION, 'standups');
  if (existsSync(newStandupsDir) && readdirSync(newStandupsDir).length > 0) {
    return;
  }

  const plan = analyzeMigration();
  if (!plan || plan.standups.length === 0) {
    return;
  }

  p.intro(pc.bgYellow(pc.black(' 🔄 Migration Available ')));

  p.log.warn(
    'Detected standup data in old location:\n' +
    pc.gray(OLD_LOCATION) + '\n\n' +
    `Found ${plan.standups.length} standup(s) that can be migrated.`
  );

  const shouldMigrate = await p.confirm({
    message: 'Would you like to migrate your data now?',
    initialValue: true,
  });

  if (p.isCancel(shouldMigrate)) {
    p.note(
      'You can migrate later by running:\n  ' + pc.cyan('standup --migrate'),
      'Migration skipped'
    );
    return;
  }

  if (shouldMigrate) {
    await migrate(false);
  } else {
    p.note(
      'You can migrate later by running:\n  ' + pc.cyan('standup --migrate'),
      'Migration skipped'
    );
  }
}

import AppDataSource from '../data-source';
import { seedDefaults } from './seed-defaults';

async function run() {
  await AppDataSource.initialize();
  console.log('connected to db');

  // Run pending migrations (if any). In development/test environments
  // we also allow automatic schema creation via synchronize to ensure
  // tables are present when migrations are not defined yet.
  console.log('running migrations...');
  const migrations = await AppDataSource.runMigrations();
  console.log(`executed ${migrations.length} migrations`);

  if (migrations.length === 0) {
    console.log(
      'no migrations found — performing schema synchronization to ensure tables exist (dev/test only)',
    );
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        'NODE_ENV=production — skipping automatic synchronize to avoid schema drift',
      );
    } else {
      // synchronize will create tables for all entities based on current models
      await AppDataSource.synchronize();
      console.log('schema synchronized');
    }
  }

  // Seed defaults
  console.log('seeding defaults...');
  await seedDefaults();
  console.log('seed complete');

  await AppDataSource.destroy();
}

run().catch((err) => {
  console.error('setup error', err);
  process.exit(1);
});

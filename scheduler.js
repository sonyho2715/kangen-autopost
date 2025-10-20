/**
 * Cron Scheduler for Kangen Water Facebook Posts
 * Schedules 3 posts daily at 6 AM, 12 PM, and 6 PM Hawaii time
 * Rotates through 10 predefined topics
 */

import cron from 'node-cron';
import dotenv from 'dotenv';
import { addContentGenerationJob } from './lib/queue.js';
import { getLastPostedTopic } from './lib/db.js';

dotenv.config();

// 10 topics to rotate through
const TOPICS = [
  'Benefits of Alkaline Water',
  'Hydration and Wellness',
  'pH Balance and Health',
  'Kangen Water vs Tap Water',
  'Detoxification Through Water',
  'Energy and Hydration',
  'Skin Health and Alkaline Water',
  'Athletic Performance and Hydration',
  'Immune System and pH Balance',
  'Daily Wellness Routine',
];

let currentTopicIndex = 0;

/**
 * Get the next topic in rotation
 */
async function getNextTopic() {
  // Get last posted topic from database
  const lastTopic = await getLastPostedTopic();

  if (lastTopic) {
    // Find the index and move to next
    const lastIndex = TOPICS.indexOf(lastTopic);
    if (lastIndex !== -1) {
      currentTopicIndex = (lastIndex + 1) % TOPICS.length;
    }
  }

  const topic = TOPICS[currentTopicIndex];
  currentTopicIndex = (currentTopicIndex + 1) % TOPICS.length;

  return topic;
}

/**
 * Schedule a post - triggers content generation job
 */
export async function schedulePost() {
  try {
    const topic = await getNextTopic();

    console.log('\n' + '='.repeat(60));
    console.log(`[Scheduler] 🕐 Scheduling post at ${new Date().toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' })} HST`);
    console.log(`[Scheduler] 📝 Topic: ${topic}`);
    console.log('='.repeat(60));

    // Add job to content generation queue
    await addContentGenerationJob(topic);

    console.log(`[Scheduler] ✓ Content generation job queued for topic: ${topic}`);
  } catch (error) {
    console.error('[Scheduler] Error scheduling post:', error.message);
  }
}

/**
 * Initialize scheduler with cron jobs
 */
export function initScheduler() {
  console.log('[Scheduler] Initializing cron scheduler...');
  console.log('[Scheduler] Timezone: Pacific/Honolulu (Hawaii)');
  console.log('[Scheduler] Schedule: 6 AM, 12 PM, 6 PM daily');

  // Schedule post at 6 AM Hawaii time (16:00 UTC)
  const morning = cron.schedule(
    '0 6 * * *',
    async () => {
      console.log('[Scheduler] ☀️  Morning post triggered (6 AM HST)');
      await schedulePost();
    },
    {
      scheduled: true,
      timezone: 'Pacific/Honolulu',
    }
  );

  // Schedule post at 12 PM Hawaii time (22:00 UTC)
  const noon = cron.schedule(
    '0 12 * * *',
    async () => {
      console.log('[Scheduler] 🌤️  Noon post triggered (12 PM HST)');
      await schedulePost();
    },
    {
      scheduled: true,
      timezone: 'Pacific/Honolulu',
    }
  );

  // Schedule post at 6 PM Hawaii time (04:00 UTC next day)
  const evening = cron.schedule(
    '0 18 * * *',
    async () => {
      console.log('[Scheduler] 🌙 Evening post triggered (6 PM HST)');
      await schedulePost();
    },
    {
      scheduled: true,
      timezone: 'Pacific/Honolulu',
    }
  );

  console.log('[Scheduler] ✓ Cron jobs scheduled successfully');
  console.log('[Scheduler] Next posts:');
  console.log('  - 6:00 AM HST (Morning)');
  console.log('  - 12:00 PM HST (Noon)');
  console.log('  - 6:00 PM HST (Evening)');

  // Return scheduler controls
  return {
    morning,
    noon,
    evening,
    scheduleNow: schedulePost, // For manual triggering
    stop: () => {
      morning.stop();
      noon.stop();
      evening.stop();
      console.log('[Scheduler] All cron jobs stopped');
    },
  };
}

/**
 * Get current Hawaii time
 */
export function getHawaiiTime() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu',
    dateStyle: 'full',
    timeStyle: 'long',
  });
}

/**
 * Test scheduler by posting immediately
 */
export async function testScheduler() {
  console.log('[Scheduler] Running test post...');
  await schedulePost();
  console.log('[Scheduler] Test post completed');
}

export default {
  initScheduler,
  schedulePost,
  getHawaiiTime,
  testScheduler,
};

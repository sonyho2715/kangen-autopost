/**
 * Kangen Water Facebook Auto-Post System
 * Main application entry point
 *
 * This application automatically posts health and wellness content
 * about Kangen water to Facebook 3x daily with AI-generated content and images
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { testConnection as testDB, closePool, getPost, getRecentPosts as dbGetRecentPosts } from './lib/db.js';
import { initRedis, closeQueues, getQueueStats, addContentGenerationJob, addPublishJob } from './lib/queue.js';
import { testConnection as testOpenAI } from './lib/openai-generator.js';
import { testConnection as testFacebook, getPageInfo } from './lib/facebook-poster.js';
import { initScheduler, getHawaiiTime, schedulePost } from './scheduler.js';
import pool from './lib/db.js';

// Import workers (they start automatically)
import './workers/content-worker.js';
import './workers/image-worker.js';
import './workers/publish-worker.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

let scheduler;
let schedulerActive = false;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    const queueStats = await getQueueStats();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      hawaiiTime: getHawaiiTime(),
      queues: queueStats,
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
});

/**
 * Status endpoint
 */
app.get('/status', async (req, res) => {
  try {
    const pageInfo = await getPageInfo();
    const queueStats = await getQueueStats();

    res.json({
      status: 'running',
      hawaiiTime: getHawaiiTime(),
      facebookPage: pageInfo ? {
        name: pageInfo.name,
        id: pageInfo.id,
        followers: pageInfo.followers_count,
        category: pageInfo.category,
      } : 'Not connected',
      queues: queueStats,
      schedule: {
        timezone: 'Pacific/Honolulu',
        times: ['6:00 AM', '12:00 PM', '6:00 PM'],
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
});

/**
 * Dashboard API Endpoints
 */

// Get system status
app.get('/api/status', (req, res) => {
  res.json({
    schedulerActive,
    hawaiiTime: getHawaiiTime(),
  });
});

// Toggle scheduler
app.post('/api/scheduler/toggle', (req, res) => {
  const { active } = req.body;
  schedulerActive = active;

  if (active && scheduler && scheduler.morning && scheduler.noon && scheduler.evening) {
    scheduler.morning.start();
    scheduler.noon.start();
    scheduler.evening.start();
    console.log('[API] Scheduler activated');
  } else if (!active && scheduler) {
    if (scheduler.morning) scheduler.morning.stop();
    if (scheduler.noon) scheduler.noon.stop();
    if (scheduler.evening) scheduler.evening.stop();
    console.log('[API] Scheduler paused');
  }

  res.json({ success: true, active: schedulerActive });
});

// Get pending posts (awaiting approval)
app.get('/api/posts/pending', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM kangen_posts
       WHERE status IN ('generating', 'scheduled')
       ORDER BY created_at DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent posts
app.get('/api/posts/recent', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM kangen_posts
       WHERE status = 'posted'
       ORDER BY posted_at DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get stats
app.get('/api/stats', async (req, res) => {
  try {
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM kangen_posts WHERE status = \'posted\'');
    const pendingResult = await pool.query('SELECT COUNT(*) as count FROM kangen_posts WHERE status IN (\'generating\', \'scheduled\')');
    const todayResult = await pool.query('SELECT COUNT(*) as count FROM kangen_posts WHERE status = \'posted\' AND DATE(posted_at) = CURRENT_DATE');

    res.json({
      total: parseInt(totalResult.rows[0].count),
      pending: parseInt(pendingResult.rows[0].count),
      today: parseInt(todayResult.rows[0].count),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate a preview post
app.post('/api/posts/generate', async (req, res) => {
  try {
    console.log('[API] Manual post generation requested');
    await schedulePost();
    res.json({ success: true, message: 'Post generation started' });
  } catch (error) {
    console.error('[API] Error generating post:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve a post (queue it for publishing)
app.post('/api/posts/:id/approve', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    console.log(`[API] Post ${postId} approved for publishing`);

    // Update status
    await pool.query('UPDATE kangen_posts SET status = $1 WHERE id = $2', ['posting', postId]);

    // Queue for publishing
    await addPublishJob(postId);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Error approving post:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reject a post
app.post('/api/posts/:id/reject', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    console.log(`[API] Post ${postId} rejected`);

    await pool.query('UPDATE kangen_posts SET status = $1, error_message = $2 WHERE id = $3',
      ['failed', 'Rejected by user', postId]);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Error rejecting post:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Root endpoint - Serve dashboard
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Initialize and start the application
 */
async function startApp() {
  console.log('\n' + '='.repeat(70));
  console.log('🌊 Kangen Water Facebook Auto-Post System');
  console.log('='.repeat(70));
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Current Hawaii Time: ${getHawaiiTime()}`);
  console.log('='.repeat(70) + '\n');

  try {
    // Test all connections
    console.log('[App] Testing connections...\n');

    // 1. Test Database
    console.log('[App] 1/4 Testing PostgreSQL connection...');
    await testDB();
    console.log('[App] ✓ Database connected\n');

    // 2. Test Redis
    console.log('[App] 2/4 Testing Redis connection...');
    await initRedis();
    console.log('[App] ✓ Redis connected\n');

    // 3. Test OpenAI
    console.log('[App] 3/4 Testing OpenAI API...');
    const openaiOk = await testOpenAI();
    if (!openaiOk) {
      throw new Error('OpenAI API test failed');
    }
    console.log('[App] ✓ OpenAI API connected\n');

    // 4. Test Facebook
    console.log('[App] 4/4 Testing Facebook API...');
    const fbOk = await testFacebook();
    if (!fbOk) {
      throw new Error('Facebook API test failed');
    }
    console.log('[App] ✓ Facebook API connected\n');

    // Get Facebook page info
    const pageInfo = await getPageInfo();
    if (pageInfo) {
      console.log('[App] 📘 Facebook Page Info:');
      console.log(`[App]   Name: ${pageInfo.name}`);
      console.log(`[App]   ID: ${pageInfo.id}`);
      console.log(`[App]   Followers: ${pageInfo.followers_count || 'N/A'}`);
      console.log(`[App]   Category: ${pageInfo.category || 'N/A'}\n`);
    }

    // Start Express server
    app.listen(PORT, () => {
      console.log(`[App] 🌐 Express server running on port ${PORT}`);
      console.log(`[App]   Health check: http://localhost:${PORT}/health`);
      console.log(`[App]   Status: http://localhost:${PORT}/status\n`);
    });

    // Initialize scheduler
    console.log('[App] 🕐 Starting scheduler...');
    scheduler = initScheduler();
    console.log('[App] ✓ Scheduler started\n');

    // Display queue status
    const queueStats = await getQueueStats();
    console.log('[App] 📊 Queue Status:');
    console.log(`[App]   Content Generation: ${JSON.stringify(queueStats.content)}`);
    console.log(`[App]   Image Generation: ${JSON.stringify(queueStats.image)}`);
    console.log(`[App]   Publishing: ${JSON.stringify(queueStats.publish)}`);

    console.log('\n' + '='.repeat(70));
    console.log('✅ System is ready and running!');
    console.log('🤖 Workers are waiting for scheduled jobs...');
    console.log('📅 Next posts scheduled for 6 AM, 12 PM, and 6 PM HST');
    console.log('='.repeat(70) + '\n');
  } catch (error) {
    console.error('\n❌ Failed to start application:', error.message);
    console.error('\nPlease check your configuration and ensure:');
    console.error('  1. PostgreSQL database is running and accessible');
    console.error('  2. Redis server is running');
    console.error('  3. OpenAI API key is valid');
    console.error('  4. Facebook page access token is valid');
    console.error('  5. All environment variables are set in .env file\n');
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('\n[App] Shutting down gracefully...');

  try {
    // Stop scheduler
    if (scheduler) {
      scheduler.stop();
      console.log('[App] ✓ Scheduler stopped');
    }

    // Close queues
    await closeQueues();
    console.log('[App] ✓ Queues closed');

    // Close database
    await closePool();
    console.log('[App] ✓ Database closed');

    console.log('[App] Goodbye!\n');
    process.exit(0);
  } catch (error) {
    console.error('[App] Error during shutdown:', error.message);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[App] Uncaught Exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[App] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the application
startApp();

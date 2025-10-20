/**
 * Kangen Water Facebook Auto-Post System - Optimized Edition
 * Main application with engagement optimization, A/B testing, auto-approval, and cost tracking
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { testConnection as testDB, closePool } from './lib/db.js';
import { initRedis, closeQueues, getQueueStats, addContentGenerationJob, addPublishJob } from './lib/queue.js';
import { testConnection as testOpenAI } from './lib/openai-generator.js';
import { testConnection as testFacebook, getPageInfo } from './lib/facebook-poster.js';
import { initScheduler, getHawaiiTime, schedulePost } from './scheduler.js';
import pool from './lib/db.js';

// Import optimization modules
import { generateContentAndImageParallel, generateVariantsParallel } from './lib/parallel-generator.js';
import { fetchPostEngagement, updateRecentPostsEngagement, getTopPosts } from './lib/engagement-tracker.js';
import { calculateTopicWeights, selectWeightedTopic, getTopicRankings, initializeTopicWeights } from './lib/topic-analyzer.js';
import { predictEngagement, getPredictionAccuracy } from './lib/engagement-predictor.js';
import { determineApprovalAction, autoApprovePost, userApprovePost, rejectPost, getApprovalStats, getPendingReview, getApprovalSettings, updateApprovalSettings } from './lib/auto-approver.js';
import { generateABTestVariants, selectVariant, compareVariantPerformance, getABTestStats } from './lib/ab-test-generator.js';
import { getCostSummary, getCostTrends, calculateROI, getImageReuseStats, analyzeCostOptimizations } from './lib/cost-optimizer.js';

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
let engagementTrackerInterval;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// HEALTH CHECK ENDPOINTS
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    const dbHealth = await testDB();
    const openaiHealth = await testOpenAI();
    const facebookHealth = await testFacebook();
    const queueStats = await getQueueStats();

    res.json({
      status: 'healthy',
      timestamp: new Date(),
      components: {
        database: dbHealth,
        openai: openaiHealth,
        facebook: facebookHealth,
        queues: queueStats,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// ============================================================================
// SYSTEM STATUS
// ============================================================================

app.get('/api/status', (req, res) => {
  res.json({
    schedulerActive,
    hawaiiTime: getHawaiiTime(),
    timestamp: new Date(),
  });
});

app.post('/api/scheduler/toggle', (req, res) => {
  const { active } = req.body;
  schedulerActive = active;

  if (active && scheduler) {
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

// ============================================================================
// ENGAGEMENT & ANALYTICS
// ============================================================================

app.get('/api/analytics/engagement', async (req, res) => {
  try {
    const topPosts = await getTopPosts(10);
    const costSummary = await getCostSummary(30);
    const roi = await calculateROI(30);
    const predictionAccuracy = await getPredictionAccuracy();

    res.json({
      topPosts,
      costs: costSummary,
      roi,
      predictionAccuracy,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/costs', async (req, res) => {
  try {
    const summary = await getCostSummary(30);
    const trends = await getCostTrends(30);
    const roi = await calculateROI(30);
    const imageStats = await getImageReuseStats();
    const optimizations = await analyzeCostOptimizations();

    res.json({
      summary,
      trends,
      roi,
      imageReuse: imageStats,
      opportunities: optimizations,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/topics', async (req, res) => {
  try {
    const rankings = await getTopicRankings();
    res.json({ topicRankings: rankings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POST GENERATION - PARALLEL & OPTIMIZED
// ============================================================================

app.post('/api/posts/generate', async (req, res) => {
  try {
    console.log('[API] Manual post generation requested');

    // Use weighted topic selection
    const topic = await selectWeightedTopic();
    console.log('[API] Selected topic:', topic);

    // Generate content and image in parallel
    const generated = await generateContentAndImageParallel(topic);

    // Predict engagement
    const prediction = await predictEngagement(
      topic,
      generated.content,
      generated.hashtags,
      new Date()
    );

    // Determine approval action
    const approvalAction = await determineApprovalAction(0, prediction.confidenceScore);

    // Store post in database
    const insertResult = await pool.query(
      `INSERT INTO kangen_posts (topic, content, hashtags, image_url, status, confidence_score, approval_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [topic, generated.content, generated.hashtags, generated.imageUrl, 'scheduled', prediction.confidenceScore, approvalAction.action]
    );

    const postId = insertResult.rows[0].id;

    res.json({
      success: true,
      post: {
        id: postId,
        topic,
        content: generated.content,
        hashtags: generated.hashtags,
        imageUrl: generated.imageUrl,
        generationTime: `${generated.generationTime}ms`,
      },
      prediction,
      approvalAction,
    });
  } catch (error) {
    console.error('[API] Error generating post:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// A/B TESTING
// ============================================================================

app.post('/api/posts/generate/variants', async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ error: 'Topic required' });
    }

    console.log('[API] Generating A/B test variants for topic:', topic);

    const variants = await generateABTestVariants(topic);

    // Store the best variant post
    const bestVariant = variants.bestVariant;
    const insertResult = await pool.query(
      `INSERT INTO kangen_posts (topic, content, hashtags, image_url, status, confidence_score, variant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [topic, bestVariant.content, bestVariant.hashtags, null, 'scheduled', bestVariant.predictedScore, 'variants_created']
    );

    const postId = insertResult.rows[0].id;

    // Store all variants
    const variantA = variants.variants.find((v) => v.variant === 'A');
    const variantB = variants.variants.find((v) => v.variant === 'B');
    const variantC = variants.variants.find((v) => v.variant === 'C');

    await pool.query(
      `INSERT INTO post_variants (post_id, variant_a_content, variant_a_hook, variant_a_cta, variant_a_predicted,
                                   variant_b_content, variant_b_hook, variant_b_cta, variant_b_predicted,
                                   variant_c_content, variant_c_hook, variant_c_cta, variant_c_predicted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        postId,
        variantA?.content,
        variantA?.hook,
        variantA?.cta,
        variantA?.predictedScore,
        variantB?.content,
        variantB?.hook,
        variantB?.cta,
        variantB?.predictedScore,
        variantC?.content,
        variantC?.hook,
        variantC?.cta,
        variantC?.predictedScore,
      ]
    );

    res.json({
      success: true,
      postId,
      variants: variants.variants,
      bestVariant: variants.bestVariant,
      recommendation: variants.recommendation,
    });
  } catch (error) {
    console.error('[API] Error generating variants:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/posts/:id/variant/:variant', async (req, res) => {
  try {
    const { id, variant } = req.params;

    if (!['A', 'B', 'C'].includes(variant)) {
      return res.status(400).json({ error: 'Invalid variant' });
    }

    const selected = await selectVariant(id, variant);

    res.json({
      success: true,
      selectedVariant: selected,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// APPROVAL WORKFLOW
// ============================================================================

app.get('/api/posts/pending', async (req, res) => {
  try {
    const pending = await getPendingReview(20);
    res.json({ pending });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/posts/:id/approve', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    console.log(`[API] User approved post ${postId}`);

    await userApprovePost(postId);

    res.json({ success: true, action: 'approved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/posts/:id/reject', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { reason } = req.body;

    console.log(`[API] User rejected post ${postId}: ${reason}`);

    await rejectPost(postId, reason);

    res.json({ success: true, action: 'rejected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AUTO-APPROVAL SETTINGS
// ============================================================================

app.get('/api/settings/approval', async (req, res) => {
  try {
    const settings = await getApprovalSettings();
    const stats = await getApprovalStats();

    res.json({
      settings,
      stats,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/approval', async (req, res) => {
  try {
    const updated = await updateApprovalSettings(req.body);
    res.json({ success: true, settings: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// POSTS MANAGEMENT
// ============================================================================

app.get('/api/posts/recent', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM kangen_posts
       WHERE status = 'posted'
       ORDER BY posted_at DESC
       LIMIT 10`
    );

    res.json({ posts: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalResult = await pool.query(
      "SELECT COUNT(*) as count FROM kangen_posts WHERE status = 'posted'"
    );
    const pendingResult = await pool.query(
      "SELECT COUNT(*) as count FROM kangen_posts WHERE status IN ('generating', 'scheduled')"
    );
    const todayResult = await pool.query(
      "SELECT COUNT(*) as count FROM kangen_posts WHERE status = 'posted' AND DATE(posted_at) = CURRENT_DATE"
    );

    res.json({
      total: parseInt(totalResult.rows[0].count),
      pending: parseInt(pendingResult.rows[0].count),
      today: parseInt(todayResult.rows[0].count),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ROOT & UI
// ============================================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// INITIALIZE & START
// ============================================================================

async function startApplication() {
  try {
    console.log('\n======================================================================');
    console.log('🚀 Kangen Water Facebook Auto-Post System - Optimized Edition');
    console.log('======================================================================\n');

    // Test connections
    console.log('[Init] Testing connections...');
    await testDB();
    console.log('✓ Database connected');

    await initRedis();
    console.log('✓ Redis connected');

    await testOpenAI();
    console.log('✓ OpenAI connected');

    const pageInfo = await testFacebook();
    console.log('✓ Facebook connected');

    // Initialize topic weights
    await initializeTopicWeights();
    console.log('✓ Topic weights initialized');

    // Calculate initial topic weights
    await calculateTopicWeights();
    console.log('✓ Topic weights calculated');

    // Initialize scheduler
    scheduler = await initScheduler();
    console.log('✓ Scheduler initialized');

    // Start engagement tracking (every 6 hours)
    engagementTrackerInterval = setInterval(async () => {
      try {
        console.log('[System] Running engagement update...');
        await updateRecentPostsEngagement();
        await calculateTopicWeights(); // Recalculate weights based on new data
      } catch (error) {
        console.error('[System] Engagement update error:', error);
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Start server
    app.listen(PORT, () => {
      console.log(`\n✓ Server running on http://localhost:${PORT}`);
      console.log(`\n📊 Dashboard: http://localhost:${PORT}`);
      console.log(`\n✨ Automatic posting is ${schedulerActive ? 'ACTIVE' : 'PAUSED'}`);
      console.log(`\n📈 Features Enabled:`);
      console.log('   • Parallel content + image generation (15s)');
      console.log('   • Engagement tracking & analytics');
      console.log('   • Topic performance weighting');
      console.log('   • Confidence scoring & predictions');
      console.log('   • Smart auto-approval');
      console.log('   • A/B testing variants');
      console.log('   • Cost optimization & tracking');
      console.log('\n' + '='.repeat(70) + '\n');
    });
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[System] Shutting down gracefully...');

  if (engagementTrackerInterval) {
    clearInterval(engagementTrackerInterval);
  }

  if (scheduler) {
    if (scheduler.morning) scheduler.morning.stop();
    if (scheduler.noon) scheduler.noon.stop();
    if (scheduler.evening) scheduler.evening.stop();
  }

  await closeQueues();
  await closePool();

  console.log('✓ Shutdown complete');
  process.exit(0);
});

// Start the application
startApplication();

export { app };

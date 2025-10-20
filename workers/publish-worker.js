/**
 * Facebook Publishing Worker
 * Processes jobs from the publishing queue
 * Posts content to Facebook page and updates database
 */

import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { postToFacebook } from '../lib/facebook-poster.js';
import { getPost, markPostAsPosted, updatePostStatus, incrementRetryCount } from '../lib/db.js';

dotenv.config();

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};

// Create worker for Facebook publishing
const publishWorker = new Worker(
  'facebook-publish',
  async (job) => {
    const { postId } = job.data;

    console.log(`\n[Publish Worker] Processing job ${job.id}`);
    console.log(`[Publish Worker] Post ID: ${postId}`);

    try {
      // Get post from database
      const post = await getPost(postId);

      if (!post) {
        throw new Error(`Post ${postId} not found in database`);
      }

      console.log(`[Publish Worker] Retrieved post: ${post.topic}`);
      console.log(`[Publish Worker] Has image: ${!!post.image_url}`);

      // Update status to posting
      await updatePostStatus(postId, 'posting');

      // Post to Facebook
      console.log('[Publish Worker] Posting to Facebook...');
      const facebookPostId = await postToFacebook({
        message: post.content,
        imageUrl: post.image_url,
        hashtags: post.hashtags,
      });

      console.log(`[Publish Worker] Successfully posted to Facebook`);
      console.log(`[Publish Worker] Facebook Post ID: ${facebookPostId}`);

      // Mark as posted in database
      await markPostAsPosted(postId, facebookPostId);

      console.log(`[Publish Worker] Database updated - post marked as posted`);

      return {
        success: true,
        postId,
        facebookPostId,
        topic: post.topic,
        hasImage: !!post.image_url,
      };
    } catch (error) {
      console.error(`[Publish Worker] Error processing job ${job.id}:`, error.message);

      // Increment retry count in database
      if (job.data.postId) {
        await incrementRetryCount(job.data.postId);
      }

      // Check if this is a token expiration error
      if (error.message.includes('Invalid OAuth') || error.message.includes('token')) {
        console.error('[Publish Worker] ⚠️  CRITICAL: Facebook access token may be expired!');
        console.error('[Publish Worker] Please generate a new token and update .env file');

        // Mark as failed immediately (don't retry token issues)
        await updatePostStatus(job.data.postId, 'failed', `Token error: ${error.message}`);
        throw new Error('Facebook token expired - manual intervention required');
      }

      // Check for rate limiting
      if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
        console.warn('[Publish Worker] Rate limit hit, will retry after backoff');
      }

      // Log for retry
      if (job.attemptsMade < job.opts.attempts) {
        console.log(`[Publish Worker] Will retry (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
        await updatePostStatus(job.data.postId, 'scheduled', `Retry ${job.attemptsMade + 1}: ${error.message}`);
      } else {
        // Max retries exceeded
        await updatePostStatus(job.data.postId, 'failed', error.message);
      }

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process one at a time to avoid rate limits
    limiter: {
      max: 10, // Maximum 10 posts
      duration: 60000, // per 60 seconds
    },
  }
);

// Worker event handlers
publishWorker.on('completed', (job, result) => {
  console.log(`[Publish Worker] Job ${job.id} completed successfully`);
  console.log(`[Publish Worker] ✓ Posted: ${result.topic} (FB ID: ${result.facebookPostId})`);
});

publishWorker.on('failed', async (job, err) => {
  console.error(`[Publish Worker] Job ${job.id} failed:`, err.message);

  if (job.attemptsMade >= job.opts.attempts) {
    console.error(`[Publish Worker] Job ${job.id} permanently failed after ${job.attemptsMade} attempts`);
    console.error(`[Publish Worker] Post ${job.data.postId} will not be published`);
  }
});

publishWorker.on('active', (job) => {
  console.log(`[Publish Worker] Job ${job.id} is now active`);
});

publishWorker.on('stalled', (jobId) => {
  console.warn(`[Publish Worker] Job ${jobId} has stalled`);
});

publishWorker.on('error', (err) => {
  console.error('[Publish Worker] Worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Publish Worker] Received SIGTERM, shutting down gracefully...');
  await publishWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Publish Worker] Received SIGINT, shutting down gracefully...');
  await publishWorker.close();
  process.exit(0);
});

console.log('[Publish Worker] Worker started and waiting for jobs...');

export default publishWorker;

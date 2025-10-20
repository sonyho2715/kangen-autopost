/**
 * Image Generation Worker
 * Processes jobs from the image generation queue
 * Generates images using DALL-E 3 and updates database
 */

import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { generateImage } from '../lib/openai-generator.js';
import { updatePostImage, updatePostStatus, getPost } from '../lib/db.js';

dotenv.config();

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};

// Create worker for image generation
const imageWorker = new Worker(
  'image-generation',
  async (job) => {
    const { postId, topic, content } = job.data;

    console.log(`\n[Image Worker] Processing job ${job.id}`);
    console.log(`[Image Worker] Post ID: ${postId}, Topic: ${topic}`);

    try {
      // Verify post exists
      const post = await getPost(postId);
      if (!post) {
        throw new Error(`Post ${postId} not found in database`);
      }

      // Generate image using DALL-E 3
      console.log('[Image Worker] Generating image with DALL-E 3...');
      const imageResult = await generateImage(topic, content);

      if (imageResult && imageResult.imageUrl) {
        // Image generated successfully
        console.log(`[Image Worker] Image generated successfully`);
        console.log(`[Image Worker] Image URL: ${imageResult.imageUrl}`);

        // Update database with image URL
        await updatePostImage(postId, imageResult.imageUrl);

        console.log(`[Image Worker] Database updated with image URL for post ${postId}`);
      } else {
        // Image generation failed, but we can still post text-only
        console.warn('[Image Worker] Image generation failed, will post text-only');
        await updatePostStatus(postId, 'scheduled', 'Image generation failed - will post text only');
      }

      // Mark as scheduled (awaiting approval) instead of auto-publishing
      await updatePostStatus(postId, 'scheduled');

      console.log(`[Image Worker] Post ${postId} ready for approval`);

      return {
        success: true,
        postId,
        hasImage: !!imageResult?.imageUrl,
        imageUrl: imageResult?.imageUrl || null,
      };
    } catch (error) {
      console.error(`[Image Worker] Error processing job ${job.id}:`, error.message);

      // Check if this is a retryable error
      if (job.attemptsMade < job.opts.attempts) {
        console.log(`[Image Worker] Will retry (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
      } else {
        // Max retries exceeded - still queue publish job for text-only post
        console.warn('[Image Worker] Max retries exceeded, queuing text-only post');
        await updatePostStatus(postId, 'generating', `Image generation failed: ${error.message}`);
        await addPublishJob(postId);
      }

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process one at a time (DALL-E can be slow)
    limiter: {
      max: 5, // Maximum 5 jobs
      duration: 60000, // per 60 seconds (to respect DALL-E rate limits)
    },
  }
);

// Worker event handlers
imageWorker.on('completed', (job, result) => {
  console.log(`[Image Worker] Job ${job.id} completed successfully`);
  console.log(`[Image Worker] Result: Post ID ${result.postId}, Has Image: ${result.hasImage}`);
});

imageWorker.on('failed', async (job, err) => {
  console.error(`[Image Worker] Job ${job.id} failed:`, err.message);

  // If max retries exceeded
  if (job.attemptsMade >= job.opts.attempts) {
    console.error(`[Image Worker] Job ${job.id} permanently failed after ${job.attemptsMade} attempts`);

    const { postId } = job.data;
    if (postId) {
      // Update status but don't mark as failed - we'll post without image
      await updatePostStatus(postId, 'generating', `Image generation failed: ${err.message}`);
    }
  }
});

imageWorker.on('active', (job) => {
  console.log(`[Image Worker] Job ${job.id} is now active`);
});

imageWorker.on('stalled', (jobId) => {
  console.warn(`[Image Worker] Job ${jobId} has stalled`);
});

imageWorker.on('error', (err) => {
  console.error('[Image Worker] Worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Image Worker] Received SIGTERM, shutting down gracefully...');
  await imageWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Image Worker] Received SIGINT, shutting down gracefully...');
  await imageWorker.close();
  process.exit(0);
});

console.log('[Image Worker] Worker started and waiting for jobs...');

export default imageWorker;

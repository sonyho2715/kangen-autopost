/**
 * Content Generation Worker
 * Processes jobs from the content generation queue
 * Generates post content using OpenAI GPT and stores in database
 */

import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { generateContent } from '../lib/openai-generator.js';
import { createPost, updatePostStatus, incrementRetryCount } from '../lib/db.js';
import { addImageGenerationJob } from '../lib/queue.js';

dotenv.config();

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};

// Create worker for content generation
const contentWorker = new Worker(
  'content-generation',
  async (job) => {
    const { topic } = job.data;

    console.log(`\n[Content Worker] Processing job ${job.id}`);
    console.log(`[Content Worker] Topic: ${topic}`);

    try {
      // Generate content using OpenAI
      const { content, hashtags, tokensUsed } = await generateContent(topic);

      console.log(`[Content Worker] Content generated (${tokensUsed} tokens)`);
      console.log(`[Content Worker] Preview: ${content.substring(0, 100)}...`);

      // Save to database
      const post = await createPost({
        topic,
        content,
        hashtags,
        imageUrl: null,
      });

      console.log(`[Content Worker] Post saved to database with ID: ${post.id}`);

      // Queue image generation job
      await addImageGenerationJob(post.id, topic, content);

      console.log(`[Content Worker] Image generation job queued for post ${post.id}`);

      return {
        success: true,
        postId: post.id,
        topic,
        tokensUsed,
      };
    } catch (error) {
      console.error(`[Content Worker] Error processing job ${job.id}:`, error.message);

      // Log error for retry
      if (job.attemptsMade < job.opts.attempts) {
        console.log(`[Content Worker] Will retry (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
      }

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2, // Process up to 2 jobs simultaneously
    limiter: {
      max: 10, // Maximum 10 jobs
      duration: 60000, // per 60 seconds (to respect API rate limits)
    },
  }
);

// Worker event handlers
contentWorker.on('completed', (job, result) => {
  console.log(`[Content Worker] Job ${job.id} completed successfully`);
  console.log(`[Content Worker] Result: Post ID ${result.postId}`);
});

contentWorker.on('failed', async (job, err) => {
  console.error(`[Content Worker] Job ${job.id} failed:`, err.message);

  // If max retries exceeded, mark as permanently failed
  if (job.attemptsMade >= job.opts.attempts) {
    console.error(`[Content Worker] Job ${job.id} permanently failed after ${job.attemptsMade} attempts`);

    // Update database if we have a post ID
    if (job.data.postId) {
      await updatePostStatus(job.data.postId, 'failed', err.message);
    }
  }
});

contentWorker.on('active', (job) => {
  console.log(`[Content Worker] Job ${job.id} is now active`);
});

contentWorker.on('stalled', (jobId) => {
  console.warn(`[Content Worker] Job ${jobId} has stalled`);
});

contentWorker.on('error', (err) => {
  console.error('[Content Worker] Worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Content Worker] Received SIGTERM, shutting down gracefully...');
  await contentWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Content Worker] Received SIGINT, shutting down gracefully...');
  await contentWorker.close();
  process.exit(0);
});

console.log('[Content Worker] Worker started and waiting for jobs...');

export default contentWorker;

/**
 * BullMQ Job Queue Setup
 * Manages job queues for content generation, image generation, and Facebook posting
 */

import { Queue, QueueEvents } from 'bullmq';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Redis connection configuration
const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};

// Create Redis client for health checks
let redisClient;

export async function initRedis() {
  try {
    redisClient = createClient({ url: redisConnection.url });

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    await redisClient.connect();
    return true;
  } catch (error) {
    console.error('[Redis] Failed to connect:', error.message);
    throw error;
  }
}

// Job queue configuration
const defaultJobOptions = {
  attempts: 3, // Maximum retry attempts
  backoff: {
    type: 'exponential',
    delay: 5000, // Start with 5 seconds
  },
  removeOnComplete: {
    age: 86400, // Keep completed jobs for 24 hours
    count: 1000, // Keep last 1000 jobs
  },
  removeOnFail: {
    age: 604800, // Keep failed jobs for 7 days
  },
};

// Create queues
export const contentQueue = new Queue('content-generation', {
  connection: redisConnection,
  defaultJobOptions,
});

export const imageQueue = new Queue('image-generation', {
  connection: redisConnection,
  defaultJobOptions,
});

export const publishQueue = new Queue('facebook-publish', {
  connection: redisConnection,
  defaultJobOptions,
});

// Queue events for monitoring
const contentEvents = new QueueEvents('content-generation', { connection: redisConnection });
const imageEvents = new QueueEvents('image-generation', { connection: redisConnection });
const publishEvents = new QueueEvents('facebook-publish', { connection: redisConnection });

// Monitor content generation queue
contentEvents.on('completed', ({ jobId }) => {
  console.log(`[Queue] Content generation job ${jobId} completed`);
});

contentEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`[Queue] Content generation job ${jobId} failed:`, failedReason);
});

// Monitor image generation queue
imageEvents.on('completed', ({ jobId }) => {
  console.log(`[Queue] Image generation job ${jobId} completed`);
});

imageEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`[Queue] Image generation job ${jobId} failed:`, failedReason);
});

// Monitor publishing queue
publishEvents.on('completed', ({ jobId }) => {
  console.log(`[Queue] Publishing job ${jobId} completed`);
});

publishEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`[Queue] Publishing job ${jobId} failed:`, failedReason);
});

/**
 * Add a content generation job
 */
export async function addContentGenerationJob(topic) {
  try {
    const job = await contentQueue.add('generate-content', {
      topic,
      timestamp: new Date().toISOString(),
    }, {
      jobId: `content-${Date.now()}-${topic.replace(/\s+/g, '-')}`,
    });

    console.log(`[Queue] Added content generation job: ${job.id}`);
    return job;
  } catch (error) {
    console.error('[Queue] Error adding content generation job:', error.message);
    throw error;
  }
}

/**
 * Add an image generation job
 */
export async function addImageGenerationJob(postId, topic, content) {
  try {
    const job = await imageQueue.add('generate-image', {
      postId,
      topic,
      content,
      timestamp: new Date().toISOString(),
    }, {
      jobId: `image-${Date.now()}-${postId}`,
    });

    console.log(`[Queue] Added image generation job: ${job.id} for post ${postId}`);
    return job;
  } catch (error) {
    console.error('[Queue] Error adding image generation job:', error.message);
    throw error;
  }
}

/**
 * Add a Facebook publishing job
 */
export async function addPublishJob(postId) {
  try {
    const job = await publishQueue.add('publish-to-facebook', {
      postId,
      timestamp: new Date().toISOString(),
    }, {
      jobId: `publish-${Date.now()}-${postId}`,
      delay: 5000, // Wait 5 seconds after image generation
    });

    console.log(`[Queue] Added publishing job: ${job.id} for post ${postId}`);
    return job;
  } catch (error) {
    console.error('[Queue] Error adding publishing job:', error.message);
    throw error;
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  try {
    const [contentCounts, imageCounts, publishCounts] = await Promise.all([
      contentQueue.getJobCounts(),
      imageQueue.getJobCounts(),
      publishQueue.getJobCounts(),
    ]);

    return {
      content: contentCounts,
      image: imageCounts,
      publish: publishCounts,
    };
  } catch (error) {
    console.error('[Queue] Error getting queue stats:', error.message);
    return null;
  }
}

/**
 * Clean old jobs from queues
 */
export async function cleanQueues() {
  try {
    await Promise.all([
      contentQueue.clean(86400000, 100, 'completed'), // Clean completed jobs older than 24 hours
      contentQueue.clean(604800000, 100, 'failed'), // Clean failed jobs older than 7 days
      imageQueue.clean(86400000, 100, 'completed'),
      imageQueue.clean(604800000, 100, 'failed'),
      publishQueue.clean(86400000, 100, 'completed'),
      publishQueue.clean(604800000, 100, 'failed'),
    ]);

    console.log('[Queue] Queue cleanup completed');
  } catch (error) {
    console.error('[Queue] Error cleaning queues:', error.message);
  }
}

/**
 * Graceful shutdown - close all queue connections
 */
export async function closeQueues() {
  try {
    await Promise.all([
      contentQueue.close(),
      imageQueue.close(),
      publishQueue.close(),
      contentEvents.close(),
      imageEvents.close(),
      publishEvents.close(),
    ]);

    if (redisClient) {
      await redisClient.quit();
    }

    console.log('[Queue] All queues closed gracefully');
  } catch (error) {
    console.error('[Queue] Error closing queues:', error.message);
  }
}

export default {
  contentQueue,
  imageQueue,
  publishQueue,
  addContentGenerationJob,
  addImageGenerationJob,
  addPublishJob,
  getQueueStats,
  cleanQueues,
  closeQueues,
  initRedis,
};

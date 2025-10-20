/**
 * PostgreSQL Database Connection and Query Helper
 * Manages database connection pool and provides utility functions
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err);
  process.exit(-1);
});

// Test database connection
export async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now');
    console.log('[DB] Connection successful:', result.rows[0].now);
    client.release();
    return true;
  } catch (error) {
    console.error('[DB] Connection failed:', error.message);
    throw error;
  }
}

/**
 * Create a new post record in the database
 */
export async function createPost({ topic, content, hashtags, imageUrl = null }) {
  const query = `
    INSERT INTO kangen_posts (topic, content, hashtags, image_url, status)
    VALUES ($1, $2, $3, $4, 'generating')
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [topic, content, hashtags, imageUrl]);
    console.log(`[DB] Created post record: ID ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] Error creating post:', error.message);
    throw error;
  }
}

/**
 * Update post status
 */
export async function updatePostStatus(postId, status, errorMessage = null) {
  const query = `
    UPDATE kangen_posts
    SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [status, errorMessage, postId]);
    console.log(`[DB] Updated post ${postId} status to: ${status}`);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] Error updating post status:', error.message);
    throw error;
  }
}

/**
 * Update post with image URL
 */
export async function updatePostImage(postId, imageUrl) {
  const query = `
    UPDATE kangen_posts
    SET image_url = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [imageUrl, postId]);
    console.log(`[DB] Updated post ${postId} with image URL`);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] Error updating post image:', error.message);
    throw error;
  }
}

/**
 * Mark post as successfully posted to Facebook
 */
export async function markPostAsPosted(postId, facebookPostId) {
  const query = `
    UPDATE kangen_posts
    SET status = 'posted',
        facebook_post_id = $1,
        posted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [facebookPostId, postId]);
    console.log(`[DB] Post ${postId} marked as posted. FB ID: ${facebookPostId}`);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] Error marking post as posted:', error.message);
    throw error;
  }
}

/**
 * Increment retry count for failed posts
 */
export async function incrementRetryCount(postId) {
  const query = `
    UPDATE kangen_posts
    SET retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [postId]);
    console.log(`[DB] Incremented retry count for post ${postId}`);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] Error incrementing retry count:', error.message);
    throw error;
  }
}

/**
 * Get post by ID
 */
export async function getPost(postId) {
  const query = 'SELECT * FROM kangen_posts WHERE id = $1';

  try {
    const result = await pool.query(query, [postId]);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] Error getting post:', error.message);
    throw error;
  }
}

/**
 * Get recent posts (for analytics)
 */
export async function getRecentPosts(limit = 10) {
  const query = `
    SELECT * FROM kangen_posts
    WHERE status = 'posted'
    ORDER BY posted_at DESC
    LIMIT $1
  `;

  try {
    const result = await pool.query(query, [limit]);
    return result.rows;
  } catch (error) {
    console.error('[DB] Error getting recent posts:', error.message);
    throw error;
  }
}

/**
 * Get last posted topic to support topic rotation
 */
export async function getLastPostedTopic() {
  const query = `
    SELECT topic FROM kangen_posts
    WHERE status = 'posted'
    ORDER BY posted_at DESC
    LIMIT 1
  `;

  try {
    const result = await pool.query(query);
    return result.rows[0]?.topic || null;
  } catch (error) {
    console.error('[DB] Error getting last topic:', error.message);
    return null;
  }
}

/**
 * Update engagement metrics for a post
 */
export async function updateEngagement(postId, likes, comments, shares) {
  const query = `
    UPDATE kangen_posts
    SET engagement_likes = $1,
        engagement_comments = $2,
        engagement_shares = $3,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [likes, comments, shares, postId]);
    console.log(`[DB] Updated engagement for post ${postId}`);
    return result.rows[0];
  } catch (error) {
    console.error('[DB] Error updating engagement:', error.message);
    throw error;
  }
}

/**
 * Close database pool (for graceful shutdown)
 */
export async function closePool() {
  await pool.end();
  console.log('[DB] Database pool closed');
}

export default pool;

/**
 * Engagement Tracker
 * Fetches post performance metrics from Facebook Graph API
 * Stores engagement data for analysis and learning
 */

import fetch from 'node-fetch';
import pool from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;

/**
 * Fetch engagement metrics for a specific post from Facebook
 */
export async function fetchPostEngagement(facebookPostId) {
  try {
    if (!facebookPostId) {
      console.warn('[EngagementTracker] No Facebook post ID provided');
      return null;
    }

    const url = `${GRAPH_API_BASE}/${facebookPostId}`;
    const params = new URLSearchParams({
      fields: 'likes.limit(1).summary(true),comments.limit(1).summary(true),shares',
      access_token: PAGE_ACCESS_TOKEN,
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();

    if (!response.ok) {
      console.error('[EngagementTracker] Facebook API error:', data);
      return null;
    }

    const likes = data.likes?.summary?.total_count || 0;
    const comments = data.comments?.summary?.total_count || 0;
    const shares = data.shares?.count || 0;

    console.log(`[EngagementTracker] Post ${facebookPostId} - Likes: ${likes}, Comments: ${comments}, Shares: ${shares}`);

    return {
      facebookPostId,
      likes,
      comments,
      shares,
      totalInteractions: likes + comments + shares,
      fetchedAt: new Date(),
    };
  } catch (error) {
    console.error('[EngagementTracker] Error fetching engagement:', error);
    return null;
  }
}

/**
 * Store engagement metrics in database and calculate engagement rate
 */
export async function storeEngagement(postId, engagement) {
  try {
    if (!engagement) return null;

    const { likes, comments, shares } = engagement;

    // Calculate engagement rate (normalized by post age)
    const result = await pool.query('SELECT posted_at FROM kangen_posts WHERE id = $1', [postId]);

    if (result.rows.length === 0) {
      console.warn('[EngagementTracker] Post not found:', postId);
      return null;
    }

    const postedAt = new Date(result.rows[0].posted_at);
    const ageHours = (Date.now() - postedAt.getTime()) / (1000 * 60 * 60);
    const engagementRate = ageHours > 0 ? ((likes + comments * 2 + shares * 3) / ageHours).toFixed(2) : 0;

    // Store in post_engagement table
    const insertResult = await pool.query(
      `INSERT INTO post_engagement (post_id, likes, comments, shares, engagement_rate, measured_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, engagement_rate`,
      [postId, likes, comments, shares, engagementRate]
    );

    // Update main posts table with engagement rate
    await pool.query('UPDATE kangen_posts SET engagement_rate = $1 WHERE id = $2', [
      engagementRate,
      postId,
    ]);

    console.log(`[EngagementTracker] Stored engagement for post ${postId}: rate = ${engagementRate}/hr`);

    return {
      postId,
      likes,
      comments,
      shares,
      engagementRate,
      ageHours: ageHours.toFixed(1),
    };
  } catch (error) {
    console.error('[EngagementTracker] Error storing engagement:', error);
    throw error;
  }
}

/**
 * Batch fetch and store engagement for all recent posts
 * Run this periodically (every 6 hours)
 */
export async function updateRecentPostsEngagement() {
  try {
    console.log('[EngagementTracker] Starting batch engagement update...');

    // Get all posts from last 7 days that have been posted
    const result = await pool.query(
      `SELECT id, facebook_post_id FROM kangen_posts
       WHERE status = 'posted'
       AND posted_at > NOW() - INTERVAL '7 days'
       ORDER BY posted_at DESC
       LIMIT 100`
    );

    console.log(`[EngagementTracker] Updating ${result.rows.length} posts...`);

    const updates = [];
    for (const post of result.rows) {
      const engagement = await fetchPostEngagement(post.facebook_post_id);
      if (engagement) {
        const stored = await storeEngagement(post.id, engagement);
        updates.push(stored);
      }
      // Rate limit - space out requests
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`[EngagementTracker] Successfully updated ${updates.length} posts`);
    return updates;
  } catch (error) {
    console.error('[EngagementTracker] Batch update failed:', error);
    throw error;
  }
}

/**
 * Get top performing posts
 */
export async function getTopPosts(limit = 10) {
  try {
    const result = await pool.query(
      `SELECT id, topic, content, engagement_rate, likes, comments, shares, posted_at
       FROM kangen_posts
       WHERE status = 'posted'
       ORDER BY engagement_rate DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  } catch (error) {
    console.error('[EngagementTracker] Error fetching top posts:', error);
    throw error;
  }
}

/**
 * Get engagement trends (hourly breakdown)
 */
export async function getEngagementTrends(days = 7) {
  try {
    const result = await pool.query(
      `SELECT
         EXTRACT(HOUR FROM posted_at) as hour_of_day,
         COUNT(*) as total_posts,
         AVG(engagement_rate) as avg_engagement,
         SUM(engagement_rate) as total_engagement
       FROM kangen_posts
       WHERE status = 'posted'
       AND posted_at > NOW() - INTERVAL '$1 days'
       GROUP BY hour_of_day
       ORDER BY hour_of_day`,
      [days]
    );

    return result.rows;
  } catch (error) {
    console.error('[EngagementTracker] Error fetching trends:', error);
    throw error;
  }
}

/**
 * Get engagement by topic
 */
export async function getEngagementByTopic(limit = 20) {
  try {
    const result = await pool.query(
      `SELECT
         topic,
         COUNT(*) as total_posts,
         AVG(engagement_rate) as avg_engagement,
         SUM(likes) as total_likes,
         SUM(comments) as total_comments,
         SUM(shares) as total_shares
       FROM kangen_posts kp
       JOIN post_engagement pe ON kp.id = pe.post_id
       WHERE kp.status = 'posted'
       GROUP BY topic
       ORDER BY avg_engagement DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  } catch (error) {
    console.error('[EngagementTracker] Error fetching topic breakdown:', error);
    throw error;
  }
}

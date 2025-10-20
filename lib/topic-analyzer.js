/**
 * Topic Analyzer
 * Analyzes topic performance and creates weighted selection probabilities
 * Learns which topics drive engagement and biases future generation toward high performers
 */

import pool from './db.js';

const DEFAULT_TOPICS = [
  'Health Benefits',
  'Hydration Science',
  'Detoxification',
  'Energy Boost',
  'Wellness Tips',
  'Customer Stories',
  'pH Balance',
  'Daily Routine',
  'Lifestyle Change',
  'Testimonials',
];

/**
 * Calculate topic weights based on historical performance
 * Topics with higher engagement get higher probability
 */
export async function calculateTopicWeights() {
  try {
    console.log('[TopicAnalyzer] Calculating topic weights...');

    const weights = {};

    for (const topic of DEFAULT_TOPICS) {
      const result = await pool.query(
        `SELECT
           COUNT(*) as total_posts,
           COALESCE(AVG(engagement_rate), 0) as avg_engagement,
           COALESCE(SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END), 0) as posted_count
         FROM kangen_posts
         WHERE topic = $1
         AND posted_at > NOW() - INTERVAL '30 days'`,
        [topic]
      );

      const row = result.rows[0];
      const totalPosts = parseInt(row.total_posts) || 0;
      const avgEngagement = parseFloat(row.avg_engagement) || 0;
      const postedCount = parseInt(row.posted_count) || 0;

      if (totalPosts === 0) {
        // New topic: give it baseline weight
        weights[topic] = {
          weight: 1.0,
          reason: 'new_topic',
          totalPosts: 0,
          avgEngagement: 0,
        };
      } else {
        // Calculate weight: engagement * post recency factor * consistency
        const engagementWeight = Math.max(0.1, avgEngagement);
        const recencyBoost = postedCount > 0 ? 1.2 : 0.8;
        const consistency = postedCount > 0 ? 1.0 + postedCount * 0.1 : 1.0;

        weights[topic] = {
          weight: engagementWeight * recencyBoost * consistency,
          reason: 'performance_based',
          totalPosts,
          avgEngagement: avgEngagement.toFixed(2),
        };
      }
    }

    // Normalize weights so they sum to 1
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w.weight, 0);
    const normalizedWeights = {};

    for (const [topic, data] of Object.entries(weights)) {
      normalizedWeights[topic] = {
        ...data,
        normalizedWeight: (data.weight / totalWeight).toFixed(3),
        probability: `${((data.weight / totalWeight) * 100).toFixed(1)}%`,
      };
    }

    // Store in database
    for (const [topic, data] of Object.entries(normalizedWeights)) {
      await pool.query(
        `INSERT INTO topic_weights (topic, performance_score, engagement_rate, total_posts, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (topic) DO UPDATE SET
           performance_score = $2,
           engagement_rate = $3,
           total_posts = $4,
           updated_at = NOW()`,
        [topic, data.normalizedWeight, data.avgEngagement, data.totalPosts]
      );
    }

    console.log('[TopicAnalyzer] Topic weights calculated:', normalizedWeights);
    return normalizedWeights;
  } catch (error) {
    console.error('[TopicAnalyzer] Error calculating weights:', error);
    throw error;
  }
}

/**
 * Select next topic using weighted probability
 * Higher performing topics have higher chance of selection
 */
export async function selectWeightedTopic() {
  try {
    const result = await pool.query(`
      SELECT topic, CAST(performance_score as FLOAT) as weight
      FROM topic_weights
      ORDER BY topic ASC
    `);

    if (result.rows.length === 0) {
      console.log('[TopicAnalyzer] No topic weights found, returning random topic');
      return DEFAULT_TOPICS[Math.floor(Math.random() * DEFAULT_TOPICS.length)];
    }

    // Build weighted selection pool
    const topics = result.rows;
    const totalWeight = topics.reduce((sum, t) => sum + (t.weight || 0), 0);

    // Random number between 0 and totalWeight
    let random = Math.random() * totalWeight;

    for (const topic of topics) {
      random -= topic.weight || 0;
      if (random <= 0) {
        console.log(`[TopicAnalyzer] Selected topic: ${topic.topic} (weight: ${topic.weight})`);
        return topic.topic;
      }
    }

    // Fallback
    return topics[0].topic;
  } catch (error) {
    console.error('[TopicAnalyzer] Error selecting topic:', error);
    return DEFAULT_TOPICS[Math.floor(Math.random() * DEFAULT_TOPICS.length)];
  }
}

/**
 * Get topic performance rankings
 */
export async function getTopicRankings() {
  try {
    const result = await pool.query(`
      SELECT
        topic,
        total_posts,
        COALESCE(engagement_rate, 0) as avg_engagement,
        COALESCE(likes_total, 0) as total_likes,
        COALESCE(comments_total, 0) as total_comments,
        COALESCE(shares_total, 0) as total_shares,
        CAST(performance_score as FLOAT) as weight
      FROM topic_weights
      ORDER BY performance_score DESC
    `);

    return result.rows.map((row) => ({
      ...row,
      probability: `${(parseFloat(row.weight) * 100).toFixed(1)}%`,
    }));
  } catch (error) {
    console.error('[TopicAnalyzer] Error fetching rankings:', error);
    throw error;
  }
}

/**
 * Update topic engagement totals (called after post engagement is fetched)
 */
export async function updateTopicStats(topic, likes, comments, shares) {
  try {
    await pool.query(
      `UPDATE topic_weights
       SET likes_total = COALESCE(likes_total, 0) + $1,
           comments_total = COALESCE(comments_total, 0) + $2,
           shares_total = COALESCE(shares_total, 0) + $3,
           updated_at = NOW()
       WHERE topic = $4`,
      [likes, comments, shares, topic]
    );

    console.log(`[TopicAnalyzer] Updated stats for topic: ${topic}`);
  } catch (error) {
    console.error('[TopicAnalyzer] Error updating topic stats:', error);
  }
}

/**
 * Get performance comparison
 */
export async function getPerformanceComparison() {
  try {
    const result = await pool.query(`
      SELECT
        topic,
        total_posts,
        COALESCE(engagement_rate, 0) as avg_engagement,
        CASE
          WHEN engagement_rate > 1.0 THEN 'High Performer'
          WHEN engagement_rate > 0.5 THEN 'Medium Performer'
          ELSE 'Low Performer'
        END as category,
        COALESCE(performance_score, 0) as selection_weight
      FROM topic_weights
      ORDER BY engagement_rate DESC
    `);

    const highPerformers = result.rows.filter((r) => r.category === 'High Performer');
    const mediumPerformers = result.rows.filter((r) => r.category === 'Medium Performer');
    const lowPerformers = result.rows.filter((r) => r.category === 'Low Performer');

    return {
      summary: {
        total_topics: result.rows.length,
        high_performers: highPerformers.length,
        medium_performers: mediumPerformers.length,
        low_performers: lowPerformers.length,
      },
      highPerformers,
      mediumPerformers,
      lowPerformers,
    };
  } catch (error) {
    console.error('[TopicAnalyzer] Error fetching comparison:', error);
    throw error;
  }
}

/**
 * Initialize topic weights if they don't exist
 */
export async function initializeTopicWeights() {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM topic_weights');
    const count = parseInt(result.rows[0].count);

    if (count === 0) {
      console.log('[TopicAnalyzer] Initializing topic weights for first time...');

      for (const topic of DEFAULT_TOPICS) {
        await pool.query(
          `INSERT INTO topic_weights (topic, performance_score, engagement_rate, total_posts)
           VALUES ($1, 0.1, 0, 0)`,
          [topic]
        );
      }

      console.log('[TopicAnalyzer] Initialized', DEFAULT_TOPICS.length, 'topics');
    }

    return count === 0;
  } catch (error) {
    console.error('[TopicAnalyzer] Error initializing weights:', error);
    throw error;
  }
}

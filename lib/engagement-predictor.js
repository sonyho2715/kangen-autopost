/**
 * Engagement Predictor
 * Predicts post engagement based on topic history, timing, and content patterns
 * Assigns confidence scores to posts for smart auto-approval
 */

import pool from './db.js';

/**
 * Predict engagement for a post
 * Returns confidence score (0-100) and factors
 */
export async function predictEngagement(topic, content, hashtags, postingTime) {
  try {
    console.log('[Predictor] Predicting engagement for topic:', topic);

    let confidenceScore = 50; // Start at baseline
    const factors = {};

    // Factor 1: Topic historical performance (0-30 points)
    const topicResult = await pool.query(
      `SELECT COALESCE(engagement_rate, 0) as avg_engagement,
              CAST(performance_score as FLOAT) as weight,
              total_posts
       FROM topic_weights
       WHERE topic = $1`,
      [topic]
    );

    if (topicResult.rows.length > 0) {
      const topicData = topicResult.rows[0];
      const topicScore = Math.min(30, (parseFloat(topicData.avg_engagement) || 0) * 30);
      confidenceScore += topicScore;
      factors.topic = {
        score: topicScore.toFixed(1),
        reason: `Topic avg engagement: ${topicData.avg_engagement}`,
        totalPosts: topicData.total_posts,
      };
    } else {
      factors.topic = { score: 0, reason: 'New topic' };
    }

    // Factor 2: Posting time optimization (0-20 points)
    const hour = new Date(postingTime).getHours();
    const timeResult = await pool.query(
      `SELECT
         AVG(engagement_rate) as avg_engagement
       FROM kangen_posts
       WHERE status = 'posted'
       AND EXTRACT(HOUR FROM posted_at) = $1
       AND posted_at > NOW() - INTERVAL '14 days'`,
      [hour]
    );

    if (timeResult.rows.length > 0 && timeResult.rows[0].avg_engagement) {
      const timeScore = Math.min(20, (parseFloat(timeResult.rows[0].avg_engagement) || 0) * 20);
      confidenceScore += timeScore;
      factors.timing = {
        score: timeScore.toFixed(1),
        reason: `Hour ${hour} avg engagement: ${timeResult.rows[0].avg_engagement}`,
        peakHours: await getPeakPostingHours(),
      };
    } else {
      factors.timing = { score: 5, reason: 'Off-peak hour' };
      confidenceScore += 5;
    }

    // Factor 3: Hashtag effectiveness (0-20 points)
    if (hashtags) {
      const hashtagScore = await predictHashtagPerformance(hashtags);
      const weightedHashtagScore = Math.min(20, hashtagScore * 20);
      confidenceScore += weightedHashtagScore;
      factors.hashtags = {
        score: weightedHashtagScore.toFixed(1),
        reason: `Hashtag performance: ${hashtagScore.toFixed(2)}`,
        tags: hashtags.split(' ').slice(0, 3),
      };
    }

    // Factor 4: Content length and structure (0-10 points)
    const contentScore = evaluateContentQuality(content);
    confidenceScore += contentScore;
    factors.content = {
      score: contentScore.toFixed(1),
      reason: 'Content structure and length analysis',
      length: content.length,
      wordCount: content.split(' ').length,
    };

    // Factor 5: Recent post momentum (0-20 points)
    const momentumScore = await calculateRecentMomentum(topic);
    confidenceScore += momentumScore;
    factors.momentum = {
      score: momentumScore.toFixed(1),
      reason: 'Recent post performance trend',
    };

    // Cap at 100
    confidenceScore = Math.min(100, confidenceScore);

    const result = {
      topic,
      confidenceScore: Math.round(confidenceScore),
      factors,
      recommendation: getApprovalRecommendation(confidenceScore),
      timestamp: new Date(),
    };

    console.log('[Predictor] Prediction complete:', result);
    return result;
  } catch (error) {
    console.error('[Predictor] Error predicting engagement:', error);
    // Return safe default
    return {
      topic,
      confidenceScore: 50,
      factors: { error: error.message },
      recommendation: 'manual_review',
      timestamp: new Date(),
    };
  }
}

/**
 * Get approval recommendation based on confidence score
 */
function getApprovalRecommendation(score) {
  if (score >= 85) return 'auto_approve';
  if (score >= 70) return 'delayed_approve'; // Approve after 5 min delay
  if (score >= 60) return 'optional_approve'; // Allow user to skip review
  return 'manual_review'; // Require manual approval
}

/**
 * Evaluate content quality
 */
function evaluateContentQuality(content) {
  let score = 5; // Base score

  // Optimal length: 150-300 characters
  if (content.length >= 150 && content.length <= 300) {
    score += 3;
  } else if (content.length > 100) {
    score += 1;
  }

  // Check for CTA
  const ctaKeywords = ['learn', 'try', 'discover', 'join', 'click', 'visit', 'get'];
  if (ctaKeywords.some((kw) => content.toLowerCase().includes(kw))) {
    score += 2;
  }

  // Check for question (typically higher engagement)
  if (content.includes('?')) {
    score += 2;
  }

  // Check for urgency/value words
  const valueWords = ['now', 'today', 'free', 'special', 'exclusive', 'amazing', 'incredible'];
  const valueCount = valueWords.filter((word) => content.toLowerCase().includes(word)).length;
  score += Math.min(3, valueCount);

  return Math.min(10, score);
}

/**
 * Predict hashtag performance
 */
async function predictHashtagPerformance(hashtags) {
  try {
    if (!hashtags) return 0.5;

    const tags = hashtags.split(' ').filter((tag) => tag.startsWith('#'));
    if (tags.length === 0) return 0.5;

    const result = await pool.query(
      `SELECT AVG(COALESCE(avg_engagement_rate, 0)) as avg
       FROM hashtag_performance
       WHERE hashtag = ANY($1)`,
      [tags]
    );

    return (parseFloat(result.rows[0].avg) || 0.5) / 2; // Normalize to 0-1
  } catch (error) {
    console.error('[Predictor] Error predicting hashtag performance:', error);
    return 0.5;
  }
}

/**
 * Calculate recent momentum for a topic
 */
async function calculateRecentMomentum(topic) {
  try {
    const result = await pool.query(
      `SELECT
         AVG(engagement_rate) as avg_recent,
         COUNT(*) as post_count
       FROM kangen_posts
       WHERE topic = $1
       AND posted_at > NOW() - INTERVAL '7 days'
       AND status = 'posted'`,
      [topic]
    );

    if (result.rows[0].post_count === 0) {
      return 5; // New topic, low momentum score
    }

    const avgRecent = parseFloat(result.rows[0].avg_recent) || 0;
    return Math.min(20, avgRecent * 10);
  } catch (error) {
    console.error('[Predictor] Error calculating momentum:', error);
    return 10;
  }
}

/**
 * Get peak posting hours based on historical data
 */
async function getPeakPostingHours() {
  try {
    const result = await pool.query(
      `SELECT
         EXTRACT(HOUR FROM posted_at) as hour,
         AVG(engagement_rate) as avg_engagement,
         COUNT(*) as post_count
       FROM kangen_posts
       WHERE status = 'posted'
       AND posted_at > NOW() - INTERVAL '30 days'
       GROUP BY hour
       ORDER BY avg_engagement DESC
       LIMIT 3`
    );

    return result.rows.map((row) => ({
      hour: parseInt(row.hour),
      avgEngagement: parseFloat(row.avg_engagement).toFixed(2),
      postCount: row.post_count,
    }));
  } catch (error) {
    console.error('[Predictor] Error getting peak hours:', error);
    return [];
  }
}

/**
 * Store prediction for later learning
 */
export async function storePrediction(postId, prediction) {
  try {
    await pool.query(
      `UPDATE kangen_posts
       SET confidence_score = $1
       WHERE id = $2`,
      [prediction.confidenceScore, postId]
    );

    console.log(`[Predictor] Stored confidence score ${prediction.confidenceScore} for post ${postId}`);
  } catch (error) {
    console.error('[Predictor] Error storing prediction:', error);
  }
}

/**
 * Learn from user approvals to improve future predictions
 */
export async function learnFromApproval(postId, userRating, actualEngagement) {
  try {
    const postResult = await pool.query(
      `SELECT confidence_score FROM kangen_posts WHERE id = $1`,
      [postId]
    );

    if (postResult.rows.length === 0) return;

    const predictedScore = postResult.rows[0].confidence_score;

    await pool.query(
      `INSERT INTO approval_history (post_id, user_rating, predicted_score, actual_engagement)
       VALUES ($1, $2, $3, $4)`,
      [postId, userRating, predictedScore, actualEngagement]
    );

    console.log(
      `[Predictor] Learned: post ${postId} - predicted ${predictedScore}, user rated ${userRating}`
    );
  } catch (error) {
    console.error('[Predictor] Error storing learning:', error);
  }
}

/**
 * Get prediction accuracy
 */
export async function getPredictionAccuracy() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN actual_engagement > 0 THEN 1 END) as with_engagement,
        AVG(ABS(predicted_score - user_rating)) as avg_error,
        CORR(predicted_score, user_rating) as correlation
      FROM approval_history
      WHERE actual_engagement > 0
    `);

    const row = result.rows[0];
    return {
      totalReviews: parseInt(row.total),
      averageError: parseFloat(row.avg_error).toFixed(2),
      correlation: row.correlation ? parseFloat(row.correlation).toFixed(3) : 'N/A',
      accuracy: row.total > 0 ? `${((1 - parseFloat(row.avg_error) / 100) * 100).toFixed(1)}%` : 'N/A',
    };
  } catch (error) {
    console.error('[Predictor] Error getting accuracy:', error);
    return {};
  }
}

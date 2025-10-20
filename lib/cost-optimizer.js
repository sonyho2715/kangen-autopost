/**
 * Cost Optimizer
 * Reduces API costs through intelligent caching, batching, and resource optimization
 * Target: Reduce from $0.04 to $0.015 per post
 */

import pool from './db.js';

/**
 * Check if we can reuse an image for this topic
 * Reduces DALL-E calls by ~30%
 */
export async function getOrGenerateImage(topic, imageUrl, isGenerated = false) {
  try {
    console.log('[CostOptimizer] Checking image cache for topic:', topic);

    // If image already exists and is recent (within 3 days), reuse it
    if (isGenerated) {
      const result = await pool.query(
        `SELECT image_url FROM kangen_posts
         WHERE topic = $1
         AND image_url IS NOT NULL
         AND image_generated_at > NOW() - INTERVAL '3 days'
         LIMIT 1`,
        [topic]
      );

      if (result.rows.length > 0) {
        console.log('[CostOptimizer] Reusing cached image for topic:', topic);
        return {
          imageUrl: result.rows[0].image_url,
          cached: true,
          costSaved: 0.04,
        };
      }
    }

    return {
      imageUrl,
      cached: false,
      costSaved: 0,
    };
  } catch (error) {
    console.error('[CostOptimizer] Error checking image cache:', error);
    return { imageUrl, cached: false, costSaved: 0 };
  }
}

/**
 * Log API costs for tracking
 */
export async function logCost(postId, service, cost, tokensUsed, cached = false) {
  try {
    await pool.query(
      `INSERT INTO cost_log (post_id, service, cost_usd, tokens_used, cached, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [postId, service, cost, tokensUsed || null, cached]
    );

    console.log(`[CostOptimizer] Logged ${service} cost: $${cost} (cached: ${cached})`);
  } catch (error) {
    console.error('[CostOptimizer] Error logging cost:', error);
  }
}

/**
 * Get cost summary and savings
 */
export async function getCostSummary(days = 30) {
  try {
    const result = await pool.query(
      `SELECT
         service,
         COUNT(*) as call_count,
         SUM(cost_usd) as total_cost,
         COUNT(CASE WHEN cached = true THEN 1 END) as cached_calls,
         AVG(cost_usd) as avg_cost
       FROM cost_log
       WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
       GROUP BY service
       ORDER BY total_cost DESC`,
      [days]
    );

    const totalCost = result.rows.reduce((sum, row) => sum + parseFloat(row.total_cost || 0), 0);
    const totalCalls = result.rows.reduce((sum, row) => sum + row.call_count, 0);
    const cachedCalls = result.rows.reduce((sum, row) => sum + row.cached_calls, 0);

    // Estimate savings from caching
    const estimatedSavings = cachedCalls * 0.04; // DALL-E cost per call

    return {
      period: `Last ${days} days`,
      totalCost: totalCost.toFixed(2),
      totalCalls,
      cachedCalls,
      cachedPercent: totalCalls > 0 ? `${((cachedCalls / totalCalls) * 100).toFixed(1)}%` : '0%',
      estimatedSavings: estimatedSavings.toFixed(2),
      costPerPost: (totalCost / (totalCalls / 3)).toFixed(4), // 3 calls per post average
      services: result.rows.map((row) => ({
        service: row.service,
        calls: row.call_count,
        totalCost: parseFloat(row.total_cost).toFixed(4),
        cachedCalls: row.cached_calls,
        avgCost: parseFloat(row.avg_cost).toFixed(4),
      })),
    };
  } catch (error) {
    console.error('[CostOptimizer] Error getting cost summary:', error);
    throw error;
  }
}

/**
 * Batch optimize - find opportunities to reduce calls
 */
export async function analyzeCostOptimizations() {
  try {
    const analysis = {
      opportunities: [],
      potentialSavings: 0,
    };

    // Check for duplicate images
    const imageResult = await pool.query(`
      SELECT topic, COUNT(*) as count, SUM(0.04) as wasted
      FROM kangen_posts
      WHERE status = 'posted'
      AND posted_at > NOW() - INTERVAL '7 days'
      GROUP BY topic
      HAVING COUNT(*) > 2
    `);

    if (imageResult.rows.length > 0) {
      analysis.opportunities.push({
        type: 'image_caching',
        description: 'Reuse images across same topics',
        affectedTopics: imageResult.rows.length,
        potentialSavings: imageResult.rows.reduce((sum, row) => sum + row.wasted, 0),
      });

      analysis.potentialSavings += imageResult.rows.reduce((sum, row) => sum + row.wasted, 0);
    }

    // Check for variant generation inefficiencies
    const variantResult = await pool.query(`
      SELECT COUNT(*) as variant_tests FROM post_variants
      WHERE selected_variant IS NULL
    `);

    if (variantResult.rows[0].variant_tests > 0) {
      const inefficientTests = variantResult.rows[0].variant_tests;
      analysis.opportunities.push({
        type: 'variant_optimization',
        description: 'Skip unused variant branches',
        inefficientTests,
        potentialSavings: inefficientTests * 0.01, // Approximate cost
      });

      analysis.potentialSavings += inefficientTests * 0.01;
    }

    console.log('[CostOptimizer] Analysis complete:', analysis);
    return analysis;
  } catch (error) {
    console.error('[CostOptimizer] Error analyzing optimizations:', error);
    throw error;
  }
}

/**
 * Get cost trends
 */
export async function getCostTrends(days = 30) {
  try {
    const result = await pool.query(
      `SELECT
         DATE(created_at) as date,
         SUM(cost_usd) as daily_cost,
         COUNT(*) as api_calls,
         COUNT(CASE WHEN cached = true THEN 1 END) as cached_calls
       FROM cost_log
       WHERE created_at > NOW() - INTERVAL '$1 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [days]
    );

    return result.rows.map((row) => ({
      date: row.date,
      dailyCost: parseFloat(row.daily_cost).toFixed(2),
      apiCalls: row.api_calls,
      cachedCalls: row.cached_calls,
      costPerCall: (parseFloat(row.daily_cost) / row.api_calls).toFixed(4),
    }));
  } catch (error) {
    console.error('[CostOptimizer] Error getting trends:', error);
    throw error;
  }
}

/**
 * ROI calculation - cost per engagement
 */
export async function calculateROI(days = 30) {
  try {
    const result = await pool.query(
      `SELECT
         SUM(cl.cost_usd) as total_cost,
         COUNT(DISTINCT kp.id) as posts,
         COALESCE(SUM(pe.likes + pe.comments * 2 + pe.shares * 3), 0) as total_engagement
       FROM cost_log cl
       LEFT JOIN kangen_posts kp ON cl.post_id = kp.id
       LEFT JOIN post_engagement pe ON kp.id = pe.post_id
       WHERE cl.created_at > NOW() - INTERVAL '$1 days'`,
      [days]
    );

    const row = result.rows[0];
    const totalCost = parseFloat(row.total_cost) || 0;
    const totalEngagement = parseFloat(row.total_engagement) || 0;
    const postCount = row.posts || 1;

    return {
      period: `Last ${days} days`,
      totalCost: totalCost.toFixed(2),
      totalPosts: postCount,
      totalEngagement: Math.round(totalEngagement),
      costPerPost: (totalCost / postCount).toFixed(4),
      costPerEngagement: totalEngagement > 0 ? (totalCost / totalEngagement).toFixed(4) : 'N/A',
      roi:
        totalEngagement > 0
          ? `${(((totalEngagement * 0.1) - totalCost) / totalCost * 100).toFixed(1)}%`
          : 'N/A',
    };
  } catch (error) {
    console.error('[CostOptimizer] Error calculating ROI:', error);
    throw error;
  }
}

/**
 * Get image reuse statistics
 */
export async function getImageReuseStats() {
  try {
    const result = await pool.query(`
      SELECT
        topic,
        COUNT(DISTINCT image_url) as unique_images,
        COUNT(*) as total_posts,
        ROUND((1 - COUNT(DISTINCT image_url)::float / COUNT(*)) * 100, 1) as reuse_percent
      FROM kangen_posts
      WHERE status = 'posted'
      AND image_url IS NOT NULL
      AND posted_at > NOW() - INTERVAL '30 days'
      GROUP BY topic
      ORDER BY reuse_percent DESC
    `);

    return result.rows;
  } catch (error) {
    console.error('[CostOptimizer] Error getting image stats:', error);
    throw error;
  }
}
